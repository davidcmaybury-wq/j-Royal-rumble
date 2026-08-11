// Robot players, for filling a roster when there aren't thirty humans about.
//
// The model follows the one Dave's friend built for his own game: a player has
// an aggression level that sets how often they attempt a clue, and a separate
// buzzing skill that sets how fast they are when they do. Higher levels draw
// better buzzing skills, but not deterministically — a rookie can have quick
// hands and an elite can be slow on the trigger.
//
// NUMBERS MARKED (guess) ARE MINE, NOT HIS. Only the jedi buzz distribution
// and the attempt bands came from the original; the rest are placeholders
// chosen to sit sensibly between them, and should be replaced when his modules
// turn up.

export const LEVELS = ['rookie', 'normie', 'champ', 'superchamp', 'elite'];

// Attempts per 61-clue game, from the original. Converted to a per-clue
// probability, because a Rumble runs any number of clues and a player is only
// in the ring for part of it.
// Fitted against observed play, not the original bands — a recorded rookie
// averaged 21.7 attempts a game, above the "<20" the spec suggested.
// Bounded by the official box scores: across 27 sampled player-games, attempts
// ran 22 to 51 with a median of 38. The old elite band topped out at 58, above
// anything anyone has actually done.
const ATTEMPTS_PER_GAME = {
  rookie:     [20, 28],
  normie:     [27, 36],
  champ:      [34, 43],
  superchamp: [40, 47],
  elite:      [44, 52],
};
const CLUES_PER_GAME = 61;

// How likely each level is to have each pair of hands. Elite is from the
// original (80% jedi, 20% good); the rest are (guess), interpolated.
const BUZZ_SKILL_ODDS = {
  rookie:     { bad: 0.30, mid: 0.50, good: 0.18, jedi: 0.02 },
  normie:     { bad: 0.03, mid: 0.33, good: 0.50, jedi: 0.14 },
  champ:      { bad: 0.00, mid: 0.12, good: 0.52, jedi: 0.36 },
  superchamp: { bad: 0.00, mid: 0.04, good: 0.36, jedi: 0.60 },
  elite:      { bad: 0.00, mid: 0.00, good: 0.20, jedi: 0.80 },
};

// Buzz time in ms, drawn per clue. A negative draw means they jumped the
// lights — which is where the early-buzz behaviour comes from, rather than
// being bolted on separately.
// jedi is from the original. The rest are (guess).
// Two calibrations, because they answer different questions.
//
// `observed` reproduces the recorded solo games. Its spread is very wide: the
// jedi profile implies a Time% of 85, against roughly 46 for the best champions
// on the show. That is why a strong human beats good robots easily in that
// model — the human is effectively superhuman relative to the field.
//
// `broadcast` compresses the spread to the range real contestants occupy,
// which makes the good robots much harder to beat while being *more* realistic
// rather than less. It is the answer to "how do I make them harder without
// cheating": don't speed them up beyond human, stop the human being so far
// ahead of them.
export const PROFILES = {
  observed: {
    jedi: { mean: 50, sd: 35 },     // from the original model
    good: { mean: 88, sd: 42 },
    mid:  { mean: 150, sd: 62 },
    bad:  { mean: 275, sd: 115 },
  },
  broadcast: {
    jedi: { mean: 122, sd: 52 },    // Time% ~46, a strong champion
    good: { mean: 137, sd: 56 },    // Time% ~39
    mid:  { mean: 152, sd: 62 },    // Time% ~33, the average contestant
    bad:  { mean: 186, sd: 78 },    // Time% ~20, being outbuzzed
  },
  // Anchored on buzz times actually recorded in this game: two strong players
  // over 63 buzzes, median 198ms, sd 97, range 8 to 362.
  //
  // This is the one to use. The other two are both calibrated against a
  // notional human who buzzes far faster than the people who will really be
  // sitting opposite these robots, which quietly makes the robots harmless.
  measured: {
    jedi: { mean: 178, sd: 88 },    // as quick as the quickest player recorded
    good: { mean: 205, sd: 95 },    // about the median of a strong field
    mid:  { mean: 240, sd: 100 },
    bad:  { mean: 300, sd: 120 },
  },
};

export let BUZZ_PROFILE = PROFILES.measured;
export function useProfile(name) {
  BUZZ_PROFILE = PROFILES[name] || PROFILES.observed;
  return BUZZ_PROFILE;
}

