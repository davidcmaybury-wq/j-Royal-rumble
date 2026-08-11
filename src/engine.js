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
  // --- advanced mechanics, all off unless the host turns them on ---
  topRope: false,            // double your stakes both ways for one clue
  targeting: false,          // aim your damage at one player, and theirs at you
  bounties: false,           // queued players pay to put a price on a head
  revival: false,            // one more life, at a fraction of the stake
  revivalLimit: 1,
  revivalFraction: 0.5,
  bountyMaxFraction: 0.5,    // most of their stake a queued player may stake
  // Two evenly matched players trade the same points back and forth forever.
  // Once the queue is empty and only a couple remain, the stakes climb until
  // one of them cracks.
  overtime: true,
  overtimeAt: 2,             // players left in the ring that starts it
  overtimeEvery: 6,          // clues between each escalation
  overtimeMax: 8,            // never beyond this multiple
  botReadJitter: 45,         // ms, shared per clue: the host activates by hand
  botMatchField: true,       // shift robots to sit alongside the humans present
  botOffset: 0,              // used when botMatchField is off
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
        originalDraw: i + 1,
        state: 'queued', score: 0, enteredAtClue: null,
        eliminatedAtClue: null, placement: null,
        pins: 0, correct: 0, missed: 0,
        topRope: false, target: null, revivals: 0, bountyPlaced: 0,
      });
    });
    this.drawOrder = order.map((p) => p.id);
    this.eliminationOrder = [];
    this.bounties = [];        // { placer, target, amount }
    this.overtimeFrom = null;  // clue number the escalation began at

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
      bounties: this.bounties,
      overtimeFrom: this.overtimeFrom,
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
    this.bounties = d.bounties || [];
    this.overtimeFrom = d.overtimeFrom ?? null;
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

  // ---- overtime -------------------------------------------------------

  // Multiplies every clue value once the field is down to the last few and
  // nobody else is coming. Doubling on a fixed cadence, capped.
  overtime() {
    if (!this.s.overtime || this.overtimeFrom == null) return null;
    const elapsed = this.cluesRevealed - this.overtimeFrom;
    const steps = Math.floor(elapsed / this.s.overtimeEvery);
    const mult = Math.min(this.s.overtimeMax, Math.pow(2, steps));
    return {
      multiplier: mult,
      since: this.overtimeFrom,
      cluesAtThisLevel: elapsed % this.s.overtimeEvery,
      nextIn: mult >= this.s.overtimeMax
        ? null : this.s.overtimeEvery - (elapsed % this.s.overtimeEvery),
    };
  }

  overtimeMultiplier() {
    const o = this.overtime();
    return o ? o.multiplier : 1;
  }

  // Called after a clue resolves: opens overtime, or notes an escalation.
  checkOvertime(entry) {
    if (!this.s.overtime) return;
    const ring = this.live().length;
    if (this.overtimeFrom == null) {
      if (ring <= this.s.overtimeAt && !this.queued().length && ring > 1) {
        this.overtimeFrom = this.cluesRevealed;
        entry.overtimeStarted = { multiplier: 1, at: this.cluesRevealed };
      }
      return;
    }
    if (ring <= 1) return;
    const before = entry.overtimeBefore ?? 1;
    const now = this.overtimeMultiplier();
    if (now > before) entry.overtimeRaised = { multiplier: now };
  }

  // ---- advanced mechanics ---------------------------------------------

  // Declared between clues, never after one is on the board — otherwise you
  // would only ever climb up when you already knew the answer.
  setTopRope(token, on) {
    if (!this.s.topRope) return false;
    const p = this.players.get(token);
    if (!p || p.state !== 'live') return false;
    p.topRope = !!on;
    return true;
  }

  setTarget(token, targetToken) {
    if (!this.s.targeting) return false;
    const p = this.players.get(token);
    if (!p || p.state !== 'live') return false;
    if (!targetToken) { p.target = null; return true; }
    const t = this.players.get(targetToken);
    if (!t || t.state !== 'live' || targetToken === token) return false;
    p.target = targetToken;
    return true;
  }

  // Paid out of a queued player's stake, so they walk in lighter. That cost is
  // what stops a bounty being a free shot.
  placeBounty(placerToken, targetToken, amount) {
    if (!this.s.bounties) return { error: 'bounties are off' };
    const placer = this.players.get(placerToken);
    const target = this.players.get(targetToken);
    if (!placer || placer.state !== 'queued') return { error: 'only queued players can place a bounty' };
    if (!target || target.state !== 'live') return { error: 'that player is not in the ring' };
    const cap = Math.floor(this.s.startScore * this.s.bountyMaxFraction);
    const amt = Math.max(1, Math.floor(amount));
    if (placer.bountyPlaced + amt > cap) {
      return { error: `you can stake at most ${cap} in total` };
    }
    placer.bountyPlaced += amt;
    this.bounties.push({ placer: placerToken, target: targetToken, amount: amt });
    return { ok: true, amount: amt, remaining: cap - placer.bountyPlaced };
  }

  bountiesOn(token) {
    return this.bounties.filter((b) => b.target === token);
  }

  bountyTotal(token) {
    return this.bountiesOn(token).reduce((n, b) => n + b.amount, 0);
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

    const otBefore = this.overtimeMultiplier();
    const value = ROW_VALUES[row - 1] * otBefore;
    clue.revealed = true;
    this.cluesRevealed += 1;

    const { winnerId = null, missedIds = [] } = outcome;
    const live = this.live();
    const liveIds = new Set(live.map((p) => p.id));
    const mult = (p) => (p.topRope ? 2 : 1);      // top rope doubles your own stakes, both ways
    const entry = {
      type: 'clue', n: this.cluesRevealed, category: cat.title, row, value,
      faceValue: ROW_VALUES[row - 1], overtimeBefore: otBefore,
      winnerId, missedIds: [...missedIds], ceiling: this.ceiling, eliminated: [],
      topRope: live.filter((p) => p.topRope).map((p) => p.id),
      targets: Object.fromEntries(live.filter((p) => p.target).map((p) => [p.id, p.target])),
    };

    for (const id of missedIds) {
      if (!liveIds.has(id)) continue;
      const p = this.players.get(id);
      p.score -= value * mult(p);
      p.missed += 1;
    }

    let ceilingFreeFor = null;

    if (winnerId && liveIds.has(winnerId)) {
      const w = this.players.get(winnerId);
      const opponents = live.filter((p) => p.id !== winnerId);
      const pot = value * opponents.length;

      // Who pays, and how much. Three cases, in order of precedence.
      const payers = new Map();
      const aimedAtWinner = opponents.filter((p) => p.target === winnerId);
      if (aimedAtWinner.length) {
        // They went for the winner and missed. Each pays the whole pot; the
        // players who stayed out of it pay nothing.
        for (const p of aimedAtWinner) payers.set(p.id, pot);
        entry.backfired = aimedAtWinner.map((p) => p.id);
      } else if (w.target && liveIds.has(w.target)) {
        // The winner aimed. All the damage lands on one head.
        payers.set(w.target, pot);
        entry.focused = w.target;
      } else {
        for (const p of opponents) payers.set(p.id, value);
      }

      let collected = 0;
      for (const [id, amount] of payers) {
        const p = this.players.get(id);
        const paid = amount * mult(p);
        p.score -= paid;
        collected += amount;          // the payer's own multiplier is their problem
      }
      // Flat scoring pays the clue value regardless of how many opponents
      // contributed. Keeping this path is what lets the harness show why the
      // pot rule exists at all.
      const gain = (this.s.potScoring ? collected : value) * mult(w);
      w.score += gain;
      w.correct += 1;
      entry.gain = gain;
      if (w.topRope) ceilingFreeFor = w.id;   // the point of the risk is the reward
    } else if (this.s.stumperFraction > 0) {
      const d = Math.round(value * this.s.stumperFraction);
      for (const p of live) p.score -= d * mult(p);
      entry.stumperDeduction = d;
    }

    // A declaration lasts exactly one clue, however it resolves.
    for (const p of live) p.topRope = false;

    // Ceiling clips every live score, not just the answerer's — except the
    // player who went to the top rope, whose whole reason for going was to
    // reach past it.
    const cap = this.ceiling;
    for (const p of this.live()) {
      if (p.id === ceilingFreeFor) continue;
      if (p.score > cap) p.score = cap;
    }

    this.applyEliminations(entry, winnerId);
    this.checkOvertime(entry);

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
        // Nobody collected. The money spent trying to remove them is theirs.
        if (this.s.bounties) {
          const left = this.bountyTotal(w.id);
          if (left) {
            w.score += left;
            entry.bountyAbsorbed = { by: w.id, amount: left };
            this.bounties = this.bounties.filter((b) => b.target !== w.id);
          }
        }
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

    const winner = winnerId ? this.players.get(winnerId) : null;

    for (const p of doomed) {
      p.state = 'eliminated';
      p.eliminatedAtClue = this.cluesRevealed;
      this.eliminationOrder.push(p.id);
      entry.eliminated.push(p.id);

      // --- bounties on the player going out ---
      if (this.s.bounties) {
        const on = this.bountiesOn(p.id);
        if (on.length && winner && winner.state === 'live') {
          const paid = on.reduce((n, b) => n + b.amount, 0);
          winner.score += paid;
          entry.bountyCollected = (entry.bountyCollected || [])
            .concat([{ by: winner.id, on: p.id, amount: paid }]);
        }
        this.bounties = this.bounties.filter((b) => b.target !== p.id);
      }

      // --- a bounty placer going out at the hands of the head they bought ---
      // The target keeps the money that was spent trying to remove them.
      if (this.s.bounties && winner && winner.state === 'live') {
        const theirs = this.bounties.filter(
          (b) => b.placer === p.id && b.target === winner.id);
        if (theirs.length) {
          const paid = theirs.reduce((n, b) => n + b.amount, 0);
          winner.score += paid;
          this.bounties = this.bounties.filter(
            (b) => !(b.placer === p.id && b.target === winner.id));
          entry.bountyTurned = (entry.bountyTurned || [])
            .concat([{ to: winner.id, from: p.id, amount: paid }]);
        }
      }

      // --- revival ---
      if (this.s.revival && p.revivals < this.s.revivalLimit && this.queued().length + 1 > 0) {
        p.revivals += 1;
        p.state = 'queued';
        p.eliminatedAtClue = null;
        p.enteredAtClue = null;
        p.target = null;
        p.topRope = false;
        this.eliminationOrder = this.eliminationOrder.filter((id) => id !== p.id);
        this.drawOrder = this.drawOrder.filter((id) => id !== p.id).concat([p.id]);
        // A fresh number for the queue, but the number they actually drew is
        // what the standings and every fairness measurement should use.
        p.drawNumber = this.players.size + this.revivedCount();
        entry.revived = (entry.revived || []).concat([p.id]);
      }
    }

    // Anyone aiming at a player who has just gone loses their aim.
    const gone = new Set(doomed.filter((p) => p.state !== 'queued').map((p) => p.id));
    for (const p of this.players.values()) {
      if (p.target && gone.has(p.target)) p.target = null;
    }

    if (winner && winner.state === 'live' && doomed.length) winner.pins += doomed.length;
  }

  revivedCount() {
    return [...this.players.values()].reduce((n, p) => n + p.revivals, 0);
  }

  admit(cause) {
    const next = this.queued()[0];
    if (!next) return null;
    next.state = 'live';
    const stake = next.revivals > 0
      ? Math.round(this.s.startScore * this.s.revivalFraction)
      : this.s.startScore;
    next.score = Math.min(stake - next.bountyPlaced, this.ceiling);
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
