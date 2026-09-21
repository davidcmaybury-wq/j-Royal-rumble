import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID, randomBytes } from 'crypto';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RumbleGame, makeRng, autoEntryInterval, expectedClues, DEFAULT_SETTINGS } from './engine.js';
import { makeWeightedPool, fromTtgJson, fromJpartyCsv, parseCsv, parseLooseJson } from './sources.js';
import { assignToken, resolveChoice } from './tokens-server.js';
import { distinctLook, looksAlike } from '../public/wrestlers.js';
import { wrongAnswer, status as wrongsStatus } from './wrongs.js';
import * as tts from './tts.js';
import * as judge from './judge.js';
import { Autohost } from './autohost.js';
import * as reports from './reports.js';
import * as logs from './logstore.js';
import { mountAvailability, when, discord } from './when-routes.js';
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
// Which process answered this request.
//
// Matches live in this process's memory, so two reachable servers is two
// separate broken games — and the way you catch it is hitting /api/health twice
// and seeing the id change.
//
// This used to be `FLY_MACHINE_ID || 'local'`. Fly sets that variable; Lightsail
// does not, so after the migration it was the constant string 'local' on every
// response and the check could not detect anything at all — two instances would
// have answered identically. What the check needs is a value that differs per
// process and holds still within one. FLY_MACHINE_ID is still preferred when it is
// there, because the old Fly app is still up as a spare and its own id is the
// more useful label on that box.
//
// Pid and a boot nonce rather than the hostname, for two reasons. /api/health is
// public and unauthenticated, and the hostname here is `ip-172-26-x-y` — no
// reason to publish an internal address to answer "is more than one of you
// running". And pids are only unique per machine: two boxes can both be serving
// from pid 1234, which is exactly the case this check exists to catch, so the
// nonce is what actually guarantees they differ.
const MACHINE = process.env.FLY_MACHINE_ID
  || `${process.pid}-${randomBytes(3).toString('hex')}`;

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
// Responses stop announcing the framework. Free, and one less thing to fingerprint.
app.disable('x-powered-by');

