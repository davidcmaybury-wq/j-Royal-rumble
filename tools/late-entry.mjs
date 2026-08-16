// Entering during overtime.
//
// A real match: Randall came in at clue 150 with the standard 3,000 into x2
// overtime, lasted six clues without winning a race, was revived at 1,500 into
// x4 where the top row paid 2,000, and was gone after one. He never had a hand
// to play. Does scaling the stake to the multiplier give one back?
import { RumbleGame, makeRng, autoCeiling } from '../src/engine.js';
import { makeBot, planClue } from '../src/bots.js';

const ROW = [100, 200, 300, 400, 500];
function pool() { let n = 0; return () => { n++; return { id: 'c' + n, title: 'C' + n,
  clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; }; }

function run(seed, cfg) {
  const rng = makeRng(seed);
  const brains = new Map();
  const players = [];
  for (let i = 0; i < 8; i++) {
    players.push({ id: 'p' + i, name: 'P' + i });
    brains.set('p' + i, makeBot(rng, { level: 'normie' }));
  }
  const g = new RumbleGame({ players, rng, categoryPool: pool(),
    settings: { entryInterval: 6, startScore: 3000, ceiling: autoCeiling(8),
      ceilingFloor: 3000, ceilingDecayPerClue: null, overtime: true,
      // Revival on, because that is the case that actually happens: overtime
      // opens when the queue empties, so the people arriving into it are the
      // ones being brought back.
      overtimeEvery: 6, overtimeMax: 8, revival: true, revivalFraction: 0.5,
      ...cfg } });

  // Every time somebody goes from not-live to live, note the multiplier they
  // walked into and what they walked in with.
  const spells = [];
  const spellOf = new Map();       // id -> the spell they are currently living
  let guard = 0;
  while (!g.finished && guard++ < 500) {
    const liveNow = new Set(g.live().map((p) => p.id));
    for (const id of liveNow) {
      if (!spellOf.has(id)) {
        const sp = { mult: g.overtimeMultiplier(), from: g.cluesRevealed,
          stake: g.players.get(id).score, lasted: 0, won: false };
        spellOf.set(id, sp); spells.push(sp);
      }
    }
    for (const [id, sp] of spellOf) {
      if (!liveNow.has(id)) { sp.lasted = g.cluesRevealed - sp.from; spellOf.delete(id); }
    }
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
    g.resolveClue(s, r, { winnerId: f && f.correct ? f.id : null,
      missedIds: f && !f.correct ? [f.id] : [] });
  }
  for (const [, sp] of spellOf) { sp.lasted = g.cluesRevealed - sp.from; sp.won = true; }
  return spells.filter((sp) => sp.mult >= 2);
}

const CONFIGS = [
  ['fixed stake (as shipped)', { scaleEntryStake: false }],
  ['stake x multiplier      ', { scaleEntryStake: true }],
];
console.log('Eight players, overtime on. Anybody who enters at x2 or above.\n');
console.log('  setting                    n   median clues survived   died within 3   survived');
for (const [name, cfg] of CONFIGS) {
  const all = [];
  for (let s = 1; s <= 3000; s++) all.push(...run(s, cfg));
  if (!all.length) { console.log(`  ${name}  none entered during overtime`); continue; }
  const l = all.map((x) => x.lasted).sort((a, b) => a - b);
  const med = l[Math.floor(l.length / 2)];
  const quick = all.filter((x) => x.lasted <= 3).length / all.length * 100;
  const lived = all.filter((x) => x.won).length / all.length * 100;
  console.log(`  ${name}  ${String(all.length).padStart(4)}   ${String(med).padStart(19)}`
    + `   ${(quick.toFixed(0) + '%').padStart(13)}   ${(lived.toFixed(0) + '%').padStart(8)}`);
}
