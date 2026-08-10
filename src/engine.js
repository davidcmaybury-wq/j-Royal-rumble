// Jeopardy Royal Rumble — headless rules engine.
// No DOM, no network, no framework. Deterministic given a seeded rng.
// The host supplies buzzer outcomes; the engine owns all scoring and state.

export const ROW_VALUES = [100, 200, 300, 400, 500];
export const BOARD_CATEGORIES = 6;

export const DEFAULT_SETTINGS = {
  startScore: 3000,
  ceiling: 11000,
  ceilingDecayPerClue: null,  // null => auto: decay to the floor over the match
  ceilingFloor: null,         // null => auto: the starting score
  entryInterval: null,       // null => auto from roster + targetMinutes
  entrantsOnFieldClear: 2,
  stumperFraction: 0.5,      // 0 disables the universal-stumper deduction
  potScoring: true,          // winner collects the value from EACH opponent
  secondsPerClue: 17.5,
  targetMinutes: 60,
  recordMatch: false,        // keep a detailed log of the match
  delay: 200,                // ms held back so buzzers arm with Zoom audio
  lockout: 250,              // ms penalty for buzzing before the lights
  seasonRange: null,         // [lo, hi] archive seasons; null = all
};

export function autoEntryInterval(playerCount, targetMinutes, secondsPerClue) {
  if (playerCount <= 3) return 1;
  const targetClues = (targetMinutes * 60) / secondsPerClue;
  const raw = Math.round((targetClues * 0.6) / (playerCount - 3));
  return Math.min(15, Math.max(2, raw));
}

// Roughly how many clues a match of this shape runs. Mirrors the estimate the
// setup page shows the host — the queue emptying, plus an endgame.
export function expectedClues(playerCount, interval) {
  const entry = Math.max(0, playerCount - 3) * interval;
  return Math.round(entry + Math.max(22, entry * 0.67));
}

// A ceiling that decays from its opening value down to the floor across the
// expected length of the match. Set by hand if you want it steeper.
export function autoCeilingDecay(ceiling, floor, playerCount, interval) {
  const clues = expectedClues(playerCount, interval);
  if (clues <= 0 || ceiling <= floor) return 0;
  return -Math.max(5, Math.round((ceiling - floor) / clues / 5) * 5);
}

