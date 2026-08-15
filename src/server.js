import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID, randomBytes } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { gunzipSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RumbleGame, makeRng, autoEntryInterval, expectedClues, DEFAULT_SETTINGS } from './engine.js';
import { makeWeightedPool, fromTtgJson, fromJpartyCsv, parseCsv, parseLooseJson } from './sources.js';
import { assignToken, resolveChoice } from './tokens-server.js';
import { distinctLook, looksAlike } from '../public/wrestlers.js';
import { wrongAnswer } from './wrongs.js';
import * as logs from './logstore.js';
import { makeBot, botName, planClue, describe as describeBot, LEVELS,
         loadDistributions, drawReadJitter, referenceHumanMedian,
         nightlyForm } from './bots.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

// 45k categories decompress to ~90MB of JS objects. Loaded once at boot and
// held in memory; the alternative is a per-draw disk read on every category.
const PKG = JSON.parse(readFileSync(join(__dir, '../package.json'), 'utf8'));
export const VERSION = PKG.version;
const BOOTED = Date.now();
const MACHINE = process.env.FLY_MACHINE_ID || 'local';

// Real buzz histograms, recorded from play of the original model.
try {
  loadDistributions(JSON.parse(readFileSync(join(__dir, '../data/buzz-distributions.json'), 'utf8')));
} catch (e) {
  console.log('no buzz distributions found; robots will use parametric profiles');
}

const LIBRARY = gunzipSync(readFileSync(join(__dir, '../data/library.ndjson.gz')))
  .toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Categories imported before the title fix carry their escapes. Cleaning them
// at load costs a few milliseconds once and saves a library rebuild.
// Categories imported before the escape fix carry their escapes — and some
// carry them twice, having been through two converters. Cleaning at load costs
// a second at boot and saves rebuilding a 47,000-category library.
const unescapeText = (t) => {
  if (typeof t !== 'string') return t;
  let out = t;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/\\(["'\\])/g, '$1');
    if (next === out) break;
    out = next;
  }
  return out.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
};
let fixedCats = 0, fixedClues = 0;
for (const c of LIBRARY) {
  const t = unescapeText(c.title), n = unescapeText(c.note);
  if (t !== c.title || n !== c.note) fixedCats++;
  c.title = t; c.note = n;
  for (const x of c.clues) {
    const tx = unescapeText(x.text), an = unescapeText(x.answer);
    if (tx !== x.text || an !== x.answer) fixedClues++;
    x.text = tx; x.answer = an;
  }
}
if (fixedCats || fixedClues) {
  console.log(`repaired escapes: ${fixedCats} categories, ${fixedClues} clues`);
}

const SEASONS = [...new Set(LIBRARY.map((c) => c.provenance?.season).filter(Boolean))].sort();
console.log(`v${VERSION} · machine ${MACHINE} · library ${LIBRARY.length} categories, seasons ${SEASONS[0]}-${SEASONS.at(-1)}`);

const app = express();
app.use(express.json({ limit: '12mb' }));

// A retired host, kept running as a fallback, is a hazard: matches live in
// memory on one instance, so half a group joining the old address and half the
// new one is two separate broken games. Set RUMBLE_MOVED_TO on the old box and
// every page redirects, preserving the path so an old /j/ABCD link lands on the
// right room at the new address.
//
// Deliberately not a hardcoded domain: the old box is the one that needs to
// know it is old, and it is the only one that should have this set.
const MOVED_TO = process.env.RUMBLE_MOVED_TO || '';
if (MOVED_TO) {
  app.use((req, res, next) => {
    // Health checks still answer, so the box can be monitored while retired.
    if (req.path === '/api/health') return next();
    const to = MOVED_TO.replace(/\/$/, '') + req.originalUrl;
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.status(410).send(`<!doctype html><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>J! Royal Rumble has moved</title>
        <style>body{background:#0A0E1C;color:#EEEBE1;font:16px/1.6 system-ui,sans-serif;
        display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}
        a{color:#D6A93F}h1{font-size:22px;letter-spacing:.02em}p{color:#7C88AB;max-width:40ch}</style>
        <div><h1>This address has moved</h1>
        <p>The game now lives at a new address. This one is kept only as a spare,
        and a match started here would not be the same match as everyone else's.</p>
        <p><a href="${to}">${to}</a></p></div>`);
    }
    return res.redirect(308, to);
  });
}

// The rules engine, served to the browser so the setup page can use the same
// fairness measurements the server does rather than a second copy that drifts.
// Served at /src/engine.js so that `../src/engine.js` resolves the same way
// from a module in public/ whether it is loaded by the browser or by node.
app.get('/src/engine.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(join(__dir, 'engine.js'));
});

app.use(express.static(join(__dir, '../public')));

const http = createServer(app);
// Tuned for latency rather than throughput. Every message here is tiny, so
// compression costs more in CPU than it saves on the wire, and the polling
// fallback only adds a handshake we never want to pay for.
const io = new Server(http, {
  cors: { origin: false },
  transports: ['websocket'],
  perMessageDeflate: false,
  httpCompression: false,
  pingInterval: 20000,
  pingTimeout: 25000,
});
// Nagle batches small writes, which is exactly wrong for a buzzer.
http.on('connection', (sock) => sock.setNoDelay(true));

// ---------------------------------------------------------------- matches

// Long enough to collapse a burst of buzzes, short enough that nobody sees it.
const PUSH_COALESCE_MS = 25;

// How many human buzzes to watch before fixing the robots' speed to the field.
//
// Six was too few. Measured against two real matches, the first six buzzes gave
// 302ms and 242ms where the settled figures were 85ms and 60ms — people start
// slowly. The estimate stops moving at about sixteen:
//
//   buzzes    6     10    12    16    20    whole match
//   test 1  302    204   190   190   178      85
//   test 2  242    118   118   105    64      60
//
// Sixteen is still reached inside the first few clues, because warm-up presses
// count toward it — which is what stops the calibration failing to fire for a
// player who is being eliminated early.
const BOT_CALIBRATION_BUZZES = 16;

// Testing phase: record and save every match, whatever the host ticked.
const RECORD_EVERYTHING = process.env.RUMBLE_RECORD_ALL !== '0';

// What to assume until then. The robots were recorded against a human whose
// median buzz was 43ms; players of this game buzz at 200-450ms across every
// match recorded so far. Starting from zero meant starting at the harder end of
// that range, which is exactly the wrong way round for an unknown field.
const BOT_DEFAULT_OFFSET = 190;

const matches = new Map();   // gameId -> Match

// A host who closes the tab halfway through should still leave a log behind,
// and a deploy should not throw away a match in progress.
setInterval(() => {
  for (const m of matches.values()) {
    if (m.record && m.phase === 'live') m.saveLog({ partial: true });
  }
}, 3 * 60 * 1000).unref?.();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    for (const m of matches.values()) {
      if (m.record) m.saveLog({ partial: m.phase !== 'over' });
    }
    process.exit(0);
  });
}