// The site was sending no security headers at all — no HSTS, no nosniff, no
// frame protection. helmet's defaults cover those; the referrer policy is
// overridden below, because its default broke YouTube embeds outright.
//
// Content-Security-Policy is off on purpose, not by oversight. Every page here
// is a single self-contained file with its inline <script> and <style>, which a
// default CSP blocks outright — the buzzer would simply stop working. Turning it
// on means either `unsafe-inline`, which gives most of the protection away, or
// moving every page's script to its own file and hashing it. That is a real
// piece of work and a separate change; doing it badly would break the one page
// players cannot do without.
//
// The referrer policy is set rather than inherited. helmet defaults to
// `no-referrer`, which strips the Referer from every outbound request — and
// YouTube uses it to decide whether a site may embed a video. With no referrer
// it refuses, answering error 153, so every YouTube entrance theme died
// silently for as long as entrance music has existed. Players kept choosing
// them: seven on 2026-09-07 alone, and the room never heard one.
//
// `strict-origin-when-cross-origin` sends the origin and nothing else to a
// cross-origin HTTPS destination, so YouTube learns `https://j-royal-rumble.net`
// and no more. The two things worth protecting are untouched: the host key
// lives in the URL *fragment*, which no policy ever sends, and the path — the
// room code in /host/LXAF or /j/ABCD — is not sent cross-origin under this
// policy either. Same-origin requests still get the full URL, and a downgrade
// to http sends nothing.
app.use(helmet({
  contentSecurityPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
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

// The host's voice, one clip at a time. The key is the one the server put in
// `host-speaks`, forty hex characters of a hash, and anything else is refused
// before the filesystem is consulted. A clip is immutable once written, so it
// can be cached hard: thirty clients fetching the same read hit CloudFront,
// not the box.
app.get('/clip/:engine/:key.wav', (req, res) => {
  const p = tts.locate(req.params.engine, req.params.key);
  if (!p) return res.status(404).type('text/plain').send('no such clip');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type('audio/wav');
  res.sendFile(p);
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
    // The backfire default is a property of the mode, not of the engine.
    //
    // The decision was Arcade/Chaos 0 and Tournament 0.5, host-adjustable in
    // every mode. That only ever got implemented in the quick-start ruleset
    // table, and Tournament is *derived* from `comeback: false` — so a host who
    // turned the comeback off any other way got Tournament with the engine
    // default of 0, an aimed miss costing nothing. Recorded that way in the
    // Tradiac lobbies and then in David's own M20 on 0.95.8, where targeting
    // was on and it mattered live.
    //
    // Applied only when the host did not name it, so the dial still wins.
    if (!Object.prototype.hasOwnProperty.call(settings || {}, 'targetBackfire')
        && this.settings.comeback === false) {
      this.settings.targetBackfire = 0.5;
    }
    // All Jeopardy! archive by default. The custom boards are still there and
    // one slider moves them back in; they are just not what most matches want
    // as a starting point.
    this.blend = settings.blend || { original: 0, archive: 1 };
    // Who ran the match. Metadata, not a rule — it rides beside the settings
    // rather than inside them so it never reaches the engine, the same way
    // `blend` does. It is here so the saved logs can be grouped by host: the
    // read is a big part of how a match plays, and nine recorded matches all
    // have the same host, so nothing measured so far can separate the host's
    // pace from the rules.
    this.hostName = '';
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
        // Null rather than '' so a log written before hosts were recorded and
        // one where the box was left empty read the same in the analysis.
        host: this.settings.autohost ? 'autohost' : (this.hostName || null),
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
        // Settings are passed so the recorded prediction is the same one the
        // setup page showed the host. Without them the revival multiplier is
        // skipped, and `estimateError` grades a number nobody ever saw.
        estimate: (() => {
          const clues = expectedClues(
            this.roster.size, this.settings.entryInterval, this.settings);
          return {
            entryInterval: this.settings.entryInterval,
            secondsPerClue: this.settings.secondsPerClue,
            expectedClues: clues,
            expectedMinutes: Math.round(clues * this.settings.secondsPerClue / 60),
          };
        })(),
        clues: [],
        events: [],
      };
    }
  }

  // --- public views ----------------------------------------------------

  /**
   * Which of the two shapes this match is, named for the room rather than for
   * the setting behind it.
   *
   * ARCADE — the comeback is on, so somebody knocked out before they got going
   * comes back with time off their buzz. Buzz order stops being buzz speed, so
   * the screens show places and keep each player's own milliseconds to
   * themselves.
   *
   * TOURNAMENT — the comeback is off. Fastest press wins, every time, and the
   * times are public because they mean exactly what they look like.
   *
   * It is a property of the match, not of the moment: a label that switched on
   * and off as players picked up and lost the edge would tell the room nothing
   * it could act on.
   */
  arcade() { return !!this.settings.comeback; }
  mode() { return this.arcade() ? 'arcade' : 'tournament'; }

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
      // The stables, so every board can tint its rows and show the badges.
      stables: this.settings.stables ? this.stableList() : null,
      phase: this.phase, gameId: this.id, version: VERSION, watching: true,
      clues: g.cluesRevealed,
      ceiling: g.ceiling,
      control: this.control,
      overtime: g.overtime ? g.overtime() : null,
      cluesUntilNextEntry: g.cluesUntilNextEntry(),
      retoss: this.retoss || 0,

      board: g.board.map((c) => ({
        title: c.title, note: c.note, source: c.source,
        // The year the category was written, for archive material only. A J!
        // category is of its time — "STATE OF THE UNION ADDRESSES" plays very
        // differently in 2005 than now — and the room should be able to see
        // that before somebody buzzes. Original boards have an author rather
        // than an air date and show nothing, which is why this keys off the
        // source and not merely on the field being present.
        year: c.source === 'archive' && c.provenance?.airDate
          ? Number(String(c.provenance.airDate).slice(0, 4)) || null
          : null,
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

      // Arcade mode shows the order, not the clock.
      //
      // With the comeback on, the ranking is ms x buzzEdge, so a slower press
      // legitimately takes the clue — which read as a scoring bug the first
      // time a room saw it. Sending places rather than times removes the
      // contradiction at the source instead of explaining it afterwards. Each
      // player still gets their own number, through myBuzz; nobody gets anybody
      // else's. The match record keeps every real time either way.
      arcade: this.arcade(),
      race: this.race ? {
        open: !!this.race.open,
        timedOut: !!this.race.timedOut,
        buzzes: this.race.buzzes.filter((b) => !b.spectator)
          .map((b, i) => ({ name: b.name, place: i + 1, early: !!b.early,
            ...(this.arcade() ? {} : { ms: b.ms }) })),
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
      // Which stable, so every scoreboard can tint the row the same way.
      stable: p.stable || null,
      // On the way back from a near-elimination, with time off their buzz.
      onFloor: g.onTheFloor ? g.onTheFloor(p.id) : false,
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
      // What the computer host is doing and how the room is hearing it — for
      // a console left open to watch, and for the test that proves the spread
      // of playback starts is being collected.
      autohost: this.autohost ? { ...this.autohost.status(), heard: this.autohost.heardSummary() } : null,
      roster: [...this.roster.values()].map((p) => ({
        token: p.token, name: p.name, connected: p.connected,
        hasAvatar: !!p.avatar, latency: p.latency ?? null,
        // Whether this player brought their own entrance music, so the console
        // can skip the horn rather than playing two sounds over each other. A
        // flag and not the theme itself: the console only needs to know that
        // music is coming. It has to ride the state because the state push
        // beats the `resolved` event that carries `entrances`, so at the moment
        // the console notices somebody walked in, nothing else has told it yet.
        hasTheme: !!p.theme,
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
        // The year the category was written, for archive material only. A J!
        // category is of its time — "STATE OF THE UNION ADDRESSES" plays very
        // differently in 2005 than now — and the room should be able to see
        // that before somebody buzzes. Original boards have an author rather
        // than an air date and show nothing, which is why this keys off the
        // source and not merely on the field being present.
        year: c.source === 'archive' && c.provenance?.airDate
          ? Number(String(c.provenance.airDate).slice(0, 4)) || null
          : null,
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
        // Which shape the room is playing; see Match.arcade().
        arcade: this.arcade(),
        fastest: this.fastest,
        // The history is only needed once, at the end. Pushing every point of
        // it on every state change was the bulk of the traffic.
        ...(this.phase === 'over' ? { history: this.history } : {}),
        historyLength: this.history.length,
        recording: !!this.record,
        // So the console can say when an entrance will pass in silence.
        soundScreens: soundScreens.size,
        themesChosen: [...this.roster.values()].filter((p) => p.theme).length,
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
      // Which stable, so every scoreboard can tint the row the same way.
      stable: p.stable || null,
      // On the way back from a near-elimination, with time off their buzz.
      onFloor: g.onTheFloor ? g.onTheFloor(p.id) : false,
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
      id: st.id, name: st.name, colour: st.colour,
      members: members.get(st.id) || [] }));
  }

  raceView() {
    if (!this.race) return null;
    return {
      open: this.race.open,
      lockedOut: [...this.race.lockedOut],
      buzzes: this.race.buzzes
        .filter((b) => !b.spectator)
        // The console loses the times in Arcade too. It is the surface most
        // likely to be on a shared screen — the same reason the next entrant's
        // name is hidden there — and the host adjudicates on who is on the
        // clock, which is the place, not the number.
        .map((b, i) => ({ token: b.token, name: b.name, place: i + 1, early: b.early,
          ...(this.arcade() ? {} : { ms: b.ms }),
          // No `edge` field any more. 0.85.1 sent the ranked time beside the
          // real one so the host could see why a slower press held the clock —
          // the answer to "P11 was fastest but P12 was highlighted as first
          // in". buzzEdge only ever differs from 1 when the comeback is on,
          // which is exactly when this view stops carrying times at all, so it
          // could never fire again. Showing the order beats explaining the
          // arithmetic behind it.
          //
          // A robot knows whether it is about to be right; the host has no way
          // to adjudicate one, so the console is told.
          bot: !!b.bot, botCorrect: b.bot ? b.botCorrect : undefined })),
    };
  }

  setupView() {
    return {
      gameId: this.id, phase: this.phase, version: VERSION,
      settings: this.settings, blend: this.blend, hostName: this.hostName,
      // Whether the box has a voice, so the setup page can say so beside the
      // autohost switch rather than letting a silent match be discovered live.
      voice: { engine: tts.status().engine, configured: tts.status().configured, reason: tts.status().reason },
      // Same reasoning, for the other way an autohost match refuses to start:
      // no judge configured. David hit that refusal after gathering a full
      // lobby; the setup page should say so before anyone shows up.
      judge: { configured: judge.status().configured, mode: judge.status().mode },
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
        // Recorded alongside revivals because otherwise the comeback leaves no
        // trace in a saved match at all. The engine tracks it per player, but it
        // never reached the record, so the mechanic the whole fairness programme
        // rests on could not be measured from live play — and a lives count
        // derived from `revivals` alone silently undercounts whenever it fired.
        // Found while checking the Aug 22 logs, where the arithmetic happened to
        // balance without it and so looked complete.
        comebackUsed: !!p.comebackUsed,
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
        warmAtt: st.warmAtt || 0, warmEarly: st.warmEarly || 0,
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
      // On the way back from a near-elimination, with time off their buzz.
      onFloor: g.onTheFloor ? g.onTheFloor(p.id) : false,
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
      // The player's own number stays theirs — myBuzz below still carries it.
      // What goes is everybody else's, which is what made buzz order look like
      // a lie once the comeback could reorder it.
      arcade: this.arcade(),
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
      // With no human host, the buzzer is where a player learns what the host
      // is doing and whether it is their board to call.
      autohost: !!this.settings.autohost,
      host: this.autohost ? { state: this.autohost.state, line: this.autohost.line,
        // Per viewer: a player needs to know whether their own O is already in.
        objection: this.autohost.objectionView(token),
        award: this.autohost.awardView() } : null,
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
  // Trimmed and capped: it lands in the saved record and on a table, and an
  // empty string has to mean "not recorded" rather than a host called "   ".
  // Tested for presence rather than truthiness, so clearing the box works.
  if (req.body.hostName != null) {
    m.hostName = String(req.body.hostName).trim().slice(0, 40);
  }
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
  // Robots walk in to music unless the caller says otherwise.
  //
  // Entrance music went unheard in every recorded match while players kept
  // choosing it — seven of them on 2026-09-07 alone — and the reason took a
  // week to find because reproducing it needed a human to pick a link and then
  // walk into a live ring. A robot can do both, so the feature is now testable
  // by one person with no players in the room.
  //
  // The YouTube ids are real picks from the 2026-09-07 matches, kept because
  // the failure is specific to the YouTube branch and a library .mp3 would test
  // the half that already worked. They are video ids and nothing else: no
  // player is named here and no mapping to one exists.
  //
  // One of the original four was swapped out: its owner blocks embedding, so
  // every robot match would have cried wolf with a warning about a link nobody
  // could act on. The replacement is a Creative Commons Blender short, which
  // will not quietly become unplayable later. The blocked id lives on as a
  // fixture in test/entrance.mjs, where a refusal is the point.
  const wantsThemes = req.body?.themes !== false;
  const BOT_THEMES = [
    { kind: 'youtube', id: 'CMV850rhcQM', seconds: 5, start: 0 },
    { kind: 'library', key: 'wrestling-heel', seconds: 5 },
    { kind: 'youtube', id: 'HMuYfScGpbE', seconds: 5, start: 0 },
    { kind: 'library', key: 'sports-anthem', seconds: 5 },
    { kind: 'youtube', id: 'aqz-KE-bpKQ', seconds: 7, start: 0 },
    { kind: 'library', key: 'horror-stalker', seconds: 5 },
    { kind: 'youtube', id: '52PHX4m07aI', seconds: 5, start: 0 },
    { kind: 'library', key: 'horror-dirge', seconds: 5 },
  ];
  // Alternating the two kinds is the point: if the library entries are heard
  // and the YouTube ones are not, that is the answer in one match rather than
  // an argument about whether the sound was on.
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
      theme: wantsThemes ? BOT_THEMES[m.bots.size % BOT_THEMES.length] : null,
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

// Matches live in this process's memory. If two servers are running, a host can
// create a match on one and have players land on the other — which shows up as
// "bad host key" and "no such game". Hitting this twice and seeing the machine
// id change is the tell, which is why that id has to differ per process; see
// MACHINE above for the version of this check that could not.
// Public health is deliberately thin.
//
// It used to hand anybody the machine id, the on-disk log path, the library
// size, how many matches were live and how many people were in them. None of
// that helps a player and all of it helps somebody mapping the box.
//
// `version` stays public because it already is — /history prints "Running X
// right now" on a page with no key — and hiding it here while showing it there
// would be theatre that breaks deploy verification for nothing.
//
// The full body is still available two ways, which is what keeps the deploy
// guard working: from the box itself (deploy-remote.sh curls 127.0.0.1 to ask
// matchesInPlay before it restarts and ends people's games), and with the admin
// key from anywhere.
const localReq = (req) => {
  // socket.remoteAddress only — never req.ip. If `trust proxy` is ever switched
  // on, req.ip becomes the X-Forwarded-For value, which the client controls, and
  // this check would hand the full body to anyone who sent the right header.
  const ip = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
};

app.get('/api/health', (req, res) => {
  if (!localReq(req) && !adminOk(req)) {
    return res.json({ status: 'ok', version: VERSION });
  }
  res.json({
    logs: logs.status(),
    // Both of these report their own storage and what they are missing,
    // because an unconfigured integration and a broken one look the same
    // from outside and only one of them is worth getting out of bed for.
    availability: when.status(),
    discord: discord.status(),
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
    // Where the robots' wrong answers are coming from. Reported because the
    // fallback used to be silent: nonsense answers were the only symptom of a
    // missing key, a rejected key, or a bad model name, and they look the same.
    wrongAnswers: wrongsStatus(),
    voice: tts.status(),
    judge: judge.status(),
  });
});

// The entrance-music library: whatever mp3s are in public/audio/themes.
//
// Read from the folder rather than a hardcoded list, so dropping a file in adds
// it without a deploy. Names come from the filename — "wrestling-champion.mp3"
// becomes mood Wrestling, title Champion — which keeps the folder the single
// source of truth and means there is no manifest to fall out of step.
const THEME_DIR = join(__dir, '../public/audio/themes');
// Can YouTube actually be embedded here, or is the room about to hear nothing?
//
// A player picks a link, the match starts, they walk in, and the video refuses
// — by which point the only person who can act on it is mid-entrance and has no
// idea. The oEmbed endpoint answers the same question the player needs answered
// at the moment they choose: 403 for a video whose owner has turned embedding
// off, 404 for one that is private or gone. Checked against the four real picks
// from 2026-09-07, it flags exactly the one that failed live and passes the
// three that played.
//
// Fails OPEN. A network blip, a timeout, or anything unexpected returns
// playable: a false rejection takes away a theme that would have worked, which
// is worse than the silence this is trying to prevent, and the console still
// reports a refusal at entrance time either way.
const YT_CHECK = new Map();   // id -> { ok, reason }, for the life of the process

async function ytPlayable(id) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id || '')) return { ok: false, reason: 'That is not a YouTube link.' };
  if (YT_CHECK.has(id)) return YT_CHECK.get(id);
  let out = { ok: true };
  try {
    const url = 'https://www.youtube.com/oembed?url='
      + encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json';
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (r.status === 401 || r.status === 403) {
      out = { ok: false, reason: 'That video\u2019s owner does not allow it to be played on other sites. Pick a different one.' };
    } else if (r.status === 404 || r.status === 400) {
      // 404 is private or deleted; 400 is what oEmbed returns for a
      // well-formed id that never existed (measured 2026-09-21). Both were
      // going to be silence at the entrance, which is the thing this check
      // exists to say out loud.
      out = { ok: false, reason: 'That video is private or no longer exists. Pick a different one.' };
    }
  } catch { /* fail open, deliberately — see above */ }
  YT_CHECK.set(id, out);
  return out;
}

// Used by the buzzer's picker before it saves, so the answer arrives while the
// player is still looking at the box they pasted into. A plain GET and not a
// socket call because the picker is reachable before joining a match, which is
// where most themes are actually chosen.
app.get('/api/theme-check', async (req, res) => {
  res.json(await ytPlayable(String(req.query.id || '')));
});

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
// Guarded by RUMBLE_ADMIN_KEY, which must be set in the service environment.
// A password, not a secret. It keeps a stranger who finds the address from
// ending a live match; it is not protecting anything valuable, and it travels
// in a request header rather than the URL so it stays out of logs.
// No default. There used to be one — the literal string 'daymay' — sitting in a
// public repo, which meant /api/control was open to anyone who read the source:
// list every live match, download every log and report, and end a game in
// progress. It read as protected because an unauthenticated request correctly
// returned 403. Found 2026-08-17; the external review that prompted the fix
// missed it for exactly that reason, testing without a key and stopping there.
//
// Unset now means refuse, not allow. A guard whose default is open is not a
// guard — the second fail-open default found in the same sitting.
const ADMIN_KEY = process.env.RUMBLE_ADMIN_KEY || '';
function adminOk(req) {
  // An empty configured key must never match an empty supplied one.
  if (!ADMIN_KEY) return false;
  const given = req.get('x-admin-key') || req.query.key || '';
  return given === ADMIN_KEY;
}

app.get('/control', (_req, res) => res.sendFile(join(__dir, '../public/control.html')));

// Anybody can file one — no key, no account. That is the point: the people
// hitting bugs are players, and a form that asks them to sign up is a form
// nobody fills in. The guards are in reports.js: a length cap and a rate limit.
app.post('/api/report', (req, res) => {
  const r = reports.save(req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

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
    reports: reports.list().slice(0, 200),
    reportStatus: reports.status(),
    newSince: sinceMarker(),
    newCount: countSince(sinceMarker()),
  });
});

// Dealt with, or noise. Guarded like the rest of the control room.
app.post('/api/control/report/:file', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const r = reports.update(req.params.file, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// --- bulk download -------------------------------------------------------
//
// Everything added since the last time somebody took a copy, in one file.
//
// The marker lives on disk beside the files, not in the browser: a timestamp in
// local storage means opening this page from a different machine either
// re-downloads everything or silently skips a batch. And it only moves once the
// download has actually been written, because a dropped connection that had
// already advanced the marker would lose reports with no way to know which.
const MARKER = join(reports.dir(), '.last-download');

function sinceMarker() {
  try { return readFileSync(MARKER, 'utf8').trim() || null; } catch { return null; }
}
function countSince(since) {
  const newer = (x) => !since || x.at > since;
  return logs.list().filter(newer).length + reports.list().filter(newer).length;
}

app.get('/api/control/download', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const all = req.query.all === '1';
  const since = all ? null : sinceMarker();
  const newer = (x) => !since || x.at > since;

  const bundle = {
    takenAt: new Date().toISOString(),
    since: since || 'the beginning',
    logs: [], reports: [],
  };
  for (const l of logs.list().filter(newer)) {
    const body = logs.read(l.file);
    if (body) { try { bundle.logs.push({ file: l.file, match: JSON.parse(body) }); }
      catch { /* skip a half-written file rather than fail the lot */ } }
  }
  for (const r of reports.list().filter(newer)) {
    const body = reports.read(r.file);
    if (body) { try { bundle.reports.push({ file: r.file, report: JSON.parse(body) }); }
      catch { /* same */ } }
  }

  const name = `rumble-${all ? 'everything' : 'new'}-${bundle.takenAt.slice(0, 10)}.json`;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-disposition', `attachment; filename="${name}"`);
  res.send(JSON.stringify(bundle, null, 2));

  // Only now, and never for a full archive dump — that is a copy, not a
  // handover, and moving the marker would hide the next batch.
  if (!all) {
    try { writeFileSync(MARKER, bundle.takenAt); } catch { /* nothing to do */ }
  }
});

// Ending somebody's match is destructive, so it is a POST and it records.
app.post('/api/control/:id/end', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const m = matches.get(String(req.params.id || '').toUpperCase());
  if (!m) return res.status(404).json({ error: 'no such match' });
  if (m.phase === 'live') {
    m.phase = 'over';
    m.endedReason = 'admin';
    m.autohost?.onOver();
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
    // Up to ten seconds. Long enough for a hook, short enough that the room is
    // not waiting on somebody's music before the next clue.
    const secs = Math.min(10, Math.max(1, Math.floor(theme.seconds || 5)));
    return id ? { kind: 'youtube', id, seconds: secs,
      start: Math.max(0, Math.floor(theme.start || 0)) } : null;
  }
  if (kind === 'url') {
    const u = String(theme.url || '').slice(0, 500);
    return /^https:\/\//.test(u) ? { kind: 'url', url: u } : null;
  }
  return null;
}

/**
 * The robot on the clock says what it has, before the host adjudicates.
 *
 * Only the one who actually took the buzz — everybody else's answer is noise,
 * and in the room only the player on the clock ever speaks. A short settle
 * first, because a slower buzz can still arrive and take the lead.
 *
 * Module level because robots do not buzz through the socket handler: they are
 * driven by timers, so a hook on the incoming 'buzz' event never saw them and
 * the announcement silently never fired.
 */
function announceLeader(match) {
  if (!match || match.saidTimer || match.saidFor) return;
  match.saidTimer = setTimeout(() => {
    match.saidTimer = null;
    const lead = (match.race?.buzzes || []).filter((b) => !b.spectator)[0];
    if (!lead || !match.clue) return;
    match.saidFor = lead.token;
    // A person on the clock is the autohost's cue to listen: the same settle
    // that stops a robot speaking too early is exactly when a human should be
    // asked for their answer, because it is the moment the race is settled.
    if (!lead.bot) return match.autohost?.onLeader({ token: lead.token, name: lead.name });
    const line = lead.botCorrect
      ? { kind: 'right', text: match.clue.answer }
      : { kind: 'wrong', text: match.wrongAnswer || "...I'll pass" };
    for (const room of ['host', 'watch', 'board']) {
      io.to(`${match.id}:${room}`).emit('bot-said',
        { said: [{ token: lead.token, name: lead.name, ...line }] });
    }
    match.autohost?.onBotSaid({ name: lead.name, token: lead.token, ...line });
  }, (match.settings?.lockout || 250) + 450);
}

/**
 * Order a race, giving somebody on the way back their edge.
 *
 * The recorded `ms` is left alone — that is what the player actually did and
 * the log should keep it. The edge is applied only to the ordering, and the
 * console shows both numbers so nobody is left wondering why third place is
 * on the clock.
 */
function rankRace(match) {
  if (!match?.race) return;
  const g = match.game;
  const edge = (b) => b.ms * (g ? g.buzzEdge(b.token) : 1);
  match.race.buzzes.sort((a, b) => edge(a) - edge(b));
}

// Watch screens that have turned their sound on. A set of socket ids, so a
// closed tab stops counting the moment it disconnects.
const soundScreens = new Set();

// Broadcasting from outside a socket connection.
//
// The push helpers live inside the connection closure and close over one
// socket's match, so the reaper and the admin page cannot use them. This is
// the same three sends without that assumption.
function broadcast(m) {
  if (!m) return;
  pushHostNow(m);
  pushPlayersNow(m);
}

// The two halves of a push, at module level so the socket handlers, the
// reaper and the autohost all send the same thing.
function pushHostNow(m) {
  if (!m) return;
  io.to(`${m.id}:host`).emit('state', m.hostView());
  // Watchers get their own view, never the host's.
  // Two audiences, two rooms. A watch screen listens for `state`; a player in
  // full mode already uses `state` for their own buzzer view, so putting them
  // in the same room would overwrite it with somebody else's. They get their
  // own room and their own event name.
  const wv = m.watchView();
  io.to(`${m.id}:watch`).emit('state', wv);
  io.to(`${m.id}:board`).emit('watch-state', wv);
}
function pushPlayersNow(m) {
  if (!m) return;
  for (const p of m.roster.values()) {
    if (p.socketId) io.to(p.socketId).emit('state', m.playerView(p.token));
  }
}

// A burst of buzzes would otherwise fan out one full state push per buzz,
// per player. Coalescing them costs a few milliseconds of staleness and
// keeps the socket clear for the messages that are actually time-critical.
// The pending flag and timer live on the match, so a push scheduled from a
// socket handler and one scheduled by the autohost fold into the same send.
function schedulePush(m, what) {
  if (!m) return;
  m._pending = m._pending === 'all' || m._pending !== what ? (m._pending ? 'all' : what) : what;
  if (m._pushTimer) return;
  m._pushTimer = setTimeout(() => {
    const kind = m._pending;
    m._pushTimer = null; m._pending = null;
    if (kind === 'host' || kind === 'all') pushHostNow(m);
    if (kind === 'players' || kind === 'all') pushPlayersNow(m);
  }, PUSH_COALESCE_MS);
}
const pushDeps = (m) => ({
  pushAll: () => schedulePush(m, 'all'),
  pushHost: () => schedulePush(m, 'host'),
  pushPlayers: () => schedulePush(m, 'players'),
});

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

// How long a finished match stays in memory before it is dropped.
//
// It used to be forever: the reaper deleted idle lobbies and ended idle live
// matches, but nothing ever removed a match once its phase was 'over' — the
// `phase !== 'over'` guard below excluded exactly the case that accumulates.
// A server up five days was still holding every match played on it, each with
// its full clue record, per-clue score history and base64 avatars. Harmless at
// seven matches, unbounded over months, and the eventual symptom is an OOM
// nowhere near the cause.
//
// Deliberately much longer than IDLE_MS rather than sharing it. Ten minutes is
// the right answer for "nobody is playing"; it is the wrong answer for "nobody
// has clicked anything while reading the box score", and having the final
// standings vanish mid-read would be a worse bug than the leak. The log is on
// disk the moment the match ends, so after this window the match is still
// readable at /history — it is only the live view that goes.
const OVER_GRACE_MS = Number(process.env.RUMBLE_OVER_GRACE_MINUTES || 60) * 60 * 1000;

function reapIdle() {
  const now = Date.now();
  for (const [id, m] of matches) {
    const quiet = now - (m.lastActivity || now);
    // A finished match gets the longer grace; everything else the idle window.
    if (quiet < (m.phase === 'over' ? OVER_GRACE_MS : IDLE_MS)) continue;
    if (m.phase === 'live') {
      m.phase = 'over';
      m.endedReason = 'idle';
      m.autohost?.onOver();
      try { m.finishRecord(); m.saveLog(); } catch { /* record what we can */ }
      io.to(`${id}:host`).emit('error-msg',
        'This match was ended after ten minutes with nobody doing anything.');
      broadcast(m);
      console.log(`[reap] ended ${id} after ${Math.round(quiet / 60000)} min idle`);
    } else {
      // Lobbies and finished matches alike. A finished match has already
      // written its log, so dropping it loses nothing that is not on disk.
      matches.delete(id);
      console.log(`[reap] dropped ${m.phase === 'over' ? 'finished match' : 'idle lobby'} ${id}`
        + ` after ${Math.round(quiet / 60000)} min`);
    }
  }
}
// The interval is configurable so the reaper can actually be tested. At the
// default sixty seconds a test would have to sit for over a minute to watch one
// tick, which is how this went untested long enough to grow a leak.
const REAP_INTERVAL_MS = Number(process.env.RUMBLE_REAP_INTERVAL_MS || 60 * 1000);
setInterval(reapIdle, REAP_INTERVAL_MS).unref?.();

// The saved logs, guarded by RUMBLE_LOG_KEY. Fails closed.
//
// This returned true when the key was unset, on the reasoning that an unkeyed
// deployment is a test deployment. The live site then ran for months with it
// unset: /api/logs listed all 52 saved matches and /api/logs/<file> handed
// anybody a complete log — in-game handles, every buzz time, every answer. This
// project anonymizes players to P-labels in the handbook and keeps legal names
// out of the repo on purpose, and serving the raw logs unauthenticated undid all
// of that in one route.
const logGuard = (req) => {
  // The admin key opens these too. The control room downloads individual logs,
  // and it authenticates with the admin key — it only ever worked because this
  // guard was fail-open, so closing it without this line locks the host out of
  // their own match records. One key is a superset of the other rather than two
  // unrelated namespaces.
  if (adminOk(req)) return true;
  const want = process.env.RUMBLE_LOG_KEY;
  if (!want) return false;
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

// The handbook, as HTML.
//
// It used to serve a PDF built by tools/make-handbook.py, and the two drifted:
// the PDF was months behind the game while the HTML sat in docs/ unlinked. One
// of them had to be the live document, and the HTML is the one that reads well
// on a phone and can be updated without a build step.
app.get('/handbook', (_req, res) =>
  res.sendFile(join(__dir, '../docs/handbook.html')));

// The old PDF, still generated, still available for printing.
// The PDF was generated by tools/make-handbook.py with its figures typed in by
// hand, so it drifted from the game and then from the HTML handbook as well.
// Anybody following an old link gets the real thing rather than a stale copy.
app.get('/handbook.pdf', (_req, res) => res.redirect(301, '/handbook'));
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

// The Discord explainers, rendered for the web. These are the copy David posts
// before a match, kept in docs/ as the source and dressed here — one file, so
// the message in the channel and the page on the site cannot drift apart.
const DISCORD_HTML = (() => {
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (x) => esc(x)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<]+|\bj-royal-rumble\.net\b)/g,
      (m) => `<a href="${m.startsWith('http') ? m : 'https://' + m}">${m}</a>`);
  const render = (md) => md.split(/\n\n+/).map((b) => {
    b = b.trim();
    if (!b) return '';
    if (b.startsWith('**J!')) return `<h2>${inline(b)}</h2>`;
    return `<p>${inline(b).replace(/\n/g, ' ')}</p>`;
  }).join('\n');
  const a = readFileSync(join(__dir, '../docs/discord-rules-v2.md'), 'utf8');
  const b = readFileSync(join(__dir, '../docs/discord-advanced-mechanics.md'), 'utf8');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>J! Royal Rumble — rules 101</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--ink:#0A0E1C;--panel:#131A30;--line:#2A3556;--chalk:#EEEBE1;--slate:#7C88AB;--brass:#D6A93F}
*{box-sizing:border-box}body{background:var(--ink);color:var(--chalk);margin:0;
font:400 16px/1.65 "IBM Plex Sans",system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:26px 20px 70px}
.top{display:flex;justify-content:space-between;align-items:baseline}
.top a{color:var(--slate);text-decoration:none;font-size:13.5px}
.top a:hover{color:var(--brass)}
h1{font-family:"Anton",Impact,sans-serif;font-size:34px;letter-spacing:.02em;margin:14px 0 18px}
h1 .j{color:var(--brass)}
h2{font-family:"Anton",Impact,sans-serif;font-size:19px;letter-spacing:.03em;
color:var(--brass);margin:34px 0 12px}
p{margin:0 0 14px;color:#C9CCD9}
strong{color:var(--chalk)}
a{color:var(--brass)}
hr{border:0;border-top:1px solid var(--line);margin:34px 0}
</style></head><body><div class="wrap">
<div class="top"><a href="/">&larr; J! Royal Rumble</a><a href="/how-to-play">how to play &rarr;</a></div>
<h1><span class="j">J!</span> RULES 101</h1>
${render(a)}<hr>${render(b)}
</div></body></html>`;
})();
app.get('/rules-101', (_req, res) => res.type('html').send(DISCORD_HTML));

// What changed and when. Rendered from docs/CHANGELOG.md, which `npm run ship`
// writes to — a history page maintained by hand is one that stops halfway.
app.get('/history', (_req, res) => {
  let md = '';
  try { md = readFileSync(join(__dir, '../docs/CHANGELOG.md'), 'utf8'); }
  catch { return res.status(404).send('No history recorded yet.'); }
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (x) => esc(x)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const body = md.split(/\n\n+/).map((b) => {
    b = b.trim();
    if (!b) return '';
    if (b.startsWith('# ')) return '';
    if (b.startsWith('## ')) {
      const [v, ...rest] = b.slice(3).split(' — ');
      return `<h2><span class="v">${esc(v)}</span>${rest.length
        ? ' <span class="t">' + inline(rest.join(' — ')) + '</span>' : ''}</h2>`;
    }
    return `<p>${inline(b).replace(/\n/g, ' ')}</p>`;
  }).join('\n');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>J! Royal Rumble — version history</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--ink:#0A0E1C;--panel:#131A30;--line:#2A3556;--chalk:#EEEBE1;--slate:#7C88AB;--brass:#D6A93F}
*{box-sizing:border-box}body{background:var(--ink);color:var(--chalk);margin:0;
font:400 16px/1.62 "IBM Plex Sans",system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:26px 20px 70px}
.top{display:flex;justify-content:space-between;align-items:baseline}
.top a{color:var(--slate);text-decoration:none;font-size:13.5px}
.top a:hover{color:var(--brass)}
h1{font-family:"Anton",Impact,sans-serif;font-size:32px;letter-spacing:.02em;margin:14px 0 4px}
h1 .j{color:var(--brass)}
.now{color:var(--slate);font-size:13.5px;margin-bottom:26px}
h2{margin:30px 0 8px;font-size:16px;font-weight:500;display:flex;gap:10px;
align-items:baseline;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:16px}
h2 .v{font-family:"IBM Plex Mono",monospace;color:var(--brass);font-size:14px;flex:none}
h2 .t{color:var(--chalk)}
p{margin:0 0 12px;color:#C9CCD9;font-size:15px}
code{font-family:"IBM Plex Mono",monospace;font-size:.9em;background:var(--panel);
border:1px solid var(--line);border-radius:3px;padding:1px 5px}
</style></head><body><div class="wrap">
<div class="top"><a href="/">&larr; J! Royal Rumble</a><a href="/handbook">the handbook &rarr;</a></div>
<h1><span class="j">J!</span> VERSION HISTORY</h1>
<div class="now">Running ${VERSION} right now.</div>
${body}
</div></body></html>`);
});
app.get('/how-to-play', (_req, res) => res.sendFile(join(__dir, '../public/howto.html')));
app.get('/rules.md', (_req, res) => res.sendFile(join(__dir, '../RULES.md')));

app.get('/j/:id', (_req, res) => res.sendFile(join(__dir, '../public/buzzer.html')));
app.get('/join', (_req, res) => res.sendFile(join(__dir, '../public/buzzer.html')));
app.get('/host/:id', (_req, res) => res.sendFile(join(__dir, '../public/console.html')));
app.get('/admin/:id', (_req, res) => res.sendFile(join(__dir, '../public/admin.html')));

// Availability, the heat map and the game-night scan. Mounted here rather
// than written here, and mounted at this point in the file because it borrows
// `localReq` and `adminOk` — the guards that already exist — instead of
// growing a second copy of either.
mountAvailability(app, { dir: __dir, localReq, adminOk });

// ---------------------------------------------------------------- sockets


// --- the three rulings, as plain functions -----------------------------------
//
// Extracted from their socket handlers without a line of behaviour changing, so
// that a second caller can drive a match. The autohost has no socket and no
// host, and the alternative to this was a second copy of the rules — which is
// how `tools/` fell a release behind the engine and printed rows labelled
// SHIPPED that described a rule nobody was playing any more.
//
// `hostOnly` deliberately stays on the socket side: it is about who is allowed
// to ask, which is a question about a connection, not about the match.
//
// Everything these need that used to be in the connection closure arrives as
// `deps`. `match` keeps its name so the bodies could move verbatim; that is the
// whole reason this diff is readable.
// What the host does when they pick a clue: put it up, open a closed race,
// and get the robots' wrong answer written while the room is still reading.
// A function rather than a handler body so the autohost can pick too.
// What a card is worth and says, right now. Factored out of runPick because
// an objection's walk-back has to rebuild exactly this after a restore, and a
// second copy of "what is this clue worth in overtime" is the kind of thing
// that drifts.
//
// The value is display only — the engine works it out again when it scores —
// but every surface that showed a raw $400 during a x4 overtime was telling
// the room the wrong number.
function clueAt(match, slot, row) {
  const g = match.game;
  const cat = g.board[slot];
  const clue = cat?.clues.find((c) => c.row === row);
  if (!clue || clue.revealed) return null;
  const face = [100, 200, 300, 400, 500][row - 1];
  return { slot, row, face, value: face * g.overtimeMultiplier(),
    category: cat.title, note: cat.note, text: clue.text, answer: clue.answer };
}

function runPick(match, { slot, row }) {
  const g = match.game;
  const cat = g.board[slot];
  const clue = cat?.clues.find((c) => c.row === row);
  const built = clueAt(match, slot, row);
  if (!built) return false;
  match.clue = built;
  match.race = { open: false, activatedAt: null, buzzes: [], lockedOut: new Set() };
  match.retoss = 0;
  clearTimeout(match.raceTimer);

  // Work out the robots' wrong answer now, while the host is still reading.
  // Doing it at buzz time would put a network call inside the race.
  match.wrongAnswer = null;
  clearTimeout(match.saidTimer);
  match.saidTimer = null;
  match.saidFor = null;
  const siblings = g.board.flatMap((c) => c.clues.map((x) => x.answer))
    .filter((a) => a && a !== clue.answer);
  wrongAnswer(match.clue, siblings).then((w) => { match.wrongAnswer = w; });

  schedulePush(match, 'host');
  io.to(`${match.id}:players`).emit('clue-shown', { value: match.clue.value });
  schedulePush(match, 'players');
  match.autohost?.onPicked();
  return true;
}

// Lights and buzzers are separate signals, matching the existing app.
// `delay` compensates for Zoom audio lagging the socket by ~150ms: clients
// wait `delay` ms, then arm locally, and every client anchors on that same
// post-delay instant so live and spectator times stay comparable.
// The five lights are a promise: when they go out, the clue is over. There
// was no timeout at all, so a clue nobody wanted sat open until the host
// noticed and pressed X — and on a re-toss the lights ran a second time,
// which read as a glitch rather than as a second race.
function armTimeoutFor(match) {
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
    schedulePush(match, 'all');
    match.autohost?.onRaceTimeout();
  }, grace);
}

