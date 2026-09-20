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
import { matchPick } from './pick-match.js';

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
    // The open window, if any: { kind: 'answer' | 'pick', sid, token, closesAt }.
    // One at a time by construction — the host is either listening to the
    // person on the clock or to the person holding the board, never both.
    this.window = null;
    this.windowSeq = 0;
    this.retried = new Set();   // clue keys that have already had one "be more specific"
    this.heardText = [];        // { at, kind, token, name, text, verdict, via, ms }
    // The ruling the room may still object to, and the open award vote if the
    // reversal turned out to be ambiguous. See the objections section below.
    this.standing = null;
    this.rulingSeq = 0;
    this.award = null;
    this.awardTimer = null;
    this.walkback = false;
    this.pickControl = null;    // who held the board when this clue was picked
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
    this.closeWindow();
    this.clearTimers();
    // Bare timers are not in this.timers, on purpose, so they need saying so.
    clearTimeout(this.awardTimer);
    this.award = null;
    const g = this.m.game;
    const winner = g.live()[0];
    const line = winner ? `Your winner: ${winner.name}!` : 'That is the match.';
    this.m.note('autohost-summary', { spoke: this.spoke.length,
      fromClock: this.spoke.filter((s) => s.fromClock).length,
      backlog: { ...this.backlog }, heard: this.heardSummary(),
      rulings: this.rulingSummary() });
    this.say(GENE, line, { then: () => {
      this.line = 'The match is over.'; this.pushState(); this.stopped = true;
    } });
  }

  /** The console undid a clue. Everything scheduled is stale. */
  onUndo() {
    if (this.stopped) return;
    this.closeWindow();
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
      // Their microphone opens for the whole pick clock: the pick is spoken
      // first and clicked second (docs/autohost-design.md), so the window is
      // the window, not a separate step they have to trigger.
      this.openWindow('pick', holder.id, total / 1000);
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
    this.closeWindow();
    this.clearTimers();
    const c = this.m.clue;
    if (!c) return;
    this.state = 'reading';
    this.stumperSpoken = false;
    // Whoever called this clue gets the board back if the room throws it out.
    this.pickControl = this.m.control;
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

  // --------------------------------------------------------------- listening
  //
  // The microphone is on the player's own machine and so is the recognizer:
  // the browser turns speech into text and sends the text. Nothing here is
  // audio, the server never holds a recording, and there is no speech service
  // to pay for or to be down — the approach Matt Schiffler's j-trivia autohost
  // proved in live play, and a straight simplification of what this design
  // originally specified (see docs/autohost-from-jtrivia.md).
  //
  // A window is a small object with an id. Everything that arrives carries
  // that id, so a transcript from a window that has already closed — the
  // recognizer finishing its sentence a beat late — is dropped instead of
  // ruling on a clue that has moved on.

  /** Open a window and tell exactly one player their microphone is live. */
  openWindow(kind, token, seconds) {
    const sid = ++this.windowSeq;
    this.window = { kind, sid, token, closesAt: Date.now() + seconds * 1000 };
    const sock = this.m.roster.get(token)?.socketId;
    if (sock) this.io.to(sock).emit('listen', { sid, kind, ms: seconds * 1000 });
    this.after(seconds * 1000, () => {
      if (this.window?.sid !== sid) return;
      this.closeWindow();
      if (kind === 'answer') this.onAnswerTimeout(token);
    });
    return sid;
  }

  closeWindow() {
    const w = this.window;
    this.window = null;
    if (!w) return;
    const sock = this.m.roster.get(w.token)?.socketId;
    if (sock) this.io.to(sock).emit('listen', { sid: w.sid, kind: w.kind, ms: 0, close: true });
  }

  /** A person won the race. Ask them, and start the clock on the answer. */
  onLeader({ token, name }) {
    if (this.stopped || !this.m.clue) return;
    this.state = 'listening';
    this.line = `${name} is answering`;
    this.pushState();
    const secs = Number(this.m.settings.answerSeconds || 5);
    this.openWindow('answer', token, secs);
    if (this.m.settings.autohostSayName !== false) this.say(MIKE, `${name}.`);
  }

  /** The window closed with nothing said. That is a miss, said plainly. */
  onAnswerTimeout(token) {
    if (this.stopped || !this.m.clue) return;
    this.record({ kind: 'answer', token, text: '', clue: `${this.m.clue.slot}:${this.m.clue.row}`,
      verdict: 'unclear', via: 'timeout', ms: 0 });
    this.say(MIKE, 'Time.', { then: () => {
      if (this.stopped || !this.m.clue) return;
      this.act.runMarkWrong(token);
    } });
  }

  /**
   * What the player on the clock said. Judge it, then do what a host does.
   *
   * Returns an acknowledgement for the buzzer rather than throwing: a client
   * that speaks into a closed window should be told so, not left waiting.
   */
  onAnswerHeard(token, { sid, text }) {
    if (this.stopped) return { error: 'the match is over' };
    const w = this.window;
    if (!w || w.kind !== 'answer' || w.sid !== sid) return { error: 'that window is closed' };
    if (w.token !== token) return { error: 'you are not on the clock' };
    if (!this.m.clue) return { error: 'that clue is already settled' };
    this.closeWindow();
    this.clearTimers();
    const clue = this.m.clue;
    const name = this.m.roster.get(token)?.name || 'somebody';
    this.state = 'ruling';
    this.line = `"${text}" — ruling`;
    this.pushState();

    this.chain = this.chain.then(async () => {
      if (this.stopped || this.m.clue !== clue) return;
      let r;
      try {
        r = await this.act.judge({ clue: clue.text, answer: clue.answer, said: text, category: clue.category });
      } catch (e) {
        // judge() is written never to throw; if it somehow does, the clue is
        // not silently swallowed.
        r = { verdict: 'unclear', reason: e.message, via: 'local', local: true, ms: 0 };
      }
      this.record({ kind: 'answer', token, text, clue: `${clue.slot}:${clue.row}`,
        verdict: r.verdict, via: r.via, ms: r.ms, reason: r.reason });
      this.log('autohost', { event: 'ruling', name, said: text, verdict: r.verdict, via: r.via, ms: r.ms });
      if (this.stopped || this.m.clue !== clue) return;
      return this.rule(r, token, name, clue);
    }).catch((e) => this.log('autohost', { event: 'error', where: 'judge', error: e.message }));
    return { ok: true };
  }

  /** Act on a verdict, in the host's voice. */
  async rule(r, token, name, clue) {
    const key = `${clue.slot}:${clue.row}`;

    // "Be more specific." The clue is not resolved either way and the player
    // keeps the clock — a host's prompt, not a ruling. Once per clue, because
    // a second prompt is just a slower no.
    if (r.verdict === 'too_broad' && this.m.settings.specificRetry !== false && !this.retried.has(key)) {
      this.retried.add(key);
      await this.play(MIKE, 'Be more specific.');
      if (this.stopped || this.m.clue !== clue) return;
      this.state = 'listening';
      this.line = `${name} is answering again`;
      this.pushState();
      this.openWindow('answer', token, Number(this.m.settings.answerSeconds || 5));
      return;
    }

    if (r.verdict === 'correct') {
      this.stand('right', token, clue);
      return this.act.runResolve({ winnerToken: token });
    }

    // Everything else is a miss. `unclear` is said differently from `wrong`
    // because they are different things to be on the end of, and a player who
    // was misheard should hear that rather than "no".
    const line = r.local
      ? `I could not rule on that one, so I have to say no, ${name}.`
      : r.verdict === 'unclear' ? `I did not catch that, ${name}.` : `No, ${name}.`;
    // runMarkWrong says "No, name" itself through onMarkedWrong; suppress that
    // so the room does not hear the ruling twice.
    this.suppressWrongLine = true;
    await this.play(MIKE, line);
    if (this.stopped || this.m.clue !== clue) { this.suppressWrongLine = false; return; }
    this.stand('wrong', token, clue);
    this.act.runMarkWrong(token);
    this.suppressWrongLine = false;
  }

  /** What the board-holder said when asked to call a clue. */
  onPickHeard(token, { sid, alternatives }) {
    if (this.stopped) return { error: 'the match is over' };
    const w = this.window;
    if (!w || w.kind !== 'pick' || w.sid !== sid) return { error: 'that window is closed' };
    if (w.token !== token) return { error: 'you do not hold the board' };
    if (this.m.clue) return { error: 'a clue is already up' };
    const m = matchPick(alternatives, this.m.game.board,
      { multiplier: this.m.game.overtimeMultiplier() });
    const name = this.m.roster.get(token)?.name || 'somebody';
    this.record({ kind: 'pick', token, text: alternatives.join(' | '), verdict: m.slot != null && m.row != null ? 'picked' : 'unmatched', via: 'phonetic', ms: 0, reason: m.why });
    this.log('autohost', { event: 'pick-heard', name, heard: alternatives[0], slot: m.slot, row: m.row, why: m.why });
    if (m.slot != null && m.row != null && !m.taken) {
      this.closeWindow();
      this.clearTimers();
      this.act.runPick({ slot: m.slot, row: m.row });
      return { ok: true, slot: m.slot, row: m.row };
    }
    // Not understood. Say why and leave the window open for the rest of the
    // pick clock — the player can simply say it again, and the autopick timer
    // is still running underneath, so nothing stalls.
    const ask = m.taken ? 'That one is gone. Something else?'
      : m.row == null && m.slot != null ? 'For how much?'
      : m.slot == null && m.row != null ? 'Which category?'
      : 'Say the category and the amount.';
    this.say(MIKE, ask);
    return { ok: false, why: m.why };
  }

  /** Every transcript and ruling, for the record and the console. */
  record(row) {
    this.heardText.push({ at: Date.now(), name: this.m.roster.get(row.token)?.name || null, ...row });
    if (this.heardText.length > 400) this.heardText.shift();
  }

  /** A robot took the buzz and said something. Read it to the room. */
  onBotSaid({ name, kind, text, token }) {
    if (this.stopped || kind === 'pick') return;
    // Recorded as well as spoken: a robot that was ruled wrong is as much a
    // candidate for an award vote as a person, and the room saw it answer.
    if (token && this.m.clue) {
      this.record({ kind: 'answer', token, text, clue: `${this.m.clue.slot}:${this.m.clue.row}`,
        verdict: null, via: 'bot', ms: 0 });
    }
    this.say(MIKE, `${name} says: ${text}`);
  }

  onMarkedWrong(token) {
    if (this.stopped) return;
    // The judge path has already said its own line, which is more specific
    // than this one ("I did not catch that" rather than "No"). This is for a
    // console's N, which says nothing on its own.
    if (this.suppressWrongLine) return;
    // A console's N is a ruling like any other, and the room can object to it.
    this.stand('wrong', token, this.m.clue);
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
    // A console's Correct is a ruling the room can object to. The host's own
    // correct ruling already stood itself before it called runResolve, so this
    // only fires for the console — `stand` is a no-op mid-walk-back.
    if (winnerToken && !this.isStanding(clue)) this.stand('right', winnerToken, clue);
    // Where this clue's snapshot now sits in the undo stack, and what it did.
    // Both are what a walk-back needs, and neither is knowable until the rule
    // has run.
    if (this.isStanding(clue)) {
      const st = this.standing;
      st.depth = this.m.undoStack.length;
      st.recordAt = (this.m.record?.clues.length ?? 0) - 1;
      st.endedStumper = !winnerToken;
      st.missedIds = [...(entry.missedIds || [])];
    }
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

  // ------------------------------------------------------------ objections
  //
  // The room polices the host. Any player — in the ring, queued or eliminated
  // — can press O from the moment a ruling is spoken until the *next* ruling
  // is spoken. That window is one whole clue cycle, so the board goes straight
  // back to the players the instant a ruling lands and nobody ever waits on a
  // vote that will usually never come. Objections are rare by assumption; the
  // common case must not pay for the rare one.
  //
  // Two thresholds, whichever is met first: a simple majority of everybody in
  // the match, or two-thirds of the ring. Two, because the roster is thirty
  // and the ring is three — a majority of the room lets the crowd correct a
  // host that is plainly wrong, and two-thirds of the ring lets the people
  // with money on the clue correct it without needing twenty-five spectators
  // to look up from their drinks. The answering player's own O counts.
  //
  // Nothing here re-fires a rule. A reversal is a walk-back: `undoStack` holds
  // a snapshot of the whole engine before every scored clue, so the server
  // restores it and re-runs the same `resolveClue` the other way round. Where
  // the walk-back cannot express what the room wants — three players were
  // ruled wrong, or a *right* was overruled and the race that should have
  // followed cannot be run minutes later — the room is asked directly, and the
  // clue is thrown out only if it cannot decide.

  /**
   * A ruling has been spoken. It is now the one the room may object to, and
   * whatever was standing before it has run out of time.
   */
  stand(kind, token, clue) {
    // A walk-back's own re-resolve is not a ruling; there is no objecting to
    // an objection.
    if (this.walkback) return;
    if (this.standing && !this.standing.done) this.lapse(this.standing);
    this.standing = {
      id: ++this.rulingSeq,
      kind, token,
      clue: clue ? { slot: clue.slot, row: clue.row, category: clue.category,
        value: clue.value, answer: clue.answer } : null,
      control: this.pickControl,
      votes: new Set(),
      open: false,
      depth: null, recordAt: null, endedStumper: false, missedIds: [],
      done: false,
    };
  }

  /** Is `clue` the one the standing ruling is about? */
  isStanding(clue) {
    const st = this.standing;
    return !!(st && !st.done && st.clue && clue
      && st.clue.slot === clue.slot && st.clue.row === clue.row);
  }

  /**
   * How many objections it would take, right now.
   *
   * Robots are left out of both denominators, which the design did not
   * contemplate and a room with robots in it makes unavoidable: a robot cannot
   * press O, so counting them is counting votes that can never be cast — in a
   * field half full of them the all-players threshold would be unreachable by
   * arithmetic rather than by disagreement.
   *
   * The tolerance is not superstition, and it is not floating-point paranoia
   * either — it is the setup page. Two-thirds of a ring of three is exactly
   * two, but the page stores the share as a whole percentage because "67" is
   * something a host can type and 0.6666666666666666 is not. Three times 0.67
   * is 2.01, and a bare `ceil` would make a ring of three unanimous when the
   * settled rule says two. So the share is treated as accurate to the half
   * percent it is stored at, which over a ring of n is half a percent of n —
   * negligible for a big ring and exactly what rescues a small one.
   *
   * What that produces, at the shipped two thirds however it was stored:
   *
   *     ring   2  3  4  5  6  100
   *     needs  2  2  3  4  4   67
   *
   * and at three quarters, a ring of three needs all three and a ring of four
   * needs three — which is the point of the field being a dial rather than a
   * constant.
   */
  objectionCounts() {
    const g = this.m.game;
    const people = [...g.players.values()].filter((p) => !this.m.bots.has(p.id));
    const ring = people.filter((p) => p.state === 'live');
    const frac = Number(this.m.settings.ringSupermajority) || 2 / 3;
    const tol = 0.005 * ring.length + 1e-9;
    return {
      of: people.length,
      ring: ring.length,
      needAll: Math.floor(people.length / 2) + 1,
      needRing: ring.length ? Math.max(1, Math.ceil(ring.length * frac - tol)) : Infinity,
      ringVotes: (st) => (st ? [...st.votes].filter((t) => g.players.get(t)?.state === 'live').length : 0),
    };
  }

  /** One player pressed O. */
  onObject(token) {
    if (this.stopped) return { error: 'the match is over' };
    if (this.m.settings.objections === false) return { error: 'objections are switched off' };
    const st = this.standing;
    if (!st || st.done) return { error: 'there is no ruling to object to' };
    if (!this.m.game.players.get(token)) return { error: 'you are not in this match' };
    if (st.votes.has(token)) return { ok: true, votes: st.votes.size, already: true };

    st.votes.add(token);
    const first = !st.open;
    st.open = true;
    if (first) {
      this.say(MIKE, 'Objection on the last ruling. Press O to join.');
      this.log('autohost', { event: 'objection-opened', ruling: st.id,
        by: this.m.roster.get(token)?.name, kind: st.kind });
    }
    const c = this.objectionCounts();
    const met = st.votes.size >= c.needAll || c.ringVotes(st) >= c.needRing;
    this.pushState();
    if (met) this.reverse(st);
    return { ok: true, votes: st.votes.size, met };
  }

  /** What one player's buzzer should show about the objection. */
  objectionView(token) {
    const st = this.standing;
    if (!st || st.done || !st.open) return null;
    const c = this.objectionCounts();
    return { votes: st.votes.size, ring: c.ringVotes(st), of: c.of,
      needAll: c.needAll, needRing: c.needRing === Infinity ? null : c.needRing,
      mine: st.votes.has(token),
      on: st.clue ? `${st.clue.category} for $${money(st.clue.value)}` : null };
  }

  /** The window closed with too few. Nothing is said; the count is kept. */
  lapse(st) {
    st.done = true;
    if (!st.open) return;
    const c = this.objectionCounts();
    this.log('autohost', { event: 'objection-lapsed', ruling: st.id, votes: st.votes.size,
      needAll: c.needAll, needRing: c.needRing });
    this.writeObjection(st, { met: false, shape: 'lapsed' });
    this.pushState();
  }

  /** Everyone who gave an answer on the objected clue, in the order they did. */
  answerersOf(st) {
    if (!st.clue) return [];
    const key = `${st.clue.slot}:${st.clue.row}`;
    const seen = new Map();
    for (const r of this.heardText) {
      if (r.kind !== 'answer' || r.clue !== key) continue;
      if (!String(r.text || '').trim()) continue;   // a timeout is not an answer
      seen.set(r.token, { token: r.token, name: r.name || 'somebody', text: r.text });
    }
    return [...seen.values()];
  }

  /** Is the objected clue still the one on the board, unresolved? */
  stillUp(st) {
    const c = this.m.clue;
    return !!(c && st.clue && c.slot === st.clue.slot && c.row === st.clue.row);
  }

  /**
   * Which of the three shapes this reversal is.
   *
   * `clean`    the clue never ended — the reopened race is still running, so
   *            closing it and paying the objected player is the whole job.
   * `snapshot` the clue ended as a stumper, exactly one person answered on it,
   *            and nothing has been ruled since: the snapshot says precisely
   *            what to put back.
   * everything else is ambiguous and belongs to the room.
   */
  shapeOf(st) {
    if (st.kind === 'wrong' && this.stillUp(st)) return 'clean';
    if (st.kind === 'wrong' && st.endedStumper && this.answerersOf(st).length === 1
      && st.depth != null && this.m.undoStack.length === st.depth) return 'snapshot';
    return 'ambiguous';
  }

  /** Enough objections arrived. Put it right. */
  reverse(st) {
    st.done = true;
    st.open = false;
    const shape = this.shapeOf(st);
    this.log('autohost', { event: 'objection-met', ruling: st.id, votes: st.votes.size, shape });

    if (shape === 'clean' || shape === 'snapshot') {
      const name = this.m.roster.get(st.token)?.name || 'that';
      this.say(MIKE, `The room overrules me. ${name}, that is good.`);
      const ok = this.settle(st, st.token);
      this.writeObjection(st, { met: true, shape: ok ? 'reversed' : 'late' });
      if (!ok) this.tooLate();
      return;
    }

    // A reversed *right* has exactly one candidate — the player the room just
    // overruled — so there is nothing to vote on. The rules say a miss reopens
    // the race, and that race cannot be run now, minutes later, with the
    // answer already spoken to the room. The clue goes.
    if (st.kind === 'right') {
      this.say(MIKE, 'The room overrules me.');
      const ok = this.settle(st, null);
      this.writeObjection(st, { met: true, shape: ok ? 'voided' : 'late' });
      if (!ok) this.tooLate();
      return;
    }

    this.openAward(st);
  }

  /**
   * Put the objected clue back the way the room says it should have gone.
   *
   * `winnerToken` null throws the clue out. Returns false when the walk-back
   * can no longer reach it, which is the "too late" case: the next clue was
   * ruled on while this was being decided, so its snapshot sits on top of the
   * objected one and popping would undo the wrong clue.
   */
  settle(st, winnerToken) {
    this.walkback = true;
    try {
      const { slot, row } = st.clue;

      // Still on the board: no snapshot to walk back through. Lift the
      // lockout and rule it the other way, which keeps the buzz times in the
      // record — an undo and re-resolve would throw them away.
      if (this.stillUp(st)) {
        this.clearTimers();
        this.closeWindow();
        if (this.m.race) this.m.race.open = false;
        if (winnerToken) {
          this.m.race?.lockedOut.delete(winnerToken);
          this.act.runResolve({ winnerToken });
          return true;
        }
        this.m.clue = null; this.m.race = null;
        this.act.voidClue(slot, row);
        this.handBack(st);
        return true;
      }

      // Otherwise the game has moved on. Abandon whatever is in progress —
      // its card was never revealed, so it simply goes back on the board and
      // will be picked again — then walk back through the snapshot.
      this.clearTimers();
      this.closeWindow();
      this.m.clue = null; this.m.race = null;
      if (st.depth == null || this.m.undoStack.length !== st.depth) return false;
      if (!this.act.runUndo()) return false;

      if (winnerToken) {
        this.act.reresolve({ slot, row, winnerToken,
          missedTokens: (st.missedIds || []).filter((t) => t !== winnerToken) });
      } else {
        this.act.voidClue(slot, row);
        this.handBack(st);
      }
      return true;
    } catch (e) {
      this.log('autohost', { event: 'error', where: 'objection', error: e.message });
      return false;
    } finally {
      this.walkback = false;
    }
  }

  /**
   * A thrown-out clue pays nobody, so nobody won the board with it: it goes
   * back to whoever called the clue, and the room still hears the answer
   * rather than being left hanging.
   */
  handBack(st) {
    const back = st.control;
    this.m.control = back && this.m.game.players.get(back)?.state === 'live' ? back : this.m.control;
    this.standing = null;
    const back_to_board = () => { this.pushState(); this.handover(); };
    if (st.clue?.answer) {
      this.say(MIKE, 'That clue is thrown out.');
      this.say(MIKE, `The correct response: ${st.clue.answer}.`, { then: back_to_board });
    } else {
      this.say(MIKE, 'That clue is thrown out.', { then: back_to_board });
    }
  }

  tooLate() {
    this.say(MIKE, 'That vote came too late. The ruling stands.');
    this.pushState();
  }

  // ---------------------------------------------------------- the award vote

  /**
   * The room said the host was wrong but not about whom. Ask it.
   *
   * Every buzzer gets the players who answered on that clue, with what the
   * transcript heard each of them say, and "nobody — throw it out". Plurality
   * wins; a tie or an empty vote throws the clue out, because a room that
   * cannot choose has not made a case for taking money off anybody. The game
   * keeps going underneath — the vote is a popup, not a pause.
   */
  openAward(st) {
    const candidates = this.answerersOf(st);
    if (!candidates.length) {
      const ok = this.settle(st, null);
      this.writeObjection(st, { met: true, shape: ok ? 'voided' : 'late' });
      if (!ok) this.tooLate();
      return;
    }
    const secs = Number(this.m.settings.awardSeconds || 15);
    this.award = { st, candidates, votes: new Map(), closesAt: Date.now() + secs * 1000 };
    this.say(MIKE, 'The room overrules me. Who had it? Vote on your buzzer.');
    this.pushState();
    // A bare timer, not `after`: `clearTimers()` cancels what the host was
    // going to do next, and the game is deliberately still running underneath
    // this vote — the next pick would cancel the count and the popup would sit
    // on thirty screens forever. Same reason the clip waits are bare.
    clearTimeout(this.awardTimer);
    this.awardTimer = setTimeout(() => this.closeAward(), secs * 1000);
  }

  onAwardVote(token, { to }) {
    if (this.stopped) return { error: 'the match is over' };
    const a = this.award;
    if (!a) return { error: 'there is no vote open' };
    if (!this.m.game.players.get(token)) return { error: 'you are not in this match' };
    const pick = to == null ? null : String(to);
    if (pick !== null && !a.candidates.some((c) => c.token === pick)) return { error: 'not a candidate' };
    a.votes.set(token, pick);
    this.pushState();
    return { ok: true, votes: a.votes.size };
  }

  awardView() {
    const a = this.award;
    if (!a) return null;
    return { candidates: a.candidates.map((c) => ({ token: c.token, name: c.name, text: c.text })),
      votes: a.votes.size, closesAt: a.closesAt,
      on: a.st.clue ? `${a.st.clue.category} for $${money(a.st.clue.value)}` : null };
  }

  closeAward() {
    const a = this.award;
    if (!a || this.stopped) return;
    this.award = null;
    const tally = new Map();
    for (const v of a.votes.values()) tally.set(v, (tally.get(v) || 0) + 1);
    let best = null, bestN = 0, tied = false;
    for (const [who, n] of tally) {
      if (n > bestN) { best = who; bestN = n; tied = false; }
      else if (n === bestN) tied = true;
    }
    // `best` can be null in two different ways — nobody voted, or the room
    // voted to throw it out — and both mean the same thing here.
    const to = tied || bestN === 0 ? null : best;
    this.log('autohost', { event: 'award-closed', ruling: a.st.id, votes: a.votes.size,
      to: to ? this.m.roster.get(to)?.name : null, tied });
    const ok = this.settle(a.st, to);
    this.writeObjection(a.st, { met: true, shape: ok ? (to ? 'awarded' : 'voided') : 'late',
      award: { to: to ? this.m.roster.get(to)?.name : null, votes: bestN, of: a.votes.size } });
    if (!ok) return this.tooLate();
    if (to) this.say(MIKE, `The room gives it to ${this.m.roster.get(to)?.name}.`);
    this.pushState();
  }

  /**
   * What the room decided, in the record.
   *
   * It goes two places on purpose: on the clue, so a reader of one match sees
   * it in context, and in `corrections` beside the undos and delay changes, so
   * the analysis chat can count how often the room disagrees with the judge —
   * the number that decides when the judge is good enough — without walking
   * every clue of every log.
   */
  writeObjection(st, { met, shape, award = null }) {
    const c = this.objectionCounts();
    const payload = { votes: st.votes.size, of: c.of, ring: c.ringVotes(st),
      needAll: c.needAll, needRing: c.needRing === Infinity ? null : c.needRing,
      met, shape, ruling: st.kind, on: this.m.roster.get(st.token)?.name || null,
      ...(award ? { award } : {}) };
    const clues = this.m.record?.clues;
    if (clues?.length) {
      // A walk-back replaced the clue's row, so the newest one is the objected
      // clue; a lapse left the original in place where it always was.
      const row = shape === 'lapsed' && st.recordAt != null && clues[st.recordAt]
        ? clues[st.recordAt] : clues[clues.length - 1];
      if (row) row.objection = payload;
    }
    this.m.corrections?.push({ at: this.m.elapsed(), clue: this.m.game.cluesRevealed,
      type: 'objection', category: st.clue?.category, value: st.clue?.value, ...payload });
    this.m.note('objection', payload);
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

  /**
   * How the rulings were made, for the record: how many never needed a model,
   * how many the model decided, and how many fell back to the local judge —
   * that last count is the one that says whether a room needs objections.
   */
  rulingSummary() {
    const answers = this.heardText.filter((r) => r.kind === 'answer');
    const by = (k) => answers.filter((r) => r.via === k).length;
    const times = answers.filter((r) => r.ms > 0).map((r) => r.ms).sort((a, b) => a - b);
    return {
      answers: answers.length,
      exact: by('exact') + by('grace'), model: by('model'), local: by('local'),
      timedOut: by('timeout'),
      verdicts: answers.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] || 0) + 1 }), {}),
      judgeMs: times.length ? { p50: times[Math.floor(times.length / 2)], max: times.at(-1) } : null,
      picks: this.heardText.filter((r) => r.kind === 'pick').length,
      picksUnmatched: this.heardText.filter((r) => r.kind === 'pick' && r.verdict === 'unmatched').length,
    };
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
      listening: this.window ? { kind: this.window.kind, name: this.m.roster.get(this.window.token)?.name || null } : null,
      transcripts: this.heardText.slice(-8),
      objection: this.objectionView(null),
      award: this.awardView(),
      backlog: { ...this.backlog, depth: this.jobs.length } };
  }
}
