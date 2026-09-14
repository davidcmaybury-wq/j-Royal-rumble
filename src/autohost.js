// The host, when there is no host.
//
// One of these per match with `autohost: true`. It never touches the rules: it
// calls the same runPick / runActivate / runResolve / runMarkWrong that the
// console calls, and it listens to the same events. What it adds is a voice
// and a clock — it says what a host would say, and it does what a host would
// do next, on a timer, so thirty people are never waiting on one.
//
// Two voices (docs/autohost-design.md, "Two hosts"). MIKE reads: the handover,
// the category and value, the clue, the ruling, the correct response on a
// stumper. GENE calls the ring: entrances, eliminations, the field clearing,
// overtime. They never speak in the same step, so the handoff is clean. Which
// of the two says a line is an argument to say(), never a decision made at
// the call site by string-matching.
//
// Step three of the build. The autohost reads and calls, and a human at a
// console still presses Correct / Wrong. It does not listen and does not judge
// — those are steps four and five — so the only ruling it makes on its own is
// the stumper, where the lights ran out with nobody on the clock.
//
// The voice is a clip, never a stream: the server owns the audio and knows
// its length, so the buzzers are armed at `spokenAt + durationMs`, the same
// `activate-buzzers {at}` a human host triggers. Every client plays the clip
// from its own speaker and reports when it actually started (`heard`), and
// the spread of those reports is the number that decides how much settle to
// add — it is recorded per clip so the first real match can answer it.
//
// Nothing here waits on synthesis if it can help it. The board is queued for
// synthesis in the background the moment it is dealt, picked clues jump the
// queue, and a clue whose clip is not ready when it is picked is read from
// the clock — `readingTimeMs` — with the text already on every screen. The
// fallback is a counted event, not a silent one.

import { speak, speakJoined, voiceFor, readingTimeMs, status as ttsStatus, TtsError } from './tts.js';

export const MIKE = 'mike';
export const GENE = 'gene';

// A short breath after a clip before the next thing happens. Measured from
// nothing yet: the `heard` spread from a real match is what sets it, and the
// value here is the smallest that does not sound like the host interrupting
// himself. Do not tune it without that measurement.
const SETTLE_MS = 250;

// Nudge the player holding the board this many seconds before the host picks
// for them. Four, so a nudge at eight of twelve still leaves time to answer it.
const NUDGE_BEFORE_S = 4;

const money = (n) => Math.round(n).toLocaleString('en-US');

export class Autohost {
  /**
   * @param match   the Match, already started
   * @param actions { runPick, runActivate, runResolve, runMarkWrong } bound to
   *                the match with server deps — the same four the console calls
   * @param io      socket.io, to emit `host-speaks` and `entrances`
   */
  constructor(match, actions, io, { log = () => {} } = {}) {
    this.m = match;
    this.act = actions;
    this.io = io;
    this.log = log;
    this.state = 'idle';       // idle | handover | reading | racing | ruling | narrating | over
    this.line = '';            // what the host is doing, for every buzzer's status strip
    this.seq = 0;              // clip ids, per match
    this.chain = Promise.resolve();   // lines never overlap
    this.timers = new Set();
    this.heard = new Map();    // sid -> [{ token, lateMs }]
    this.spoke = [];           // { sid, host, text, durationMs, synthMs, fromClock }
    this.jobs = [];            // background synthesis, highest priority first
    this.working = false;
    this.backlog = { queued: 0, done: 0, waitedMs: 0, waits: 0, maxDepth: 0 };
    this.stumperSpoken = false;
    this.stopped = false;
  }

  // ------------------------------------------------------------ lifecycle

  /** At the bell. Control to draw 1, the board into the queue, and hand over. */
  start() {
    const g = this.m.game;
    const first = [...g.players.values()].find((p) => p.drawNumber === 1);
    if (first) this.m.control = first.id;
    this.queueFixed();
    this.queueBoard();
    for (const p of g.live()) this.queuePlayerLines(p.id);
    this.log('autohost', { event: 'start', control: first?.name || null });
    this.after(0, () => this.handover());
  }

