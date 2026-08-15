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
  const r = g.createStable('a');
  check('a stable can be founded', r.ok === true, r.name);
  check('and is named from the list, with a colour',
    r.name === 'Diamond' && /^#/.test(r.colour), `${r.name} ${r.colour}`);
  check('the founder is in it', g.players.get('a').stable === r.id);
  check('a second player can join', g.joinStable('b', r.id).ok === true);
  check('a second stable takes the next stone', g.createStable('c').name === 'Ruby');
  check('joining twice is refused', !!g.joinStable('b', r.id).error);
  check('you cannot hop straight to another', !!g.joinStable('b', 'nope').error);
}

console.log('\nWHO PAYS');
{
  // Three, so everybody named is in the ring from the first clue.
  const g = mk(3);
  const ring = g.live().map((p) => p.id);
  const [A, B, C] = ring;
  const st = g.createStable(A).id;
  g.joinStable(B, st);
  const [s, r] = open(g);
  const before = { a: score(g, A), b: score(g, B), c: score(g, C) };
  const val = r * 100;
  g.resolveClue(s, r, { winnerId: A, missedIds: [] });
  // The teammate's share is loaded onto the outsider rather than written off,
  // so one outsider facing a pair pays for both of them.
  check('the outsider carries the whole pot', score(g, C) === before.c - val * 2,
    `${before.c} -> ${score(g, C)}`);
  // ...and the pot is split across the stable, so the teammate gains without
  // having answered. That is what a stable is now: a shared purse.
  check('the winner takes half of it', score(g, A) === before.a + val,
    `+${score(g, A) - before.a}`);
  check('and the teammate takes the other half', score(g, B) === before.b + val,
    `+${score(g, B) - before.b}`);

  // The older behaviour is still available.
  const g2 = mk(3, { stableShare: 'winner' });
  const r2 = g2.live().map((p) => p.id);
  const s2 = g2.createStable(r2[0]).id;
  g2.joinStable(r2[1], s2);
  const [sl2, rw2] = open(g2);
  const b2 = score(g2, r2[1]);
  g2.resolveClue(sl2, rw2, { winnerId: r2[0], missedIds: [] });
  check("with stableShare 'winner' the teammate only avoids paying",
    score(g2, r2[1]) === b2, `${b2} -> ${score(g2, r2[1])}`);
}

console.log('\nWITHOUT stableFocus THE POT JUST SHRINKS');
{
  const g = mk(3, { stableFocus: false });
  const [A, B, C] = g.live().map((p) => p.id);
  const st = g.createStable(A).id;
  g.joinStable(B, st);
  const [s, r] = open(g);
  const val = r * 100;
  const before = score(g, C);
  g.resolveClue(s, r, { winnerId: A, missedIds: [] });
  check('the outsider pays face value only', score(g, C) === before - val,
    `${before} -> ${score(g, C)}`);
}

console.log('\nBETRAYAL');
{
  // A stable of three needs a ring of six, so lift the cap rather than depend
  // on how many the engine starts.
  const g = mk(3, { stableMaxFraction: 1 });
  const [A, B, C] = g.live().map((p) => p.id);
  const st = g.createStable(A).id;
  g.joinStable(B, st); g.joinStable(C, st);
  g.players.get(A).score = 6000;
  const b4 = { b: score(g, B), c: score(g, C) };
  const r = g.betray(A, null);
  check('betrayal is allowed', r.ok === true, JSON.stringify({ stack: r.stack, each: r.each }));
  // Half by default: a real cost without being unthinkable.
  check('the traitor keeps half', score(g, A) === 3000, String(score(g, A)));
  // The other half, split between the two left behind.
  check('and the other half goes to those abandoned',
    score(g, B) === b4.b + 1500 && score(g, C) === b4.c + 1500,
    `+${score(g, B) - b4.b} and +${score(g, C) - b4.c}`);
  check('and they are out of the stable', g.players.get(A).stable === null);
}
{
  const g = mk(3);
  const [A, B] = g.live().map((p) => p.id);
  g.createStable(A);
  const two = g.createStable(B).id;
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
  const st = g.createStable(A).id;
  g.joinStable(B, st); g.joinStable(C, st);
  check('an all-in ring is spotted', g.stableHasWon() === st);
  const [s, r] = open(g);
  const e = g.resolveClue(s, r, { winnerId: A, missedIds: [] });
  check('the stable wins and dissolves', !!e.stableWon, e.stableWon && e.stableWon.name);
  check('so nobody is allied any more',
    g.live().every((p) => p.stable === null));
}

// The toll is a setting, so check both ends of it too.
{
  const g = mk(3, { stableMaxFraction: 1, betrayalKeepFraction: 0 });
  const [A, B] = g.live().map((p) => p.id);
  const st = g.createStable(A).id;
  g.joinStable(B, st);
  g.players.get(A).score = 4000;
  const before = score(g, B);
  g.betray(A, null);
  check('at nothing kept, the traitor leaves empty', score(g, A) === 0, String(score(g, A)));
  check('and the whole stack changes hands', score(g, B) === before + 4000,
    `+${score(g, B) - before}`);
}

console.log('\nSIZE CAP');
{
  const g = mk(3);
  const [A, B, C] = g.live().map((p) => p.id);
  const st = g.createStable(A).id;
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
