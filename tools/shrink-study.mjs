// Does leaving a stable get more tempting as the field empties?
//
//   node tools/shrink-study.mjs [winner|even|surplus] [normie|elite]
//
// A stable of five against a field that keeps shrinking.
//
// Under stableFocus the pot is the size it would have been for the whole ring,
// but only the outsiders pay it — so as they dwindle, each one carries more.
// The question is whether that ever makes leaving worth it.
import { RumbleGame, makeRng, autoCeiling } from '../src/engine.js';
import { makeBot, planClue } from '../src/bots.js';

const SHARE = process.argv[2] || 'winner';
const DECIDER = process.argv[3] || 'elite';
const ROW = [100, 200, 300, 400, 500];
function pool() { let n = 0; return () => { n++; return { id: 'c' + n, title: 'C' + n,
  clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; }; }

function build(seed, outsiders) {
  const total = 5 + outsiders;
  const rng = makeRng(seed);
  const brains = new Map();
  const players = [];
  for (let i = 0; i < total; i++) {
    players.push({ id: 'p' + i, name: 'P' + i });
    brains.set('p' + i, makeBot(rng, { level: i === 2 ? DECIDER : 'normie' }));
  }
  const g = new RumbleGame({ players, rng, categoryPool: pool(),
    settings: { entryInterval: 999, startScore: 3000, ceiling: autoCeiling(total),
      // Pinned, not inherited. It shipped on-by-default in 0.90.0, so a row
      // measured either side of that reads differently for no stated reason.
      arrivalGrace: true,
      ceilingFloor: 3000, ceilingDecayPerClue: null, stables: true,
      stableFocus: true, stableShare: SHARE, betrayalKeepFraction: 0.5,
      stableMaxFraction: 1, longevity: false, categorySweep: false } });
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
function finish(ctx, who) {
  let guard = 0;
  while (!ctx.g.finished && guard++ < 1500) if (!playOne(ctx)) break;
  const w = [...ctx.g.players.values()]
    .find((p) => p.state === 'winner' || (ctx.g.finished && p.state === 'live'));
  return w ? w.id === who : false;
}

function study(outsiders, runs = 900) {
  const res = { stay: 0, stag: 0, n: 0 };
  for (let seed = 1; seed <= runs; seed++) {
    const base = build(seed, outsiders);
    const A = base.g.createStable('p0', 'A').id;
    for (let i = 1; i < 5; i++) base.g.joinStable('p' + i, A);
    for (let i = 0; i < 14 && !base.g.finished; i++) playOne(base);
    if (base.g.finished) continue;
    const me = 'p2';
    if (base.g.players.get(me).state !== 'live') continue;
    if (base.g.live().filter((p) => !p.stable).length < 1) continue;
    const snap = JSON.parse(JSON.stringify(base.g.snapshot()));
    res.n++;
    for (const choice of ['stay', 'stag']) {
      const ctx = build(seed, outsiders);
      ctx.g.restore(JSON.parse(JSON.stringify(snap)));
      ctx.rng = makeRng(seed * 7919 + 13);
      if (choice === 'stag') ctx.g.betray(me, null);
      if (finish(ctx, me)) res[choice]++;
    }
  }
  return res;
}

console.log(`A stable of five, decider is a ${DECIDER}, sharing: ${SHARE}.\n`);
console.log('  outsiders   ring   stay      go stag    difference');
for (const out of [10, 7, 5, 3, 2, 1]) {
  const r = study(out);
  if (!r.n) { console.log(`  ${String(out).padStart(9)}   —      not enough matches reached the point`); continue; }
  const stay = r.stay / r.n * 100, stag = r.stag / r.n * 100;
  console.log(`  ${String(out).padStart(9)}   ${String(5 + out).padStart(4)}   ${stay.toFixed(1).padStart(5)}%   ${stag.toFixed(1).padStart(8)}%   ${(stag - stay >= 0 ? '+' : '') + (stag - stay).toFixed(1)}`);
}