  onOver() {
    this.state = 'over';
    this.clearTimers();
    const g = this.m.game;
    const winner = g.live()[0];
    const line = winner ? `Your winner: ${winner.name}!` : 'That is the match.';
    this.m.note('autohost-summary', { spoke: this.spoke.length,
      fromClock: this.spoke.filter((s) => s.fromClock).length,
      backlog: { ...this.backlog }, heard: this.heardSummary() });
    this.say(GENE, line, { then: () => {
      this.line = 'The match is over.'; this.pushState(); this.stopped = true;
    } });
  }

  /** The console undid a clue. Everything scheduled is stale. */
  onUndo() {
    if (this.stopped) return;
    this.clearTimers();
    this.stumperSpoken = false;
    this.say(MIKE, 'That clue is undone.', { then: () => this.handover() });
  }

  // --------------------------------------------------------------- the loop

  /** Whoever holds the board is told so, and the pick clock starts. */
  handover() {
    if (this.stopped || this.m.phase !== 'live' || this.m.clue) return;
    this.state = 'handover';
    const g = this.m.game;
    const holder = this.m.control && g.players.get(this.m.control)?.state === 'live'
      ? g.players.get(this.m.control) : null;
    if (!holder) {
      // Nobody holds it — the first clue, or the holder just went out. The
      // engine gives control to a correct answer and leaves it on a stumper;
      // with the holder gone there is nobody to hand to, so the host picks.
      return this.autopick('nobody holds the board');
    }
    if (this.m.bots.has(holder.id)) {
      // A robot's pick arrives with the ruling that gave it the board
      // (entry.botPick); at the bell there is no ruling yet, so pick for it.
      return this.autopick(`${holder.name} is a robot`);
    }
    this.line = `${holder.name} has the board`;
    this.pushState();
    this.say(MIKE, `You have the board, ${holder.name}.`, { then: () => {
      if (this.state !== 'handover') return;
      const total = Number(this.m.settings.pickSeconds || 12) * 1000;
      this.after(Math.max(0, total - NUDGE_BEFORE_S * 1000), () => {
        if (this.state !== 'handover' || this.m.clue) return;
        this.say(MIKE, `${holder.name}, call a clue.`);
      });
      this.after(total, () => {
        if (this.state !== 'handover' || this.m.clue) return;
        this.autopick(`${holder.name} did not call one in ${total / 1000}s`);
      });
    } });
  }

  /** A player clicked a card on their board. Only the holder, only now. */
  playerPick(token, { slot, row }) {
    if (this.stopped) return { error: 'The match is over' };
    if (this.state !== 'handover' || this.m.clue) return { error: 'Not while a clue is up' };
    if (token !== this.m.control) return { error: 'You do not hold the board' };
    const ok = this.act.runPick({ slot: Number(slot), row: Number(row) });
    return ok ? { ok: true } : { error: 'That clue is already gone' };
  }

  autopick(why) {
    if (this.stopped || this.m.clue) return;
    const open = [];
    this.m.game.board.forEach((c, slot) => c.clues.forEach((x) => {
      if (!x.revealed) open.push({ slot, row: x.row });
    }));
    if (!open.length) return;
    const pick = open[Math.floor(Math.random() * open.length)];
    this.log('autohost', { event: 'autopick', why });
    this.pickedBy = 'host';
    this.act.runPick(pick);
  }

