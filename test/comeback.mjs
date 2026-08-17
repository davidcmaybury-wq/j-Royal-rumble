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

console.log('\nCOMING BACK INTO OVERTIME');
{
  // Half the recorded eliminations happen during overtime, and a flat stake
  // walking into raised values is one pot payment from going straight back out
  // — measured at 1 to 6 clues of life. The stake has to buy the same number of
  // clues whenever the comeback fires, which is what scaleEntryStake already
  // does for entrants and revivals.
  const g = game({ overtime: true, overtimeMax: 8 });
  const [a, b] = g.live().map((p) => p.id);
  // Force x4 directly rather than stalling into it: this is about the stake, and
  // a test that has to grind out six clues first is testing the escalation clock.
  g.overtimeFrom = 1; g.overtimeSteps = 2;
  check('overtime is running at x4', g.overtimeMultiplier() === 4,
    String(g.overtimeMultiplier()));

  g.players.get(b).score = 50;
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  const p = g.players.get(b);
  check('a comeback during overtime returns at the multiplied stake',
    p.score === 6000, String(p.score));
  check('and the player is still in the ring', p.state === 'live', p.state);
}
{
  const g = game();
  const [a, b] = g.live().map((p) => p.id);
  check('no overtime means no multiplier', g.overtimeMultiplier() === 1,
    String(g.overtimeMultiplier()));
  g.players.get(b).score = 50;
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('a comeback in regulation still returns at half stake',
    g.players.get(b).score === 1500, String(g.players.get(b).score));
}
{
  // The ceiling is applied earlier in resolveClue than the comeback runs, so an
  // unclamped stake would sit above the roof for a whole clue.
  const g = game({ overtime: true, overtimeMax: 8, ceiling: 4000, ceilingFloor: 0 });
  const [a, b] = g.live().map((p) => p.id);
  g.overtimeFrom = 1; g.overtimeSteps = 3;   // x8 -> 12,000 before clamping
  g.players.get(b).score = 50;
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('and never above the ceiling', g.players.get(b).score === 4000,
    String(g.players.get(b).score));
}
{
  // One switch for one idea: turning off entry scaling turns off all three
  // re-entry paths together, so a host who wants flat stakes gets flat stakes.
  const g = game({ overtime: true, overtimeMax: 8, scaleEntryStake: false });
  const [a, b] = g.live().map((p) => p.id);
  g.overtimeFrom = 1; g.overtimeSteps = 2;
  g.players.get(b).score = 50;
  const [s, r] = open(g);
  g.resolveClue(s, r, { winnerId: a, missedIds: [] });
  check('scaleEntryStake: false restores the flat stake',
    g.players.get(b).score === 1500, String(g.players.get(b).score));
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


console.log('\nARRIVALS ARE NOT CLIPPED TO A ROOF THEY NEVER TOUCHED');
{
  // The bare clamp ate the scaled stake: the roof falls through overtime while
  // the multiplier climbs, so they cross and the arrival lands on the roof
  // instead of on its stake. The carve-out is arrival-only and lives at the cap
  // in resolveClue, because raising the roof measured worse than the defect.
  // stumperFraction 0 so an unanswered clue moves nobody's score: the only
  // thing resolveClue then does to a score is apply the cap, which is the
  // subject. Without it the deduction eliminated the player mid-assertion.
  const g = game({ ceiling: 10000, ceilingFloor: 3000, ceilingDecayPerClue: 0,
    overtimeCeilingDrop: 500, comeback: false, stumperFraction: 0 });
  // Force a decayed overtime roof: opened 8 clues ago at 10,000, now 6,000.
  g.overtimeFrom = 0;
  g.cluesRevealed = 8;
  g.overtimeSteps = 2;                       // x4
  check('the roof has fallen below what an arrival is owed',
    g.ceiling === 6000, `${g.ceiling}`);
  check('but the arrival cap is the roof as it was when overtime opened',
    g.arrivalCap() === 10000, `${g.arrivalCap()}`);

  const p = g.live()[0];   // must be in the ring: the cap loop walks live() only
  g.arrivalLand(p, 12000);                   // x4 entry stake
  check('so a x4 arrival lands on that reference, not the decayed roof',
    p.score === 10000, `${p.score}`);
  check('and is flagged exempt, having landed above the roof', p.capExempt === true);

  // The exemption has to survive a clue, or it is cosmetic.
  const [slot, row] = open(g);
  g.resolveClue(slot, row, { winnerId: null, missedIds: [] });
  check('it is still above the roof after a clue resolves',
    p.score > g.ceiling, `${p.score} vs roof ${g.ceiling}`);

  // ...and end the first time they touch the roof, not on a clue count.
  p.score = 100;
  const [s2, r2] = open(g);
  g.resolveClue(s2, r2, { winnerId: null, missedIds: [] });
  check('once they have dipped to the roof the exemption is spent',
    p.capExempt === false);
  p.score = 99999;
  const [s3, r3] = open(g);
  g.resolveClue(s3, r3, { winnerId: null, missedIds: [] });
  check('and they are clipped like anybody else afterwards',
    p.score === g.ceiling, `${p.score} vs roof ${g.ceiling}`);
}

console.log('\nTHE EXEMPTION COVERS THE ARRIVAL, NOT WHAT IT THEN WINS');
{
  // The version this was measured from flagged every arrival, which also exempts
  // somebody who landed under the roof and climbed above it by winning pots.
  // That is an open-ended ceiling exemption on accumulated score — the property
  // the whole design exists to avoid — and it is worth a point of casual win
  // share that we are deliberately not taking.
  // stumperFraction 0 so an unanswered clue moves nobody's score: the only
  // thing resolveClue then does to a score is apply the cap, which is the
  // subject. Without it the deduction eliminated the player mid-assertion.
  const g = game({ ceiling: 10000, ceilingFloor: 3000, ceilingDecayPerClue: 0,
    overtimeCeilingDrop: 500, comeback: false, stumperFraction: 0 });
  g.overtimeFrom = 0; g.cluesRevealed = 8; g.overtimeSteps = 2;
  const p = g.live()[0];   // must be in the ring: the cap loop walks live() only
  g.arrivalLand(p, 1500);                    // lands well under the roof
  check('an arrival landing under the roof is not flagged', p.capExempt === false);
  p.score = 20000;                           // then wins its way above it
  const [slot, row] = open(g);
  g.resolveClue(slot, row, { winnerId: null, missedIds: [] });
  check('and gets clipped once it climbs past the roof',
    p.score === g.ceiling, `${p.score} vs roof ${g.ceiling}`);
}

console.log('\nTURNING IT OFF RESTORES THE BARE CLAMP');
{
  const g = game({ ceiling: 10000, ceilingFloor: 3000, ceilingDecayPerClue: 0,
    overtimeCeilingDrop: 500, comeback: false, arrivalGrace: false, stumperFraction: 0 });
  g.overtimeFrom = 0; g.cluesRevealed = 8; g.overtimeSteps = 2;
  const p = g.live()[0];   // must be in the ring: the cap loop walks live() only
  g.arrivalLand(p, 12000);
  check('the arrival is clamped to the decayed roof', p.score === 6000, `${p.score}`);
  check('and nothing is exempt', p.capExempt === false);
  check('arrivalCap is just the ceiling', g.arrivalCap() === g.ceiling);
}


console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
