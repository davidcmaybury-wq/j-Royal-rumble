// Overtime: the fix for two evenly matched players trading the same points
// back and forth until one of them has to go home.
import { RumbleGame, makeRng } from '../src/engine.js';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const ROW = [100, 200, 300, 400, 500];
let n = 0;
const pool = () => { n++; return { id: 'c' + n, title: 'C' + n,
  clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; };
const mk = (over = {}, players = 2) => { n = 0; return new RumbleGame({
  players: Array.from({ length: players }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
  rng: makeRng(9), categoryPool: pool,
  settings: { entryInterval: 999, startScore: 3000, ceiling: 90000,
    ceilingDecayPerClue: 0, overtimeEvery: 6, ...over } }); };
const anyClue = (g) => {
  for (let i = 0; i < g.board.length; i++) {
    const c = g.board[i].clues.find((x) => !x.revealed);
    if (c) return [i, c.row];
  }
  return [0, 1];
};

// the exact stall: two players alternating perfectly, forever
function stall(settings) {
  const g = mk(settings);
  let i = 0, started = null, raises = [];
  while (!g.finished && i < 400) {
    const e = g.resolveClue(...anyClue(g), { winnerId: i % 2 ? 'p0' : 'p1', missedIds: [] });
    if (e.overtimeStarted) started = e.n;
    if (e.overtimeRaised) raises.push([e.n, e.overtimeRaised.multiplier]);
    i++;
  }
  return { clues: g.cluesRevealed, finished: g.finished, started, raises };
}

const off = stall({ overtime: false });
check('without overtime a perfect stall never resolves', !off.finished, `${off.clues} clues and going`);

const on = stall({});
check('with overtime it ends', on.finished, `${on.clues} clues`);
check('and it ends in a sensible number of clues', on.clues < 40, `${on.clues}`);
check('the escalation is announced when it opens', on.started !== null, `at clue ${on.started}`);
check('and again at each doubling', on.raises.length >= 2,
  on.raises.map(([c, m]) => `x${m}@${c}`).join(' '));

// values actually change
{
  const g = mk({});
  const first = g.resolveClue(...anyClue(g), { winnerId: 'p0', missedIds: [] });
  check('face value is untouched at the start', first.value === first.faceValue,
    `$${first.faceValue} played at $${first.value}`);
  for (let i = 0; i < 7; i++) g.resolveClue(...anyClue(g), { winnerId: i % 2 ? 'p0' : 'p1', missedIds: [] });
  const later = g.resolveClue(...anyClue(g), { winnerId: 'p0', missedIds: [] });
  check('later clues play above face value', later.value > later.faceValue,
    `$${later.faceValue} played at $${later.value}`);
  check('the multiplier is reported', g.overtime().multiplier > 1, `x${g.overtime().multiplier}`);
  check('and it says when the next rise lands',
    typeof g.overtime().nextIn === 'number' || g.overtime().nextIn === null);
}

// David's case: three evenly matched players with an empty queue. The old rule
// waited for heads-up, so a real robot match ran 30 clues with three players
// trading the same points and overtime never firing.
{
  const g = mk({}, 3);
  let i = 0;
  while (!g.finished && i < 300) {
    g.resolveClue(...anyClue(g), { winnerId: ['p0', 'p1', 'p2'][i % 3], missedIds: [] });
    i++;
  }
  check('three players stalling still resolves', g.finished, `${g.cluesRevealed} clues`);
}

// The escalation clock counts clues where nobody went out, so a field that is
// thinning on its own does not get the stakes raised under it.
{
  const g = mk({}, 3);
  g.resolveClue(...anyClue(g), { winnerId: 'p0', missedIds: [] });
  const before = g.overtime()?.multiplier ?? 1;
  for (let i = 0; i < 10; i++) {
    g.resolveClue(...anyClue(g), { winnerId: ['p0', 'p1', 'p2'][i % 3], missedIds: [] });
  }
  check('a stalled run raises the stakes', (g.overtime()?.multiplier ?? 1) > before,
    `x${g.overtime()?.multiplier}`);
}

// it must not fire while people are still queued
{
  const g = mk({ entryInterval: 999 }, 6);
  for (let i = 0; i < 10; i++) g.resolveClue(...anyClue(g), { winnerId: null, missedIds: [] });
  check('overtime stays shut while players are still waiting', g.overtime() === null,
    `${g.queued().length} in the queue`);
}

// the cap holds
{
  const g = mk({ overtimeEvery: 1, overtimeMax: 4 });
  for (let i = 0; i < 12; i++) {
    if (g.finished) break;
    g.resolveClue(...anyClue(g), { winnerId: i % 2 ? 'p0' : 'p1', missedIds: [] });
  }
  const o = g.overtime();
  check('the multiplier is capped', !o || o.multiplier <= 4, o ? `x${o.multiplier}` : 'ended');
}

check('off by setting means off', mk({ overtime: false }).overtimeMultiplier() === 1);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