  /** runPick happened — by a player, the host, or a console. Read it. */
  onPicked() {
    if (this.stopped) return;
    this.clearTimers();
    const c = this.m.clue;
    if (!c) return;
    this.state = 'reading';
    this.stumperSpoken = false;
    this.line = `Mike is reading ${c.category} for $${money(c.value)}`;
    this.pushState();
    // The category and value are one joined clip from two cached parts, so a
    // category is synthesized once per board and a value once ever.
    const parts = [{ text: `${c.category}.`, voice: voiceFor(MIKE) }, { text: `For ${money(c.value)}.`, voice: voiceFor(MIKE) }];
    if (this.pickedBy === 'host') parts.unshift({ text: "I'll pick one.", voice: voiceFor(MIKE) });
    this.pickedBy = null;
    this.chain = this.chain
      .then(() => this.playJoined(MIKE, parts))
      .then(() => this.play(MIKE, c.text, { clue: true }))
      .then(() => {
        if (this.stopped || this.m.clue !== c || this.m.race?.open) return;
        this.state = 'racing';
        this.line = 'Buzzers are live';
        this.pushState();
        this.act.runActivate();
      })
      .catch((e) => this.log('autohost', { event: 'error', where: 'read', error: e.message }));
  }

  /** A robot took the buzz and said something. Read it to the room. */
  onBotSaid({ name, kind, text }) {
    if (this.stopped || kind === 'pick') return;
    this.say(MIKE, `${name} says: ${text}`);
  }

  onMarkedWrong(token) {
    if (this.stopped) return;
    const name = this.m.roster.get(token)?.name;
    this.say(MIKE, name ? `No, ${name}.` : 'No.');
  }

  /** The lights ran out with nobody on the clock: reveal, and settle it. */
  onRaceTimeout() {
    if (this.stopped || !this.m.clue) return;
    this.state = 'ruling';
    this.line = 'Nobody — Mike is reading the correct response';
    this.pushState();
    const c = this.m.clue;
    this.stumperSpoken = true;
    this.say(MIKE, `The correct response: ${c.answer}.`, { then: () => {
      if (this.stopped || this.m.clue !== c) return;
      this.act.runResolve({ winnerToken: null });
    } });
  }

  /** A ruling landed, from a console or from the stumper path above. */
  onResolved(entry, { winnerToken, clue }) {
    if (this.stopped) return;
    this.clearTimers();
    this.state = 'narrating';
    const g = this.m.game;
    const nameOf = (t) => this.m.roster.get(t)?.name || 'somebody';
    const winner = winnerToken ? nameOf(winnerToken) : null;
    if (winner) this.say(MIKE, `Correct, ${winner}.`);
    else if (!this.stumperSpoken && clue?.answer) {
      // A console's X without the lights running out: the room still hears
      // the answer, as it would from a human host.
      this.say(MIKE, `The correct response: ${clue.answer}.`);
    }
    this.stumperSpoken = false;

    // Gene's calls, in the order they matter. At most two, so the game never
    // waits long on commentary — an elimination beats an entrance beats a
    // bonus, and the bonuses are on every screen anyway.
    const calls = [];
    const outs = (entry.eliminated || []).map(nameOf);
    if (outs.length === 1) calls.push(`${outs[0]} is eliminated!`);
    else if (outs.length > 1) calls.push(`${outs.slice(0, -1).join(', ')} and ${outs.at(-1)} are eliminated!`);
    const arrivals = (entry.entered == null ? [] : [].concat(entry.entered)).map((t) => g.players.get(t)).filter(Boolean);
    for (const p of arrivals) {
      calls.push(`Number ${p.drawNumber}, ${p.name}, enters with ${money(p.score)}!`);
    }
    if (entry.fieldClear) calls.push('The field is clear!');
    if (entry.overtimeStarted) calls.push('Overtime! The stakes are climbing.');
    else if (entry.overtimeRaised) calls.push(`Stakes times ${entry.overtimeRaised.multiplier}!`);
    for (const t of entry.revived || []) calls.push(`${nameOf(t)} is back in the queue!`);
    for (const line of calls.slice(0, 2)) this.say(GENE, line);

    // The walk-in music plays after Gene has said the name, not under it. The
    // server holds the `entrances` emit for an autohost match so it can go
    // here; the buzzers cut it at the next arm regardless.
    const themed = (entry.entrances || []).filter((e) => e.theme);
    this.chain = this.chain.then(() => {
      if (this.stopped) return;
      if (entry.entrances?.length) {
        this.io.to(`${this.m.id}:players`).emit('entrances', { entrances: entry.entrances });
      }
      if (!themed.length) return;
      const secs = Math.max(...themed.map((e) => Math.min(10, e.theme.seconds || 10)));
      return new Promise((r) => this.after(secs * 1000, r));
    });

    if (g.finished) return;   // onOver follows
    for (const p of arrivals) this.queuePlayerLines(p.id);
    if (entry.fieldClear) this.queueBoard();
    // Whoever has the board now. A robot's pick came with the ruling.
    this.chain = this.chain.then(() => {
      if (this.stopped || this.m.clue || this.m.phase !== 'live') return;
      if (entry.botPick) {
        const { name, slot, row } = entry.botPick;
        this.line = `${name} has the board`;
        this.pushState();
        return this.play(MIKE, `${name} takes it.`).then(() => {
          if (this.stopped || this.m.clue) return;
          this.act.runPick({ slot, row });
        });
      }
      this.handover();
    });
  }

