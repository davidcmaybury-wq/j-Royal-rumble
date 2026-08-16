// Jeopardy Royal Rumble — headless rules engine.
// No DOM, no network, no framework. Deterministic given a seeded rng.
// The host supplies buzzer outcomes; the engine owns all scoring and state.

export const ROW_VALUES = [100, 200, 300, 400, 500];
export const BOARD_CATEGORIES = 6;

export const DEFAULT_SETTINGS = {
  startScore: 3000,
  ceiling: null,             // null => scaled to the field, see autoCeiling
  ceilingDecayPerClue: null,  // null => auto: decay to the floor over the match
  ceilingFloor: null,         // null => auto: the starting score
  entryInterval: null,       // null => auto from roster + targetMinutes
  entrantsOnFieldClear: 2,
  stumperFraction: 0.5,      // 0 disables the universal-stumper deduction
  potScoring: true,          // winner collects the value from EACH opponent
  secondsPerClue: 17.5,
  targetMinutes: 30,
  recordMatch: true,          // always on; kept so old saved settings still load        // keep a detailed log of the match
  // --- advanced mechanics, all off unless the host turns them on ---
  // --- advanced mechanics, all off unless the host turns them on -----------
  topRope: false,            // double your stakes both ways for one clue
  // Clues you must wait before climbing again. Without one, a player who
  // decides doubling is worth it simply declares every single clue, and the
  // mechanic stops being a decision — it becomes a permanent stake setting that
  // the rest of the ring has to play against.
  topRopeCooldown: 5,
  // Buying an eliminated player back in. Advanced: it undoes an elimination,
  // which is a bigger change to how a match reads than a scoring tweak, and it
  // leans on a keyboard control.
  savePlayer: false,
  // Teams. Off by default: it changes who pays whom, which is the deepest
  // change any of these mechanics makes.
  stables: false,
  // The largest share of the ring one stable may hold.
  //
  // Without a cap everybody joins the first one founded: simulated at twenty
  // players the biggest stable reached fifteen, the ring dissolved five to
  // thirteen times a match, and the draw spread went from 1.12 to 0.69 because
  // late entrants walked in as the only outsider and paid everybody. Half the
  // ring keeps it a faction rather than a consensus.
  stableMaxFraction: 0.5,
  // Load the teammates' share onto the outsiders rather than letting the pot
  // shrink. Measured below; see README.
  stableFocus: true,
  // How a stable member's winnings are divided.
  //
  //   'winner'   the winner keeps the lot. A stable is a non-aggression pact
  //              and nothing more; members still race each other flat out.
  //   'even'     the whole pot split across the stable. The stable behaves as
  //              one entity, and a strong member is heavily taxed by it.
  //   'surplus'  the winner banks the clue's face value, and only what the
  //              stable's protection added on top is shared. A middle course:
  //              you always earn your own clue, you share the windfall.
  stableShare: 'even',
  // What a traitor walks away with. The rest is split among the people they
  // leave behind. Capped at the stack, never a top-up: without that, somebody
  // poor would betray to get richer, which is not betrayal, it is a wage.
  //
  // A flat amount is worth measuring before setting. As a share of the stack it
  // is nearly nothing to a leader and everything to a straggler:
  //
  //   stack    keep 0   keep 500   keep 1000
  //     500     100%        0%         0%      free
  //    1000     100%       50%         0%      free
  //    3000     100%       83%        67%      still ruinous
  //    8000     100%       94%        88%      still ruinous
  //
  // So a flat keep is an escape hatch for whoever is losing rather than an
  // option for whoever is winning — the opposite of the interesting betrayal,
  // which is the leader walking out. A share of the stack scales properly if
  // that is the behaviour wanted.
  betrayalKeep: 0,
  // The same toll as a share of the stack, which is the version that scales:
  // a flat amount is free to a straggler and irrelevant to a leader. Takes
  // precedence over betrayalKeep when set.
  // Half. Enough of a toll that walking out is a real cost, not enough to make
  // it unthinkable — measured, a defector at 50% wins 16.9% against 25.1% for
  // staying put, so it is a bad move for an ordinary player and a live question
  // for anybody who thinks they are better than the room.
  betrayalKeepFraction: 0.5,
  // On by default. It is the only tool a room has for dealing with somebody
  // who is running away with it — and unlike stables, which turned out to do
  // nothing against a strong player, this one actually bites: it puts the whole
  // pot on one head.
  targeting: true,           // aim your damage at one player, and theirs at you

  // One foot on the floor.
  //
  // Somebody knocked out before they ever got going comes straight back with
  // half a stake and a temporary edge on the buzzer. Standard, because without
  // it the bottom of a mixed field is scenery: measured against one strong
  // player and two more, a casual's chance of winning the match is 0.1%. With
  // this it is 7.3%, and the strongest player drops from 80.6% to 57.5%.
  //
  // The gate is the whole design. Ungated, the same mechanic is a subsidy for
  // the sharks — they use their free life too, and the casual's chance only
  // reaches 1.9%. "Fewer than three clues taken" is a workable definition of
  // never having got going, and it is close to sandbag-proof: staying under it
  // means not scoring.
  comeback: true,
  comebackGate: 3,           // clues taken, below which you qualify
  comebackStake: 0.5,        // share of the starting stake you return with
  // How much of your buzz time the edge takes off. Was 0.7 when the mechanic
  // was first measured; David set it to 0.5 before it ever shipped, on the
  // grounds that 70% was more help than the moment called for. Every figure
  // quoted for this mechanic was measured at 0.7 and is therefore an upper
  // bound on what 0.5 does — `npm run comeback-study` re-measures it.
  comebackBoost: 0.5,
  comebackRaces: 40,         // races the edge lasts
  bounties: false,           // queued players pay to put a price on a head
  revival: false,            // one more life, at a fraction of the stake
  revivalLimit: 1,
  revivalFraction: 0.5,
  // Multiply a new entrant's stake by the overtime level they walk into.
  scaleEntryStake: true,
  bountyMaxFraction: 0.5,    // most of their stake a queued player may stake
  // Two evenly matched players trade the same points back and forth forever.
  // Once the queue is empty and only a couple remain, the stakes climb until
  // one of them cracks.
  overtime: true,
  // Once nobody else is coming, the stakes start climbing — whatever the ring
  // size. It used to wait for heads-up, and a robot test ran 30 clues with
  // three players trading the same points because it never fired.
  overtimeAt: null,          // ring size that starts it; null means any
  overtimeEvery: 6,          // clues between each escalation
  overtimeMax: 8,
  // The ceiling falls during overtime, and only then.
  //
  // Taking the decay out of the main match was right — it was handing the game
  // to late draws — but it also removed the only guaranteed drain, and a
  // symmetric exchange with nothing leaking never resolves. Raising the stakes
  // does not help: doubling both sides of an even trade leaves it even. A
  // field of evenly matched robots ran 400 clues without an elimination.
  //
  // Confining it to overtime gives the endgame teeth without touching the entry
  // phase, which is where the draw bias came from.
  overtimeCeilingDrop: 120,
  // When the lights run out and nobody has taken the clue, close the race and
  // let the host call it. Off means the buzzers stay open until they press X,
  // which is what they used to do.
  // Who is coming next is hidden from the room until they walk in. The
  // countdown stays visible — knowing *when* somebody arrives is tactical — it
  // is only the name that goes, so the horn means something again.
  anonymousNext: true,

  // Paying for survival rather than taking from leaders. Early draws spend the
  // whole match being ground down by pot scoring; this pays them for the thing
  // they actually do more of. Measured across 3,000 simulated matches per
  // field size, every 10 clues at +500 brings the draw spread from 1.31x /
  // 1.40x / 1.14x (10 / 20 / 30 players) to 1.05x / 1.07x / 0.97x. +1000
  // overshoots and hands the advantage to early draws instead.
  //
  // It self-limits: a leader near the ceiling gets nothing from it, so it helps
  // whoever is grinding rather than whoever is already winning.
  longevity: true,
  longevityEvery: 10,
  longevityBonus: 500,

  // Taking every clue in a column. Rewards a run rather than a single lucky
  // buzz, and gives the board a reason to be watched rather than read.
  categorySweep: true,
  sweepBonus: 500,

  // A player waiting in the queue can hand part of their entry to somebody
  // already in the ring.
  giftFromQueue: true,
  // When the lights run out and nobody has taken the clue, close the race and
  // let the host call it. Off means the buzzers stay open until they press X.
  autoStumper: true,
  lecternSeconds: 5,         // how long the lights run
  botReadJitter: 45,         // ms, shared per clue: the host activates by hand
  botMatchField: true,       // shift robots to sit alongside the humans present
  botOffset: null,           // ms; null means use the built-in default, then
                             // calibrate to the field once enough buzzes land
  delay: 200,                // ms held back so buzzers arm with Zoom audio
  lockout: 250,              // ms penalty for buzzing before the lights
  seasonRange: null,         // [lo, hi] archive seasons; null = all
};

