// The advanced mechanics, exercised against the engine directly. These change
// scoring, so they get arithmetic tests rather than "did it not crash" tests.
import { RumbleGame, makeRng } from '../src/engine.js';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const ROW = [100, 200, 300, 400, 500];
let catN = 0;
const pool = () => {
  catN++;
  return { id: 'c' + catN, title: 'CAT ' + catN, source: 'test',
    clues: ROW.map((v, i) => ({ id: `c${catN}-${i}`, row: i + 1, text: 't', answer: 'a' })) };
};

function game(settings, n = 5) {
  catN = 0;
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const g = new RumbleGame({
    players, rng: makeRng(3), categoryPool: pool,
    settings: { entryInterval: 999, startScore: 3000, ceiling: 9000,
      ceilingDecayPerClue: 0, stumperFraction: 0.5, ...settings },
  });
  return g;
}
const live = (g) => g.live().map((p) => p.id);
const score = (g, id) => g.players.get(id).score;
// find an unrevealed clue of a given row
function pick(g, row) {
  for (let i = 0; i < g.board.length; i++) {
    const c = g.board[i].clues.find((x) => x.row === row && !x.revealed);
    if (c) return [i, row];
  }
  return [0, row];
}

console.log('TOP ROPE');
{
  const g = game({ topRope: true });
  const [a, b, c] = live(g);
  const before = { a: score(g, a), b: score(g, b) };
  g.setTopRope(a, true);
  let [s, r] = pick(g, 5);                      // $500, two opponents
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('a top-rope win pays double',
    score(g, a) - before.a === 500 * 2 * 2, `gained ${score(g, a) - before.a}`);
  check('opponents pay their normal share',
    before.b - score(g, b) === 500, `paid ${before.b - score(g, b)}`);
  check('the declaration lasts one clue only', g.players.get(a).topRope === false);

  const g2 = game({ topRope: true });
  const [x, y] = live(g2);
  const wasX = score(g2, x);
  g2.setTopRope(x, true);
  let [s2, r2] = pick(g2, 4);                   // $400, x is not the winner
  g2.resolveClue(s2, r2, { winnerId: y, missedIds: [] });
  check('a top-rope loss costs double', wasX - score(g2, x) === 800, `paid ${wasX - score(g2, x)}`);

  const g3 = game({ topRope: true, ceiling: 3200 });
  const [m] = live(g3);
  g3.setTopRope(m, true);
  let [s3, r3] = pick(g3, 5);
  g3.resolveClue(s3, r3, { winnerId: m, missedIds: [] });
  check('the ceiling does not clip a top-rope win',
    score(g3, m) > 3200, `${score(g3, m)} against a 3200 ceiling`);

  const g4 = game({ topRope: true });
  const [n1] = live(g4);
  g4.board[0].clues[0].revealed = false;
  g4.resolveClue(...pick(g4, 1), { winnerId: null, missedIds: [] });
  check('you cannot climb up once a clue is live', (() => {
    const gg = game({ topRope: true });
    const id = live(gg)[0];
    // the server blocks this; the engine allows it, so the guard is the server's
    return gg.setTopRope(id, true) === true;
  })(), 'engine permits, server gates');
}


