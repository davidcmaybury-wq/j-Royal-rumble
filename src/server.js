import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RumbleGame, makeRng, autoEntryInterval, DEFAULT_SETTINGS } from './engine.js';
import { makeWeightedPool } from './sources.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

// 45k categories decompress to ~90MB of JS objects. Loaded once at boot and
// held in memory; the alternative is a per-draw disk read on every category.
const LIBRARY = gunzipSync(readFileSync(join(__dir, '../data/library.ndjson.gz')))
  .toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const SEASONS = [...new Set(LIBRARY.map((c) => c.provenance?.season).filter(Boolean))].sort();
console.log(`library: ${LIBRARY.length} categories, seasons ${SEASONS[0]}-${SEASONS.at(-1)}`);

const app = express();
app.use(express.json());
app.use(express.static(join(__dir, '../public')));

const http = createServer(app);
const io = new Server(http, { cors: { origin: false } });

// ---------------------------------------------------------------- matches

const matches = new Map();   // gameId -> Match

class Match {
  constructor(settings = {}) {
    this.id = randomBytes(3).toString('hex').toUpperCase();
    this.hostKey = randomUUID();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.blend = settings.blend || { original: 1, archive: 1 };
    this.roster = new Map();     // token -> { token, name, socketId, connected }
    this.game = null;
    this.phase = 'lobby';        // lobby | live | over
    this.clue = null;            // { slot, row, value, category, note, text, answer }
    this.race = null;            // { open, activatedAt, delay, buzzes:[], lockedOut:Set }
    this.vetoLog = [];
    this.fastest = null;
  }

  pool() {
    const buckets = {};
    const [lo, hi] = this.settings.seasonRange || [SEASONS[0], SEASONS.at(-1)];
    for (const [name, weight] of Object.entries(this.blend)) {
      const cats = LIBRARY.filter((c) => c.source === name
        && (name !== 'archive' || (c.provenance.season >= lo && c.provenance.season <= hi)));
      if (cats.length && weight > 0) buckets[name] = { weight, categories: cats };
    }
    if (!Object.keys(buckets).length) {
      buckets.all = { weight: 1, categories: LIBRARY };
    }
    return makeWeightedPool(buckets, this.rng);
  }

  start() {
    const players = [...this.roster.values()].map((p) => ({ id: p.token, name: p.name }));
    if (players.length < 3) throw new Error('need at least 3 players');
    this.rng = makeRng(Date.now() & 0x7fffffff);
    if (this.settings.entryInterval == null) {
      this.settings.entryInterval = autoEntryInterval(
        players.length, this.settings.targetMinutes, this.settings.secondsPerClue);
    }
    this.game = new RumbleGame({
      players, settings: this.settings, categoryPool: this.pool(), rng: this.rng,
    });
    this.phase = 'live';
  }

  // --- public views ----------------------------------------------------

  // Sent to the host console and the shared screen. Carries answers.
  hostView() {
    const g = this.game;
    return {
      phase: this.phase, gameId: this.id,
      settings: this.settings,
      roster: [...this.roster.values()].map((p) => ({
        token: p.token, name: p.name, connected: p.connected })),
      ...(g ? {
        clues: g.cluesRevealed, ceiling: g.ceiling,
        cluesUntilNextEntry: g.cluesUntilNextEntry(),
        board: g.board.map((c) => ({
          title: c.title, note: c.note, source: c.source,
          clues: c.clues.map((x) => ({ row: x.row, revealed: x.revealed })) })),
        live: g.live().map(this.playerRow, this),
        queue: g.queued().map((p) => ({ draw: p.drawNumber, name: p.name })),
        out: [...g.players.values()].filter((p) => p.state === 'eliminated')
          .map(this.playerRow, this),
        clue: this.clue,
        race: this.raceView(),
        fastest: this.fastest,
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
      capped: p.score >= g.ceiling,
    };
  }

  raceView() {
    if (!this.race) return null;
    return {
      open: this.race.open,
      lockedOut: [...this.race.lockedOut],
      buzzes: this.race.buzzes
        .filter((b) => !b.spectator)
        .map((b) => ({ token: b.token, name: b.name, ms: b.ms, early: b.early })),
    };
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
        cluesToEntry: p.state === 'queued' ? g.cluesUntilNextEntry() : null,
        entryStake: Math.min(this.settings.startScore, g.ceiling),
      },
      buzzOpen: !!this.race?.open,
      myBuzz: mine ? { ms: mine.ms, early: mine.early,
        ...(mine.ranked || {}) } : null,
    };
  }
}