// The ceiling that makes a given field size even.
//
// This turned out to be a stronger fairness lever than the entry interval, and
// it had been confounding every earlier measurement — the ceiling was jumping
// from 7,500 to 11,000 at 25 players, which made a 24-player field look far
// less fair than a 30-player one. It was the ceiling, not the field size.
//
// A ceiling that is too low favours late draws, because it clips the leaders an
// early entrant has worked to become. Too high and it never binds, so early
// accumulation runs away. Measured at 2,500 matches per point:
//
//   field   fair ceiling   spread
//     6         6,000       0.96
//    10         7,500       0.99
//    16         7,500       1.02
//    20         9,000       0.96
//    24        10,500       0.98
//    30        10,500       1.01
export function autoCeiling(playerCount) {
  // Small fields were tightest of all, which was backwards.
  //
  // At six players the cap was twice the starting stake, so a leader only had
  // to double up to hit it — and then every further correct answer gained them
  // nothing. A real 53-clue match had the winner pinned for 20 of them and the
  // ceiling swallowed 11,930 points. Measured over 2,000 six-player matches:
  //
  //   ceiling   clues pinned   points swallowed
  //     6,000        22%             5,361
  //     9,000        11%             2,884
  //    10,500         8%             2,061
  //    12,000         6%             1,440
  //
  // 10,500 is the knee: the cap still binds when somebody runs away, and stops
  // being the thing the match is about.
  //
  // The ladder is deliberately not monotonic. A small field needs the MOST
  // headroom, not the least: a lone strong player there faces the fewest
  // opponents per clue, so they climb slowly, and the match runs long enough
  // for that slow climb to hit the cap and stay there. The old ladder had it
  // exactly backwards.
  if (playerCount <= 8) return 10500;
  if (playerCount <= 20) return 9000;
  return 10500;
}

