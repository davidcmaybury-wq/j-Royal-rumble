// The ceiling has to keep binding in overtime.
//
// The winner of a raised clue banks the full amount and meets the ceiling on
// the next clue, so the falling roof takes it back. But the exemption used to
// re-arm every time they won, and in a two-handed overtime the stronger player
// wins most clues — so they never met the ceiling at all. One live match ended
// with 12,520 against a ceiling of 4,560.
import { RumbleGame, makeRng } from '../src/engine.js';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const ROW = [100, 200, 300, 400, 500];
let cn = 0;
const pool = () => { cn++; return { id: 'c' + cn, title: 'C' + cn,
  clues: ROW.map((v, i) => ({ id: `c${cn}-${i}`, row: i + 1, text: '', answer: '' })) }; };

const g = new RumbleGame({
  players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
  rng: makeRng(5), categoryPool: pool,
  settings: { entryInterval: 999, startScore: 3000, ceiling: 6000, ceilingFloor: 3000,
    ceilingDecayPerClue: -120, overtime: true, overtimeEvery: 2, overtimeMax: 8,
    longevity: false, categorySweep: false },
});
const open = () => { const o = []; g.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); })); return o[0]; };

// A always wins, which is the case that broke it.
let mult = 1, over = 0;
for (let i = 0; i < 60 && !g.finished; i++) {
  const [s, r] = open();
  g.resolveClue(s, r, { winnerId: 'a', missedIds: [] });
  const a = g.players.get('a');
  if (a.score > g.ceiling) over++;
  mult = Math.max(mult, 2 ** (g.overtimeSteps || 0));
}
const a = g.players.get('a');
check('overtime actually opened', mult > 1, `x${mult}`);
check('a repeat winner does not outrun the ceiling for ever',
  a.score <= g.ceiling * 1.05, `${a.score} against ${g.ceiling}`);
check('and is above it at most briefly', over <= 15, `${over} of 30 clues above`);

// The banked-then-clipped behaviour still has to work for a single big win.
const g2 = new RumbleGame({
  players: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }, { id: 'z', name: 'Z' }],
  rng: makeRng(9), categoryPool: pool,
  settings: { entryInterval: 999, startScore: 3000, ceiling: 6000, ceilingFloor: 3000,
    ceilingDecayPerClue: -120, overtime: true, overtimeEvery: 2, overtimeMax: 8,
    longevity: false, categorySweep: false },
});
const open2 = () => { const o = []; g2.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); })); return o[0]; };
let banked = false;
for (let i = 0; i < 60 && !g2.finished; i++) {
  const [s, r] = open2();
  // alternate the winner so nobody is exempt twice running
  g2.resolveClue(s, r, { winnerId: i % 2 ? 'y' : 'x', missedIds: [] });
  if ((g2.overtimeSteps || 0) > 0) {
    const w = g2.players.get(i % 2 ? 'y' : 'x');
    if (w.score > g2.ceiling) banked = true;
  }
}
check('a raised clue can still be banked in full', banked,
  banked ? 'seen above the cap' : 'never exceeded — the fix went too far');

// --- walking into overtime ------------------------------------------------
//
// A real match: Randall entered at clue 150 with the standard 3,000 into x2,
// lasted six clues without winning a race, was revived at 1,500 into x4 where
// the top row paid 2,000, and was gone after one. He never had a hand to play.
//
// Overtime only opens once the queue is empty, so revival is the way people
// actually arrive into it — which is why the stake is set in admit() and tested
// there rather than through a whole match.
{
  const mkq = (extra) => new RumbleGame({
    players: [...Array(8)].map((_, i) => ({ id: 'q' + i, name: 'Q' + i })),
    rng: makeRng(3), categoryPool: pool,
    settings: { entryInterval: 999, startScore: 3000, ceiling: 99999,
      ceilingFloor: 0, ceilingDecayPerClue: 0, overtime: true, overtimeMax: 8,
      longevity: false, categorySweep: false, ...extra },
  });

  for (const [steps, want] of [[0, 3000], [1, 6000], [2, 12000]]) {
    const g3 = mkq({});
    g3.overtimeSteps = steps;
    const q = g3.queued()[0];
    g3.admit('test');
    check(`at x${2 ** steps} an entrant starts on ${want.toLocaleString()}`,
      q.score === want, String(q.score));
  }

  // A revival is half of the scaled stake, not half of the flat one: that was
  // the second half of what happened to Randall.
  const g4 = mkq({ revivalFraction: 0.5 });
  g4.overtimeSteps = 2;
  const r = g4.queued()[0];
  r.revivals = 1;
  g4.admit('test');
  check('a revival at x4 is half of the scaled stake', r.score === 6000, String(r.score));

  // And with the scaling turned off, nothing has changed.
  const g5 = mkq({ scaleEntryStake: false });
  g5.overtimeSteps = 2;
  const q5 = g5.queued()[0];
  g5.admit('test');
  check('with scaling off it is the flat stake', q5.score === 3000, String(q5.score));
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