// ---------------------------------------------------------------- routes

app.post('/api/match', (req, res) => {
  const m = new Match(req.body?.settings || {});
  matches.set(m.id, m);
  res.json({ gameId: m.id, hostKey: m.hostKey,
    joinUrl: `/j/${m.id}`, consoleUrl: `/host/${m.id}#${m.hostKey}` });
});

app.get('/api/library', (_req, res) => {
  const by = {};
  for (const c of LIBRARY) by[c.source] = (by[c.source] || 0) + 1;
  res.json({ total: LIBRARY.length, bySource: by, seasons: [SEASONS[0], SEASONS.at(-1)] });
});

app.get('/j/:id', (_req, res) => res.sendFile(join(__dir, '../public/buzzer.html')));
app.get('/host/:id', (_req, res) => res.sendFile(join(__dir, '../public/console.html')));
app.get('/admin/:id', (_req, res) => res.sendFile(join(__dir, '../public/admin.html')));

// ---------------------------------------------------------------- sockets

io.on('connection', (socket) => {
  let match = null, token = null, isHost = false;

  const pushHost = () => match && io.to(`${match.id}:host`).emit('state', match.hostView());
  const pushPlayers = () => {
    if (!match) return;
    for (const p of match.roster.values()) {
      if (p.socketId) io.to(p.socketId).emit('state', match.playerView(p.token));
    }
  };
  const pushAll = () => { pushHost(); pushPlayers(); };

  socket.on('host-join', ({ gameId, hostKey }, ack) => {
    const m = matches.get(gameId);
    if (!m || m.hostKey !== hostKey) return ack?.({ error: 'bad host key' });
    match = m; isHost = true;
    socket.join(`${m.id}:host`);
    ack?.({ ok: true, state: m.hostView() });
  });

  // Players identify by a durable token stored on their own device, so a
  // reconnect keeps their score, draw number and place in the queue.
  socket.on('join', ({ gameId, token: t, name }, ack) => {
    const m = matches.get(gameId);
    if (!m) return ack?.({ error: 'no such match' });
    match = m;
    token = t && m.roster.has(t) ? t : (t || randomUUID());
    const existing = m.roster.get(token);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      if (name) existing.name = name;
    } else {
      if (m.phase !== 'lobby') return ack?.({ error: 'match already started' });
      m.roster.set(token, { token, name: name || 'Player', socketId: socket.id, connected: true });
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
    if (p) { p.connected = false; p.socketId = null; }
    pushHost();
  });

  // --- host actions ----------------------------------------------------

  const hostOnly = (fn) => (...args) => {
    if (!isHost || !match) return;
    try { fn(...args); } catch (e) { socket.emit('error-msg', e.message); }
  };

  socket.on('start-match', hostOnly(() => { match.start(); pushAll(); }));

  socket.on('pick-clue', hostOnly(({ slot, row }) => {
    const g = match.game;
    const cat = g.board[slot];
    const clue = cat.clues.find((c) => c.row === row);
    if (!clue || clue.revealed) return;
    match.clue = {
      slot, row, value: [100, 200, 300, 400, 500][row - 1],
      category: cat.title, note: cat.note, text: clue.text, answer: clue.answer,
    };
    match.race = { open: false, activatedAt: null, buzzes: [], lockedOut: new Set() };
    pushHost();
    io.to(`${match.id}:players`).emit('clue-shown', { value: match.clue.value });
    pushPlayers();
  }));

  // Lights and buzzers are separate signals, matching the existing app.
  // `delay` compensates for Zoom audio lagging the socket by ~150ms: clients
  // wait `delay` ms, then arm locally, and every client anchors on that same
  // post-delay instant so live and spectator times stay comparable.
  socket.on('activate', hostOnly(() => {
    if (!match.race) return;
    const at = Date.now() + match.settings.delay;
    match.race.open = true;
    match.race.activatedAt = at;
    io.to(`${match.id}:players`).emit('activate-lights', { at });
    io.to(`${match.id}:players`).emit('activate-buzzers', { at, lockout: match.settings.lockout });
    pushAll();
  }));

  socket.on('resolve', hostOnly(({ winnerToken }) => {
    const { slot, row } = match.clue;
    const missed = [...match.race.lockedOut];
    const entry = match.game.resolveClue(slot, row, { winnerId: winnerToken ?? null, missedIds: missed });
    match.clue = null; match.race = null;
    pushAll();
    io.to(`${match.id}:host`).emit('resolved', entry);
    if (match.game.finished) {
      match.phase = 'over';
      pushAll();
    }
  }));

  // A miss locks that player out of the rest of the clue and re-opens the
  // race for everyone still eligible.
  socket.on('mark-wrong', hostOnly(({ token: t }) => {
    if (!match.race) return;
    match.race.lockedOut.add(t);
    match.race.buzzes = match.race.buzzes.filter((b) => b.token !== t);
    match.race.open = true;
    match.race.activatedAt = Date.now() + match.settings.delay;
    io.to(`${match.id}:players`).emit('activate-buzzers',
      { at: match.race.activatedAt, lockout: match.settings.lockout });
    pushAll();
  }));

  socket.on('veto', hostOnly(({ slot }) => {
    const cat = match.game.board[slot];
    match.vetoLog.push({ categoryId: cat.id, at: Date.now() });
    match.game.vetoCategory(slot, 'host veto');
    pushHost();
  }));

  socket.on('end-match', hostOnly(() => { match.phase = 'over'; pushAll(); }));

  // --- player actions --------------------------------------------------

  socket.on('buzz', ({ ms, status }) => {
    if (!match || !token || !match.race) return;
    const g = match.game;
    const p = g?.players.get(token);
    const spectator = !p || p.state !== 'live';
    if (!spectator && match.race.lockedOut.has(token)) return;
    if (match.race.buzzes.some((b) => b.token === token)) return;
    const rec = {
      token, name: match.roster.get(token)?.name || 'Player',
      ms: Math.round(ms * 10) / 10, early: status === 'early', spectator,
    };
    match.race.buzzes.push(rec);
    match.race.buzzes.sort((a, b) => a.ms - b.ms);

    if (!spectator && (!match.fastest || rec.ms < match.fastest.ms)) {
      match.fastest = { ms: rec.ms, name: rec.name, clue: g.cluesRevealed + 1,
        category: match.clue?.category, value: match.clue?.value };
    }
    // Spectators are ranked against the LIVE field only, never each other.
    const liveTimes = match.race.buzzes.filter((b) => !b.spectator).map((b) => b.ms);
    rec.ranked = spectator
      ? g.rankSpectatorBuzz(rec.ms, liveTimes.filter((t) => t !== rec.ms))
      : { place: liveTimes.filter((t) => t < rec.ms).length + 1, outOf: liveTimes.length };
    pushAll();
  });

  socket.on('ping-probe', (_d, ack) => ack?.());

  socket.on('buzzer-latency', ([ms, ref]) => {
    if (!match || !token) return;
    const p = match.roster.get(token);
    if (p) { p.latency = ms; p.latencyRef = ref; }
  });
});

http.listen(PORT, () => console.log(`J! Royal Rumble on :${PORT}`));