  // ------------------------------------------------------------- speaking

  /** Queue one line in one voice; `then` runs after it has played out. */
  say(host, text, { then } = {}) {
    this.chain = this.chain
      .then(() => this.play(host, text))
      .then(() => { if (then && !this.stopped) then(); })
      .catch((e) => this.log('autohost', { event: 'error', where: 'say', error: e.message }));
    return this.chain;
  }

  /** Speak now (inside the chain) and resolve when the clip has played. */
  async play(host, text, { clue = false } = {}) {
    if (this.stopped) return;
    const started = Date.now();
    let clip = null, why = null;
    try {
      const depth = this.jobs.length;
      clip = await speak(text, voiceFor(host));
      if (clue && !clip.cached && (clip.synthMs || 0) >= 100) {
        // The pick beat the queue. Counted, because the design says this
        // should be rare after the first clue or two of a board.
        this.backlog.waits++; this.backlog.waitedMs += Date.now() - started;
        this.log('autohost', { event: 'clip-wait', ms: Date.now() - started, depth });
      }
    } catch (e) {
      why = e instanceof TtsError ? e.message : `voice: ${e.message}`;
    }
    return this.emitClip(host, text, clip, why);
  }

  async playJoined(host, parts) {
    if (this.stopped) return;
    let clip = null, why = null;
    try { clip = await speakJoined(parts); } catch (e) { why = e instanceof TtsError ? e.message : `voice: ${e.message}`; }
    return this.emitClip(host, parts.map((p) => p.text).join(' '), clip, why);
  }

  emitClip(host, text, clip, why) {
    const sid = ++this.seq;
    const at = Date.now();
    const durationMs = clip ? clip.durationMs : readingTimeMs(text);
    const msg = {
      sid, host, text, at, durationMs,
      url: clip && clip.engine !== 'silent' ? `/clip/${clip.engine}/${clip.key}.wav` : null,
      // No clip: the text is on every screen and the room reads it in the
      // time the host would have taken. Said on the buzzer, counted here.
      fromClock: !clip || clip.engine === 'silent', reason: why,
    };
    // One emit for all four rooms, so a buzzer in full mode — which sits in
    // both `players` and `board` — hears each line once, not twice.
    this.io.to(['players', 'watch', 'host', 'board'].map((r) => `${this.m.id}:${r}`)).emit('host-speaks', msg);
    this.spoke.push({ sid, host, text, durationMs, synthMs: clip?.synthMs ?? null, cached: clip?.cached ?? null, fromClock: msg.fromClock, reason: why });
    if (why) this.log('autohost', { event: 'voice-fallback', sid, reason: why });
    // A plain timer, not one of this.timers: clearTimers() cancels what the
    // host was *going* to do, never the wait for a line already playing. The
    // first version cancelled this too, and a pick that landed mid-line left
    // the chain waiting forever on a resolve that had been cleared.
    return new Promise((resolve) => setTimeout(resolve, durationMs + SETTLE_MS));
  }