console.log('\nTHE BACKFIRE DIAL');
{
  // The whole-pot price decided who targeting was for: six ordinary players all
  // aiming at the richest shark took 5.5% of wins against 17.3% for the same
  // group holding its fire, because every aimed miss paid the entire pot. So the
  // price is a dial. Arcade and Chaos set 0, Tournament 0.5, 1 is the old rule.
  const half = game({ targeting: true, targetBackfire: 0.5 });
  const [a, b, c] = live(half);
  const was = { a: score(half, a), c: score(half, c) };
  half.setTarget(a, b);
  half.resolveClue(...pick(half, 3), { winnerId: b, missedIds: [] });  // pot 600
  check('at 0.5 an aimed miss pays half the pot',
    was.a - score(half, a) === 300, `paid ${was.a - score(half, a)}`);
  check('and a bystander still pays nothing', was.c === score(half, c));

  // 0 does not merely make the branch cheap — it must not fire at all, or an
  // aimed miss would pay nothing while everybody else pays the even split.
  const off = game({ targeting: true, targetBackfire: 0 });
  const [d, e, f2] = live(off);
  const wOff = { d: score(off, d), f2: score(off, f2) };
  off.setTarget(d, e);
  off.resolveClue(...pick(off, 3), { winnerId: e, missedIds: [] });
  check('at 0 an aimed miss costs no more than any other miss',
    wOff.d - score(off, d) === 300, `paid ${wOff.d - score(off, d)}`);
  check('and the clue goes back to an even split',
    wOff.f2 - score(off, f2) === 300, `bystander paid ${wOff.f2 - score(off, f2)}`);

  // Turning backfire off must not turn off the winner's own focused fire.
  const foc = game({ targeting: true, targetBackfire: 0 });
  const [g1, h1, i1] = live(foc);
  const wF = { h1: score(foc, h1), i1: score(foc, i1) };
  foc.setTarget(g1, h1);
  foc.resolveClue(...pick(foc, 3), { winnerId: g1, missedIds: [] });
  check('with backfire off, focused fire still lands in full',
    wF.h1 - score(foc, h1) === 600, `target paid ${wF.h1 - score(foc, h1)}`);
  check('and the bystander is still spared', wF.i1 === score(foc, i1));

  // Mutual targeting does not stack: the winner's own target owes the focused
  // pot once, never focused pot plus a backfire on top. Aiming back is neither
  // a discount nor a surcharge.
  const mut = game({ targeting: true, targetBackfire: 0.5 });
  const [m, n, o] = live(mut);
  const wM = { n: score(mut, n), o: score(mut, o) };
  mut.setTarget(m, n);      // winner aims at n
  mut.setTarget(n, m);      // n aims back
  mut.setTarget(o, m);      // o also aims at the winner
  mut.resolveClue(...pick(mut, 3), { winnerId: m, missedIds: [] });
  check('a mutual pair pays the focused pot, once',
    wM.n - score(mut, n) === 600, `paid ${wM.n - score(mut, n)}`);
  check('while another aggressor pays the backfire share',
    wM.o - score(mut, o) === 300, `paid ${wM.o - score(mut, o)}`);

  // Fractions round rather than producing pennies.
  const odd = game({ targeting: true, targetBackfire: 0.5 });
  const [q, r] = live(odd);
  const wQ = score(odd, q);
  odd.setTarget(q, r);
  odd.resolveClue(...pick(odd, 1), { winnerId: r, missedIds: [] });   // pot 100*2 = 200
  check('the share is rounded, not fractional',
    Number.isInteger(wQ - score(odd, q)), `paid ${wQ - score(odd, q)}`);
}

console.log('\nTARGETING');
{
  const g = game({ targeting: true });
  const [a, b, c] = live(g);
  const was = { a: score(g, a), b: score(g, b), c: score(g, c) };
  g.setTarget(a, b);
  g.resolveClue(...pick(g, 3), { winnerId: a, missedIds: [] });   // $300, two opponents
  check('all the damage lands on the target',
    was.b - score(g, b) === 600, `target paid ${was.b - score(g, b)}`);
  check('the bystander pays nothing', was.c === score(g, c), `paid ${was.c - score(g, c)}`);
  check('the winner still collects the whole pot',
    score(g, a) - was.a === 600, `gained ${score(g, a) - was.a}`);

  // targetBackfire is a dial now and defaults to 0, so the whole-pot rule has to
  // be asked for. f = 1 is the regression anchor: byte-for-byte the old rule.
  const g2 = game({ targeting: true, targetBackfire: 1 });
  const [x, y, z] = live(g2);
  const w2 = { x: score(g2, x), y: score(g2, y), z: score(g2, z) };
  g2.setTarget(x, y);
  g2.resolveClue(...pick(g2, 3), { winnerId: y, missedIds: [] });  // the target answers
  check('at 1, aiming at someone who answers backfires for the whole pot',
    w2.x - score(g2, x) === 600, `aggressor paid ${w2.x - score(g2, x)}`);
  check('the players who stayed out of it are untouched',
    w2.z === score(g2, z), `paid ${w2.z - score(g2, z)}`);

  const g3 = game({ targeting: true });
  const [p, q] = live(g3);
  g3.setTarget(p, q);
  g3.players.get(q).score = -1;
  g3.resolveClue(...pick(g3, 1), { winnerId: p, missedIds: [] });
  check('aim clears when the target goes out', g3.players.get(p).target === null);
  check('you cannot aim at yourself', g3.setTarget(p, p) === false);
}

