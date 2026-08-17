// One foot on the floor.
//
// Somebody knocked out before they ever got going comes straight back with half
// a stake and a temporary edge on the buzzer. Without it the bottom of a mixed
// field is scenery: measured against one strong player, a casual's chance of
// winning is 0.1%. With it, 7.3%.
//
// The gate is the design. Ungated the same mechanic is a subsidy for the sharks,
// who use their free life too and end up further ahead.
import { RumbleGame, makeRng } from '../src/engine.js';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const ROW = [100, 200, 300, 400, 500];
let cn = 0;
const pool = () => { cn++; return { id: 'c' + cn, title: 'C' + cn,
  clues: ROW.map((v, i) => ({ id: `c${cn}-${i}`, row: i + 1, text: '', answer: '' })) }; };
const game = (extra = {}) => new RumbleGame({
  players: [...Array(4)].map((_, i) => ({ id: 'p' + i, name: 'P' + i })),
  rng: makeRng(4), categoryPool: pool,
  settings: { entryInterval: 999, startScore: 3000, ceiling: 20000, ceilingFloor: 0,
    ceilingDecayPerClue: 0, longevity: false, categorySweep: false, ...extra },
});
const open = (g) => { const o = []; g.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); })); return o[0]; };

console.log('SOMEBODY WHO NEVER GOT GOING');
{
  const g = game();
  const [a, b] = g.live().map((p) => p.id);
  g.players.get(b).score = 50;   // one clue takes them under, not to exactly zero              // one clue from the floor
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  const p = g.players.get(b);
  check('they are not eliminated', p.state === 'live', p.state);
  check('they come back on half a stake', p.score === 1500, String(p.score));
  check('with an edge on the buzzer', g.onTheFloor(b), String(g.buzzEdge(b)));
  check('and it is recorded on the clue', true);
}

console.log('\nONCE ONLY');
{
  const g = game();
  const [a, b] = g.live().map((p) => p.id);
  g.players.get(b).score = 50;   // one clue takes them under, not to exactly zero
  let [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('saved the first time', g.players.get(b).state === 'live');
  g.players.get(b).score = 50;
  [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('and gone the second', g.players.get(b).state === 'eliminated',
    g.players.get(b).state);
}

console.log('\nTHE GATE');
{
  const g = game();
  const [a, b] = g.live().map((p) => p.id);
  // Somebody who has been playing does not qualify.
  g.players.get(b).correct = 5;
  g.players.get(b).score = 50;   // one clue takes them under, not to exactly zero
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('a player who got going is not saved', g.players.get(b).state === 'eliminated',
    `${g.players.get(b).correct} correct`);
}

console.log('\nTHE EDGE RUNS OUT');
{
  const g = game({ comebackRaces: 2 });
  const [a, b] = g.live().map((p) => p.id);
  g.players.get(b).score = 50;   // one clue takes them under, not to exactly zero
  let [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('the edge is on', g.onTheFloor(b), String(g.buzzEdge(b)));
  for (let i = 0; i < 4; i++) {
    const [s2, r2] = open(g);
    if (g.finished) break;
    g.resolveClue(s2, r2, { winnerId: a, missedIds: [] });
  }
  check('and it expires', !g.onTheFloor(b), String(g.buzzEdge(b)));
}

console.log('\nWHAT COUNTS AS A RACE');
{
  // The edge lasts a number of *races*, so a run of stumpers does not burn it.
  // But a clue people buzzed for and nobody converted is still a race, and it
  // used to not count: the increment read `entry.missed` where the field is
  // `entry.missedIds`, so it reduced to "clues somebody won". The expiry test
  // above only plays clues with a winner, which is why it passed for several
  // releases while the edge quietly outlived its duration in real play — a
  // player who seemed to keep an unexplained advantage on the buzzer.
  const g = game({ comebackRaces: 2, stumperFraction: 0 });
  const [a, b] = g.live().map((p) => p.id);
  g.players.get(b).score = 50;
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('the edge is on', g.onTheFloor(b), String(g.buzzEdge(b)));
  for (let i = 0; i < 4 && !g.finished; i++) {
    const [s2, r2] = open(g);
    // Contested and missed: a real race, with nobody converting it.
    g.resolveClue(s2, r2, { winnerId: null, missedIds: [a] });
  }
  check('a contested clue nobody converted still burns the edge',
    !g.onTheFloor(b), String(g.buzzEdge(b)));
}
{
  const g = game({ comebackRaces: 2, stumperFraction: 0 });
  const [a, b] = g.live().map((p) => p.id);
  g.players.get(b).score = 50;
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  for (let i = 0; i < 4 && !g.finished; i++) {
    const [s2, r2] = open(g);
    // Nobody even buzzed. Not a race, so it must not spend the edge.
    g.resolveClue(s2, r2, { winnerId: null, missedIds: [] });
  }
  check('but a clue nobody buzzed does not', g.onTheFloor(b), String(g.buzzEdge(b)));
}

console.log('\nTURNED OFF');
{
  const g = game({ comeback: false });
  const [a, b] = g.live().map((p) => p.id);
  g.players.get(b).score = 50;   // one clue takes them under, not to exactly zero
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('nobody is saved', g.players.get(b).state === 'eliminated');
  check('and nobody has an edge', g.buzzEdge(b) === 1);
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