// Bots buzz by the clock rather than by hand. Each one is scheduled at the
// moment its drawn reaction time lands, so the race fills in on the console
// the way it would with people — rather than all at once the instant the
// buzzers open.
function runBotsFor(match) {
  if (!match?.game || !match.race || !match.clue) return;
  clearBotTimersFor(match);
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
        schedulePush(match, 'host');
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
      rankRace(match);
      announceLeader(match);
      if (!match.fastest || plan.ms < match.fastest.ms) {
        match.fastest = { ms: plan.ms, name: p.name, clue: match.game.cluesRevealed + 1,
          category: match.clue?.category, value: match.clue?.value };
      }
      schedulePush(match, 'all');
    }, Math.max(0, fireAt - Date.now())));
  }
}
function clearBotTimersFor(match) {
  if (!match) return;
  match.botTimers.forEach(clearTimeout);
  match.botTimers = [];
}

// Everything the extracted rulings need, for a caller with no socket.
function matchDeps(m) {
  return {
    ...pushDeps(m),
    runBots: () => runBotsFor(m),
    armTimeout: () => armTimeoutFor(m),
    clearBotTimers: () => clearBotTimersFor(m),
  };
}

// Wire an autohost to a match that just started: it drives the same four
// rulings the console does, through the same functions, with no socket.
function startAutohost(m) {
  const deps = matchDeps(m);
  const report = (msg) => console.log(`[autohost ${m.id}] refused: ${msg}`);
  m.autohost = new Autohost(m, {
    judge: (args) => judge.judge(args),
    runPick: (pick) => runPick(m, pick),
    runActivate: () => runActivate(m, deps),
    runResolve: (r) => runResolve(m, r, deps, report),
    runMarkWrong: (t) => runMarkWrong(m, t, deps),
    // The objection's walk-back. `quiet`, because the autohost writes its own
    // correction saying what the room decided — an undo logged as an undo
    // would read as the host having had second thoughts.
    runUndo: () => runUndo(m, deps, report, { quiet: true }),
    reresolve: (args) => runReresolve(m, args, deps, report),
    voidClue: (slot, row) => m.game.voidClue(slot, row),
    pushPlayers: deps.pushPlayers,
  }, io, { log: (type, data) => { m.note(type, data); if (data.event === 'error' || data.event === 'voice-fallback' || data.event === 'synth-failed') console.log(`[autohost ${m.id}]`, data); } });
  m.autohost.start();
}