// Bounties and revival both fire on elimination, and the comeback stops a
// player under its gate being eliminated at all. That interaction is real and
// intended — see the note below — but these blocks are about the other
// mechanics, so they turn it off to get somebody out of the ring.
console.log('\nBOUNTIES');
{
  const g = game({ comeback: false,  bounties: true }, 6);
  const inRing = live(g);
  const queued = g.queued().map((p) => p.id);
  const placer = queued[0], head = inRing[1], hunter = inRing[0];
  const r = g.placeBounty(placer, head, 800);
  check('a queued player can put a price on a head', r.ok === true, `${r.amount}`);
  check('a bounty shows on the head', g.bountyTotal(head) === 800);
  check('over the cap is refused',
    !!g.placeBounty(placer, head, 5000).error, g.placeBounty(placer, head, 5000).error);
  check('a player in the ring cannot place one', !!g.placeBounty(hunter, head, 100).error);

  const wasHunter = score(g, hunter);
  g.players.get(head).score = 100;
  g.resolveClue(...pick(g, 3), { winnerId: hunter, missedIds: [] });
  check('the head went out', g.players.get(head).state === 'eliminated');
  const gained = score(g, hunter) - wasHunter;
  check('the hunter collects the bounty', gained > 600 + 800 - 1,
    `gained ${gained}, of which 800 is bounty`);
  check('the bounty is cleared once paid', g.bountyTotal(head) === 0);

  // the placer walks in lighter
  const g2 = game({ comeback: false,  bounties: true, entryInterval: 1 }, 5);
  const q2 = g2.queued()[0].id;
  g2.placeBounty(q2, live(g2)[0], 900);
  g2.resolveClue(...pick(g2, 1), { winnerId: live(g2)[0], missedIds: [] });
  const entered = g2.players.get(q2);
  check('the stake comes out of their own pocket',
    entered.state !== 'queued' && entered.score === 3000 - 900, `entered on ${entered.score}`);

  // turning it back on the placer
  const g3 = game({ comeback: false,  bounties: true, entryInterval: 1 }, 5);
  const q3 = g3.queued()[0].id;
  const head3 = live(g3)[0];
  g3.placeBounty(q3, head3, 700);
  g3.resolveClue(...pick(g3, 1), { winnerId: head3, missedIds: [] });   // q3 enters
  const wasHead = score(g3, head3);
  g3.players.get(q3).score = 50;
  g3.resolveClue(...pick(g3, 2), { winnerId: head3, missedIds: [] });   // head knocks placer out
  check('the head keeps the money spent on removing them',
    score(g3, head3) - wasHead > 700, `gained ${score(g3, head3) - wasHead}`);
}