class Match {
  // Four letters, spoken aloud over Zoom. Ambiguous pairs are left in — the
  // host reads it out, and a wrong code just fails to find a match.
  static newCode() {
    let c;
    do {
      c = Array.from({ length: 4 }, () =>
        'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
    } while (matches.has(c));
    return c;
  }

  constructor(settings = {}) {
    this.id = Match.newCode();
    this.hostKey = randomUUID();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    // All Jeopardy! archive by default. The custom boards are still there and
    // one slider moves them back in; they are just not what most matches want
    // as a starting point.
    this.blend = settings.blend || { original: 0, archive: 1 };
    this.roster = new Map();     // token -> { token, name, socketId, connected }
    this.game = null;
    this.phase = 'lobby';        // lobby | live | over
    this.clue = null;            // { slot, row, value, category, note, text, answer }
    this.race = null;            // { open, activatedAt, delay, buzzes:[], lockedOut:Set }
    this.vetoLog = [];
    this.fastest = null;
    this.stats = new Map();      // token -> buzzer + drain stats
    this.uploads = [];           // { name, categories: [...] }
    this.undoStack = [];         // snapshots taken before each scored clue
    this.history = [];           // { clue, ceiling, scores } — always kept, drives the graph
    this.record = null;          // detailed log, only when the host asks for it
    this.startedAt = null;
    this.corrections = [];
    this.control = null;         // who picks the next clue
    this.latency = new Map();    // token -> [{ at, ms }] one-way samples
    this.bots = new Map();       // token -> bot brain
    this.humanBuzzes = new Map();// token -> [ms] for the live-field offset
    this.frozenOffset = null;    // set once, then never moves
    this.botTimers = [];
  }

  stat(token) {
    if (!this.stats.has(token)) {
      this.stats.set(token, { att: 0, early: 0, won: 0, drained: 0, peak: 0, times: [] });
    }
    return this.stats.get(token);
  }

  uploadedCategories() {
    return this.uploads.flatMap((u) => u.categories);
  }

  available() {
    const [lo, hi] = this.settings.seasonRange || [SEASONS[0], SEASONS.at(-1)];
    return {
      archive: LIBRARY.filter((c) => c.source === 'archive'
        && c.provenance.season >= lo && c.provenance.season <= hi).length,
      original: LIBRARY.filter((c) => c.source === 'original').length,
      upload: this.uploadedCategories().length,
    };
  }

  pool() {
    const buckets = {};
    const [lo, hi] = this.settings.seasonRange || [SEASONS[0], SEASONS.at(-1)];
    const sets = {
      archive: LIBRARY.filter((c) => c.source === 'archive'
        && c.provenance.season >= lo && c.provenance.season <= hi),
      original: LIBRARY.filter((c) => c.source === 'original'),
      upload: this.uploadedCategories(),
    };
    for (const [name, weight] of Object.entries(this.blend)) {
      const cats = sets[name] || [];
      if (cats.length && weight > 0) buckets[name] = { weight, categories: cats };
    }
    if (!Object.keys(buckets).length) throw new Error('no clue material selected');
    return makeWeightedPool(buckets, this.rng);
  }

  start() {
    // isBot goes through: the engine spreads robots evenly through the draw so
    // a stretch of the match does not pass with nobody real walking in.
    const players = [...this.roster.values()]
      .map((p) => ({ id: p.token, name: p.name, isBot: !!p.isBot }));
    if (players.length < 3) throw new Error('need at least 3 players');
    this.rng = makeRng(Date.now() & 0x7fffffff);
    if (this.settings.entryInterval == null) {
      this.settings.entryInterval = autoEntryInterval(
        players.length, this.settings.targetMinutes, this.settings.secondsPerClue);
    }
    this.game = new RumbleGame({
      players, settings: this.settings, categoryPool: this.pool(), rng: this.rng,
    });
    // The engine resolves the auto settings against the roster. Adopt what it
    // decided so the console and the setup view report real numbers, not nulls.
    this.settings = { ...this.settings, ...this.game.s };
    this.phase = 'live';
    this.startedAt = Date.now();
    // Give every robot its form for the night. Real contestants swing about
    // six points of accuracy between games; without this a robot plays its
    // exact average every single match.
    for (const [tok, brain] of this.bots) {
      this.bots.set(tok, nightlyForm(brain, this.rng || makeRng(1)));
    }
    this.history = [{ clue: 0, ceiling: this.game.ceiling,
      scores: Object.fromEntries(this.game.live().map((p) => [p.id, p.score])) }];
    // Every match is recorded while the format is being tested. The setting
    // still exists, but nothing turns it off — a log that was not kept is a
    // test that has to be run again.
    // Always. Recording used to be a setting that defaulted off, which meant
    // the interesting matches — the ones nobody expected to be interesting —
    // were the ones without a record. The control room is where they are read.
    {
      this.record = {
        version: VERSION,
        startedAt: new Date().toISOString(),
        settings: { ...this.settings },
        blend: { ...this.blend },
        available: this.available(),
        // Theme included so an entrance-music failure can be looked into after
      // the fact; a log that records neither the choice nor the entrance leaves
      // nothing to go on.
      roster: [...this.roster.values()].map((p) => ({
        token: p.token, name: p.name, theme: p.theme || null })),
        draw: [...this.game.players.values()]
          .sort((a, b) => a.drawNumber - b.drawNumber)
          .map((p) => ({ draw: p.drawNumber, token: p.id, name: p.name })),
        estimate: {
          entryInterval: this.settings.entryInterval,
          secondsPerClue: this.settings.secondsPerClue,
          expectedClues: expectedClues(this.roster.size, this.settings.entryInterval),
          expectedMinutes: Math.round(
            expectedClues(this.roster.size, this.settings.entryInterval)
            * this.settings.secondsPerClue / 60),
        },
        clues: [],
        events: [],
      };
    }
  }

  // --- public views ----------------------------------------------------

  // For the watch screen. Built up field by field rather than by copying the
  // host view and deleting things — the host view carries the correct answer,
  // and a spectator page that leaks it ruins the game. Anything added to the
  // host view in future is absent here until somebody adds it on purpose.
  watchView() {
    const g = this.game;
    if (!g) {
      return {
        phase: this.phase, gameId: this.id, version: VERSION, watching: true,
        roster: [...this.roster.values()].map((p) => ({
          token: p.token, name: p.name, connected: p.connected,
          hasAvatar: !!p.avatar, tokenArt: p.tokenArt || null, look: p.look || null,
          isBot: !!p.isBot, level: this.bots.get(p.token)?.level || null })),
      };
    }
    return {
      phase: this.phase, gameId: this.id, version: VERSION, watching: true,
      clues: g.cluesRevealed,
      ceiling: g.ceiling,
      control: this.control,
      overtime: g.overtime ? g.overtime() : null,
      cluesUntilNextEntry: g.cluesUntilNextEntry(),
      retoss: this.retoss || 0,

      board: g.board.map((c) => ({
        title: c.title, note: c.note, source: c.source,
        clues: c.clues.map((x) => ({
          row: x.row, revealed: x.revealed,
          value: [100, 200, 300, 400, 500][x.row - 1] * g.overtimeMultiplier(),
        })),
      })),

      // The clue text, never the response.
      clue: this.clue ? {
        category: this.clue.category, note: this.clue.note,
        text: this.clue.text, value: this.clue.value, row: this.clue.row,
      } : null,

      race: this.race ? {
        open: !!this.race.open,
        timedOut: !!this.race.timedOut,
        buzzes: this.race.buzzes.filter((b) => !b.spectator)
          .map((b) => ({ name: b.name, ms: b.ms, early: !!b.early })),
        lockedOut: [...this.race.lockedOut]
          .map((t) => this.roster.get(t)?.name).filter(Boolean),
      } : null,

      live: g.live().map((p) => this.watchRow(p)),
      out: g.eliminationOrder.map((t) => this.watchRow(g.players.get(t))),
      // The room does not get to know who is coming. The countdown stays —
      // knowing *when* somebody arrives is tactical — it is only the name that
      // goes, so the horn means something again.
      queue: g.queued().map((p) => this.settings.anonymousNext
        ? { draw: null, name: null }
        : { draw: p.drawNumber, name: p.name }),
      ...(this.phase === 'over'
        ? { standings: this.standings(), history: this.history,
            fastest: this.fastest } : {}),
    };
  }

  watchRow(p) {
    const g = this.game;
    const r = this.roster.get(p.id);
    return {
      token: p.id, draw: p.drawNumber, name: p.name, score: p.score,
      state: p.state, tenure: (p.eliminatedAtClue ?? g.cluesRevealed) - (p.enteredAtClue ?? 0),
      connected: r?.connected ?? false, hasAvatar: !!r?.avatar,
      tokenArt: r?.tokenArt || null, look: r?.look || null, isBot: !!r?.isBot,
      level: this.bots.get(p.id)?.level || null,
      capped: p.score >= g.ceiling,
      topRope: !!p.topRope,
      targetedBy: [...g.players.values()]
        .filter((x) => x.target === p.id && x.state === 'live').map((x) => x.id),
      bounty: this.settings.bounties ? g.bountyTotal(p.id) : 0,
      pins: p.pins, correct: p.correct, missed: p.missed,
    };
  }

  // Sent to the host console and the shared screen. Carries answers.
  hostView() {
    const g = this.game;
    return {
      phase: this.phase, gameId: this.id, version: VERSION,
      settings: this.settings,
      roster: [...this.roster.values()].map((p) => ({
        token: p.token, name: p.name, connected: p.connected,
        hasAvatar: !!p.avatar, latency: p.latency ?? null,
        tokenArt: p.tokenArt || null, look: p.look || null,
        isBot: !!p.isBot, level: this.bots.get(p.token)?.level || null,
        bot: p.isBot ? describeBot(this.bots.get(p.token)) : null })),
      ...(g ? {
        clues: g.cluesRevealed, ceiling: g.ceiling,
        cluesUntilNextEntry: g.cluesUntilNextEntry(),
        retoss: this.retoss || 0,
        control: this.control,
        delay: this.settings.delay,
        botOffset: this.bots.size ? this.botOffset() : null,
        botOffsetFrozen: this.frozenOffset != null,
        overtime: g.overtime ? g.overtime() : null,
        board: g.board.map((c) => ({
          title: c.title, note: c.note, source: c.source,
          clues: c.clues.map((x) => ({ row: x.row, revealed: x.revealed,
            // What it will actually cost, not what the row says.
            value: [100, 200, 300, 400, 500][x.row - 1] * g.overtimeMultiplier() })) })),
        // The engine flips the last player's state to 'winner', which would
        // drop them out of the ring at the exact moment they win it.
        live: [...g.players.values()]
          .filter((p) => p.state === 'live' || p.state === 'winner')
          .map(this.playerRow, this),
        // Hidden from the console too: it is the surface most likely to be on
        // a shared screen. The host still gets the name, in the admin window,
        // which is the one they are already keeping to themselves.
        queue: g.queued().map((p) => this.settings.anonymousNext
          ? { draw: null, name: null, token: null, revivals: 0, hidden: true }
          : { draw: p.drawNumber, name: p.name, token: p.id, revivals: p.revivals || 0 }),
        anonymousNext: !!this.settings.anonymousNext,
        // For the admin window only, which is already the surface holding the
        // answers and is the one the host keeps unshared. The console shows the
        // countdown without a name; this is where the name lives.
        nextUp: (() => {
          const n = g.queued()[0];
          return n ? { draw: n.drawNumber, name: n.name } : null;
        })(),
        bounties: this.settings.bounties ? g.bounties.map((b) => ({
          placer: g.players.get(b.placer)?.name, target: g.players.get(b.target)?.name,
          targetToken: b.target, amount: b.amount })) : [],
        out: [...g.players.values()].filter((p) => p.state === 'eliminated')
          .map(this.playerRow, this),
        clue: this.clue,
        race: this.raceView(),
        fastest: this.fastest,
        // The history is only needed once, at the end. Pushing every point of
        // it on every state change was the bulk of the traffic.
        ...(this.phase === 'over' ? { history: this.history } : {}),
        historyLength: this.history.length,
        recording: !!this.record,
        corrections: this.corrections.length,
        canUndo: this.undoStack.length > 0,
        ...(this.phase === 'over' ? { standings: this.standings() } : {}),
      } : {}),
    };
  }

  playerRow(p) {
    const g = this.game;
    const tenure = (p.eliminatedAtClue ?? g.cluesRevealed) - (p.enteredAtClue ?? 0);
    return {
      token: p.id, draw: p.drawNumber, name: p.name, score: p.score,
      state: p.state, pins: p.pins, correct: p.correct, missed: p.missed,
      tenure, connected: this.roster.get(p.id)?.connected ?? false,
      hasAvatar: !!this.roster.get(p.id)?.avatar,
      tokenArt: this.roster.get(p.id)?.tokenArt || null,
      look: this.roster.get(p.id)?.look || null,
      isBot: !!this.roster.get(p.id)?.isBot,
      level: this.bots.get(p.id)?.level || null,
      latency: this.roster.get(p.id)?.latency ?? null,
      capped: p.score >= g.ceiling,
      topRope: !!p.topRope,
      target: p.target || null,
      targetedBy: [...g.players.values()].filter((x) => x.target === p.id && x.state === 'live')
        .map((x) => x.id),
      bounty: this.settings.bounties ? g.bountyTotal(p.id) : 0,
      revivals: p.revivals || 0,
    };
  }

  /** Every stable and who is in it, for the pickers and the scoreboards. */
  stableList() {
    if (!this.game) return [];
    const members = new Map();
    for (const p of this.game.players.values()) {
      if (!p.stable) continue;
      if (!members.has(p.stable)) members.set(p.stable, []);
      members.get(p.stable).push({ token: p.id, name: p.name, state: p.state });
    }
    return [...this.game.stables.values()].map((st) => ({
      id: st.id, name: st.name, members: members.get(st.id) || [] }));
  }

  raceView() {
    if (!this.race) return null;
    return {
      open: this.race.open,
      lockedOut: [...this.race.lockedOut],
      buzzes: this.race.buzzes
        .filter((b) => !b.spectator)
        .map((b) => ({ token: b.token, name: b.name, ms: b.ms, early: b.early,
          // A robot knows whether it is about to be right; the host has no way
          // to adjudicate one, so the console is told.
          bot: !!b.bot, botCorrect: b.bot ? b.botCorrect : undefined })),
    };
  }

  setupView() {
    return {
      gameId: this.id, phase: this.phase, version: VERSION,
      settings: this.settings, blend: this.blend,
      seasons: [SEASONS[0], SEASONS.at(-1)],
      available: this.available(),
      uploads: this.uploads.map((u) => ({ name: u.name, categories: u.categories.length })),
      roster: [...this.roster.values()].map((p) => ({
        token: p.token, name: p.name, connected: p.connected,
        hasAvatar: !!p.avatar, tokenArt: p.tokenArt || null, look: p.look || null,
        isBot: !!p.isBot,
        level: this.bots.get(p.token)?.level || null,
        bot: p.isBot ? describeBot(this.bots.get(p.token)) : null })),
    };
  }

  // Robots were recorded against one particular field on one particular setup:
  // a human whose median buzz was 43ms. Dropped in front of a player who buzzes
  // at 400ms they would be unbeatable, so they are shifted to sit alongside
  // whoever actually turned up.
  //
  // The shift is measured once and then frozen. Recomputing it every clue made
  // the robots chase the human: slow buzzes early dragged the whole field down
  // and never recovered, so a player who started badly faced easier opposition
  // for the rest of the match. Measured over one real match, the gap went from
  // the bots being 132ms faster than the human to 318ms slower.
  //
  // The 40th percentile rather than the median, so the target is the player's
  // decent buzzes rather than their average — buzzing slowly should not make
  // the opposition slower too.
  botOffset() {
    if (this.settings.botMatchField === false) return this.settings.botOffset ?? BOT_DEFAULT_OFFSET;
    if (this.frozenOffset != null) return this.frozenOffset;

    // Warm-up buzzes count. Queued and eliminated players keep buzzing, so
    // there is a supply of human timing even when nobody is winning races.
    const times = [];
    for (const [tok, arr] of this.humanBuzzes || []) {
      if (this.roster.get(tok)?.isBot) continue;
      times.push(...arr);
    }
    if (times.length < BOT_CALIBRATION_BUZZES) {
      return this.settings.botOffset ?? BOT_DEFAULT_OFFSET;
    }

    times.sort((a, b) => a - b);
    const mark = times[Math.floor(times.length * 0.4)];
    this.frozenOffset = Math.round(mark - referenceHumanMedian());
    this.note('bot-calibration', {
      offset: this.frozenOffset, from: times.length, mark: Math.round(mark),
    });
    return this.frozenOffset;
  }

  // Written when the match ends, and periodically while it runs. A host who
  // closes the tab halfway through should still leave something behind.
  saveLog({ partial = false } = {}) {
    if (!this.record) return null;
    const rec = partial
      ? { ...this.record, actual: this.record.actual || null }
      : (this.record.actual ? this.record : this.finishRecord());
    const name = logs.save(this.id, rec, { partial });
    if (name && !partial) console.log(`saved match log ${name}`);
    this.savedAs = name || this.savedAs;
    return name;
  }

  note(type, data) {
    if (!this.record) return;
    this.record.events.push({ at: this.elapsed(), clue: this.game?.cluesRevealed ?? 0, type, ...data });
  }

  elapsed() {
    return this.startedAt ? Math.round((Date.now() - this.startedAt) / 100) / 10 : 0;
  }

  // A finished record with the things worth comparing against the model.
  finishRecord() {
    if (!this.record) return null;
    const g = this.game;
    const secs = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    const clues = g?.cluesRevealed || 0;
    const e = this.record.estimate;
    this.record.finishedAt = new Date().toISOString();
    const gaps = this.record.clues.map((c) => c.seconds).filter((n) => n > 0).sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const brisk = gaps.filter((n) => n <= 45);
    this.record.actual = {
      clues,
      seconds: Math.round(secs),
      minutes: Math.round(secs / 60),
      secondsPerClue: clues ? Math.round(secs / clues * 10) / 10 : null,
      // The mean counts every pause for discussion. The median is the pace you
      // actually play at, and it's the one the estimates should be built on.
      secondsPerClueMedian: median,
      secondsPerClueExcludingBreaks: brisk.length
        ? Math.round(brisk.reduce((a, b) => a + b, 0) / brisk.length * 10) / 10 : null,
      longestGap: gaps.length ? gaps[gaps.length - 1] : null,
      breaksOver45s: gaps.filter((n) => n > 45).length,
      // Buzzes under 150ms can't be reactions to the lights — they're players
      // timing the host's cadence. Worth tracking: it says how the field plays.
      anticipated: (() => {
        const all = this.record.clues.flatMap((c) => c.buzzes.map((b) => b.ms));
        return { buzzes: all.length, under150ms: all.filter((m) => m < 150).length };
      })(),
      fieldClears: g?.fieldClears ?? 0,
      corrections: this.corrections.length,
    };
    this.record.estimateError = {
      cluesPredicted: e.expectedClues, cluesActual: clues,
      cluesOffBy: clues - e.expectedClues,
      minutesPredicted: e.expectedMinutes, minutesActual: this.record.actual.minutes,
      minutesOffBy: this.record.actual.minutes - e.expectedMinutes,
      secondsPerCluePredicted: e.secondsPerClue,
      secondsPerClueActual: this.record.actual.secondsPerClue,
      secondsPerClueMedian: this.record.actual.secondsPerClueMedian,
    };
    // Latency is the thing that decides whether the Zoom delay is pointing the
    // right way. Without it a slow match is indistinguishable from a slow field.
    const summary = (arr) => {
      if (!arr || !arr.length) return null;
      const v = arr.map((x) => x.ms).sort((a, b) => a - b);
      return {
        samples: v.length,
        median: v[Math.floor(v.length / 2)],
        min: v[0], max: v[v.length - 1],
        p90: v[Math.floor(v.length * 0.9)],
      };
    };
    this.record.latency = {
      byPlayer: Object.fromEntries([...this.latency.entries()].map(([tok, arr]) =>
        [this.roster.get(tok)?.name || tok, summary(arr)])),
      overall: summary([...this.latency.values()].flat()),
      samples: [...this.latency.entries()].map(([tok, arr]) => ({
        player: this.roster.get(tok)?.name || tok,
        points: arr.map((x) => [x.at, x.ms]),
      })),
      delaySetting: this.settings.delay,
      botOffset: this.frozenOffset,
      botOffsetNote: this.frozenOffset == null
        ? 'never calibrated — fewer than ' + BOT_CALIBRATION_BUZZES
          + ' human buzzes; robots ran on the ' + BOT_DEFAULT_OFFSET + 'ms default'
        : 'robots shifted ' + this.frozenOffset + 'ms to sit alongside the human field, '
          + 'measured once after ' + BOT_CALIBRATION_BUZZES + ' buzzes and frozen',
      note: 'One-way estimates in ms, sampled every 8s from each client. '
        + 'The Zoom delay assumes the socket path beats the call audio; if median '
        + 'latency approaches the delay setting, that assumption is failing.',
    };
    this.record.anticipation = (() => {
      const all = this.record.clues.flatMap((c) => c.buzzes.filter((b) => !b.spectator));
      const fast = all.filter((b) => b.ms < 150).length;
      return { buzzes: all.length, under150ms: fast, under50ms: all.filter((b) => b.ms < 50).length,
        note: 'Buzzes under 150ms are players timing the read, not reacting to the lights.' };
    })();
    this.record.fieldOverTime = this.history.map((h) => ({
      clue: h.clue, inRing: Object.keys(h.scores).length, ceiling: h.ceiling }));
    this.record.standings = this.standings();
    this.record.history = this.history;
    this.record.corrections = this.corrections;
    this.record.fastest = this.fastest;
    return this.record;
  }

  standings() {
    const g = this.game;
    if (!g) return [];
    return [...g.players.values()].filter((p) => p.state !== 'queued').map((p) => {
      const st = this.stat(p.id);
      const times = st.times;
      return {
        token: p.id, draw: p.originalDraw ?? p.drawNumber, name: p.name,
        isBot: !!this.roster.get(p.id)?.isBot,
        level: this.bots.get(p.id)?.level || null,
        revivals: p.revivals || 0,
        avatar: this.roster.get(p.id)?.avatar || null,
        // Only the genuine last-one-standing is crowned. A match ended early
        // by the host has no winner, however many are still in the ring.
        winner: p.state === 'winner'
          || (this.phase === 'over' && p.state === 'live' && g.live().length === 1),
        tenure: (p.eliminatedAtClue ?? g.cluesRevealed) - (p.enteredAtClue ?? 0),
        outOrder: p.eliminatedAtClue == null ? null
          : g.eliminationOrder.indexOf(p.id) + 1,
        correct: p.correct, missed: p.missed, pins: p.pins,
        drained: st.drained, peak: Math.max(st.peak, p.score),
        att: st.att, early: st.early, won: st.won,
        // Practice presses, kept apart so a queued or eliminated player can
        // still see what they did without it counting for anything.
        warmAtt: st.warmAtt || 0,
        avg: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length * 10) / 10 : null,
        best: times.length ? Math.min(...times) : null,
      };
    });
  }