// Walking one clue back.
//
// At module level because there are now two callers and only one of them has a
// socket: the console's undo button, and the autohost when the room objects to
// a ruling and wins. The snapshot in `undoStack` is the whole engine — scores,
// entries, eliminations, the ceiling — so a restore puts all of it back;
// re-doing the clue the other way is the caller's business, not this
// function's.
//
// `quiet` is for the objection path, which writes its own correction saying
// what the room decided. A plain undo that also logged itself as an undo would
// read as the host having second thoughts.
function runUndo(match, { pushAll }, report, { quiet = false } = {}) {
  const last = match.undoStack.pop();
  if (!last) { report('nothing to undo'); return null; }
  match.game.restore(last.snap);
  match.stats = new Map(JSON.parse(last.statsSnap));
  match.fastest = last.fastest;
  match.history.pop();
  if (match.record) match.record.clues.pop();
  match.phase = 'live';
  match.clue = null; match.race = null;
  if (!quiet) {
    match.corrections.push({ at: match.elapsed(), clue: match.game.cluesRevealed,
      type: 'undo', category: last.clue?.category, value: last.clue?.value });
    match.note('undo', { category: last.clue?.category, value: last.clue?.value });
  }
  pushAll();
  io.to(`${match.id}:host`).emit('undone', { category: last.clue?.category, value: last.clue?.value });
  return last;
}