// Chance of answering correctly, given that they attempted, by clue row.
// Rows get harder left to right. (guess) throughout — the original ties this
// to level and row but the exact table wasn't specified.
// Fitted. My first guess had these far too low — around 50% for a rookie. The
// observed data says accuracy once you have won the buzz runs 79% to 88% and
// barely moves with standard, because a player who does not know a clue mostly
// does not press. Aggression separates the levels; accuracy hardly does.
const ACCURACY = {
  rookie:     [0.84, 0.81, 0.77, 0.73, 0.68],
  normie:     [0.89, 0.86, 0.83, 0.79, 0.74],
  champ:      [0.88, 0.85, 0.82, 0.78, 0.73],
  superchamp: [0.90, 0.87, 0.84, 0.81, 0.76],
  elite:      [0.93, 0.91, 0.88, 0.85, 0.81],
};

// Attempt rates are flat across rows in the original. Nudged by row here so a
// hard clue draws fewer takers, which is what actually happens. (guess)
const ATTEMPT_BY_ROW = [1.15, 1.06, 1.0, 0.92, 0.82];

const NAMES = [
  'Bront', 'Vex', 'Marlo', 'Sable', 'Kip', 'Onyx', 'Dell', 'Roux', 'Tibbs', 'Wex',
  'Juno', 'Crane', 'Pim', 'Ash', 'Vero', 'Lark', 'Fen', 'Bex', 'Cass', 'Doro',
  'Ines', 'Kestrel', 'Mox', 'Nim', 'Orly', 'Pike', 'Quill', 'Rook', 'Sten', 'Tarn',
];

function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pick(odds, rng) {
  let roll = rng();
  for (const [k, p] of Object.entries(odds)) {
    roll -= p;
    if (roll <= 0) return k;
  }
  return Object.keys(odds)[Object.keys(odds).length - 1];
}

// --- empirical buzz timing -------------------------------------------------
// Real histograms beat a fitted curve. The observed distributions are strongly
// right-skewed with a long tail of whiffs, and the thing that separates a
// superchamp from a rookie is as much consistency as speed: their middle 50%
// spans 37-87ms against the rookie's -13 to 362. No gaussian reproduces that.
//
// So we sample the histogram directly: pick a bucket by weight, then a point
// within it.
let EMPIRICAL = null;
export function loadDistributions(json) {
  EMPIRICAL = {};
  for (const [level, v] of Object.entries(json.levels)) {
    const entries = Object.entries(v.buckets)
      .map(([lo, n]) => [Number(lo), n])
      .sort((a, b) => a[0] - b[0]);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    EMPIRICAL[level] = { entries, total, median: v.median, width: json.bucketWidth || 25 };
  }
  return EMPIRICAL;
}
export const hasDistributions = () => !!EMPIRICAL;

function sampleEmpirical(level, rng) {
  const d = EMPIRICAL[level] || EMPIRICAL.normie;
  let roll = rng() * d.total;
  for (const [lo, n] of d.entries) {
    roll -= n;
    if (roll <= 0) {
      // The bottom and top buckets are open-ended; give them a plausible tail
      // rather than pretending everything landed on the boundary.
      if (lo <= -999) return -260 - rng() * 220;
      if (lo >= 500) return 500 + rng() * 400;
      return lo + rng() * d.width;
    }
  }
  return d.median;
}

export function makeBot(rng, opts = {}) {
  const profile = opts.profile ? (PROFILES[opts.profile] || BUZZ_PROFILE) : BUZZ_PROFILE;
  const level = opts.level
    || LEVELS[Math.floor(rng() * LEVELS.length)];
  const skill = opts.buzzSkill || pick(BUZZ_SKILL_ODDS[level], rng);
  const [lo, hi] = ATTEMPTS_PER_GAME[level];
  const attempts = lo + rng() * (hi - lo);
  return {
    isBot: true,
    level,
    buzzSkill: skill,
    attemptRate: attempts / CLUES_PER_GAME,
    accuracy: ACCURACY[level],
    buzz: profile[skill],
    profile: opts.profile || 'measured',
    // Sample the real histogram for this standard when we have one, unless the
    // caller has asked for a parametric profile explicitly.
    empirical: opts.empirical !== false && !!EMPIRICAL && !!EMPIRICAL[level],
  };
}

export function botName(i, taken = new Set()) {
  for (let k = 0; k < NAMES.length; k++) {
    const n = NAMES[(i + k) % NAMES.length];
    if (!taken.has(n)) return n;
  }
  return 'Bot ' + (i + 1);
}