  // Sent to a player. Never carries the correct response.
  playerView(token) {
    const g = this.game;
    const base = { phase: this.phase, gameId: this.id, you: null, ceiling: g?.ceiling ?? null };
    if (!g) {
      const p = this.roster.get(token);
      return { ...base, you: { name: p?.name, state: 'lobby' } };
    }
    const p = g.players.get(token);
    if (!p) return base;
    const tenure = (p.eliminatedAtClue ?? g.cluesRevealed) - (p.enteredAtClue ?? 0);
    const mine = this.race?.buzzes.find((b) => b.token === token) ?? null;
    return {
      ...base,
      you: {
        token, name: p.name, draw: p.drawNumber, score: p.score, state: p.state,
        tenure, pins: p.pins, capped: p.score >= g.ceiling,
        lockedOut: this.race?.lockedOut.has(token) ?? false,
        cluesToEntry: p.state === 'queued' ? g.cluesUntilEntryFor(token) : null,
        // Where they stand in the queue, so the wait reads as a wait and not
        // as an imminent entry.
        queuePlace: p.state === 'queued'
          ? g.queued().findIndex((x) => x.id === token) + 1 : null,
        queueLength: p.state === 'queued' ? g.queued().length : null,
        entryStake: Math.min(
          (p.revivals ? Math.round(this.settings.startScore * this.settings.revivalFraction)
            : this.settings.startScore) - (p.bountyPlaced || 0), g.ceiling),
        tokenArt: this.roster.get(token)?.tokenArt || null,
        topRope: !!p.topRope,
        topRopeWait: g.topRopeWait(p.id),
        stable: p.stable || null,
        target: p.target || null,
        targetedBy: [...g.players.values()].filter((x) => x.target === token && x.state === 'live')
          .map((x) => x.name),
        bounty: this.settings.bounties ? g.bountyTotal(token) : 0,
        bountyPlaced: p.bountyPlaced || 0,
        bountyCap: Math.floor(this.settings.startScore * this.settings.bountyMaxFraction),
        revivals: p.revivals || 0,
      },
      buzzOpen: !!this.race?.open,
      clueUp: !!this.clue,
      mechanics: {
        topRope: !!this.settings.topRope, targeting: !!this.settings.targeting,
        bounties: !!this.settings.bounties, revival: !!this.settings.revival,
      },
      ring: g.live().map((x) => ({ token: x.id, name: x.name, draw: x.drawNumber,
        score: x.score, bounty: this.settings.bounties ? g.bountyTotal(x.id) : 0 })),
      clueValue: this.clue?.value ?? null,
      lockout: this.settings.lockout,
      roster: this.roster.size,
      control: this.control,
      delay: this.settings.delay,
      overtime: g.overtime ? g.overtime() : null,
      myBuzz: mine ? { ms: mine.ms, early: mine.early, ...(mine.ranked || {}) } : null,
      stables: this.settings.stables ? this.stableList() : null,
      ...(this.phase === 'over'
        ? { standings: this.standings(), fastest: this.fastest, history: this.history,
            draw: [...this.game.players.values()].map((p) => ({ token: p.id, name: p.name, draw: p.drawNumber })) }
        : {}),
    };
  }
}

