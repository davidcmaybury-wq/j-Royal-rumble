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
// These are Matt Schiffler's, from the generator he wrote for his own game —
// not my reconstruction of them. Checked against 3,339 real player-games from
// J!ometry's box data, his intuition holds up remarkably well:
//
//   tier         his band     share of real games in it     he draws it
//   rookie       23-35%              3.1%                       5%
//   normie       37-61%             55.8%                      60%
//   champ        63-70%             17.5%                      23%
//   superchamp   72-88%             12.8%                      11%
//   elite        89-96%              0.1%                       1%
//
// His population's mean attempt rate is 56% against a real median of 57%.
//
// Expressed as a fraction of the 61 clues in a game, since a Rumble runs any
// number of clues and a player is only in the ring for part of it.
const BUZZ_RATE = {
  rookie:     [0.23, 0.35],
  normie:     [0.37, 0.61],
  champ:      [0.63, 0.70],
  superchamp: [0.72, 0.88],
  elite:      [0.89, 0.96],
};

// How often each standard turns up when the host asks for a mixed field.
// This was the biggest thing I had wrong: I drew uniformly, so one robot in
// five was elite. On the show it is one in a hundred, and Matt's weights say
// the same. A test field of 20% elites is not a test of anything real.
export const LEVEL_WEIGHTS = {
  rookie: 0.05, normie: 0.60, champ: 0.23, superchamp: 0.11, elite: 0.01,
};

// A returning champion should skew stronger than a fresh challenger.
export const RETURNING_WEIGHTS = {
  rookie: 0.01, normie: 0.15, champ: 0.65, superchamp: 0.15, elite: 0.04,
};

// The share of a player's attempts that win the buzz, at each standard. This
// is the ladder: across 519 champions it climbs from 55% at one win to 65% at
// ten or more. It is what the buzz profiles have to reproduce.
export const TARGET_BUZ_PCT = {
  rookie: 35, normie: 47, champ: 55, superchamp: 62, elite: 72,
};

// Grouped by stable contestant id across 1,772 people, the ladder runs:
//   appearances   BUZ%   accuracy
//   1             46.3%    81.8%
//   2             52.1%    86.7%
//   4-5           54.3%    87.0%
//   6-9           56.3%    87.6%
//   10+           56.3%    89.3%
// Ten points of buzzer against seven and a half of accuracy — both matter, the
// buzzer rather more, and neither is flat.
const CLUES_PER_GAME = 61;

