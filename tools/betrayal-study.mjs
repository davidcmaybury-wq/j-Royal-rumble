// Fifteen players, two stables of five, five going it alone.
//
// At a decision point mid-match, one member of stable A is offered three
// futures: stay put, walk out alone, or cross to stable B. Each is played
// forward to the end many times and their win rate compared.
//
// Forking the actual match rather than scoring a heuristic: the last attempt at
// this measured a decision rule I had invented, which told us about the rule
// rather than about the game.
import { RumbleGame, makeRng, autoCeiling } from '../src/engine.js';
import { makeBot, planClue } from '../src/bots.js';

const DECIDER = process.argv[2] || 'normie';
const SHARE = process.argv[3] || 'winner';
const FOCUS = process.argv[4] !== 'nofocus';
const ROW = [100, 200, 300, 400, 500];
function pool() { let n = 0; return () => { n++; return { id: 'c' + n, title: 'C' + n,
  clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; }; }

function build(seed, keepFrac) {
  const rng = makeRng(seed);
  const brains = new Map();
  const players = [];
  for (let i = 0; i < 15; i++) {
    players.push({ id: 'p' + i, name: 'P' + i });
    // The decider's standard is the question: an ordinary player should stay,
    // somebody who believes they are better than the room might not.
    brains.set('p' + i, makeBot(rng, { level: i === 2 ? DECIDER : 'normie' }));
  }
  const g = new RumbleGame({ players, rng, categoryPool: pool(),
    settings: { entryInterval: 999, startScore: 3000, ceiling: autoCeiling(15),
      // Pinned, not inherited. It shipped on-by-default in 0.90.0, so a row
      // measured either side of that reads differently for no stated reason.
      arrivalGrace: true,
      ceilingFloor: 3000, ceilingDecayPerClue: null, stables: true,
      stableFocus: FOCUS, stableShare: SHARE,
      betrayalKeepFraction: keepFrac, stableMaxFraction: 1,
      longevity: false, categorySweep: false } });
  // Everybody in the ring: the opening three is hardcoded, and a scenario about
  // fifteen players in two stables needs fifteen people actually playing.
  while (g.queued().length) g.admit('setup');
  return { g, brains, rng };
}

function playOne({ g, brains, rng }) {
  const open = [];
  g.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  if (!open.length) return false;
  const [s, r] = open[Math.floor(rng() * open.length)];
  const tries = [];
  for (const p of g.live()) {
    const plan = planClue(brains.get(p.id), r, rng, 250, 0, 190);
    if (plan.attempt) tries.push({ id: p.id, ms: plan.ms, correct: plan.correct });
  }
  tries.sort((a, b) => a.ms - b.ms);
  const f = tries[0];
  g.resolveClue(s, r, { winnerId: f && f.correct ? f.id : null,
    missedIds: f && !f.correct ? [f.id] : [] });
  return true;
}

/** Play to the end and say whether `who` won. */
function finish(ctx, who) {
  let guard = 0;
  while (!ctx.g.finished && guard++ < 1500) if (!playOne(ctx)) break;
  const w = [...ctx.g.players.values()]
    .find((p) => p.state === 'winner' || (ctx.g.finished && p.state === 'live'));
  return w ? w.id === who : false;
}

function study(keepFrac, runs = 900) {
  const res = { stay: 0, stag: 0, cross: 0, n: 0, stack: 0 };
  for (let seed = 1; seed <= runs; seed++) {
    // Set the table: two stables of five, five stags.
    const base = build(seed, keepFrac);
    const A = base.g.createStable('p0', 'A').id;
    const B = base.g.createStable('p5', 'B').id;
    for (let i = 1; i < 5; i++) base.g.joinStable('p' + i, A);
    for (let i = 6; i < 10; i++) base.g.joinStable('p' + i, B);
    // Play a while so the decision is made against a real board.
    for (let i = 0; i < 18 && !base.g.finished; i++) playOne(base);
    if (base.g.finished) continue;
    const me = 'p2';
    if (base.g.players.get(me).state !== 'live') continue;
    // A deep copy per fork. snapshot() keeps the player objects by reference,
    // so restoring the same snapshot into three games had them all mutating
    // one another and every choice came out the same.
    const snap = JSON.parse(JSON.stringify(base.g.snapshot()));
    res.stack += base.g.players.get(me).score;
    res.n++;

    for (const choice of ['stay', 'stag', 'cross']) {
      const ctx = build(seed, keepFrac);
      ctx.g.restore(JSON.parse(JSON.stringify(snap)));
      ctx.rng = makeRng(seed * 7919 + 13);          // same future for each choice
      if (choice === 'stag') ctx.g.betray(me, null);
      if (choice === 'cross') ctx.g.betray(me, B);
      if (finish(ctx, me)) res[choice]++;
    }
  }
  return res;
}

console.log("Fifteen players, two stables of five, five stags. Decider: " + DECIDER + '; sharing: ' + SHARE);
console.log('One member of stable A decides, 18 clues in. Win rate for each choice.\n');
console.log('  keep     stay      go stag    cross to B     best');
for (const k of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
  const r = study(k);
  const pct = (x) => (x / r.n * 100);
  const opts = { stay: pct(r.stay), stag: pct(r.stag), cross: pct(r.cross) };
  const best = Object.entries(opts).sort((a, b) => b[1] - a[1])[0][0];
  console.log(`  ${(Math.round(k * 100) + '%').padStart(4)}   ${opts.stay.toFixed(1).padStart(6)}%   ${opts.stag.toFixed(1).padStart(8)}%   ${opts.cross.toFixed(1).padStart(11)}%     ${best}`);
}
