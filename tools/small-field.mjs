// Six players: does a higher ceiling, or decay, or both fix the two things the
// live logs showed — a leader pinned at the cap for half the match, and
// eliminations that all arrive in the last few clues.
import { RumbleGame, makeRng } from '../src/engine.js';
import { makeBot, planClue } from '../src/bots.js';

const ROW = [100, 200, 300, 400, 500];
function pool() { let n = 0; return () => { n++; return { id: 'c' + n, title: 'C' + n,
  clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; }; }

function run(seed, { ceiling, decay, start = 3000 }) {
  const rng = makeRng(seed);
  const brains = new Map();
  const players = [];
  // One strong player, as the live matches had.
  const levels = ['champ', 'normie', 'normie', 'normie', 'normie', 'normie'];
  for (let i = 0; i < 6; i++) {
    players.push({ id: 'p' + i, name: 'P' + i });
    brains.set('p' + i, makeBot(rng, { level: levels[i] }));
  }
  const g = new RumbleGame({ players, rng, categoryPool: pool(),
    settings: { entryInterval: 15, startScore: start, ceiling, ceilingFloor: start,
      ceilingDecayPerClue: decay, longevity: true, categorySweep: true } });

  let guard = 0, pinned = 0, clipped = 0, elimAt = [];
  while (!g.finished && guard++ < 400) {
    const open = [];
    g.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
    const [s, r] = open[Math.floor(rng() * open.length)];
    const tries = [];
    for (const p of g.live()) {
      const plan = planClue(brains.get(p.id), r, rng, 250, 0, 190);
      if (plan.attempt) tries.push({ id: p.id, ms: plan.ms, correct: plan.correct });
    }
    tries.sort((a, b) => a.ms - b.ms);
    const f = tries[0];
    const before = new Map(g.live().map((p) => [p.id, p.score]));
    const e = g.resolveClue(s, r, { winnerId: f && f.correct ? f.id : null,
      missedIds: f && !f.correct ? [f.id] : [] });
    if (f && f.correct) {
      const opp = before.size - 1;
      const got = (g.players.get(f.id).score) - (before.get(f.id) ?? 0);
      const want = r * 100 * opp;
      if (got < want - 1) clipped += want - got;
    }
    if (g.live().some((p) => p.score >= g.ceiling)) pinned++;
    for (const x of (e.eliminated || [])) elimAt.push(g.cluesRevealed);
  }
  const n = g.cluesRevealed || 1;
  const w = [...g.players.values()].find((p) => p.state === 'winner' || (g.finished && p.state === 'live'));
  return {
    clues: n, pinnedPct: pinned / n * 100, clipped,
    // How bunched are the eliminations? Share arriving in the last fifth.
    lateElims: elimAt.length ? elimAt.filter((c) => c > n * 0.8).length / elimAt.length * 100 : 0,
    elims: elimAt.length,
    winnerDraw: w ? (w.originalDraw ?? w.drawNumber) : null,
    strongWon: w ? w.id === 'p0' : null,
  };
}

const CONFIGS = [
  ['6,000  (as shipped)', { ceiling: 6000, decay: 0 }],
  ['9,000             ', { ceiling: 9000, decay: 0 }],
  ['10,500            ', { ceiling: 10500, decay: 0 }],
  ['12,000            ', { ceiling: 12000, decay: 0 }],
  ['15,000            ', { ceiling: 15000, decay: 0 }],
];
console.log('Six players, one champ. 2,000 matches each.\n');
console.log('  setting              clues  pinned%  swallowed  elims  late%  late-draw win%');
for (const [name, cfg] of CONFIGS) {
  let cl = 0, pin = 0, cli = 0, el = 0, late = 0, d = 0, lateWin = 0;
  for (let s = 1; s <= 2000; s++) {
    const r = run(s, cfg);
    if (r.winnerDraw == null) continue;
    d++; cl += r.clues; pin += r.pinnedPct; cli += r.clipped; el += r.elims;
    late += r.lateElims; if (r.winnerDraw >= 4) lateWin++;
  }
  console.log(`  ${name}  ${(cl/d).toFixed(0).padStart(5)}  ${(pin/d).toFixed(0).padStart(6)}%`
    + `  ${Math.round(cli/d).toLocaleString().padStart(9)}  ${(el/d).toFixed(1).padStart(5)}`
    + `  ${(late/d).toFixed(0).padStart(4)}%  ${(lateWin/d*100).toFixed(0).padStart(13)}%`);
}