// What this bot does with one clue. Decided in advance, the way a person has
// already decided whether they know it before they reach for the button.
// `readJitter` is a single offset shared by every robot on a clue. The host
// activates by hand at the end of a spoken read, and players are timing that
// read rather than reacting to a light — so when a read runs long, everybody
// anticipating it is early together. Without this the robots' errors are
// independent, which is not how a room behaves.
export function planClue(bot, row, rng, lockoutMs = 250, readJitter = 0, offset = 0) {
  const attempt = rng() < Math.min(0.97, bot.attemptRate * ATTEMPT_BY_ROW[row - 1]);
  if (!attempt) return { attempt: false };

  const base = bot.empirical
    ? sampleEmpirical(bot.level, rng)
    : bot.buzz.mean + gaussian(rng) * bot.buzz.sd;
  const raw = base + readJitter + offset;
  const correct = rng() < bot.accuracy[row - 1];

  if (raw >= 0) return { attempt: true, correct, ms: Math.round(raw * 10) / 10, early: false };

  // They jumped the lights. The penalty runs from the moment they pressed, so
  // they are free again at press + lockout, and mash until the buzzer opens.
  //
  // Worth noticing: this makes a wild early press LESS costly than a marginal
  // one. Press 240ms early and you are clear almost as the buzzers open; press
  // 10ms early and you are locked out for nearly the whole quarter-second.
  // That is how a real lockout behaves, and it is why a nervous player is
  // punished harder than a reckless one.
  const freeAt = raw + lockoutMs;
  return {
    attempt: true, correct, early: true,
    earlyAt: Math.round(raw * 10) / 10,
    ms: Math.max(0, Math.round(freeAt * 10) / 10),
  };
}

export function describe(bot) {
  const timing = bot.empirical
    ? `median ${EMPIRICAL[bot.level].median}ms, from recorded play`
    : `~${bot.buzz.mean}ms`;
  return `${bot.level} · ${bot.buzzSkill} hands · `
    + `${Math.round(bot.attemptRate * 100)}% attempt · ${timing}`;
}

// A shared per-clue offset, in ms. Small compared with the spread of an
// individual buzz, but enough that a long read catches everybody together.
export function drawReadJitter(rng, sd = 45) {
  return gaussian(rng) * sd;
}

// The median of the human distribution these robots were recorded against.
// Comparing it with the live field is how the bots stay competitive with
// whoever actually turned up rather than with whoever was recorded.
export const referenceHumanMedian = () => (EMPIRICAL?.human?.median ?? 43);

// ---------------------------------------------------------------------------
// Timing expressed the way J!ometry expresses it
//
// J!ometry's Timing Rating (Time%) is the probability a player wins an
// individual buzz, modelled as though all three players attempted the clue.
// The average is 33.3% by construction. That is a far better handle than a
// millisecond mean: it is scale-free, it is directly comparable to real
// contestants, and it separates timing from aggression, which raw "% in first
// on buzzer" does not.
//
// Real anchors, for scale:
//   33.3%   average, by definition
//   ~46%    a strong champion's share of first-buzzes across a career
//   ~10%    a contestant being thoroughly outbuzzed
//
// The model underneath is still a drawn reaction time. This converts between
// the two: given a target Time%, find the mean that produces it against two
// average opponents.

// The reference opponent that Time% is measured against. Defaults to the
// middle of whichever profile set is loaded, so a Time% always means "against
// an average player on this same scale".
const referenceOpponent = () => BUZZ_PROFILE.mid;

function winProbability(mean, sd, field, rng, trials = 4000) {
  let wins = 0;
  for (let i = 0; i < trials; i++) {
    let best = Infinity, bestIsUs = false;
    const t = mean + gaussian(rng) * sd;
    best = t; bestIsUs = true;
    for (const opp of field) {
      const o = opp.mean + gaussian(rng) * opp.sd;
      if (o < best) { best = o; bestIsUs = false; }
    }
    if (bestIsUs) wins++;
  }
  return wins / trials;
}

// Numerically solve for the mean that hits a target Time% against two average
// opponents. Bisection: faster hands mean a lower number, so the search runs
// backwards.
export function meanForTiming(timePct, sd = null, rng = null) {
  const r = rng || makeLocalRng(99);
  const ref = referenceOpponent();
  sd = sd ?? ref.sd;
  const field = [ref, ref];
  const target = timePct / 100;
  let lo = -60, hi = 900;           // ms; lo can be negative, meaning very early
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const p = winProbability(mid, sd, field, r);
    if (p > target) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

// Given a bot, what Time% do its current parameters imply?
export function timingOf(bot, rng = null) {
  const r = rng || makeLocalRng(7);
  const ref = referenceOpponent();
  return Math.round(winProbability(bot.buzz.mean, bot.buzz.sd, [ref, ref], r) * 1000) / 10;
}

function makeLocalRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a bot from a Time% instead of a named skill — the form to use if you
// want a robot that buzzes like a specific real contestant.
export function botFromTiming(rng, { timePct, level = 'champ', sd = null }) {
  const base = makeBot(rng, { level });
  const width = sd ?? referenceOpponent().sd;
  return { ...base, buzzSkill: `Time% ${timePct}`,
    buzz: { mean: meanForTiming(timePct, width), sd: width } };
}