// Deterministic PRNG (mulberry32) so a match can be replayed from its seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RumbleGame {
  // categoryPool: () => { id, title, clues: [{id, row, text, answer}] }
  constructor({ players, settings = {}, categoryPool, rng = makeRng(1) }) {
    this.s = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = rng;
    this.pool = categoryPool;
    this.log = [];
    this.cluesRevealed = 0;
    this.fieldClears = 0;
    this.usedClueIds = new Set();     // no-repeat, scoped to this match
    this.vetoedThisMatch = [];

    if (this.s.entryInterval == null) {
      this.s.entryInterval = autoEntryInterval(
        players.length, this.s.targetMinutes, this.s.secondsPerClue);
    }
    // The floor can never be below the entry stake, so that is also its default.
    if (this.s.ceilingFloor == null) this.s.ceilingFloor = this.s.startScore;
    if (this.s.ceilingDecayPerClue == null) {
      this.s.ceilingDecayPerClue = autoCeilingDecay(
        this.s.ceiling, this.s.ceilingFloor, players.length, this.s.entryInterval);
    }

    this.players = new Map();
    const order = shuffle(players.slice(), this.rng);
    order.forEach((p, i) => {
      this.players.set(p.id, {
        id: p.id, name: p.name, drawNumber: i + 1,
        state: 'queued', score: 0, enteredAtClue: null,
        eliminatedAtClue: null, placement: null,
        pins: 0, correct: 0, missed: 0,
      });
    });
    this.drawOrder = order.map((p) => p.id);
    this.eliminationOrder = [];

    this.board = [];
    for (let i = 0; i < BOARD_CATEGORIES; i++) this.board.push(this.drawCategory());

    for (let i = 0; i < Math.min(3, this.drawOrder.length); i++) this.admit('opening');
    this.finished = false;
    this.winnerId = null;
  }

  // ---- snapshots ------------------------------------------------------
  // Everything mutable, serialised. A host mis-scores a clue about as often as
  // they mis-click one, so undo has to restore the whole world — scores,
  // eliminations, the board, the used-clue set — not just the last number.

  snapshot() {
    return JSON.stringify({
      players: [...this.players.entries()],
      board: this.board,
      drawOrder: this.drawOrder,
      eliminationOrder: this.eliminationOrder,
      usedClueIds: [...this.usedClueIds],
      cluesRevealed: this.cluesRevealed,
      fieldClears: this.fieldClears,
      vetoedThisMatch: this.vetoedThisMatch,
      finished: this.finished,
      winnerId: this.winnerId,
      log: this.log,
      s: this.s,
    });
  }

  restore(snap) {
    const d = JSON.parse(snap);
    this.players = new Map(d.players);
    this.board = d.board;
    this.drawOrder = d.drawOrder;
    this.eliminationOrder = d.eliminationOrder;
    this.usedClueIds = new Set(d.usedClueIds);
    this.cluesRevealed = d.cluesRevealed;
    this.fieldClears = d.fieldClears;
    this.vetoedThisMatch = d.vetoedThisMatch;
    this.finished = d.finished;
    this.winnerId = d.winnerId;
    this.log = d.log;
    this.s = d.s;
  }

  // A manual correction. Deliberately does not re-run elimination on its own —
  // the caller decides, because pushing somebody below zero by hand should be
  // an explicit act rather than a side effect of fixing a typo.
  adjustScore(token, delta) {
    const p = this.players.get(token);
    if (!p) return null;
    const before = p.score;
    p.score = Math.min(p.score + delta, this.ceiling);
    if (p.state === 'eliminated' && p.score >= 0) {
      p.state = 'live';
      p.eliminatedAtClue = null;
      this.eliminationOrder = this.eliminationOrder.filter((id) => id !== token);
    }
    return { before, after: p.score };
  }

  // ---- derived values -------------------------------------------------

  get ceiling() {
    const c = this.s.ceiling + this.s.ceilingDecayPerClue * this.cluesRevealed;
    // A ceiling below the entry stake would clip newcomers on arrival, which
    // would quietly undo the thing the stake is for.
    const floor = Math.max(this.s.ceilingFloor, this.s.startScore);
    return Math.max(floor, Math.round(c));
  }

  live() {
    return [...this.players.values()].filter((p) => p.state === 'live');
  }

  queued() {
    return this.drawOrder
      .map((id) => this.players.get(id))
      .filter((p) => p.state === 'queued');
  }

  // Clues remaining until the next entry. Recomputed on read, so a field
  // clear that pulls players in early is reflected immediately.
  cluesUntilNextEntry() {
    if (!this.queued().length) return null;
    const iv = this.s.entryInterval;
    return iv - (this.cluesRevealed % iv);
  }

  boardRemainingValue() {
    return this.board.reduce(
      (sum, cat) => sum + cat.clues.filter((c) => !c.revealed)
        .reduce((s, c) => s + ROW_VALUES[c.row - 1], 0), 0);
  }

  // ---- board ----------------------------------------------------------

  drawCategory() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const cat = this.pool();
      if (!cat) break;
      if (cat.clues.some((c) => this.usedClueIds.has(c.id))) continue;
      cat.clues.forEach((c) => this.usedClueIds.add(c.id));
      return { ...cat, clues: cat.clues.map((c) => ({ ...c, revealed: false })) };
    }
    throw new Error('category pool exhausted');
  }

  vetoCategory(slotIndex, reason = '') {
    const cat = this.board[slotIndex];
    cat.clues.forEach((c) => this.usedClueIds.delete(c.id));
    this.vetoedThisMatch.push({ categoryId: cat.id, reason, atClue: this.cluesRevealed });
    this.board[slotIndex] = this.drawCategory();
    this.log.push({ type: 'veto', categoryId: cat.id, slot: slotIndex, reason });
    return this.board[slotIndex];
  }

  refreshBoard() {
    this.board = [];
    for (let i = 0; i < BOARD_CATEGORIES; i++) this.board.push(this.drawCategory());
  }

  // ---- the main move --------------------------------------------------

  // outcome: { winnerId: string|null, missedIds: string[] }
  resolveClue(slotIndex, row, outcome) {
    if (this.finished) throw new Error('match is over');
    const cat = this.board[slotIndex];
    const clue = cat.clues.find((c) => c.row === row);
    if (!clue || clue.revealed) throw new Error('clue unavailable');

    const value = ROW_VALUES[row - 1];
    clue.revealed = true;
    this.cluesRevealed += 1;

    const { winnerId = null, missedIds = [] } = outcome;
    const live = this.live();
    const liveIds = new Set(live.map((p) => p.id));
    const entry = {
      type: 'clue', n: this.cluesRevealed, category: cat.title, row, value,
      winnerId, missedIds: [...missedIds], ceiling: this.ceiling, eliminated: [],
    };

    for (const id of missedIds) {
      if (!liveIds.has(id)) continue;
      const p = this.players.get(id);
      p.score -= value;
      p.missed += 1;
    }

    if (winnerId && liveIds.has(winnerId)) {
      const w = this.players.get(winnerId);
      const opponents = live.filter((p) => p.id !== winnerId);
      const gain = this.s.potScoring ? value * opponents.length : value;
      w.score += gain;
      w.correct += 1;
      for (const p of opponents) p.score -= value;
      entry.gain = gain;
    } else if (this.s.stumperFraction > 0) {
      const d = Math.round(value * this.s.stumperFraction);
      for (const p of live) p.score -= d;
      entry.stumperDeduction = d;
    }

    // Ceiling clips every live score, not just the answerer's.
    const cap = this.ceiling;
    for (const p of this.live()) if (p.score > cap) p.score = cap;

    this.applyEliminations(entry, winnerId);

    if (!cat.clues.some((c) => !c.revealed)) {
      this.board[slotIndex] = this.drawCategory();
      entry.categoryReplaced = this.board[slotIndex].title;
    }

    const liveAfter = this.live();
    if (liveAfter.length === 1 && this.queued().length) {
      const champ = liveAfter[0];
      const bonus = this.boardRemainingValue();
      champ.score = Math.min(champ.score + bonus, this.ceiling);
      this.fieldClears += 1;
      this.refreshBoard();
      const admitted = [];
      for (let i = 0; i < this.s.entrantsOnFieldClear; i++) {
        const p = this.admit('field-clear');
        if (p) admitted.push(p.id);
      }
      entry.fieldClear = { championId: champ.id, bonus, admitted };
    } else if (liveAfter.length <= 1 && !this.queued().length) {
      this.finished = true;
      this.winnerId = liveAfter[0]?.id ?? null;
      if (this.winnerId) {
        const w = this.players.get(this.winnerId);
        w.placement = 1;
        w.state = 'winner';
      }
      entry.matchOver = true;
    }

    if (!this.finished && this.cluesRevealed % this.s.entryInterval === 0) {
      const p = this.admit('interval');
      if (p) entry.entered = p.id;
    }

    this.log.push(entry);
    return entry;
  }

  applyEliminations(entry, winnerId) {
    const live = this.live();
    let doomed = live.filter((p) => p.score < 0);
    if (!doomed.length) return;

    // Total wipe: highest score survives; ties broken by longest tenure.
    if (doomed.length === live.length) {
      const survivor = [...live].sort((a, b) =>
        b.score - a.score || a.enteredAtClue - b.enteredAtClue)[0];
      doomed = doomed.filter((p) => p.id !== survivor.id);
      entry.totalWipe = { survivorId: survivor.id };
    }

    const remaining = this.players.size - this.eliminationOrder.length - doomed.length;
    for (const p of doomed) {
      p.state = 'eliminated';
      p.eliminatedAtClue = this.cluesRevealed;
      p.placement = remaining + doomed.length - doomed.indexOf(p);
      this.eliminationOrder.push(p.id);
      entry.eliminated.push(p.id);
    }
    if (winnerId && this.players.get(winnerId)?.state === 'live') {
      this.players.get(winnerId).pins += doomed.length;
    }
  }

  admit(cause) {
    const next = this.queued()[0];
    if (!next) return null;
    next.state = 'live';
    next.score = Math.min(this.s.startScore, this.ceiling);
    next.enteredAtClue = this.cluesRevealed;
    this.log.push({ type: 'entry', playerId: next.id, draw: next.drawNumber, cause });
    return next;
  }

  // Spectator feedback: an eliminated or queued player's buzz ranked against
  // the live field only, never against other spectators.
  rankSpectatorBuzz(ms, liveBuzzTimes) {
    const faster = liveBuzzTimes.filter((t) => t < ms).length;
    return { ms, place: faster + 1, outOf: liveBuzzTimes.length + 1 };
  }
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