// ---------------------------------------------------------------- routes

app.post('/api/match', (req, res) => {
  const m = new Match(req.body?.settings || {});
  m.lastActivity = Date.now();
  matches.set(m.id, m);
  res.json({ gameId: m.id, hostKey: m.hostKey,
    setupUrl: `/setup/${m.id}#${m.hostKey}`,
    joinUrl: `/j/${m.id}`, consoleUrl: `/host/${m.id}#${m.hostKey}` });
});

const auth = (req) => {
  const m = matches.get((req.params.id || '').toUpperCase());
  const key = req.get('x-host-key') || req.body?.hostKey;
  return m && m.hostKey === key ? m : null;
};

app.get('/api/match/:id', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  res.json(m.setupView());
});

app.patch('/api/match/:id', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  if (m.phase !== 'lobby') return res.status(409).json({ error: 'match already started' });
  Object.assign(m.settings, req.body.settings || {});
  if (req.body.blend) m.blend = req.body.blend;
  res.json(m.setupView());
});

// Uploaded material lives on the match, not in the shared library — one
// host's fresh boards shouldn't leak into somebody else's game.
// Robot players. They sit in the roster like anyone else so the console, the
// scoring and the record treat them identically — the only difference is that
// their buzzes are generated rather than received.
app.post('/api/match/:id/bots', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  if (m.phase !== 'lobby') return res.status(409).json({ error: 'match already started' });
  const count = Math.max(1, Math.min(30, Number(req.body?.count) || 1));
  const level = LEVELS.includes(req.body?.level) ? req.body.level : null;
  // Default to the televised distribution: 3,339 real player-games beats a
  // sample of two people until this game has accumulated its own.
  const profile = ['measured', 'broadcast', 'observed'].includes(req.body?.profile)
    ? req.body.profile : 'observed';
  const rng = m.rng || makeRng(Date.now() & 0x7fffffff);
  const taken = new Set([...m.roster.values()].map((p) => p.name));
  const added = [];
  for (let i = 0; i < count; i++) {
    if (m.roster.size >= 30) break;
    const token = 'bot:' + randomUUID();
    const brain = makeBot(rng, { ...(level ? { level } : {}), profile });
    const name = botName(m.bots.size + i, taken);
    taken.add(name);
    m.bots.set(token, brain);
    m.roster.set(token, { token, name, socketId: null, connected: true,
      avatar: null, isBot: true,
      look: distinctLook(token, [...m.roster.values()].map((x) => x.look).filter(Boolean)) });
    added.push({ name, ...brain });
  }
  res.json({ ...m.setupView(), added: added.map((b) => ({ name: b.name, level: b.level,
    buzzSkill: b.buzzSkill, describe: describeBot(b) })) });
});

// The draw can be unkind — five rookies and no champion makes a poor test.
// Any robot's standard can be changed until the match starts.
app.patch('/api/match/:id/bots/:token', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  if (m.phase !== 'lobby') return res.status(409).json({ error: 'match already started' });
  const token = decodeURIComponent(req.params.token);
  const brain = m.bots.get(token);
  if (!brain) return res.status(404).json({ error: 'no such robot' });
  const level = LEVELS.includes(req.body?.level) ? req.body.level : null;
  if (!level) return res.status(400).json({ error: 'unknown standard' });
  const rng = m.rng || makeRng(Date.now() & 0x7fffffff);
  m.bots.set(token, makeBot(rng, { level, profile: brain.profile || 'observed' }));
  res.json(m.setupView());
});

app.delete('/api/match/:id/bots', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  if (m.phase !== 'lobby') return res.status(409).json({ error: 'match already started' });
  for (const t of [...m.bots.keys()]) { m.bots.delete(t); m.roster.delete(t); }
  res.json(m.setupView());
});

app.delete('/api/match/:id/bots/:token', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  if (m.phase !== 'lobby') return res.status(409).json({ error: 'match already started' });
  const token = decodeURIComponent(req.params.token);
  if (!m.bots.has(token)) return res.status(404).json({ error: 'no such robot' });
  m.bots.delete(token); m.roster.delete(token);
  res.json(m.setupView());
});

app.post('/api/match/:id/material', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  if (m.phase !== 'lobby') return res.status(409).json({ error: 'match already started' });
  const { name, content, format } = req.body || {};
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  let categories = [];
  try {
    if (format === 'csv' || /\.csv$/i.test(name)) {
      categories = fromJpartyCsv(parseCsv(content), { label: name });
    } else {
      const doc = parseLooseJson(content);
      if (!Array.isArray(doc.rounds)) {
        return res.status(400).json({ error:
          "that JSON isn't in j-trivia.org format — it needs a top-level \"rounds\" array of category lists" });
      }
      categories = fromTtgJson(doc).map((c) => ({ ...c, source: 'upload',
        provenance: { file: name, title: doc.title, author: doc.author || null } }));
    }
  } catch (e) {
    return res.status(400).json({ error: /JSON/i.test(e.message)
      ? "that file isn't valid JSON — if it's a spreadsheet export, save it as CSV"
      : 'could not read that file: ' + e.message });
  }
  if (!categories.length) {
    return res.status(400).json({ error: 'no complete categories found — every category needs all five rows and no media-dependent clues' });
  }
  m.uploads.push({ name, categories });
  res.json({ ...m.setupView(), added: categories.length });
});

app.delete('/api/match/:id/material/:idx', (req, res) => {
  const m = auth(req);
  if (!m) return res.status(403).json({ error: 'bad host key' });
  m.uploads.splice(Number(req.params.idx), 1);
  res.json(m.setupView());
});

// Matches live in this process's memory. If two machines are running, a host
// can create a match on one and have players land on the other — which shows
// up as "bad host key" and "no such game". Hitting this twice and seeing the
// machine id change is the tell.
app.get('/api/health', (_req, res) => {
  res.json({
    logs: logs.status(),
    version: VERSION, machine: MACHINE,
    uptimeSeconds: Math.round((Date.now() - BOOTED) / 1000),
    liveMatches: matches.size,
    // Matches actually being played, as opposed to lobbies and finished ones.
    // A restart ends these — they live in memory — so the deploy script asks
    // before it pulls the rug.
    matchesInPlay: [...matches.values()].filter((m) => m.phase === 'live').length,
    playersInPlay: [...matches.values()].filter((m) => m.phase === 'live')
      .reduce((n, m) => n + m.roster.size, 0),
    library: LIBRARY.length,
  });
});

// The entrance-music library: whatever mp3s are in public/audio/themes.
//
// Read from the folder rather than a hardcoded list, so dropping a file in adds
// it without a deploy. Names come from the filename — "wrestling-champion.mp3"
// becomes mood Wrestling, title Champion — which keeps the folder the single
// source of truth and means there is no manifest to fall out of step.
const THEME_DIR = join(__dir, '../public/audio/themes');
app.get('/api/themes', (_req, res) => {
  let files = [];
  try {
    files = readdirSync(THEME_DIR).filter((f) => /\.(mp3|ogg|m4a|wav)$/i.test(f));
  } catch { /* no folder yet, which is fine — the library is optional */ }
  const nice = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  res.json({
    themes: files.sort().map((f) => {
      const key = f.replace(/\.[^.]+$/, '');
      const [mood, ...rest] = key.split('-');
      return {
        key,
        url: `/audio/themes/${encodeURIComponent(f)}`,
        mood: rest.length ? nice(mood) : 'Library',
        title: (rest.length ? rest : [mood]).map(nice).join(' '),
      };
    }),
  });
});

app.get('/api/library', (_req, res) => {
  const by = {};
  for (const c of LIBRARY) by[c.source] = (by[c.source] || 0) + 1;
  res.json({ total: LIBRARY.length, bySource: by, seasons: [SEASONS[0], SEASONS.at(-1)],
    version: VERSION });
});

// The front door. It used to be the host setup page, which meant anybody who
// typed the domain landed on the controls for running a match.
app.get('/', (_req, res) => res.sendFile(join(__dir, '../public/welcome.html')));

// Setting up a match. The welcome screen mints one over the API and sends the
// host here; /host/:id, further down, is the console for a match under way.
app.get('/setup/:id', (_req, res) => res.sendFile(join(__dir, '../public/setup.html')));