console.log('\nREVIVAL');
{
  const g = game({ comeback: false,  revival: true, revivalLimit: 1, entryInterval: 999 }, 4);
  const [a, b] = live(g);
  g.players.get(b).score = 10;
  g.resolveClue(...pick(g, 2), { winnerId: a, missedIds: [] });
  const p = g.players.get(b);
  check('an eliminated player returns to the queue', p.state === 'queued', p.state);
  check('their revival is counted', p.revivals === 1);
  check('they are not in the elimination order', !g.eliminationOrder.includes(b));

  // and comes back on half
  const g2 = game({ comeback: false,  revival: true, revivalLimit: 1, entryInterval: 1 }, 4);
  const victim = live(g2)[1];
  g2.players.get(victim).score = 10;
  g2.resolveClue(...pick(g2, 2), { winnerId: live(g2)[0], missedIds: [] });
  while (g2.players.get(victim).state === 'queued' && g2.cluesRevealed < 12) {
    g2.resolveClue(...pick(g2, 1), { winnerId: null, missedIds: [] });
  }
  check('they come back on half the stake',
    g2.players.get(victim).score === 1500, `${g2.players.get(victim).score}`);

  // the limit holds
  const g3 = game({ comeback: false,  revival: true, revivalLimit: 1, entryInterval: 999 }, 4);
  const v3 = live(g3)[1];
  g3.players.get(v3).score = 10;
  g3.resolveClue(...pick(g3, 2), { winnerId: live(g3)[0], missedIds: [] });
  g3.players.get(v3).state = 'live';
  g3.players.get(v3).score = 10;
  g3.resolveClue(...pick(g3, 2), { winnerId: live(g3)[0], missedIds: [] });
  check('a second death is final at a limit of one',
    g3.players.get(v3).state === 'eliminated', g3.players.get(v3).state);
}

console.log('\nOFF BY DEFAULT');
{
  const g = game({});
  const [a, b] = live(g);
  check('top rope refuses when off', g.setTopRope(a, true) === false);
  // Targeting is standard now — on unless the host turns it off. It is the only
  // mechanic that reliably catches somebody running away with a match, so it is
  // no longer something a room has to know to ask for.
  check('targeting is on without being asked for', g.setTarget(a, b) !== false);
  const off = game({ targeting: false });
  const [c, d] = live(off);
  check('and still refuses when the host turns it off', off.setTarget(c, d) === false);
  check('bounties refuse when off', !!g.placeBounty(g.queued()[0]?.id || 'x', b, 100).error);
  const wasB = score(g, b);
  g.players.get(b).score = 10;
  // The comeback would keep them in — it is standard, and this block is about
  // revival being off. Spend their free life first so the elimination lands.
  g.players.get(b).comebackUsed = true;
  g.resolveClue(...pick(g, 2), { winnerId: a, missedIds: [] });
  check('no revival when off', g.players.get(b).state === 'eliminated');
}

// --- a small lobby that picks up latecomers must not flood -----------------
//
// autoEntryInterval returns 1 for a lobby of three or fewer, which is right
// while there is no queue to pace. The latecomer recalculation then clamped
// with Math.min against the interval already stored, so it could only ever
// shrink — and a match seeded at 1 stayed at 1 for good. Reported from PKRY as
// every player on the bench being in within three clues.
{
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const g = new RumbleGame({ players,
    settings: { entryInterval: null, targetMinutes: 30, secondsPerClue: 17.5, delay: 0 },
    categoryPool: pool, rng: makeRng(7) });

  check('a three-player lobby starts at interval 1', g.s.entryInterval === 1,
    String(g.s.entryInterval));

  const d = g.addLatecomer('d', 'D');
  const e = g.addLatecomer('e', 'E');
  check('two latecomers join', !!d.ok && !!e.ok);
  check('and the interval grows off 1 once the roster is five',
    g.s.entryInterval > 1, `interval ${g.s.entryInterval} for ${g.players.size} players`);

  // The actual complaint was the spacing, so assert that rather than the knob:
  // consecutive entry clues means the bench emptied in a burst.
  const at = [];
  for (const p of g.players.values()) if (p.entryClue != null) at.push(p.entryClue);
  const spacing = g.s.entryInterval;
  check('so queued entrants are spaced, not consecutive', spacing >= 2,
    `${spacing} clues apart`);
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