  /** A client says when the clip actually started playing on its speaker. */
  onHeard(token, { sid, lateMs }) {
    if (!Number.isFinite(sid) || !Number.isFinite(lateMs)) return;
    if (!this.heard.has(sid)) this.heard.set(sid, []);
    const list = this.heard.get(sid);
    if (list.some((h) => h.token === token)) return;
    list.push({ token, lateMs: Math.round(lateMs) });
  }

  /** The spread of playback starts per clip — the number step three owes. */
  heardSummary() {
    const rows = [];
    for (const [sid, list] of this.heard) {
      if (list.length < 2) continue;
      const v = list.map((h) => h.lateMs).sort((a, b) => a - b);
      rows.push({ sid, n: v.length, min: v[0], p50: v[Math.floor(v.length / 2)], max: v.at(-1), spread: v.at(-1) - v[0] });
    }
    return rows;
  }

  // ------------------------------------------------- background synthesis

  queueFixed() {
    for (const t of ['Correct.', 'No.', "I'll pick one.", 'That clue is undone.', 'Your winner:']) this.enqueue(1, t, MIKE);
    for (const t of ['The field is clear!', 'Overtime! The stakes are climbing.']) this.enqueue(1, t, GENE);
  }

  /** Every clue on the board, and every category title, lowest priority. */
  queueBoard() {
    const g = this.m.game;
    const mult = g.overtimeMultiplier();
    g.board.forEach((c) => {
      this.enqueue(2, `${c.title}.`, MIKE);
      c.clues.forEach((x) => {
        if (x.revealed) return;
        this.enqueue(2, `For ${money([100, 200, 300, 400, 500][x.row - 1] * mult)}.`, MIKE);
        this.enqueue(3, x.text, MIKE);
      });
    });
  }

  /** The lines Gene is likeliest to need about one player, ahead of time. */
  queuePlayerLines(token) {
    const p = this.m.game.players.get(token);
    if (!p) return;
    this.enqueue(1, `${p.name} is eliminated!`, GENE);
    this.enqueue(1, `Correct, ${p.name}.`, MIKE);
    this.enqueue(1, `You have the board, ${p.name}.`, MIKE);
    const next = this.m.game.queued()[0];
    if (next) this.enqueue(1, `Number ${next.drawNumber}, ${next.name}, enters with ${money(this.m.settings.startScore)}!`, GENE);
  }

  enqueue(pri, text, host) {
    if (this.stopped || !text) return;
    if (this.jobs.some((j) => j.text === text && j.host === host)) return;
    this.jobs.push({ pri, text, host });
    this.jobs.sort((a, b) => a.pri - b.pri);
    this.backlog.queued++;
    this.backlog.maxDepth = Math.max(this.backlog.maxDepth, this.jobs.length);
    this.work();
  }

  async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.jobs.length && !this.stopped) {
        const job = this.jobs.shift();
        try {
          const r = await speak(job.text, voiceFor(job.host));
          this.backlog.done++;
          if (!r.cached && r.synthMs != null) this.log('autohost', { event: 'synth', ms: r.synthMs, chars: job.text.length, depth: this.jobs.length });
        } catch (e) {
          // The engine is down or unconfigured; play() will fall back to the
          // clock and say so. No point retrying the whole board.
          this.log('autohost', { event: 'synth-failed', error: e.message });
          this.jobs.length = 0;
        }
        // Yield between jobs so a match's socket traffic is never starved by
        // a board's worth of synthesis on two cores.
        await new Promise((r) => setImmediate(r));
      }
    } finally { this.working = false; }
  }

  // --------------------------------------------------------------- plumbing

  after(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  pushState() { this.act.pushPlayers(); }

  /** For playerView and /api/health. */
  status() {
    return { state: this.state, line: this.line, voice: ttsStatus().engine,
      spoke: this.spoke.length, fromClock: this.spoke.filter((s) => s.fromClock).length,
      backlog: { ...this.backlog, depth: this.jobs.length } };
  }
}