// Matt's, exactly. A rookie is three-quarters likely to have bad hands; an
// elite never does. Note that a rookie can still draw mid, and a champ can
// draw jedi — which is what keeps two same-standard robots from playing
// identically, and is the point of the whole design.
const BUZZ_SKILL_ODDS = {
  rookie:     { bad: 0.75, mid: 0.25, good: 0.00, jedi: 0.00 },
  normie:     { bad: 0.30, mid: 0.50, good: 0.20, jedi: 0.00 },
  champ:      { bad: 0.05, mid: 0.45, good: 0.45, jedi: 0.05 },
  superchamp: { bad: 0.00, mid: 0.15, good: 0.60, jedi: 0.25 },
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
  // Matt's actual figures, replacing my fit to them. The standard deviations
  // are far wider than I had guessed — his `bad` has a spread larger than its
  // own mean, so a bad buzzer jumps the lights about a fifth of the time. That
  // overlap is deliberate and it is why his fields feel unpredictable.
  observed: {
    jedi: { mean: 50, sd: 25 },
    good: { mean: 80, sd: 60 },
    mid:  { mean: 125, sd: 120 },
    bad:  { mean: 250, sd: 300 },
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
// Matt's bands. I had thought these too narrow — his population spans 9 points
// against 25 in the raw per-game data — but that was the wrong comparison. Per
// game figures carry night-to-night noise; between *players* the spread really
// is about 9 points, measured on contestants with five or more games. His
// centres and his width are both right.
//
// Kept nearly flat across rows, which the per-round data settled: Double
// Jeopardy clues average four times the value of Single Jeopardy ones and
// accuracy falls only 1.9 points between them. A hard clue does not make a
// player wrong, it makes them not buzz.
const ACCURACY_BAND = {
  rookie:     [0.70, 0.80],
  normie:     [0.77, 0.87],
  champ:      [0.79, 0.89],
  superchamp: [0.83, 0.90],
  elite:      [0.87, 0.95],
};

// Row-to-row falloff applied to whichever accuracy a player drew: about one
// point per doubling of clue value, so roughly two points across a round.
const ACCURACY_BY_ROW = [1.010, 1.005, 1.0, 0.995, 0.990];

// The same player is not the same every night. Measured across 199 players
// with four or more games: accuracy swings 6.3 points and attempts 3.7 clues,
// game to game. Neither generator modelled this — both drew one number per
// opponent and held it. A robot that plays its exact average every match is
// more predictable than a person.
const NIGHTLY_ACCURACY_SD = 0.063;
const NIGHTLY_ATTEMPT_SD = 0.06;

// Difficulty shows up in the attempt, and Matt's formulation of it is better
// than the one I first wrote.
//
// I had a per-level table of multipliers on the attempt rate. He raises the
// rate to a power instead:  rate_row = rate ^ exponent_row.  The difference
// matters, because the power form grades itself — a fraction raised to a
// power above 1 falls away much faster when the fraction is small. So a weak
// player loses far more to a hard clue than a strong one without anybody
// writing a per-level table at all:
//
//   base rate   on the dearest row   lost
//        30%              13%        17 points
//        60%              42%        18 points
//        90%              84%         6 points
//
// His exponents, which sit either side of 1 rather than being small fractions
// as mine were:
const ROW_EXPONENT_J  = [0.45, 0.83, 1.00, 1.10, 1.40];

// The harder round is shifted by 0.22 from the figures he uses. His shape is
// kept exactly; only the gap between the rounds moves. As written, his model
// has players carrying 89-96% of their aggression from Single into Double
// Jeopardy, where 1,772 real contestants carry 77-88%. The shift lines the two
// up without touching the within-round curve:
//
//   band            observed   his as written   shifted
//   weakest 20%        77.3%           89.4%     73.8%
//   middle             83.7%           93.4%     83.4%
//   strongest 20%      87.8%           95.9%     89.8%
const ROW_EXPONENT_DJ = [0.82, 1.12, 1.22, 1.52, 1.92];

// A Rumble board is one round of five rows, so it uses the Single Jeopardy
// curve. The Double figures are kept for when a board is drawn from a Double
// Jeopardy category, and for anyone porting this back to a two-round game.
export const ROW_EXPONENTS = { single: ROW_EXPONENT_J, double: ROW_EXPONENT_DJ };

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
  const levels = { ...json.levels };

  // The recordings cover rookie through superchamp plus the human who played
  // against them. There is no elite among them, and borrowing the human's
  // wholesale gives elite that player's aggression: they jump the lights 20% of
  // the time against a superchamp's 11%, and our 250ms lockout charges dearly
  // for it — leaving "elite" winning fewer races than superchamp.
  //
  // A real elite player is fast *and* disciplined. So elite takes the human's
  // speed with a good part of the early mass moved back over the line.
  if (!levels.elite && levels.human) {
    const src = levels.human.buckets;
    const b = {};
    let recovered = 0;
    for (const [lo, n] of Object.entries(src)) {
      if (Number(lo) < 0) {
        const kept = Math.round(n * 0.45);
        recovered += n - kept;
        if (kept) b[lo] = kept;
      } else {
        b[lo] = n;
      }
    }
    b['0'] = (b['0'] || 0) + recovered;
    levels.elite = { attempts: levels.human.attempts, median: levels.human.median, buckets: b };
  }

  for (const [level, v] of Object.entries(levels)) {
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

// Draw a standard from the weighted population rather than uniformly. This is
// what makes a mixed field look like a real room: mostly ordinary players,
// with an elite turning up about once in a hundred.
export function drawLevel(rng, returning = false) {
  const w = returning ? RETURNING_WEIGHTS : LEVEL_WEIGHTS;
  let r = rng();
  for (const l of LEVELS) { r -= w[l]; if (r <= 0) return l; }
  return 'normie';
}

export function makeBot(rng, opts = {}) {
  const profile = opts.profile ? (PROFILES[opts.profile] || BUZZ_PROFILE) : BUZZ_PROFILE;
  const level = opts.level || drawLevel(rng, opts.returning);
  const skill = opts.buzzSkill || pick(BUZZ_SKILL_ODDS[level], rng);

  // Every trait drawn independently within the standard's range, so two
  // robots of the same standard are comparably good without being identical.
  const [bLo, bHi] = BUZZ_RATE[level];
  const [aLo, aHi] = ACCURACY_BAND[level];
  const baseAccuracy = aLo + rng() * (aHi - aLo);

  return {
    isBot: true,
    level,
    buzzSkill: skill,
    attemptRate: bLo + rng() * (bHi - bLo),
    baseAccuracy,
    accuracy: ACCURACY_BY_ROW.map((f) => Math.min(0.99, baseAccuracy * f)),
    buzz: profile[skill],
    profile: opts.profile || 'observed',
    // Sample the real histogram for this standard when we have one, unless the
    // caller has asked for a parametric profile explicitly.
    empirical: opts.empirical !== false && !!EMPIRICAL && !!EMPIRICAL[level],
  };
}

// A robot that plays its exact average every match is more predictable than a
// person. Call this once per match, per robot: it nudges their form for the
// night by the amount real contestants actually vary game to game.
export function nightlyForm(bot, rng) {
  const acc = Math.max(0.35, Math.min(0.99,
    bot.baseAccuracy + gaussian(rng) * NIGHTLY_ACCURACY_SD));
  const att = Math.max(0.05, Math.min(0.98,
    bot.attemptRate * (1 + gaussian(rng) * NIGHTLY_ATTEMPT_SD)));
  return {
    ...bot,
    attemptRate: att,
    accuracy: ACCURACY_BY_ROW.map((f) => Math.min(0.99, acc * f)),
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
  // The power form, not a multiplier: a weak player's aggression collapses on
  // the hard rows while a strong player's barely moves.
  const exps = bot.doubleRound ? ROW_EXPONENT_DJ : ROW_EXPONENT_J;
  const rate = Math.pow(bot.attemptRate, exps[row - 1]);
  const attempt = rng() < Math.min(0.97, rate);
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