// Re-run a clue that has just been walked back, the other way round.
//
// The card is unrevealed again and `match.clue` is null, so the state a ruling
// needs has to be rebuilt before the rule can run — but only the state. The
// ruling itself is `runResolve`, the same one the console and the host call,
// because a second implementation of scoring is the one thing this whole
// design is arranged to avoid. There is no read, no race and no buzz: the room
// already heard this clue, and it is being corrected rather than replayed.
function runReresolve(match, { slot, row, winnerToken, missedTokens = [] }, deps, report) {
  const built = clueAt(match, slot, row);
  if (!built) { report('that card is not on the board'); return false; }
  match.clue = built;
  match.race = { open: false, activatedAt: null, buzzes: [],
    lockedOut: new Set(missedTokens) };
  match.retoss = 0;
  clearTimeout(match.raceTimer);
  runResolve(match, { winnerToken }, deps, report);
  return true;
}

function runActivate(match, { pushAll, runBots, armTimeout }) {
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
}

// `report` is the one thing here that knew about a socket: a refusal answers the
// acknowledgement when the caller sent one and falls back to an error message on
// the connection. The autohost passes its own, because "tell the host" means
// something different when there is no host.
function runResolve(match, { winnerToken }, { pushAll, clearBotTimers }, report) {
  // Adjudicating a clue that has already been settled.
  //
  // The console sends this twice more easily than it looks: Y fires on
  // keydown and the guard in front of it reads the console's own copy of the
  // state, which is still the old clue until the server's push lands. A
  // second press — or a second click on Correct — arrives after match.clue is
  // already null.
  //
  // Every sibling handler checks; this one did not, so it destructured null
  // and threw "cannot destructure property 'slot' of 'match.clue' as it is
  // null". hostOnly caught that and handed it to the host verbatim: a
  // developer's sentence, on a screen where the game had apparently stopped,
  // in the middle of a live match. Reported from clue 16 of VWQW.
  if (!match.clue || !match.race) {
    const m = 'That clue is already settled — pick the next one.';
    report(m);
    return;
  }
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
      // The engine writes both of these on the resolve entry and nothing here
      // used to carry them into the log, so a category sweep or a longevity
      // payment had to be reconstructed from score deltas after the fact —
      // found doing exactly that for the handbook's longevity section.
      sweep: entry.sweep
        ? { name: match.roster.get(entry.sweep.playerId)?.name,
            category: entry.sweep.category, bonus: entry.sweep.bonus }
        : undefined,
      longevity: (entry.longevity || []).length
        ? entry.longevity.map((p) => ({
            name: match.roster.get(p.playerId)?.name, amount: p.amount, tenure: p.tenure }))
        : undefined,

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
  // Whoever holds the board calls the next clue.
  //
  // Control passes to whoever answered correctly and stays put on a stumper,
  // the way it does on the show — so a robot that was already leading the
  // board keeps calling clues until somebody takes it off them.
  if (winnerToken) match.control = winnerToken;
  const caller = match.control;
  if (caller && match.bots.has(caller)
      && match.game.players.get(caller)?.state === 'live') {
    const open = [];
    match.game.board.forEach((c) => c.clues.forEach((x) => {
      if (!x.revealed) open.push({ category: c.title, value: [100, 200, 300, 400, 500][x.row - 1],
        slot: match.game.board.indexOf(c), row: x.row });
    }));
    if (open.length) {
      const pick = open[Math.floor(Math.random() * open.length)];
      for (const room of ['host', 'watch', 'board']) {
        io.to(`${match.id}:${room}`).emit('bot-said', { said: [{
          token: caller, name: match.roster.get(caller)?.name,
          kind: 'pick', text: `${pick.category} for $${pick.value}` }] });
      }
      // With no human host, somebody has to actually put the robot's pick up.
      entry.botPick = { slot: pick.slot, row: pick.row, name: match.roster.get(caller)?.name };
    }
  }

  io.to(`${match.id}:host`).emit('resolved', entry);
  io.to(`${match.id}:watch`).emit('resolved', entry);
  match.autohost?.onResolved(entry, { winnerToken, clue: clueMeta });
  // Entrance music comes out of the buzzers and the host console now. A watch
  // screen is optional and in a live match nobody had one open with sound, so
  // every entrance passed in silence. The players always have a buzzer open;
  // that is the whole point of it.
  // With an autohost the walk-in music waits for Gene to say the name; the
  // autohost sends this one itself, after the call.
  if (entry.entrances?.length && !match.autohost) {
    io.to(`${match.id}:players`).emit('entrances', { entrances: entry.entrances });
  }
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
    match.autohost?.onOver();
  }
}