// Measured draw fairness, rather than a formula.
//
// Several plausible formulas were tried — the share of the match left after the
// field fills, clues after the fill, clues per player — and the best correlated
// at only r = 0.71. A rule that confident-sounding and that wrong is worse than
// a lookup, so this is the measurement itself: 3,000 simulated matches for each
// pair, with players of mixed ability and the ceiling scaled to the field.
//
// Measuring this the first time with a fixed ceiling gave badly wrong answers —
// it made twenty players look unfair at every interval past 3, when in fact
// they are fine out to 8. The ceiling was the variable doing the work.
//
// Each row is [entry interval, draw spread, minutes, skill percent]. Spread is
// the last third of the draw against the first; 1.00 is even, higher favours
// late numbers. Skill is how often one of the three strongest players wins.
const FAIRNESS = {"6":[[1,0.93,8,74],[2,0.9,8,75],[3,0.89,9,73],[4,1,11,76],[5,1.02,11,77],[6,0.96,12,77],[8,0.98,14,76],[10,0.94,15,78],[12,0.98,17,78],[15,1.03,20,77]],"8":[[1,1.02,9,63],[2,1.02,10,66],[3,0.93,12,66],[4,0.98,13,65],[5,1.07,15,66],[6,1.03,16,66],[8,1.02,19,67],[10,1.06,22,68],[12,1.06,24,69],[15,1.27,28,69]],"10":[[1,0.94,11,56],[2,0.91,13,58],[3,1.02,15,61],[4,1,17,59],[5,0.98,19,61],[6,0.96,21,63],[8,0.98,25,62],[10,0.92,28,63],[12,1.18,32,63],[15,1.47,38,62]],"12":[[1,0.93,12,52],[2,0.98,15,54],[3,0.98,18,54],[4,0.98,20,56],[5,1,22,55],[6,1.01,25,56],[8,1,29,57],[10,1.07,34,58],[12,1.23,39,58],[15,1.69,46,56]],"16":[[1,1.03,15,45],[2,1.09,18,46],[3,0.98,22,45],[4,1.05,25,48],[5,1.02,29,49],[6,1.11,32,48],[8,1.13,39,51],[10,1.34,46,49],[12,2.05,54,48],[15,3.4,63,48]],"20":[[1,1.01,18,38],[2,0.99,22,40],[3,1.02,27,41],[4,0.97,31,43],[5,0.96,36,44],[6,1.05,40,44],[8,1.07,50,46],[10,1.38,59,46],[12,1.87,69,43],[15,3.75,71,38]],"24":[[1,1,20,37],[2,0.92,26,38],[3,0.94,31,39],[4,0.96,37,41],[5,0.95,43,41],[6,0.94,48,42],[8,1.02,60,43],[10,1.29,72,42],[12,1.99,83,39],[15,3.97,71,33]],"30":[[1,0.95,23,32],[2,0.93,30,32],[3,1.03,37,33],[4,1.02,44,35],[5,1.11,52,36],[6,1.06,60,36],[8,1.14,74,38],[10,1.63,90,38],[12,2.38,104,34]]};

const SPREAD_OK = 1.15;      // beyond this the draw is doing real work
const SHORT_MINUTES = 15;    // below this the strongest players stop showing

/** Interpolate the grid for any field size and interval. */
export function predictMatch(playerCount, interval) {
  if (!interval || playerCount < 4) return null;
  const sizes = Object.keys(FAIRNESS).map(Number).sort((a, b) => a - b);
  const pick = (n) => {
    const row = FAIRNESS[n];
    if (!row) return null;
    let best = row[0];
    for (const r of row) {
      if (Math.abs(r[0] - interval) < Math.abs(best[0] - interval)) best = r;
    }
    return best;
  };
  const lo = [...sizes].reverse().find((n) => n <= playerCount) ?? sizes[0];
  const hi = sizes.find((n) => n >= playerCount) ?? sizes[sizes.length - 1];
  const a = pick(lo), b = pick(hi);
  if (!a || !b) return null;
  const t = hi === lo ? 0 : (playerCount - lo) / (hi - lo);
  return {
    spread: a[1] + (b[1] - a[1]) * t,
    minutes: Math.round(a[2] + (b[2] - a[2]) * t),
    skill: Math.round(a[3] + (b[3] - a[3]) * t),
  };
}

/**
 * The interval to recommend: the longest match the fairness budget allows.
 * Length buys skill and unfairness is what it costs, so spend right up to the
 * limit and no further.
 */
export function bestInterval(playerCount) {
  const sizes = Object.keys(FAIRNESS).map(Number).sort((a, b) => a - b);
  const n = sizes.reduce((best, x) =>
    Math.abs(x - playerCount) < Math.abs(best - playerCount) ? x : best, sizes[0]);
  const row = FAIRNESS[n] || [];
  const fair = row.filter((r) => r[1] <= SPREAD_OK && r[2] >= SHORT_MINUTES);
  if (fair.length) return fair[fair.length - 1][0];
  const any = row.filter((r) => r[1] <= SPREAD_OK);
  return any.length ? any[any.length - 1][0] : 2;
}

// How much of a match should still be left once everybody is in.
//
// Draw fairness follows this and almost nothing else. Measured across 4,000
// matches per configuration:
//
//   share of the match after the field fills    last third vs first third
//     over 40%                                       0.90 - 1.09x
//     25 - 35%                                       1.04 - 1.31x
//     12 - 20%                                       1.21 - 2.29x
//     under 10%                                      2.29 - 5.27x
//
// At sixteen players entering every sixteen clues the last entrant arrives with
// 6% of the match left, walks into an exhausted field, and wins 4.3 times their
// share. Keeping a third of the match in reserve holds the spread near 1.00.
export const MIN_TAIL_FRACTION = 0.35;

/**
 * Longer matches are less fair, not more, so this caps the interval rather than
 * simply dividing the target by the field.
 *
 * Skill pulls the other way — a short match is even but random, because the
 * strongest player never gets the clues to prove it. Most of that gain arrives
 * by twenty-odd minutes and then flattens, while fairness keeps degrading, so
 * the honest answer is a window rather than a number.
 */
export function autoEntryInterval(playerCount, targetMinutes, secondsPerClue) {
  if (playerCount <= 3) return 1;
  const targetClues = (targetMinutes * 60) / secondsPerClue;
  const entrants = playerCount - 3;

  // What the host asked for, and what fairness will allow.
  const wanted = Math.round((targetClues * 0.6) / entrants);
  const fair = Math.floor((targetClues * (1 - MIN_TAIL_FRACTION)) / entrants);

  return Math.min(15, Math.max(2, Math.min(wanted, fair)));
}

/**
 * What the host is about to get, so the setup screen can say so. Returns null
 * when the settings sit inside the measured window.
 *
 * It never refuses anything. A host who wants a two-hour thirty-player match
 * can have one; they should just know late draws will run away with it.
 */
export function fairnessWarning(playerCount, interval) {
  if (playerCount < 4 || !interval) return null;
  const p = predictMatch(playerCount, interval);
  if (!p) return null;
  const best = bestInterval(playerCount);

  if (p.spread > SPREAD_OK) {
    return {
      kind: 'late-draws',
      spread: p.spread,
      suggest: best,
      minutes: p.minutes,
      text: `At every ${interval} clues the last players in walk into a worn-down `
        + `field: late draws win about ${p.spread.toFixed(1)} times as often as `
        + `early ones. Every ${best} keeps it near even.`,
    };
  }
  if (p.minutes < SHORT_MINUTES && playerCount >= 10) {
    return {
      kind: 'too-short',
      suggest: best,
      minutes: p.minutes,
      text: `About ${p.minutes} minutes is even on the draw but short on skill — `
        + `the strongest players win noticeably less often below ${SHORT_MINUTES} `
        + `minutes. Every ${best} gives the result more to stand on.`,
    };
  }
  return null;
}