// Does this room exist? Used by the welcome screen before it sends anybody to a
// buzzer, because a mistyped code used to mean landing on a page that simply
// never connected — which reads as the site being broken rather than a typo.
// Deliberately says nothing else about the match.
app.get('/api/match/:id/exists', (req, res) => {
  const m = matches.get((req.params.id || '').toUpperCase());
  res.json({ exists: !!m, phase: m ? m.phase : null });
});
app.get('/api/match/:id/record', (req, res) => {
  const m = auth(req) || (matches.get((req.params.id || '').toUpperCase()));
  if (!m) return res.status(404).json({ error: 'no such match' });
  if (m.hostKey !== (req.get('x-host-key') || req.query.key)) {
    return res.status(403).json({ error: 'bad host key' });
  }
  const rec = m.record ? (m.record.actual ? m.record : m.finishRecord()) : null;
  if (!rec) return res.status(404).json({ error: 'this match was not recorded' });
  res.setHeader('content-disposition',
    `attachment; filename="rumble-${m.id}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(rec);
});

// The handbook, so the setup page can link to it.
// The control room: every match on this server, and every log it has kept.
//
// Guarded by RUMBLE_ADMIN_KEY when it is set. When it is not, it still works —
// locking the host out of his own server is worse than the risk at this scale —
// but the page says so plainly rather than pretending to be secure.
// A password, not a secret. It keeps a stranger who finds the address from
// ending a live match; it is not protecting anything valuable, and it travels
// in a request header rather than the URL so it stays out of logs.
const ADMIN_KEY = process.env.RUMBLE_ADMIN_KEY || 'daymay';
function adminOk(req) {
  const given = req.get('x-admin-key') || req.query.key || '';
  return given === ADMIN_KEY;
}

app.get('/control', (_req, res) => res.sendFile(join(__dir, '../public/control.html')));

app.get('/api/control', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const now = Date.now();
  res.json({
    guarded: true,
    idleMinutes: IDLE_MS / 60000,
    version: VERSION,
    uptimeSeconds: Math.round((now - BOOTED) / 1000),
    matches: [...matches.values()].map((m) => ({
      id: m.id,
      phase: m.phase,
      players: m.roster.size,
      humans: [...m.roster.values()].filter((p) => !p.isBot).length,
      connected: [...m.roster.values()].filter((p) => p.connected && !p.isBot).length,
      clues: m.game ? m.game.cluesRevealed : 0,
      idleSeconds: Math.round((now - (m.lastActivity || now)) / 1000),
      startedAt: m.startedAt || null,
    })).sort((a, b) => a.idleSeconds - b.idleSeconds),
    logs: logs.list().slice(0, 200),
  });
});

// Ending somebody's match is destructive, so it is a POST and it records.
app.post('/api/control/:id/end', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const m = matches.get(String(req.params.id || '').toUpperCase());
  if (!m) return res.status(404).json({ error: 'no such match' });
  if (m.phase === 'live') {
    m.phase = 'over';
    m.endedReason = 'admin';
    try { m.finishRecord(); m.saveLog(); } catch { /* record what we can */ }
    broadcast(m);
    io.to(`${m.id}:host`).emit('error-msg', 'This match was ended from the control room.');
  } else {
    matches.delete(m.id);
  }
  res.json({ ok: true, id: m.id, phase: m.phase });
});

/**
 * A player's chosen entrance music, made safe.
 *
 * Shared by the sign-in card and the in-match picker, because a rule enforced
 * in one place and not the other is the same as no rule. A library key is
 * stripped to bare characters — a chosen theme must never become a way to ask
 * the server for an arbitrary file — and a supplied link has to be https.
 */
function sanitiseTheme(theme) {
  if (!theme || typeof theme !== 'object') return null;
  const kind = String(theme.kind || '');
  if (kind === 'library') {
    const key = String(theme.key || '').replace(/[^A-Za-z0-9_-]/g, '');
    return key ? { kind: 'library', key } : null;
  }
  if (kind === 'youtube') {
    const id = String(theme.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    return id ? { kind: 'youtube', id, start: Math.max(0, Math.floor(theme.start || 0)) } : null;
  }
  if (kind === 'url') {
    const u = String(theme.url || '').slice(0, 500);
    return /^https:\/\//.test(u) ? { kind: 'url', url: u } : null;
  }
  return null;
}

// Broadcasting from outside a socket connection.
//
// The push helpers live inside the connection closure and close over one
// socket's match, so the reaper and the admin page cannot use them. This is
// the same three sends without that assumption.
function broadcast(m) {
  if (!m) return;
  io.to(`${m.id}:host`).emit('state', m.hostView());
  const wv = m.watchView();
  io.to(`${m.id}:watch`).emit('state', wv);
  io.to(`${m.id}:board`).emit('watch-state', wv);
  for (const p of m.roster.values()) {
    if (p.socketId) io.to(p.socketId).emit('state', m.playerView(p.token));
  }
}

// Matches that nobody is touching.
//
// A match lives in memory until somebody ends it, and closing the tab is not
// ending it — a forgotten test match sat live for an hour and blocked a deploy,
// because the deploy guard quite correctly refuses to restart under a game in
// progress. Ten minutes of complete silence is not a game in progress.
//
// A live match is ended properly, so it records and appears in the logs; an
// abandoned lobby is simply dropped, since there is nothing to record.
const IDLE_MS = Number(process.env.RUMBLE_IDLE_MINUTES || 10) * 60 * 1000;

function reapIdle() {
  const now = Date.now();
  for (const [id, m] of matches) {
    const quiet = now - (m.lastActivity || now);
    if (quiet < IDLE_MS) continue;
    if (m.phase === 'live') {
      m.phase = 'over';
      m.endedReason = 'idle';
      try { m.finishRecord(); m.saveLog(); } catch { /* record what we can */ }
      io.to(`${id}:host`).emit('error-msg',
        'This match was ended after ten minutes with nobody doing anything.');
      broadcast(m);
      console.log(`[reap] ended ${id} after ${Math.round(quiet / 60000)} min idle`);
    } else if (m.phase !== 'over') {
      matches.delete(id);
      console.log(`[reap] dropped idle lobby ${id}`);
    }
  }
}
setInterval(reapIdle, 60 * 1000).unref?.();

// The saved logs. Guarded by RUMBLE_LOG_KEY when it is set; open when it is
// not, which is fine for a test deployment and stated plainly in /api/health.
const logGuard = (req) => {
  const want = process.env.RUMBLE_LOG_KEY;
  if (!want) return true;
  return (req.get('x-log-key') || req.query.key) === want;
};

// The watch screen: public, read-only, and carrying no answers.
app.get('/watch', (_req, res) => res.sendFile(join(__dir, '../public/watch.html')));
app.get('/watch/:id', (_req, res) => res.sendFile(join(__dir, '../public/watch.html')));

app.get('/logs', (_req, res) => res.sendFile(join(__dir, '../public/logs.html')));

app.get('/api/logs', (req, res) => {
  if (!logGuard(req)) return res.status(403).json({ error: 'bad log key' });
  res.json({ ...logs.status(), matches: logs.list() });
});

app.get('/api/logs/:file', (req, res) => {
  if (!logGuard(req)) return res.status(403).json({ error: 'bad log key' });
  const body = logs.read(req.params.file);
  if (!body) return res.status(404).json({ error: 'no such log' });
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-disposition', `attachment; filename="${req.params.file}"`);
  res.send(body);
});

app.get('/handbook', (_req, res) =>
  res.sendFile(join(__dir, '../docs/j-royal-rumble-handbook.pdf')));
// The rules, rendered for reading rather than served as raw markdown.
//
// RULES.md stays the Discord-shaped source — short blocks, paste instructions —
// and this strips the pasting apparatus and dresses what remains, because the
// person following a link from the welcome screen wants to read the rules, not
// instructions for reposting them.
const RULES_HTML = (() => {
  let md = readFileSync(join(__dir, '../RULES.md'), 'utf8');
  md = md
    .replace(/^# .*\n/, '')                                  // the paste-oriented title
    .replace(/^Every block below[^]*?---\n/m, '')            // ...and its instructions
    .replace(/^## THE SHORT VERSION \(pin this\)/m, '## The short version')
    .replace(/^The Discord-ready copy.*\n/m, '')
    .replace(/^## HOW TO JOIN \(paste this before a match\)/m, '## How to join');
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (x) => esc(x)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const blocks = md.split(/\n\n+/).map((b) => {
    b = b.trim();
    if (!b) return '';
    if (b === '---') return '<hr>';
    if (b.startsWith('## ')) return `<h2>${inline(b.slice(3))}</h2>`;
    if (b.startsWith('# ')) return `<h1>${inline(b.slice(2))}</h1>`;
    if (/^[-*] /m.test(b)) {
      return '<ul>' + b.split('\n').map((l) => `<li>${inline(l.replace(/^[-*] /, ''))}</li>`).join('') + '</ul>';
    }
    return `<p>${inline(b).replace(/\n/g, ' ')}</p>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>J! Royal Rumble — the rules</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--ink:#0A0E1C;--panel:#131A30;--line:#2A3556;--chalk:#EEEBE1;--slate:#7C88AB;--brass:#D6A93F}
*{box-sizing:border-box}body{background:var(--ink);color:var(--chalk);margin:0;
font:400 16px/1.65 "IBM Plex Sans",system-ui,sans-serif}
.wrap{max-width:680px;margin:0 auto;padding:28px 20px 70px}
.top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.top a{color:var(--slate);text-decoration:none;font-size:13.5px}
.top a:hover{color:var(--brass)}
h1{font-family:"Anton",Impact,sans-serif;font-size:38px;letter-spacing:.02em;margin:14px 0 4px}
h1 .j{color:var(--brass)}
h2{font-family:"Anton",Impact,sans-serif;font-size:21px;letter-spacing:.03em;
margin:38px 0 10px;color:var(--brass)}
p{margin:0 0 14px}
strong{color:var(--chalk)}
p,li{color:#C9CCD9}
code{font-family:"IBM Plex Mono",monospace;font-size:.9em;background:var(--panel);
border:1px solid var(--line);border-radius:3px;padding:1px 5px}
hr{border:0;border-top:1px solid var(--line);margin:30px 0}
ul{margin:0 0 14px;padding-left:22px}li{margin-bottom:6px}
</style></head><body><div class="wrap">
<div class="top"><a href="/">&larr; J! Royal Rumble</a><a href="/handbook">the design handbook</a></div>
<h1><span class="j">J!</span> ROYAL RUMBLE &mdash; THE RULES</h1>
${blocks}
</div></body></html>`;
})();
app.get('/rules', (_req, res) => res.type('html').send(RULES_HTML));
app.get('/rules.md', (_req, res) => res.sendFile(join(__dir, '../RULES.md')));

app.get('/j/:id', (_req, res) => res.sendFile(join(__dir, '../public/buzzer.html')));
app.get('/join', (_req, res) => res.sendFile(join(__dir, '../public/buzzer.html')));
app.get('/host/:id', (_req, res) => res.sendFile(join(__dir, '../public/console.html')));
app.get('/admin/:id', (_req, res) => res.sendFile(join(__dir, '../public/admin.html')));

// ---------------------------------------------------------------- sockets

io.on('connection', (socket) => {
  let match = null, token = null, isHost = false;

  const pushHostNow = () => {
    if (!match) return;
    io.to(`${match.id}:host`).emit('state', match.hostView());
    // Watchers get their own view, never the host's.
    // Two audiences, two rooms. A watch screen listens for `state`; a player in
    // full mode already uses `state` for their own buzzer view, so putting them
    // in the same room would overwrite it with somebody else's. They get their
    // own room and their own event name.
    const wv = match.watchView();
    io.to(`${match.id}:watch`).emit('state', wv);
    io.to(`${match.id}:board`).emit('watch-state', wv);
  };
  const pushPlayersNow = () => {
    if (!match) return;
    for (const p of match.roster.values()) {
      if (p.socketId) io.to(p.socketId).emit('state', match.playerView(p.token));
    }
  };

  // A burst of buzzes would otherwise fan out one full state push per buzz,
  // per player. Coalescing them costs a few milliseconds of staleness and
  // keeps the socket clear for the messages that are actually time-critical.
  const pushHost = () => schedule(match, 'host');
  const pushPlayers = () => schedule(match, 'players');
  const pushAll = () => schedule(match, 'all');

  function schedule(m, what) {
    if (!m) return;
    m._pending = m._pending === 'all' || m._pending !== what ? (m._pending ? 'all' : what) : what;
    if (m._pushTimer) return;
    m._pushTimer = setTimeout(() => {
      const kind = m._pending;
      m._pushTimer = null; m._pending = null;
      if (kind === 'host' || kind === 'all') pushHostNow();
      if (kind === 'players' || kind === 'all') pushPlayersNow();
    }, PUSH_COALESCE_MS);
  }

  socket.on('host-join', ({ gameId, hostKey }, ack) => {
    const m = matches.get((gameId || '').toUpperCase());
    if (!m) return ack?.({ error: `no match ${gameId} on this server (machine ${MACHINE}). ` +
      `If the app is running more than one machine, run: fly scale count 1` });
    if (m.hostKey !== hostKey) return ack?.({ error: 'that host key does not match this game' });
    match = m; isHost = true;
    socket.join(`${m.id}:host`);
    // Send the pictures once; state pushes only carry a flag from here on.
    for (const p of m.roster.values()) {
      if (p.avatar) socket.emit('avatar', { token: p.token, dataUrl: p.avatar });
    }
    ack?.({ ok: true, state: m.hostView() });
  });

  // Players identify by a durable token stored on their own device, so a
  // reconnect keeps their score, draw number and place in the queue.
  socket.on('join', ({ gameId, token: t, name, look, theme }, ack) => {
    const j = matches.get(String(gameId || '').toUpperCase());
    if (j) j.lastActivity = Date.now();
    const m = matches.get((gameId || '').toUpperCase());
    if (!m) return ack?.({ error: `No game with the code ${(gameId || '').toUpperCase()}. ` +
      `Check the code with your host — it's four letters.` });
    match = m;
    token = t && m.roster.has(t) ? t : (t || randomUUID());
    const existing = m.roster.get(token);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      if (name) existing.name = name;
    } else {
      // Everyone gets a token on arrival rather than a blank circle. Chosen
      // to avoid whatever the room is already using.
      const art = assignToken([...m.roster.values()].map((x) => x.tokenArt), m.rng || Math.random);
      // A wrestler nobody else in this room already looks like. The player may
      // have chosen one on the way in; honour it unless somebody already looks
      // that way, in which case the room's clarity wins over the preference.
      const taken = [...m.roster.values()].map((x) => x.look).filter(Boolean);
      const wanted = look && typeof look === 'object' ? look : null;
      const clash = wanted && taken.some((t) => looksAlike(t, wanted));
      const chosen = wanted && !clash ? wanted : distinctLook(token, taken);

      if (m.phase !== 'lobby') {
        // Turning up after the bell. A Rumble is built around people arriving
        // throughout, so a latecomer goes to the back of the queue rather than
        // being turned away.
        if (!m.game) return ack?.({ error: 'match already started' });
        const r = m.game.addLatecomer(token, name || 'Player');
        if (r.error) return ack?.({ error: r.error });
        m.roster.set(token, { token, name: name || 'Player', socketId: socket.id,
          connected: true, avatar: null, tokenArt: art, look: chosen, late: true,
        theme: sanitiseTheme(theme) });
        m.note('latecomer', { name: name || 'Player', draw: r.draw });
        socket.join(`${m.id}:players`);
        ack?.({ ok: true, token, late: true, draw: r.draw, state: m.playerView(token) });
        pushAll();
        return;
      }

      m.roster.set(token, { token, name: name || 'Player', socketId: socket.id,
        connected: true, avatar: null, tokenArt: art, look: chosen,
        // Chosen on the sign-in card, before there was a match to attach it to.
        theme: sanitiseTheme(theme) });
    }
    socket.join(`${m.id}:players`);
    ack?.({ ok: true, token, state: m.playerView(token) });
    pushAll();
  });

  socket.on('disconnect', () => {
    if (!match || !token) return;
    const p = match.roster.get(token);
    // Harsh and simple: a disconnected player keeps bleeding and can be
    // eliminated while offline. We only mark them so the host can see it.
    if (p && !p.isBot) { p.connected = false; p.socketId = null; }
    pushHost();
  });

  // --- host actions ----------------------------------------------------

  // Refusing silently is how a button ends up doing nothing with no
  // explanation, so answer the acknowledgement if the caller sent one.
  // Anything a person does counts as the match being alive.
  const touch = () => { if (match) match.lastActivity = Date.now(); };

  const hostOnly = (fn) => (...args) => {
    touch();
    const ack = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (!isHost || !match) {
      return ack?.({ error: !match ? 'That match is no longer running'
        : 'Only the host can do that — try reopening the setup link' });
    }
    try { fn(...args); } catch (e) {
      socket.emit('error-msg', e.message);
      ack?.({ error: e.message });
    }
  };

  socket.on('start-match', hostOnly((_d, ack) => {
    if (match.phase !== 'lobby') return ack?.({ error: 'This match has already started' });
    if (match.roster.size < 3) return ack?.({ error: 'Three players are needed to start' });
    try {
      match.start();
    } catch (e) {
      // Say what happened rather than leaving the setup screen inert.
      return ack?.({ error: e.message || 'The match could not be started' });
    }
    ack?.({ ok: true });
    io.to(`${match.id}:players`).emit('rumble-starting', {
      entryInterval: match.settings.entryInterval,
      startScore: match.settings.startScore,
      players: match.roster.size,
    });
    pushAll();
  }));

  // The setup page watches the lobby fill without claiming the host socket.
  // Full buzzer mode: a player asks for the board as well as their buzzer.
  //
  // They join the same watch room and get the same watchView() everybody else
  // gets — deliberately, because that payload is built field-by-field with no
  // answer in it and test/watch.mjs asserts as much. Assembling a second
  // "buzzer with board" payload from the host view is exactly how an answer
  // would eventually leak.
  // A player's entrance music. Either a theme from the library or a link they
  // supplied; the watch screen with sound on is what actually plays it.
  // Another wrestler. Assigned on join, but a player who does not like theirs
  // should be able to say so — it is the figure the whole room watches get
  // thrown out of the ring.
  socket.on('reroll-look', (_d, ack) => {
    if (!match || !token) return ack?.({ error: 'no match' });
    const r = match.roster.get(token);
    if (!r) return ack?.({ error: 'not in this match' });
    const taken = [...match.roster.values()]
      .filter((p) => p.token !== token).map((p) => p.look).filter(Boolean);
    r.look = distinctLook(token + ':' + Date.now(), taken);
    pushAll();
    ack?.({ ok: true, look: r.look });
  });

  // --- stables ---------------------------------------------------------
  //
  // Declared between clues like the top rope, never while one is on the board:
  // switching sides mid-race would let somebody see who had buzzed and pick a
  // side accordingly.
  const betweenClues = () => !match?.clue;

  socket.on('make-stable', ({ name }, ack) => {
    if (!match?.game || !token) return ack?.({ error: 'no match' });
    if (!betweenClues()) return ack?.({ error: 'wait until the clue is done' });
    const r = match.game.createStable(token, name);
    if (r.error) return ack?.({ error: r.error });
    match.note('stable-made', { name: r.name, by: match.roster.get(token)?.name });
    pushAll();
    ack?.(r);
  });

  socket.on('join-stable', ({ id }, ack) => {
    if (!match?.game || !token) return ack?.({ error: 'no match' });
    if (!betweenClues()) return ack?.({ error: 'wait until the clue is done' });
    const r = match.game.joinStable(token, id);
    if (r.error) return ack?.({ error: r.error });
    match.note('stable-joined', { name: r.name, who: match.roster.get(token)?.name });
    io.to(`${match.id}:host`).emit('stable-news',
      { kind: 'join', who: match.roster.get(token)?.name, stable: r.name });
    pushAll();
    ack?.(r);
  });

  socket.on('betray', ({ id }, ack) => {
    if (!match?.game || !token) return ack?.({ error: 'no match' });
    if (!betweenClues()) return ack?.({ error: 'wait until the clue is done' });
    const r = match.game.betray(token, id || null);
    if (r.error) return ack?.({ error: r.error });
    const who = match.roster.get(token)?.name;
    match.note('betrayal', { who, from: r.fromName, to: r.toName, stack: r.stack });
    io.to(`${match.id}:host`).emit('stable-news',
      { kind: 'betray', who, from: r.fromName, to: r.toName, stack: r.stack, each: r.each });
    pushAll();
    ack?.(r);
  });

  socket.on('set-theme', ({ theme }, ack) => {
    if (!match || !token) return ack?.({ error: 'no match' });
    const r = match.roster.get(token);
    if (!r) return ack?.({ error: 'not in this match' });
    if (!theme) { r.theme = null; pushAll(); return ack?.({ ok: true, theme: null }); }

    const clean = sanitiseTheme(theme);
    if (!clean) {
      return ack?.({ error: theme && theme.kind === 'url'
        ? 'The link must start with https'
        : theme && theme.kind === 'youtube'
          ? 'That does not look like a YouTube link'
          : 'That theme is not one I recognise' });
    }
    r.theme = clean;
    pushAll();
    ack?.({ ok: true, theme: r.theme });
  });

  socket.on('want-board', ({ on }, ack) => {
    if (!match) return ack?.({ error: 'no match' });
    if (on) {
      socket.join(`${match.id}:board`);
      socket.emit('watch-state', match.watchView());
    } else {
      socket.leave(`${match.id}:board`);
    }
    ack?.({ ok: true, on: !!on });
  });

  socket.on('watch-game', ({ gameId }, ack) => {
    const m = matches.get(String(gameId || '').toUpperCase());
    if (!m) return ack?.({ error: 'no such match' });
    match = m;
    socket.join(`${m.id}:watch`);
    ack?.({ ok: true, state: m.watchView() });
  });

  socket.on('watch-setup', ({ gameId, hostKey }, ack) => {
    const m = matches.get((gameId || '').toUpperCase());
    if (!m) return ack?.({ error: `no match ${gameId} on this server (machine ${MACHINE})` });
    if (m.hostKey !== hostKey) return ack?.({ error: 'that host key does not match this game' });
    match = m; isHost = true;
    socket.join(`${m.id}:host`);
    for (const p of m.roster.values()) {
      if (p.avatar) socket.emit('avatar', { token: p.token, dataUrl: p.avatar });
    }
    ack?.({ ok: true, setup: m.setupView() });
  });

  socket.on('pick-clue', hostOnly(({ slot, row }) => {
    const g = match.game;
    const cat = g.board[slot];
    const clue = cat.clues.find((c) => c.row === row);
    if (!clue || clue.revealed) return;
    // What the clue is actually worth right now, not its face value. The
    // engine computes the same thing independently when it scores, so this is
    // display only — but every surface that showed a raw $400 during a x4
    // overtime was telling the room the wrong number.
    const face = [100, 200, 300, 400, 500][row - 1];
    match.clue = {
      slot, row, face, value: face * g.overtimeMultiplier(),
      category: cat.title, note: cat.note, text: clue.text, answer: clue.answer,
    };
    match.race = { open: false, activatedAt: null, buzzes: [], lockedOut: new Set() };
    match.retoss = 0;
    clearTimeout(match.raceTimer);

    // Work out the robots' wrong answer now, while the host is still reading.
    // Doing it at buzz time would put a network call inside the race.
    match.wrongAnswer = null;
    const siblings = g.board.flatMap((c) => c.clues.map((x) => x.answer))
      .filter((a) => a && a !== clue.answer);
    wrongAnswer(match.clue, siblings).then((w) => { match.wrongAnswer = w; });

    pushHost();
    io.to(`${match.id}:players`).emit('clue-shown', { value: match.clue.value });
    pushPlayers();
  }));

  // Lights and buzzers are separate signals, matching the existing app.
  // `delay` compensates for Zoom audio lagging the socket by ~150ms: clients
  // wait `delay` ms, then arm locally, and every client anchors on that same
  // post-delay instant so live and spectator times stay comparable.
  // The five lights are a promise: when they go out, the clue is over. There
  // was no timeout at all, so a clue nobody wanted sat open until the host
  // noticed and pressed X — and on a re-toss the lights ran a second time,
  // which read as a glitch rather than as a second race.
  const armTimeout = () => {
    clearTimeout(match.raceTimer);
    if (!match.settings.autoStumper) return;
    const grace = (match.settings.lecternSeconds ?? 5) * 1000
      + match.settings.delay + 400;
    match.raceTimer = setTimeout(() => {
      if (!match || !match.race || !match.race.open || !match.clue) return;
      if (match.race.buzzes.some((b) => !b.spectator)) return;   // somebody is on the clock
      match.race.open = false;
      match.race.timedOut = true;
      io.to(`${match.id}:host`).emit('race-timeout', {});
      pushAll();
    }, grace);
  };

  socket.on('activate', hostOnly(() => {
    if (!match.race) return;
    const at = Date.now() + match.settings.delay;
    match.race.open = true;
    match.race.activatedAt = at;
    // Sent before anything else and deliberately tiny. This is the one message
    // in the whole app where a few milliseconds are worth protecting.
    // NOT volatile: volatile packets are dropped rather than queued, which is
    // precisely wrong for the one signal that must reach everybody.
    io.to(`${match.id}:players`).emit('activate-lights', { at });
    io.to(`${match.id}:players`).emit('activate-buzzers', { at, lockout: match.settings.lockout });
    runBots();
    armTimeout();
    pushAll();
  }));

  // Bots buzz by the clock rather than by hand. Each one is scheduled at the
  // moment its drawn reaction time lands, so the race fills in on the console
  // the way it would with people — rather than all at once the instant the
  // buzzers open.
  function runBots() {
    if (!match?.game || !match.race || !match.clue) return;
    clearBotTimers();
    const rng = match.rng || makeRng(Date.now() & 0x7fffffff);
    const armAt = match.race.activatedAt;
    // One offset for the whole clue: the host activates by hand at the end of a
    // spoken read, so when a read runs long everybody anticipating it is early
    // together.
    const jitter = drawReadJitter(rng, match.settings.botReadJitter ?? 45);
    const offset = match.botOffset();
    for (const p of match.game.live()) {
      const brain = match.bots.get(p.id);
      if (!brain) continue;
      if (match.race.lockedOut.has(p.id)) continue;
      const plan = planClue(brain, match.clue.row, rng, match.settings.lockout, jitter, offset);
      if (!plan.attempt) continue;

      if (plan.early) {
        const at = armAt + plan.earlyAt;
        match.botTimers.push(setTimeout(() => {
          const st = match.stat(p.id); st.early++; st.att++;
          pushHost();
        }, Math.max(0, at - Date.now())));
      }
      const fireAt = armAt + plan.ms;
      match.botTimers.push(setTimeout(() => {
        if (!match.race || !match.race.open) return;
        if (match.race.lockedOut.has(p.id)) return;
        if (match.race.buzzes.some((b) => b.token === p.id)) return;
        const st = match.stat(p.id);
        st.att++; st.times.push(plan.ms);
        match.race.buzzes.push({ token: p.id, name: p.name, ms: plan.ms,
          early: false, spectator: false, bot: true, botCorrect: plan.correct });
        match.race.buzzes.sort((a, b) => a.ms - b.ms);
        if (!match.fastest || plan.ms < match.fastest.ms) {
          match.fastest = { ms: plan.ms, name: p.name, clue: match.game.cluesRevealed + 1,
            category: match.clue?.category, value: match.clue?.value };
        }
        pushAll();
      }, Math.max(0, fireAt - Date.now())));
    }
  }
  function clearBotTimers() {
    if (!match) return;
    match.botTimers.forEach(clearTimeout);
    match.botTimers = [];
  }

  socket.on('resolve', hostOnly(({ winnerToken }) => {
    const { slot, row } = match.clue;
    const missed = [...match.race.lockedOut];
    const snap = match.game.snapshot();
    const statsSnap = JSON.stringify([...match.stats.entries()]);
    const clueMeta = { ...match.clue };
    const buzzes = (match.race?.buzzes || []).map((b) => ({ ...b }));
    const before = Object.fromEntries(match.game.live().map((p) => [p.id, p.score]));
    const t0 = match.lastClueAt || match.startedAt;
    match.lastClueAt = Date.now();

    // Whoever was actually on the clock when the race closed took it — not
    // whoever happened to be fastest at the instant they pressed.
    const tookIt = (match.race?.buzzes || []).filter((b) => !b.spectator)[0];
    if (tookIt) match.stat(tookIt.token).won++;

    const entry = match.game.resolveClue(slot, row, { winnerId: winnerToken ?? null, missedIds: missed });
    match.undoStack.push({ snap, statsSnap, fastest: match.fastest, clue: clueMeta });
    if (match.undoStack.length > 60) match.undoStack.shift();
    if (winnerToken && entry.gain) match.stat(winnerToken).drained += entry.gain;
    // Whoever took the clue calls the next one, as at a real lectern.
    if (winnerToken && match.game.players.get(winnerToken)?.state === 'live') {
      match.control = winnerToken;
    } else if (match.control && match.game.players.get(match.control)?.state !== 'live') {
      match.control = null;
    }
    for (const p of match.game.live()) {
      const st = match.stat(p.id);
      if (p.score > st.peak) st.peak = p.score;
    }
    const after = Object.fromEntries(match.game.live().map((p) => [p.id, p.score]));
    match.history.push({ clue: match.game.cluesRevealed, ceiling: match.game.ceiling, scores: after });

    if (match.record) {
      // What the clue was actually worth over its face value.
      const mult = clueMeta.face ? Math.round(clueMeta.value / clueMeta.face) : 1;
      match.record.clues.push({
        n: match.game.cluesRevealed,
        at: match.elapsed(),
        seconds: t0 ? Math.round((Date.now() - t0) / 100) / 10 : null,
        category: clueMeta.category, source: match.game.board[slot]?.source,
        note: clueMeta.note || null, row: clueMeta.row, value: clueMeta.value,
        faceValue: clueMeta.face ?? clueMeta.value,
        buzzes: buzzes.map((b) => ({ name: b.name, ms: b.ms, spectator: b.spectator,
          early: !!b.early, latency: match.roster.get(b.token)?.latency ?? null })),
        winner: winnerToken ? match.roster.get(winnerToken)?.name : null,
        missed: missed.map((t) => match.roster.get(t)?.name),
        stumper: !winnerToken,
        ceiling: match.game.ceiling,
        inRing: Object.keys(after).length,
        scoresBefore: before, scoresAfter: after,
        eliminated: (entry.eliminated || []).map((t) => match.roster.get(t)?.name),
        fieldClear: entry.fieldClear ? true : undefined,

        // Everything below had to be inferred from arithmetic before, and I got
        // it wrong on the first pass: a clue paying 2x looked like overtime when
        // it was pot scoring with three in the ring. If the log is the way this
        // game gets tuned, the log has to say what happened.
        overtime: mult > 1 ? mult : undefined,
        overtimeStarted: entry.overtimeStarted ? true : undefined,
        overtimeRaised: entry.overtimeRaised ? entry.overtimeRaised.multiplier : undefined,
        stalledClues: match.game.stalledClues,
        // entry.entered is a single id on a normal entry and a list when the
        // field clears and two come in at once.
        entered: (() => {
          const ids = entry.entered == null ? []
            : (Array.isArray(entry.entered) ? entry.entered : [entry.entered]);
          return ids.length ? ids.map((t) => ({
            name: match.roster.get(t)?.name,
            draw: match.game.players.get(t)?.drawNumber,
            stake: match.game.players.get(t)?.score })) : undefined;
        })(),
        queueLength: match.game.queued().length,
        topRope: match.game.live().filter((p) => p.topRope)
          .map((p) => match.roster.get(p.id)?.name).filter(Boolean).length || undefined,
        bounties: (entry.bountyCollected || []).length
          ? entry.bountyCollected.map((b) => ({
              by: match.roster.get(b.by)?.name, on: match.roster.get(b.on)?.name,
              amount: b.amount })) : undefined,
        bountiesOpen: match.settings.bounties
          ? [...match.game.players.values()]
              .reduce((n, p) => n + match.game.bountyTotal(p.id), 0) || undefined
          : undefined,
      });
    }

    clearBotTimers();
    clearTimeout(match.raceTimer);
    match.clue = null; match.race = null; match.retoss = 0;
    pushAll();
    // Whoever just walked in, and what they walk in to. Added here rather than
    // in the engine: the engine deals in rules and knows nothing about music.
    if (entry.entered != null) {
      const ids = Array.isArray(entry.entered) ? entry.entered : [entry.entered];
      entry.entrances = ids.map((t) => ({
        name: match.roster.get(t)?.name,
        theme: match.roster.get(t)?.theme || null,
      })).filter((x) => x.name);
    }
    // What the robots said.
    //
    // A robot that is simply marked wrong is a scoring event; one that says
    // "Millard Fillmore" is a player. The room can only enjoy the race if it
    // hears what the robots actually offered.
    const said = [];
    // The snapshot taken before the clue resolved: match.race is already gone
    // by this point, which is why the answers never appeared the first time.
    for (const b of buzzes) {
      if (!b.bot) continue;
      if (b.botCorrect && b.token === winnerToken) {
        said.push({ token: b.token, name: b.name, kind: 'right', text: clueMeta.answer });
      } else if (!b.botCorrect) {
        const w = match.wrongAnswer;
        said.push({ token: b.token, name: b.name, kind: 'wrong',
          text: w || "...I'll pass" });
      }
    }
    // And whoever took it calls the next one, the way a board leader does.
    if (winnerToken && match.bots.has(winnerToken)) {
      const open = [];
      match.game.board.forEach((c, si) => c.clues.forEach((x) => {
        if (!x.revealed) open.push({ category: c.title, value: [100, 200, 300, 400, 500][x.row - 1] });
      }));
      if (open.length) {
        const pick = open[Math.floor(Math.random() * open.length)];
        said.push({ token: winnerToken, name: match.roster.get(winnerToken)?.name,
          kind: 'pick', text: `${pick.category} for $${pick.value}` });
      }
    }
    if (said.length) {
      for (const room of ['host', 'watch', 'board']) {
        io.to(`${match.id}:${room}`).emit('bot-said', { said });
      }
    }

    io.to(`${match.id}:host`).emit('resolved', entry);
    io.to(`${match.id}:watch`).emit('resolved', entry);
    for (const t of entry.revived || []) {
      const sid = match.roster.get(t)?.socketId;
      if (sid) io.to(sid).emit('revived', {
        stake: Math.round(match.settings.startScore * match.settings.revivalFraction) });
    }
    if (match.game.finished) {
      match.phase = 'over';
      match.finishRecord();
      match.saveLog();
      pushAll();
    }
  }));

  // A miss locks that player out of the rest of the clue and re-opens the
  // race for everyone still eligible.
  socket.on('mark-wrong', hostOnly(({ token: t }) => {
    if (!match.race) return;
    match.race.lockedOut.add(t);

    // A genuinely fresh race, which is what the rules promise: "a missed clue
    // goes straight back out to everyone still eligible as a fresh buzzer
    // race". Keeping the old queue and promoting the next-fastest instead put
    // somebody on the clock the instant the host pressed N — no second race
    // happened, and the players who had not buzzed the first time never got
    // the chance the rules say they get.
    match.race.buzzes = [];
    match.race.open = true;
    match.race.activatedAt = Date.now() + match.settings.delay;
    match.retoss = (match.retoss || 0) + 1;
    io.to(`${match.id}:players`).emit('activate-buzzers',
      { at: match.race.activatedAt, lockout: match.settings.lockout });
    io.to(`${match.id}:host`).emit('retoss', { lockedOut: [...match.race.lockedOut] });
    runBots();
    armTimeout();
    pushAll();
  }));

  // Players can't tell you the delay is wrong until they've played a clue, so
  // this can't be a setup-only setting.
  socket.on('set-delay', hostOnly(({ delay }) => {
    const d = Math.max(0, Math.min(2000, Math.round(Number(delay) || 0)));
    match.settings.delay = d;
    if (match.game) match.game.s.delay = d;
    match.note('delay', { delay: d });
    match.corrections.push({ at: match.elapsed(), clue: match.game?.cluesRevealed ?? 0,
      type: 'delay', to: d });
    pushAll();
  }));

  socket.on('veto', hostOnly(({ slot }) => {
    const cat = match.game.board[slot];
    match.vetoLog.push({ categoryId: cat.id, at: Date.now() });
    match.game.vetoCategory(slot, 'host veto');
    pushHost();
  }));

  socket.on('end-match', hostOnly(() => {
    match.phase = 'over'; match.finishRecord(); match.saveLog(); pushAll();
  }));

  // --- corrections -----------------------------------------------------

  socket.on('undo-clue', hostOnly(() => {
    const last = match.undoStack.pop();
    if (!last) return socket.emit('error-msg', 'nothing to undo');
    match.game.restore(last.snap);
    match.stats = new Map(JSON.parse(last.statsSnap));
    match.fastest = last.fastest;
    match.history.pop();
    if (match.record) match.record.clues.pop();
    match.phase = 'live';
    match.clue = null; match.race = null;
    match.corrections.push({ at: match.elapsed(), clue: match.game.cluesRevealed,
      type: 'undo', category: last.clue?.category, value: last.clue?.value });
    match.note('undo', { category: last.clue?.category, value: last.clue?.value });
    pushAll();
    io.to(`${match.id}:host`).emit('undone', { category: last.clue?.category, value: last.clue?.value });
  }));

  socket.on('adjust-score', hostOnly(({ token: t, delta, reason }) => {
    const r = match.game.adjustScore(t, Number(delta) || 0);
    if (!r) return socket.emit('error-msg', 'no such player');
    const name = match.roster.get(t)?.name;
    match.corrections.push({ at: match.elapsed(), clue: match.game.cluesRevealed,
      type: 'adjust', player: name, delta: Number(delta), from: r.before, to: r.after,
      reason: reason || null });
    match.note('adjust', { player: name, delta: Number(delta), to: r.after });
    const h = match.history[match.history.length - 1];
    if (h) h.scores[t] = r.after;
    pushAll();
    io.to(`${match.id}:host`).emit('adjusted', { name, delta: Number(delta), to: r.after });
  }));

  // --- player actions --------------------------------------------------

  // An early press never enters the race. It costs the player their lockout
  // on their own device and shows up in their stats, nothing more.
  // --- advanced mechanics ---------------------------------------------

  socket.on('top-rope', ({ on }) => {
    if (!match?.game || !token) return;
    if (match.clue) return socket.emit('error-msg', 'declare between clues, not on one');
    if (match.game.setTopRope(token, on)) {
      match.note('top-rope', { player: match.roster.get(token)?.name, on: !!on });
      pushAll();
    }
  });

  // Declared by somebody in the ring; paid at the next clue boundary so play
  // never stops while a number is typed.
  socket.on('save-player', ({ target, amount }, ack) => {
    if (!match?.game || !token) return ack?.({ error: 'no match' });
    const r = match.game.declareSave(token, target, amount);
    if (r.ok) { match.note('save-declared', { by: token, target, amount: r.amount }); pushAll(); }
    ack?.(r);
  });

  // From the queue: fund anyone in the ring out of your own entry.
  socket.on('gift', ({ target, amount }, ack) => {
    if (!match?.game || !token) return ack?.({ error: 'no match' });
    const r = match.game.giftFromQueue(token, target, amount);
    if (r.ok) {
      match.note('gift', { from: token, to: target, amount: r.amount });
      io.to(`${match.id}:host`).emit('gifted', {
        from: match.roster.get(token)?.name,
        to: match.roster.get(target)?.name, amount: r.amount });
      pushAll();
    }
    ack?.(r);
  });

  socket.on('set-target', ({ target }) => {
    if (!match?.game || !token) return;
    if (match.game.setTarget(token, target || null)) {
      const me = match.roster.get(token)?.name;
      match.note('target', { player: me, target: target ? match.roster.get(target)?.name : null });
      if (target) io.to(match.roster.get(target)?.socketId || '').emit('targeted', { by: me });
      pushAll();
    }
  });

  socket.on('place-bounty', ({ target, amount }, ack) => {
    if (!match?.game || !token) return ack?.({ error: 'not in a match' });
    const r = match.game.placeBounty(token, target, amount);
    if (r.error) return ack?.(r);
    match.note('bounty', { placer: match.roster.get(token)?.name,
      target: match.roster.get(target)?.name, amount: r.amount });
    ack?.(r);
    pushAll();
  });

  socket.on('early-buzz', () => {
    if (!match || !token) return;
    // Counted as an attempt as well as an early one, so `early` can never
    // exceed `att` — which is what made the table look broken.
    const st = match.stat(token);
    st.early++; st.att++;
  });

  // Spectators are ranked against the LIVE field only, never against each
  // other: a room full of people warming up should not be told they came
  // fourth out of nine when only three of those were in the ring.
  const rerank = (race, game) => {
    const liveTimes = race.buzzes.filter((b) => !b.spectator).map((b) => b.ms);
    for (const b of race.buzzes) {
      b.ranked = b.spectator
        ? game.rankSpectatorBuzz(b.ms, liveTimes)
        : { place: liveTimes.filter((t) => t < b.ms).length + 1, outOf: liveTimes.length };
    }
  };

  socket.on('buzz', ({ ms, status }) => {
    touch();
    if (!match || !token || !match.race) return;
    const g = match.game;
    const p = g?.players.get(token);
    const spectator = !p || p.state !== 'live';
    if (!spectator && match.race.lockedOut.has(token)) return;
    if (match.race.buzzes.some((b) => b.token === token)) return;
    // Defensive: a client that reports an early press as a buzz is ignored.
    // Note the bound is >= 0, not > 0. Players time the buzzer to the rhythm of
    // the read rather than reacting to the lights, so a perfectly judged buzz
    // legitimately lands at 0.0 — that's the best possible result, not a fault.
    if (status === 'early' || typeof ms !== 'number' || !isFinite(ms) || ms < 0) return;
    const rec = {
      token, name: match.roster.get(token)?.name || 'Player',
      ms: Math.round(ms * 10) / 10, early: false, spectator,
    };
    // Warm-up presses are practice: they must not touch the live record.
    //
    // They used to increment the same counters as a real attempt, and a player
    // eliminated at clue 9 who kept buzzing for the remaining 75 finished the
    // match credited with 159 attempts against a real 1. Across a live match
    // 43% of every recorded buzz was warm-up, so every attempt count and win
    // rate in the standings was wrong.
    const st = match.stat(token);
    if (spectator) {
      st.warmAtt = (st.warmAtt || 0) + 1;
      st.warmTimes = st.warmTimes || [];
      st.warmTimes.push(rec.ms);
    } else {
      st.att++; st.times.push(rec.ms);
    }
    if (!match.roster.get(token)?.isBot) {
      if (!match.humanBuzzes.has(token)) match.humanBuzzes.set(token, []);
      match.humanBuzzes.get(token).push(rec.ms);
    }
    match.race.buzzes.push(rec);
    match.race.buzzes.sort((a, b) => a.ms - b.ms);

    // The fastest buzz of the match has to have been a real one — otherwise it
    // can be won by somebody who was not in the ring.
    if (!spectator && (!match.fastest || rec.ms < match.fastest.ms)) {
      match.fastest = { ms: rec.ms, name: rec.name, clue: g.cluesRevealed + 1,
        category: match.clue?.category, value: match.clue?.value };
    }
    // Re-rank the whole race, not just the buzz that arrived.
    //
    // Ranking once at insert froze a warm-up buzz against whoever happened to
    // have buzzed already — and somebody warming up is usually early, so the
    // field was empty and every practice press came back "1st of 1". The
    // placing only means anything once the live buzzes are in, so it is
    // recomputed each time one lands.
    rerank(match.race, g);
    pushAll();
  });

  // The client resizes to 128x128 before sending, so this stays small. It is
  // held on the match and dies with it — the copy that survives a refresh is
  // the one cached on the player's own device.
  // A weapon token, chosen from the library. Cheap to carry — two short
  // strings — so unlike the photographs these ride along on the state push.
  socket.on('token-art', ({ art, colour }, ack) => {
    if (!match || !token) return;
    const p = match.roster.get(token);
    if (!p) return;
    // Everyone except this player — their own token should not block them.
    const others = [...match.roster.values()]
      .filter((x) => x.token !== token).map((x) => x.tokenArt);
    const resolved = resolveChoice(art, colour, others);
    if (!resolved) return;
    p.tokenArt = resolved;
    ack?.(resolved);
    pushAll();
  });

  socket.on('avatar', ({ dataUrl }) => {
    if (!match || !token) return;
    const p = match.roster.get(token);
    if (!p) return;
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) return;
    if (dataUrl.length > 60000) return;          // ~45KB of image, generous for 128px
    p.avatar = dataUrl;
    io.to(`${match.id}:host`).emit('avatar', { token, dataUrl });
    pushHost();
  });

  socket.on('ping-probe', (_d, ack) => ack?.());
  socket.on('time-probe', (_d, ack) => ack?.(Date.now()));

  socket.on('buzzer-latency', ([ms, ref]) => {
    if (!match || !token) return;
    const p = match.roster.get(token);
    if (!p) return;
    p.latency = ms; p.latencyAt = Date.now();
    if (!match.latency.has(token)) match.latency.set(token, []);
    const log = match.latency.get(token);
    log.push({ at: match.elapsed(), ms });
    if (log.length > 400) log.shift();
  });
});

http.listen(PORT, () => console.log(`J! Royal Rumble on :${PORT}`));
