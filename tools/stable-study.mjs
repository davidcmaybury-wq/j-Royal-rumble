// Can a pack of normies hold off an elite?
//
//   node tools/stable-study.mjs
//
// Short answer: no, and the reason is structural rather than a matter of
// numbers. A stable protects you from your TEAMMATES' damage, not from the
// outsider's — so when the strong player is the one outside the stable, banding
// together does nothing about the thing hurting you. It also shrinks the pot a
// pack member collects when they do win, since teammates no longer pay.
//
// How many normies does it take to hold off an elite?
//
// Uses the real bot model — the same attempt rates, accuracy bands and buzz
// distributions the robots play on — rather than a stand-in, so the answer is
// about this game rather than about my assumptions.
import { RumbleGame, makeRng, autoCeiling } from '../src/engine.js';
import { makeBot, planClue } from '../src/bots.js';

const ROW = [100, 200, 300, 400, 500];
function pool() { let n = 0; return () => { n++; return { id: 'c' + n, title: 'C' + n,
  clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; }; }

/**
 * One elite against a field of normies, some of whom band together.
 * `allied` is how many of the normies share a stable; the elite always stags.
 */
function run(field, allied, seed, focus = true) {
  const rng = makeRng(seed);
  const brains = new Map();
  const players = [];
  players.push({ id: 'elite', name: 'Elite' });
  brains.set('elite', makeBot(rng, { level: 'elite' }));
  for (let i = 0; i < field - 1; i++) {
    players.push({ id: 'n' + i, name: 'N' + i });
    brains.set('n' + i, makeBot(rng, { level: 'normie' }));
  }
  const g = new RumbleGame({ players, rng, categoryPool: pool(),
    settings: { entryInterval: 999, startScore: 3000, ceiling: autoCeiling(field),
      // Pinned, not inherited. It shipped on-by-default in 0.90.0, so a row
      // measured either side of that reads differently for no stated reason.
      arrivalGrace: true,
      ceilingFloor: 3000, ceilingDecayPerClue: null, stables: allied > 1,
      stableFocus: focus, stableMaxFraction: 1 } });   // the cap is the question, not the constraint

  if (allied > 1) {
    const st = g.createStable('n0', 'Pack');
    let joined = 1;
    for (let i = 1; i < field - 1 && joined < allied; i++) {
      if (g.joinStable('n' + i, st.id).ok) joined++;
    }
  }

  let guard = 0;
  while (!g.finished && guard++ < 1200) {
    const open = [];
    g.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
    const [s, r] = open[Math.floor(rng() * open.length)];
    // A real race: everybody plans, fastest attempt takes it.
    const tries = [];
    for (const p of g.live()) {
      const plan = planClue(brains.get(p.id), r, rng, 250, 0, 190);
      if (plan.attempt) tries.push({ id: p.id, ms: plan.ms, correct: plan.correct });
    }
    tries.sort((a, b) => a.ms - b.ms);
    const first = tries[0];
    g.resolveClue(s, r, {
      winnerId: first && first.correct ? first.id : null,
      missedIds: first && !first.correct ? [first.id] : [],
    });
  }
  const w = [...g.players.values()].find((p) => p.state === 'winner' || (g.finished && p.state === 'live'));
  return w ? w.id === 'elite' : null;
}

const FOCUS = process.argv.includes('--no-focus') ? false : true;
const RUNS = 3000;
console.log(FOCUS ? 'RULE: the stable\'s share is loaded onto the outsiders'
                  : 'RULE: the pot simply shrinks');
console.log('One elite against normies. The elite goes it alone; the pack shares a stable.\n');
for (const field of [6, 8, 10, 12]) {
  console.log(`${field} players — one elite, ${field - 1} normies`);
  console.log('   pack size   elite wins   vs a fair share');
  const fair = 100 / field;
  for (let allied = 0; allied <= field - 1; allied++) {
    if (allied === 1) continue;                // a stable of one is just stag
    let won = 0, done = 0;
    for (let s = 1; s <= RUNS; s++) {
      const r = run(field, allied, s, FOCUS);
      if (r === null) continue;
      done++; if (r) won++;
    }
    const pct = won / done * 100;
    const tag = allied > Math.floor(field / 2) ? '  (beyond the half-ring cap)' : '';
    console.log(`   ${String(allied || 'none').padStart(9)}   ${pct.toFixed(1).padStart(9)}%   ${(pct / fair).toFixed(2)}x${tag}`);
  }
  console.log('');
}