export function expectedClues(playerCount, interval) {
  const entry = Math.max(0, playerCount - 3) * interval;
  return Math.round(entry + Math.max(22, entry * 0.67));
}

// A ceiling that decays from its opening value down to the floor across the
// expected length of the match. Set by hand if you want it steeper.
// Zero, for now.
//
// The falling ceiling was invented to force a resolution, back when nothing
// else did — without it a 30-player match ran to 112 minutes. Overtime does
// that job properly now, and does it by raising the stakes rather than by
// confiscating a leader's winnings.
//
// Leaving both in place turned out to cost a great deal. The ceiling clips
// whoever is ahead, and whoever is ahead is nearly always an early entrant who
// has been accumulating; a latecomer arrives at a fixed stake untouched. So the
// decay was quietly handing the match to late draws. Across 3,000 simulated
// 20-player matches the last third of the draw was worth 2.16x the first third
// at -40, 1.85x at -25, and 1.40x at zero. Zero also rewards skill slightly
// better and nothing stalls — 9,000 matches, every one resolved, median length
// up by about two minutes.
//
// Kept as a function rather than a constant because the reasoning above depends
// on overtime being on. If a host turns overtime off, a falling ceiling is the
// only thing left that ends the match.
export function autoCeilingDecay(ceiling, floor, playerCount, interval, settings = {}) {
  if (settings.overtime !== false) return 0;
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

/**
 * The stables, in the order they are handed out.
 *
 * Gemstones because they give a name and a colour in one, and six is the most
 * a room can tell apart at a glance — beyond that the highlights stop meaning
 * anything. Diamond leads because white reads on every screen.
 */
export const STABLE_NAMES = [
  { name: 'Diamond', colour: '#EDF1F7' },
  { name: 'Ruby', colour: '#E24A3C' },
  { name: 'Emerald', colour: '#3FA98C' },
  { name: 'Sapphire', colour: '#4F7FD1' },
  // Onyx is black, but black on a near-black interface is nothing at all, so
  // it is the lightest grey that still reads as black.
  { name: 'Onyx', colour: '#8A93A6' },
  { name: 'Topaz', colour: '#D6A93F' },
];

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

    // Remembered so a latecomer can trigger a recalculation. Without it we
    // could not tell a host-chosen interval from one we worked out ourselves.
    if (this.s.ceiling == null) this.s.ceiling = autoCeiling(players.length);
    this.autoInterval = this.s.entryInterval == null;
    if (this.autoInterval) {
      this.s.entryInterval = autoEntryInterval(
        players.length, this.s.targetMinutes, this.s.secondsPerClue);
    }
    // The floor can never be below the entry stake, so that is also its default.
    if (this.s.ceilingFloor == null) this.s.ceilingFloor = this.s.startScore;
    if (this.s.ceilingDecayPerClue == null) {
      this.s.ceilingDecayPerClue = autoCeilingDecay(
        this.s.ceiling, this.s.ceilingFloor, players.length, this.s.entryInterval, this.s);
    }

    this.players = new Map();
    const order = drawOrderFor(players, this.rng);
    order.forEach((p, i) => {
      this.players.set(p.id, {
        id: p.id, name: p.name, drawNumber: i + 1,
        originalDraw: i + 1,
        state: 'queued', score: 0, enteredAtClue: null,
        eliminatedAtClue: null, placement: null,
        pins: 0, correct: 0, missed: 0,
        topRope: false, topRopeAt: null, target: null,
        stable: null,              // stable id, or null for going stag
        comebackUsed: false,       // one to a customer
        comebackUntil: null,       // race number the edge lasts through
        bankedLastClue: false,
        revivals: 0, bountyPlaced: 0,
      });
    });
    this.drawOrder = order.map((p) => p.id);
    this.eliminationOrder = [];
    this.stables = new Map();      // id -> { id, name, foundedBy }
    this.sweepTaken = new Map();   // category slot -> Map(playerId -> count)
    this.pendingSaves = [];        // { by, target, amount } declared, not yet paid
    this.bounties = [];        // { placer, target, amount }
    this.overtimeFrom = null;  // clue number the escalation began at
    this.stalledClues = 0;     // clues since anyone was eliminated
    this.overtimeSteps = 0;    // doublings reached; a ratchet, never falls
    this.racesRun = 0;         // contested clues, for timing the comeback edge

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
      stalledClues: this.stalledClues,
      overtimeSteps: this.overtimeSteps,
      racesRun: this.racesRun,
      stables: [...this.stables.values()].map((st) => ({ ...st })),
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
    this.stalledClues = d.stalledClues ?? 0;
    this.overtimeSteps = d.overtimeSteps ?? 0;
    this.racesRun = d.racesRun ?? 0;
    if (d.stables) this.stables = new Map(d.stables.map((st) => [st.id, { ...st }]));
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
  // The escalation clock counts clues where nobody went out.
  //
  // Starting it the moment the queue empties, and letting it run regardless,
  // made large fields a lottery — a 30-player match saw the stakes doubling
  // with fourteen still in the ring, and the strongest players' win rate fell
  // from 42% to 34%. But a stall is precisely a run of clues with nobody
  // eliminated, so that is what the clock should measure. While the field is
  // thinning on its own, the stakes hold.
  // The multiplier is a ratchet. An elimination stops the stakes climbing —
  // the field is thinning on its own again — but it does not put them back.
  // Deriving the level from the stall clock alone meant a single elimination
  // dropped the values from four times face to one, which reads as the game
  // forgetting what had just happened.
  overtime() {
    if (!this.s.overtime || this.overtimeFrom == null) return null;
    const mult = Math.min(this.s.overtimeMax, Math.pow(2, this.overtimeSteps));
    const at = this.stalledClues % this.s.overtimeEvery;
    return {
      multiplier: mult,
      since: this.overtimeFrom,
      cluesAtThisLevel: at,
      stalledClues: this.stalledClues,
      nextIn: mult >= this.s.overtimeMax ? null : this.s.overtimeEvery - at,
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
    // Any elimination is progress, so the clock toward the *next* raise goes
    // back to zero. The level already reached stays where it is.
    //
    // The clock runs whether or not overtime has opened, because it is also
    // what detects a match that has stalled with people still queued — a slow
    // entry interval means the queue may never empty, and waiting for that
    // before doing anything let a field of evenly matched robots run 400 clues
    // without an elimination.
    if ((entry.eliminated || []).length) {
      this.stalledClues = 0;
    } else if (ring > 1) {
      this.stalledClues += 1;
    }
    if (this.overtimeFrom != null && ring > 1) {
      if (this.stalledClues >= this.s.overtimeEvery
          && Math.pow(2, this.overtimeSteps + 1) <= this.s.overtimeMax) {
        this.overtimeSteps += 1;
        this.stalledClues = 0;
        entry.overtimeRaised = { multiplier: Math.pow(2, this.overtimeSteps) };
      }
    }
    if (this.overtimeFrom == null) {
      const cap = this.s.overtimeAt;
      // Normally when the queue empties. A very long stall opens it anyway —
      // eight escalation windows, about 48 clues, with nobody eliminated means
      // the match is not resolving on its own whoever is still queued.
      //
      // The threshold has to be that high. At three windows it fired during the
      // entry phase and did real damage: matches fell from 27 to 15 minutes,
      // back-half win rate went from 51% to 74%, and fields started getting
      // wiped. Eighteen clues without an elimination is normal early on. Forty
      // eight is not.
      const stalled = this.stalledClues >= this.s.overtimeEvery * 8;
      if ((!this.queued().length || stalled) && ring > 1 && (cap == null || ring <= cap)) {
        this.overtimeFrom = this.cluesRevealed;
        entry.overtimeStarted = { multiplier: 1, at: this.cluesRevealed };
      }
      return;
    }
  }

  // ---- advanced mechanics ---------------------------------------------

  // Declared between clues, never after one is on the board — otherwise you
  // would only ever climb up when you already knew the answer.
  setTopRope(token, on) {
    if (!this.s.topRope) return false;
    const p = this.players.get(token);
    if (!p || p.state !== 'live') return false;
    // Climbing down is always allowed; climbing up has to wait its turn.
    if (on && this.topRopeWait(token) > 0) return false;
    p.topRope = !!on;
    if (on) p.topRopeAt = this.cluesRevealed;
    return true;
  }

  /** Clues left before this player may climb again. Zero means now. */
  topRopeWait(token) {
    const p = this.players.get(token);
    if (!p || p.topRopeAt == null) return 0;
    const since = this.cluesRevealed - p.topRopeAt;
    return Math.max(0, this.s.topRopeCooldown - since);
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
    let c = this.s.ceiling + this.s.ceilingDecayPerClue * this.cluesRevealed;

    // Once overtime has opened, the roof comes down. That is the drain that
    // makes the endgame resolve — without it a symmetric exchange never ends.
    if (this.overtimeFrom != null && this.s.overtimeCeilingDrop > 0) {
      c -= this.s.overtimeCeilingDrop * (this.cluesRevealed - this.overtimeFrom);
    }
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

  // When does *this* player come in — not when does the next person come in.
  // Everyone in the queue was being shown the same countdown, so the sixth
  // draw watched a "2 clues" timer that belonged to the fourth.
  cluesUntilEntryFor(token) {
    const q = this.queued();
    if (!q.length) return null;
    const place = q.findIndex((p) => p.id === token);
    if (place < 0) return null;
    const next = this.cluesUntilNextEntry();
    if (next == null) return null;
    return next + place * this.s.entryInterval;
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
      // Who is on the other side of the exchange.
      //
      // In a stable, the damage you do lands only on people outside it — your
      // people pay nothing. That is the whole point of joining one, and it is
      // also the whole cost: a big stable takes from very few.
      // Everyone who could pay, and everyone who actually does.
      //
      // A stable's members do not pay each other. Under `stableFocus` the pot
      // stays the size it would have been — the damage the teammates would have
      // taken is loaded onto the outsiders instead, so the bigger the stable
      // the harder each outsider is hit. Without it the pot simply shrinks,
      // which protected the stable but did nothing to anybody else.
      const everyone = live.filter((p) => p.id !== winnerId);
      const opponents = everyone.filter((p) => !this.allied(p, w));
      const pot = value * ((this.s.stables && this.s.stableFocus)
        ? everyone.length : opponents.length);

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
      } else if (opponents.length) {
        // Split evenly across whoever is left outside the stable.
        const each = Math.round(pot / opponents.length);
        for (const p of opponents) payers.set(p.id, each);
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
      const mates = (this.s.stables && w.stable)
        ? this.live().filter((p) => p.stable === w.stable) : [w];
      const mode = this.s.stables && w.stable && mates.length > 1
        ? this.s.stableShare : 'winner';

      if (mode === 'even') {
        // The stable acts as one. A strong member is taxed hard by it, which is
        // the point: protection is bought with earnings.
        const each = Math.round(gain / mates.length);
        for (const p of mates) p.score += each;
        entry.shared = { stable: w.stable, each, mode };
      } else if (mode === 'surplus') {
        // You always earn your own clue; only what the stable's protection
        // added on top is shared out.
        const own = Math.min(gain, value * mult(w));
        const extra = Math.max(0, gain - own);
        const each = Math.round(extra / mates.length);
        w.score += own;
        for (const p of mates) p.score += each;
        entry.shared = { stable: w.stable, own, each, mode };
      } else {
        w.score += gain;
      }
      w.correct += 1;
      entry.gain = gain;
      if (w.topRope) ceilingFreeFor = w.id;   // the point of the risk is the reward
      // During overtime the winner keeps the whole raised amount for this clue.
      //
      // Clipping it on the spot was the thing that made escalation look broken:
      // a clue worth 2,000 paid the winner 500 while charging the loser the
      // full 2,000, so the stakes only ever went one way and it was invisible.
      // They are clipped on the next clue instead, so the falling roof takes it
      // back unless they keep winning.
      //
      // "Unless they keep winning" turned out to be the whole game. In a
      // two-handed overtime the stronger player wins most clues, was exempted
      // every time, and never met the ceiling at all — one live match ended
      // with 12,520 against a ceiling of 4,560. So the exemption cannot run two
      // clues in a row: bank it once, then face the roof whatever happens next.
      if (otBefore > 1 && !w.bankedLastClue) ceilingFreeFor = w.id;
    } else if (this.s.stumperFraction > 0) {
      const d = Math.round(value * this.s.stumperFraction);
      for (const p of live) p.score -= d * mult(p);
      entry.stumperDeduction = d;
    }

    // --- taking every clue in a column ---------------------------------
    //
    // Counted as the column is worked through rather than checked at the end,
    // so a board refresh cannot rob somebody of a run they already completed.
    const taker = winnerId && liveIds.has(winnerId) ? this.players.get(winnerId) : null;
    if (this.s.categorySweep && taker) {
      const key = cat.id || String(slotIndex);
      const tally = this.sweepTaken.get(key) || new Map();
      tally.set(taker.id, (tally.get(taker.id) || 0) + 1);
      this.sweepTaken.set(key, tally);
      if (tally.get(taker.id) === cat.clues.length) {
        const bonus = this.s.sweepBonus * otBefore;
        taker.score += bonus;
        // The slot, not just the title: the category is replaced later in this
        // same resolve, so by the time anybody draws the celebration the name
        // on screen is the new one and a lookup by title finds nothing.
        entry.sweep = { playerId: taker.id, category: cat.title, bonus, slot: slotIndex };
      }
    }

    // --- paid for still being here ---------------------------------------
    if (this.s.longevity && this.s.longevityBonus > 0) {
      const paid = [];
      for (const p of live) {
        const tenure = this.cluesRevealed - (p.enteredAtClue ?? 0);
        if (tenure > 0 && tenure % this.s.longevityEvery === 0) {
          p.score += this.s.longevityBonus;
          paid.push({ playerId: p.id, amount: this.s.longevityBonus, tenure });
        }
      }
      if (paid.length) entry.longevity = paid;
    }

    // A declaration lasts exactly one clue, however it resolves.
    for (const p of live) p.topRope = false;

    // Ceiling clips every live score, not just the answerer's — except the
    // player who went to the top rope, whose whole reason for going was to
    // reach past it.
    const cap = this.ceiling;
    for (const p of this.live()) {
      // Remember who banked above the cap, so the exemption cannot repeat.
      p.bankedLastClue = p.id === ceilingFreeFor && p.score > cap;
      if (p.id === ceilingFreeFor) continue;
      if (p.score > cap) p.score = cap;
    }

    // If the last people standing are all in one stable, nobody can take
    // anything from anybody and the match cannot end. The stable has won; it
    // dissolves and they settle it between themselves.
    const won = this.stableHasWon();
    if (won) {
      entry.stableWon = { id: won, name: this.stables.get(won)?.name || 'The stable',
        members: this.live().map((p) => p.id) };
      for (const p of this.live()) p.stable = null;
      this.stables.delete(won);
    }

    // A contested clue is a race, and the comeback edge is measured in races
    // rather than clues so a run of stumpers does not burn it.
    if (winnerId || (entry.missed || []).length) this.racesRun += 1;

    this.applyEliminations(entry, winnerId);
    // --- saves declared during the previous clue --------------------------
    //
    // Resolved here rather than the moment somebody declares, so nothing has to
    // pause while a number is typed. Several people can chip in for the same
    // player and it settles as one event.
    if (this.pendingSaves.length) {
      const byTarget = new Map();
      for (const sv of this.pendingSaves) {
        const donor = this.players.get(sv.by);
        const target = this.players.get(sv.target);
        if (!donor || !target || donor.state !== 'live') continue;
        if (target.state !== 'eliminated') continue;
        const amount = Math.max(0, Math.min(sv.amount, donor.score));
        if (amount <= 0) continue;
        donor.score -= amount;
        const cur = byTarget.get(sv.target) || { total: 0, donors: [] };
        cur.total += amount;
        cur.donors.push({ playerId: sv.by, amount });
        byTarget.set(sv.target, cur);
      }
      this.pendingSaves = [];
      const saved = [];
      for (const [targetId, info] of byTarget) {
        const t = this.players.get(targetId);
        if (!t) continue;
        // Straight back into the ring at whatever was raised. Partial amounts
        // are allowed on purpose: a cheap save is a weak save.
        t.state = 'live';
        t.score = Math.min(info.total, this.ceiling);
        t.enteredAtClue = this.cluesRevealed;
        t.eliminatedAtClue = null;
        t.revivals = (t.revivals || 0) + 1;
        this.eliminationOrder = this.eliminationOrder.filter((x) => x !== targetId);
        saved.push({ playerId: targetId, total: info.total, donors: info.donors });
      }
      if (saved.length) entry.saved = saved;
    }

    this.checkOvertime(entry);

    if (!cat.clues.some((c) => !c.revealed)) {
      this.board[slotIndex] = this.drawCategory();
      entry.categoryReplaced = this.board[slotIndex].title;
      // What was there, so a screen can hold the old column up for a moment
      // rather than swapping it out from under the celebration.
      entry.categoryWas = { slot: slotIndex, title: cat.title,
        values: cat.clues.map((c) => [100, 200, 300, 400, 500][c.row - 1]) };
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
      // One foot on the floor: back before they hit the floor at all.
      //
      // Checked before the elimination is recorded, so somebody who qualifies
      // never leaves — no gap on the board, no re-entry queue, nothing to
      // explain. They just stay up, at half a stake, with an edge for a while.
      if (this.s.comeback && !p.comebackUsed
          && p.correct < (this.s.comebackGate ?? 3)) {
        p.comebackUsed = true;
        p.score = Math.round(this.s.startScore * (this.s.comebackStake ?? 0.5));
        p.comebackUntil = this.racesRun + (this.s.comebackRaces ?? 40);
        entry.comebacks = (entry.comebacks || []).concat([{ playerId: p.id,
          score: p.score, until: p.comebackUntil }]);
        continue;
      }

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
        p.topRopeAt = null;
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

  // Somebody turning up after the bell. A Rumble is built around people
  // arriving throughout, so this is the format working rather than an edge
  // case: they go to the back of the queue and enter at the standard stake
  // like anybody else.
  //
  // Refused once overtime has opened. Overtime means the queue is empty and
  // the match is winding up; letting somebody in then would reopen it while
  // the stakes stayed elevated by the ratchet, which is a strange thing to do
  // to the people who got there on time.
  // Declared by somebody still in the ring, paid at the next clue boundary so
  // play never stops for it.
  declareSave(byId, targetId, amount) {
    if (!this.s.savePlayer) return { error: 'saves are off' };
    const by = this.players.get(byId);
    const target = this.players.get(targetId);
    if (!by || by.state !== 'live') return { error: 'you are not in the ring' };
    if (!target || target.state !== 'eliminated') return { error: 'they are not out' };
    const amt = Math.floor(Number(amount) || 0);
    if (amt <= 0) return { error: 'nothing offered' };
    if (amt > by.score) return { error: 'more than you have' };
    this.pendingSaves = this.pendingSaves.filter(
      (s2) => !(s2.by === byId && s2.target === targetId));
    this.pendingSaves.push({ by: byId, target: targetId, amount: amt });
    return { ok: true, amount: amt, pending: this.pendingSaves.length };
  }

  // A player waiting to come in can hand part of their entry to anybody in the
  // ring. They enter with whatever is left, which is the cost of the gesture.
  giftFromQueue(byId, targetId, amount) {
    if (!this.s.giftFromQueue) return { error: 'gifting is off' };
    const by = this.players.get(byId);
    const target = this.players.get(targetId);
    if (!by || by.state !== 'queued') return { error: 'you are not waiting' };
    if (!target || target.state !== 'live') return { error: 'they are not in the ring' };
    const amt = Math.floor(Number(amount) || 0);
    if (amt <= 0) return { error: 'nothing offered' };
    // Measured against the stake they have not yet received.
    const stake = this.s.startScore - (by.gifted || 0) - (by.bountyPlaced || 0);
    if (amt > stake) return { error: `you only have ${stake} to give` };
    by.gifted = (by.gifted || 0) + amt;
    target.score = Math.min(this.ceiling, target.score + amt);
    this.log.push({ type: 'gift', from: byId, to: targetId, amount: amt });
    return { ok: true, amount: amt, remaining: stake - amt };
  }

  addLatecomer(id, name) {
    if (this.finished) return { error: 'the match is over' };
    if (this.overtimeFrom != null) return { error: 'too late — the match is in overtime' };
    if (this.players.has(id)) return { error: 'already in' };

    const draw = this.drawOrder.length + 1;
    const p = {
      id, name, drawNumber: draw, originalDraw: draw,
      state: 'queued', score: 0, enteredAtClue: null,
      eliminatedAtClue: null, placement: null,
      pins: 0, correct: 0, missed: 0,
      topRope: false, topRopeAt: null, target: null,
      revivals: 0, bountyPlaced: 0,
    };
    this.players.set(id, p);
    this.drawOrder.push(id);
    // More people means the entries have to come faster to finish on time, so
    // the interval is recomputed against the clues actually left rather than
    // against the whole match.
    let interval = this.s.entryInterval;
    if (this.autoInterval) {
      const budget = Math.max(1, Math.round(
        (this.s.targetMinutes * 60) / this.s.secondsPerClue) - this.cluesRevealed);
      const waiting = this.queued().length;
      interval = Math.max(1, Math.min(this.s.entryInterval,
        Math.floor(budget / Math.max(1, waiting))));
      this.s.entryInterval = interval;
    }
    this.log.push({ type: 'latecomer', playerId: id, draw, interval });
    return { ok: true, draw, interval };
  }

  admit(cause) {
    const next = this.queued()[0];
    if (!next) return null;
    next.state = 'live';
    // The stake rides the overtime multiplier.
    //
    // A fixed 3,000 walked into a ring where clues were worth 2,000 a piece.
    // A real match: Randall entered at clue 150 into x2, lasted six clues
    // without winning a race, was revived at 1,500 into x4 where the top row
    // paid 2,000, and was gone after one. He never had a hand to play. The
    // stake now buys the same number of clues whenever you arrive.
    const mult = this.s.scaleEntryStake ? this.overtimeMultiplier() : 1;
    const base = next.revivals > 0
      ? Math.round(this.s.startScore * this.s.revivalFraction)
      : this.s.startScore;
    const stake = base * mult;
    next.score = Math.min(stake - next.bountyPlaced - (next.gifted || 0), this.ceiling);
    next.enteredAtClue = this.cluesRevealed;
    this.log.push({ type: 'entry', playerId: next.id, draw: next.drawNumber, cause });
    return next;
  }

  // Spectator feedback: an eliminated or queued player's buzz ranked against
  // the live field only, never against other spectators.
  /**
   * What somebody's buzz is worth against everybody else's, right now.
   *
   * A player on the way back from a near-elimination gets time taken off their
   * press for a while. It is applied here rather than to the recorded number so
   * the log keeps what they actually did — the edge is a ranking rule, not a
   * rewriting of history, and the console shows both.
   */
  buzzEdge(playerId) {
    if (!this.s.comeback) return 1;
    const p = this.players.get(playerId);
    if (!p || p.comebackUntil == null || this.racesRun > p.comebackUntil) return 1;
    return 1 - (this.s.comebackBoost ?? 0.5);
  }

  /** Is this player currently on the way back? */
  onTheFloor(playerId) {
    return this.buzzEdge(playerId) < 1;
  }

  /** What every clue is currently multiplied by: 1, 2, 4, up to overtimeMax. */
  overtimeMultiplier() {
    return Math.min(this.s.overtimeMax || 1, 2 ** (this.overtimeSteps || 0));
  }

  /** Two players on the same side. Nobody is allied with themselves. */
  allied(a, b) {
    if (!this.s.stables || !a || !b) return false;
    return a.id !== b.id && a.stable && a.stable === b.stable;
  }

  /**
   * Everybody left in the ring is in one stable.
   *
   * Nobody can take anything from anybody, so the match cannot resolve — the
   * stall-breaker would eventually escalate stakes that are multiplied by zero
   * opponents. When it happens the stable has served its purpose and dissolves,
   * which is also the only ending that reads as a story rather than a bug.
   */
  stableHasWon() {
    if (!this.s.stables) return null;
    const live = this.live();
    if (live.length < 2) return null;
    const first = live[0].stable;
    if (!first || !live.every((p) => p.stable === first)) return null;
    return first;
  }

  /** How many are in a stable, and whether it can take another. */
  stableSize(id) { return this.live().filter((p) => p.stable === id).length; }

  stableFull(id) {
    const cap = Math.max(2, Math.floor(this.live().length * this.s.stableMaxFraction));
    return this.stableSize(id) >= cap;
  }

  /**
   * Create a stable and put the founder in it.
   *
   * Named from the list rather than by the player. Six gemstones with six
   * colours the scoreboards can use: a stable has to be recognisable at a
   * glance across three different screens, and typed names collide, run long,
   * and cannot be turned into a colour.
   */
  createStable(playerId) {
    if (!this.s.stables) return { error: 'stables are not on in this match' };
    const p = this.players.get(playerId);
    if (!p) return { error: 'no such player' };
    if (p.stable) return { error: 'you are already in a stable' };
    const taken = new Set([...this.stables.values()].map((st) => st.name));
    const free = STABLE_NAMES.filter((g) => !taken.has(g.name));
    if (!free.length) return { error: 'every stable is already going' };
    const gem = free[0];
    const id = 's-' + gem.name.toLowerCase();
    this.stables.set(id, { id, name: gem.name, colour: gem.colour, foundedBy: playerId });
    p.stable = id;
    return { ok: true, id, name: gem.name, colour: gem.colour };
  }

  /** Join a stable you are not already in. Free — the cost is in leaving. */
  joinStable(playerId, stableId) {
    if (!this.s.stables) return { error: 'stables are not on in this match' };
    const p = this.players.get(playerId);
    if (!p) return { error: 'no such player' };
    if (!this.stables.has(stableId)) return { error: 'no such stable' };
    if (p.stable === stableId) return { error: 'you are already in that one' };
    if (p.stable) return { error: 'leave your stable first — press B to betray' };
    if (this.stableFull(stableId)) return { error: 'that stable is full' };
    p.stable = stableId;
    return { ok: true, id: stableId, name: this.stables.get(stableId).name };
  }

  /**
   * Betrayal. Your stack goes to the people you are walking out on.
   *
   * The whole score moves, not just the winnings: leaving with nothing is the
   * price of switching sides, and it is what stops a stable being a coat you
   * put on and take off. Split evenly among whoever is left; if nobody is left
   * there was nobody to betray, so it is simply leaving.
   */
  betray(playerId, joinId = null) {
    if (!this.s.stables) return { error: 'stables are not on in this match' };
    const p = this.players.get(playerId);
    if (!p) return { error: 'no such player' };
    if (!p.stable) return { error: 'you are not in a stable' };
    if (joinId && joinId !== p.stable && !this.stables.has(joinId)) {
      return { error: 'no such stable' };
    }
    if (joinId === p.stable) return { error: 'that is the stable you are leaving' };

    const from = p.stable;
    const left = this.live().filter((x) => x.id !== playerId && x.stable === from);
    const stack = p.score;
    // Never more than they had: this is a toll, not a payout.
    const kept = this.s.betrayalKeepFraction != null
      ? Math.max(0, Math.round(stack * this.s.betrayalKeepFraction))
      : Math.min(stack, Math.max(0, this.s.betrayalKeep || 0));
    const given = stack - kept;
    let each = 0;
    if (left.length && given > 0) {
      each = Math.round(given / left.length);
      for (const x of left) x.score += each;
      p.score = kept;
    } else if (left.length === 0) {
      // Nobody to abandon. Walking out of an empty room is not betrayal.
      p.score = stack;
    } else {
      p.score = Math.min(stack, kept);
    }
    p.stable = joinId || null;
    return { ok: true, from, fromName: this.stables.get(from)?.name || 'their stable',
      to: joinId, toName: joinId ? this.stables.get(joinId)?.name : null,
      stack, each, abandoned: left.map((x) => x.id) };
  }

  rankSpectatorBuzz(ms, liveBuzzTimes) {
    const faster = liveBuzzTimes.filter((t) => t < ms).length;
    return { ms, place: faster + 1, outOf: liveBuzzTimes.length + 1 };
  }
}

/**
 * The draw, with robots spread through it rather than clumped.
 *
 * A straight shuffle of a half-robot roster regularly deals three or four bots
 * in a row, and a stretch of the match where nobody real walks in is the part
 * a room notices — the entrances are the event. So the humans are shuffled,
 * the robots are shuffled, and then the robots are dealt into the gaps at even
 * spacing.
 *
 * Both groups are still shuffled first, so no individual player's number is
 * predictable; what is fixed is only the pattern of human-and-robot, which
 * nobody can exploit because it says nothing about who is where.
 *
 * With no robots, or none of one kind, this is exactly a shuffle.
 */
export function drawOrderFor(players, rng) {
  const humans = shuffle(players.filter((p) => !p.isBot), rng);
  const bots = shuffle(players.filter((p) => p.isBot), rng);
  if (!bots.length || !humans.length) return shuffle(players.slice(), rng);

  // n gaps for the humans to sit in, bots distributed across them evenly.
  const total = humans.length + bots.length;
  const out = new Array(total);
  const step = total / bots.length;
  const slots = new Set();
  for (let i = 0; i < bots.length; i++) {
    // Half a step in, so bots never take both the first and last places.
    let at = Math.round(i * step + step / 2);
    while (slots.has(at) || at >= total) at = (at + 1) % total;
    slots.add(at);
  }
  let bi = 0, hi = 0;
  for (let i = 0; i < total; i++) out[i] = slots.has(i) ? bots[bi++] : humans[hi++];
  return out;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