function runMarkWrong(match, t, { pushAll, runBots, armTimeout }) {
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

  // A fresh race needs a fresh answer.
  //
  // These are cleared per clue, which meant a robot picking up the rebound
  // never spoke: the marker from the first race was still set and the
  // announcement bailed out. The wrong answer is regenerated too, so the
  // second robot does not repeat the first one's guess.
  clearTimeout(match.saidTimer);
  match.saidTimer = null;
  match.saidFor = null;
  const said = match.wrongAnswer;
  match.wrongAnswer = null;
  {
    const sibs = match.game.board.flatMap((c) => c.clues.map((x) => x.answer))
      .filter((a) => a && a !== match.clue.answer && a !== said);
    wrongAnswer(match.clue, sibs).then((w) => { match.wrongAnswer = w || said; });
  }
  io.to(`${match.id}:players`).emit('activate-buzzers',
    { at: match.race.activatedAt, lockout: match.settings.lockout });
  io.to(`${match.id}:host`).emit('retoss', { lockedOut: [...match.race.lockedOut] });
  runBots();
  armTimeout();
  pushAll();
  match.autohost?.onMarkedWrong(t);
}


io.on('connection', (socket) => {
  let match = null, token = null, isHost = false;

  // The push helpers live at module level (schedulePush and friends) so the
  // autohost can drive a match with no socket of its own; these read the
  // connection's current match at call time, which is why they are closures.
  const pushHost = () => schedulePush(match, 'host');
  const pushPlayers = () => schedulePush(match, 'players');
  const pushAll = () => schedulePush(match, 'all');

  socket.on('host-join', ({ gameId, hostKey }, ack) => {
    const m = matches.get((gameId || '').toUpperCase());
    if (!m) return ack?.({ error: `no match ${gameId} on this server (${MACHINE}). ` +
      `If more than one server is reachable, the room is split across them: ` +
      `everybody has to be on the same address. Ask each for /api/health and ` +
      `stop all but one.` });
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

    // Two people cannot share a name.
    //
    // Names are how the host calls the room and how everybody reads the board,
    // so a second Dave is not a cosmetic problem: with nothing else to go on
    // the room treats them as one person. Ask for a different one rather than
    // quietly letting it happen.
    const wanted = String(name || '').trim();
    if (wanted) {
      const clash = [...m.roster.values()].some((p) =>
        p.token !== token && String(p.name || '').trim().toLowerCase() === wanted.toLowerCase());
      if (clash) {
        return ack?.({ error: `Somebody is already playing as ${wanted}. `
          + 'Pick a different name — the host calls people by name, so two of '
          + 'you would be one person on the board.', nameTaken: true });
      }
    }

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
    // A closed watch tab takes its sound with it, and the host needs to know:
    // otherwise the warning stays hidden and the next entrance is silent again.
    if (soundScreens.delete(socket.id) && match) pushHost();
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
    // Fail at the start button, naming the fix, rather than at clue one. The
    // silent engine is allowed through: it reads from the clock with the text
    // on screen, which is how the autohost is tested without a voice.
    if (match.settings.autohost && !tts.status().configured) {
      return ack?.({ error: `The computer cannot host: ${tts.status().reason}` });
    }
    // The judge is not optional for a match with nobody at a console. Its
    // local fallback is a mid-match safety net for one failed call, not a way
    // to run a whole match — so this refuses at the start button, naming the
    // variable, rather than letting the room discover it at clue one.
    if (match.settings.autohost && !judge.status().configured) {
      // Both ways out, because a refusal that names one of two fixes sends
      // somebody looking for a key when they might not want one tonight.
      return ack?.({ error: 'The computer cannot host: it has no way to rule on answers. '
        + 'Set ANTHROPIC_API_KEY on the server, or set RUMBLE_JUDGE=local to play '
        + 'without one — the local judge accepts an answer that contains the whole '
        + 'response and says "I could not rule on that one" to everything else, '
        + 'so it never calls somebody wrong.' });
    }
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
    if (match.settings.autohost) startAutohost(match);
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

  socket.on('make-stable', (_d, ack) => {
    if (!match?.game || !token) return ack?.({ error: 'no match' });
    if (!betweenClues()) return ack?.({ error: 'wait until the clue is done' });
    // Named from the list, not by the player: a stable has to be recognisable
    // at a glance on three screens, and typed names collide and run long.
    const r = match.game.createStable(token);
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

  socket.on('set-theme', async ({ theme }, ack) => {
    if (!match || !token) return ack?.({ error: 'no match' });
    const r = match.roster.get(token);
    if (!r) return ack?.({ error: 'not in this match' });
    if (!theme) { r.theme = null; pushAll(); return ack?.({ ok: true, theme: null }); }

    const clean = sanitiseTheme(theme);
    // The picker asks /api/theme-check before it gets here, but a client that
    // skipped the question still should not be able to store a theme the room
    // will never hear.
    if (clean && clean.kind === 'youtube') {
      const playable = await ytPlayable(clean.id);
      if (!playable.ok) return ack?.({ error: playable.reason });
    }
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

  // The player holding the board calls the next clue from their own board.
  // Only in an autohost match, only the holder, only between clues — the
  // autohost is the judge of all three, and says which one refused.
  socket.on('player-pick', ({ slot, row }, ack) => {
    touch();
    if (!match || !token) return ack?.({ error: 'no match' });
    if (!match.autohost) return ack?.({ error: 'This match has a host; they call the clues' });
    ack?.(match.autohost.playerPick(token, { slot, row }));
  });

  // What the recognizer on this player's own machine heard them say.
  //
  // The buzzer sends text, never audio: the speech recognition runs in the
  // browser, so nothing here is a microphone stream and the server never
  // holds a recording. `sid` is the window the autohost opened, so a
  // transcript that arrives after that window closed is discarded rather
  // than ruled on.
  socket.on('answer-heard', ({ sid, text }, ack) => {
    touch();
    if (!match?.autohost || !token) return ack?.({ error: 'no match' });
    ack?.(match.autohost.onAnswerHeard(token, { sid: Number(sid), text: String(text || '').slice(0, 300) }));
  });

  // The room's check on the host. Anybody in the match may object — in the
  // ring, queued or eliminated — and nobody at all may object to a ruling
  // nobody made, which is the refusal `test/security.mjs` pins.
  socket.on('object', (_payload, ack) => {
    touch();
    if (!match?.autohost || !token) return ack?.({ error: 'no match' });
    ack?.(match.autohost.onObject(token));
  });

  // Who should have had the clue, when reversing the ruling was not enough to
  // say. `to` is a player token, or null for "nobody — throw it out".
  socket.on('award-vote', ({ to } = {}, ack) => {
    touch();
    if (!match?.autohost || !token) return ack?.({ error: 'no match' });
    ack?.(match.autohost.onAwardVote(token, { to: to == null ? null : String(to).slice(0, 80) }));
  });

  // The same, for the player holding the board calling the next clue.
  socket.on('pick-heard', ({ sid, alternatives }, ack) => {
    touch();
    if (!match?.autohost || !token) return ack?.({ error: 'no match' });
    const alts = (Array.isArray(alternatives) ? alternatives : [alternatives])
      .map((t) => String(t || '').slice(0, 200)).filter(Boolean).slice(0, 5);
    ack?.(match.autohost.onPickHeard(token, { sid: Number(sid), alternatives: alts }));
  });

  // When a clip actually started on this client's speaker, against the moment
  // the server sent it. The spread across a room is what sets the settle.
  socket.on('heard', ({ sid, lateMs }) => {
    if (!match?.autohost || !token) return;
    match.autohost.onHeard(token, { sid: Number(sid), lateMs: Number(lateMs) });
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

  // Which screens can actually make a noise.
  //
  // Entrance music plays on the one watch screen with sound enabled. If nobody
  // has enabled it — or nobody has a watch screen open at all — the entrance
  // passes in silence and the host has no way to know why. That is what
  // happened in a live match: a bug report saying "entrance music didn't play",
  // filed from the host console, which never plays it in the first place.
  socket.on('watch-sound', ({ on }, ack) => {
    if (!match) return ack?.({ error: 'no match' });
    if (on) soundScreens.add(socket.id); else soundScreens.delete(socket.id);
    pushHost();
    ack?.({ ok: true });
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
    if (!m) return ack?.({ error: `no match ${gameId} on this server (${MACHINE})` });
    if (m.hostKey !== hostKey) return ack?.({ error: 'that host key does not match this game' });
    match = m; isHost = true;
    socket.join(`${m.id}:host`);
    for (const p of m.roster.values()) {
      if (p.avatar) socket.emit('avatar', { token: p.token, dataUrl: p.avatar });
    }
    ack?.({ ok: true, setup: m.setupView() });
  });

  socket.on('pick-clue', hostOnly(({ slot, row }) => runPick(match, { slot, row })));

  // Lights and buzzers are separate signals, matching the existing app.
  // `delay` compensates for Zoom audio lagging the socket by ~150ms: clients
  // wait `delay` ms, then arm locally, and every client anchors on that same
  // post-delay instant so live and spectator times stay comparable.
  // The five lights are a promise: when they go out, the clue is over. There
  // was no timeout at all, so a clue nobody wanted sat open until the host
  // noticed and pressed X — and on a re-toss the lights ran a second time,
  // which read as a glitch rather than as a second race.
  const armTimeout = () => armTimeoutFor(match);

  socket.on('activate', hostOnly(() => runActivate(match, { pushAll, runBots, armTimeout })));

  // Bots buzz by the clock rather than by hand. Each one is scheduled at the
  // moment its drawn reaction time lands, so the race fills in on the console
  // the way it would with people — rather than all at once the instant the
  // buzzers open.
  function runBots() { runBotsFor(match); }
  function clearBotTimers() { clearBotTimersFor(match); }

  socket.on('resolve', hostOnly(({ winnerToken }, ack) => runResolve(
    match, { winnerToken }, { pushAll, clearBotTimers },
    (m) => { if (ack) ack({ error: m }); else socket.emit('error-msg', m); })));

  // A miss locks that player out of the rest of the clue and re-opens the
  // race for everyone still eligible.
  socket.on('mark-wrong', hostOnly(({ token: t }) =>
    runMarkWrong(match, t, { pushAll, runBots, armTimeout })));

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
    match.autohost?.onOver();
  }));

  // --- corrections -----------------------------------------------------

  socket.on('undo-clue', hostOnly(() => {
    const last = runUndo(match, { pushAll }, (msg) => socket.emit('error-msg', msg));
    if (last) match.autohost?.onUndo();
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
    const st = match.stat(token);
    // Warm-up presses stay out of the live record, jumping the lights
    // included. This was checked on the buzz path and not here, so somebody
    // practising in the queue racked up live attempts: one player finished a
    // real match credited with 28 attempts across a tenure of one clue.
    const p = match.game?.players.get(token);
    const live = p && p.state === 'live' && match.race && match.clue;
    if (!live) {
      st.warmEarly = (st.warmEarly || 0) + 1;
      st.warmAtt = (st.warmAtt || 0) + 1;
      return;
    }
    // Counted as an attempt as well as an early one, so `early` can never
    // exceed `att` — which is what made the table look broken.
    st.early++; st.att++;
  });

  // Spectators are ranked against the LIVE field only, never against each
  // other: a room full of people warming up should not be told they came
  // fourth out of nine when only three of those were in the ring.
  const rerank = (race, game) => {
    // Place by the time the ordering actually used, not the raw press.
    //
    // rankRace sorts on ms x buzzEdge, so in a match with the comeback on a
    // player on the way back can be ahead of a faster raw time. This used to
    // rank on the raw number, which agreed with the board only while every edge
    // was 1 — that is, in every match without the comeback, which is why it went
    // unnoticed. With Arcade mode showing places instead of times, a place that
    // disagrees with who is on the clock is the whole feature broken.
    const eff = (b) => b.ms * (game ? game.buzzEdge(b.token) : 1);
    const liveEff = race.buzzes.filter((b) => !b.spectator).map(eff);
    for (const b of race.buzzes) {
      b.ranked = b.spectator
        // Warm-up presses are ranked on the raw time against the live field:
        // somebody practising has no edge to apply and is not in the race.
        ? game.rankSpectatorBuzz(b.ms, liveEff)
        : { place: liveEff.filter((t) => t < eff(b)).length + 1, outOf: liveEff.length };
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
    rankRace(match);

    // The fastest buzz of the match has to have been a real one — otherwise it
    // can be won by somebody who was not in the ring.
    if (!spectator && (!match.fastest || rec.ms < match.fastest.ms)) {
      match.fastest = { ms: rec.ms, name: rec.name, clue: g.cluesRevealed + 1,
        category: match.clue?.category, value: match.clue?.value };
    }
    if (!spectator) announceLeader(match);

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

http.listen(PORT, () => {
  console.log(`J! Royal Rumble on :${PORT}`);
  // Say it loudly rather than failing quietly. Both of these used to default to
  // open, and the only symptom was that nothing ever went wrong — which is how
  // the live site served 52 match logs to the public for months.
  if (!ADMIN_KEY) {
    console.warn('WARNING: RUMBLE_ADMIN_KEY is not set — /control and /api/control '
      + 'are refusing everyone, including you. Set it in the service environment.');
  }
  if (!process.env.RUMBLE_LOG_KEY) {
    console.warn('WARNING: RUMBLE_LOG_KEY is not set — /api/logs is refusing '
      + 'everyone. The saved match logs are unreachable until it is set.');
  }
  // Not a refusal, unlike the two above: this one protects somebody's list of
  // free evenings, and the cost of leaving it unset is that a deploy signs
  // everybody out of /when rather than that anything is exposed.
  if (!discord.sessionSecretSet()) {
    console.warn('note: RUMBLE_SESSION_SECRET is not set — /when sign-ins will '
      + 'not survive a restart.');
  }
});
