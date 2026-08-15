// Stables: teams, and what it costs to leave one.
//
// The mechanic changes who pays whom, which is the deepest change any of these
// make — so the cases that matter are the ones where it could stop the match
// resolving, or become a coat somebody puts on and takes off.
import { RumbleGame, makeRng } from '../src/engine.js';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const ROW = [100, 200, 300, 400, 500];
let cn = 0;
const pool = () => { cn++; return { id: 'c' + cn, title: 'C' + cn,
  clues: ROW.map((v, i) => ({ id: `c${cn}-${i}`, row: i + 1, text: '', answer: '' })) }; };
const mk = (n, extra = {}) => new RumbleGame({
  players: [...Array(n)].map((_, i) => ({ id: String.fromCharCode(97 + i), name: 'P' + i })),
  rng: makeRng(3), categoryPool: pool,
  settings: { entryInterval: 999, startScore: 3000, ceiling: 20000, ceilingFloor: 3000,
    ceilingDecayPerClue: 0, stables: true, longevity: false, categorySweep: false,
    overtime: false, ...extra },
});
const open = (g) => { const o = []; g.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); })); return o[0]; };
const score = (g, id) => g.players.get(id).score;

console.log('MAKING AND JOINING');
{
  const g = mk(3);
  const r = g.createStable('a', 'The Firm');
  check('a stable can be founded', r.ok === true, r.name);
  check('the founder is in it', g.players.get('a').stable === r.id);
  check('a second player can join', g.joinStable('b', r.id).ok === true);
  check('two names the same are refused', !!g.createStable('c', 'the firm').error);
  check('joining twice is refused', !!g.joinStable('b', r.id).error);
  check('you cannot hop straight to another', !!g.joinStable('b', 'nope').error);
}

console.log('\nWHO PAYS');
{
  // Three, so everybody named is in the ring from the first clue.
  const g = mk(3);
  const ring = g.live().map((p) => p.id);
  const [A, B, C] = ring;
  const st = g.createStable(A, 'Wolves').id;
  g.joinStable(B, st);
  const [s, r] = open(g);
  const before = { a: score(g, A), b: score(g, B), c: score(g, C) };
  const val = r * 100;
  g.resolveClue(s, r, { winnerId: A, missedIds: [] });
  check('a teammate pays nothing', score(g, B) === before.b,
    `${before.b} -> ${score(g, B)}`);
  check('the outsider pays', score(g, C) === before.c - val,
    `${before.c} -> ${score(g, C)}`);
  check('and the winner collects only from them',
    score(g, A) === before.a + val, `+${score(g, A) - before.a}`);
}

console.log('\nBETRAYAL');
{
  // A stable of three needs a ring of six, so lift the cap rather than depend
  // on how many the engine starts.
  const g = mk(3, { stableMaxFraction: 1 });
  const [A, B, C] = g.live().map((p) => p.id);
  const st = g.createStable(A, 'Kings').id;
  g.joinStable(B, st); g.joinStable(C, st);
  g.players.get(A).score = 6000;
  const b4 = { b: score(g, B), c: score(g, C) };
  const r = g.betray(A, null);
  check('betrayal is allowed', r.ok === true, JSON.stringify({ stack: r.stack, each: r.each }));
  check('the traitor leaves with nothing', score(g, A) === 0, String(score(g, A)));
  // 6000 split between the two left behind.
  check('the stack is split among those abandoned',
    score(g, B) === b4.b + 3000 && score(g, C) === b4.c + 3000,
    `+${score(g, B) - b4.b} and +${score(g, C) - b4.c}`);
  check('and they are out of the stable', g.players.get(A).stable === null);
}
{
  const g = mk(3);
  const [A, B] = g.live().map((p) => p.id);
  g.createStable(A, 'Alone');
  const two = g.createStable(B, 'Other').id;
  g.players.get(A).score = 5000;
  const r = g.betray(A, two);
  check('leaving a stable with nobody left in it costs nothing',
    r.ok && score(g, A) === 5000, String(score(g, A)));
  check('and lands you in the new one', g.players.get(A).stable === two);
}

console.log('\nTHE MATCH STILL HAS TO END');
{
  // The cap normally stops this, so lift it: the dissolve is the safety net for
  // eliminations leaving one stable holding the ring, not for people joining.
  const g = mk(3, { stableMaxFraction: 1 });
  const [A, B, C] = g.live().map((p) => p.id);
  const st = g.createStable(A, 'Everyone').id;
  g.joinStable(B, st); g.joinStable(C, st);
  check('an all-in ring is spotted', g.stableHasWon() === st);
  const [s, r] = open(g);
  const e = g.resolveClue(s, r, { winnerId: A, missedIds: [] });
  check('the stable wins and dissolves', !!e.stableWon, e.stableWon && e.stableWon.name);
  check('so nobody is allied any more',
    g.live().every((p) => p.stable === null));
}

console.log('\nSIZE CAP');
{
  const g = mk(3);
  const [A, B, C] = g.live().map((p) => p.id);
  const st = g.createStable(A, 'Bloc').id;
  check('a stable can hold up to half the ring', g.joinStable(B, st).ok === true);
  const third = g.joinStable(C, st);
  check('but not the whole room', !!third.error, third.error);
  check('so it can never dissolve on the first clue', g.stableHasWon() === null);
}

console.log('\nOFF BY DEFAULT');
{
  const g = new RumbleGame({
    players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    rng: makeRng(1), categoryPool: pool,
    settings: { entryInterval: 999, startScore: 3000, longevity: false, categorySweep: false },
  });
  check('stables are refused when the host has not turned them on',
    !!g.createStable('a', 'Nope').error);
  const [s, r] = open(g);
  const val = r * 100;
  const [A, B] = g.live().map((p) => p.id);
  g.resolveClue(s, r, { winnerId: A, missedIds: [] });
  check('and everyone still pays as before',
    g.players.get(B).score === 3000 - val, String(g.players.get(B).score));
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
