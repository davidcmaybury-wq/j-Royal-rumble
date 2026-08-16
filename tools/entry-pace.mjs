// How fast should people be fed into a small field?
//
// The auto interval used to cap at 15 clues and four-to-six player games always
// hit it, so every small match had identical pacing. David wants the option of
// five. The question is what that costs: entering sooner means facing more
// opponents for longer, and the whole point of a staggered entry is that a late
// draw should not be doomed by arriving into a room full of money.
import { RumbleGame, makeRng, autoCeiling } from '../src/engine.js';
import { makeBot, planClue } from '../src/bots.js';
import { writeFileSync } from 'fs';

const ROW = [100, 200, 300, 400, 500];
function pool() { let n = 0; return () => { n++; return { id: 'c' + n, title: 'C' + n,
  clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; }; }

function run(field, iv, seed) {
  const rng = makeRng(seed);
  const brains = new Map();
  const players = [];
  for (let i = 0; i < field; i++) {
    players.push({ id: 'p' + i, name: 'P' + i });
    brains.set('p' + i, makeBot(rng, { level: 'normie' }));
  }
  const g = new RumbleGame({ players, rng, categoryPool: pool(),
    settings: { entryInterval: iv, startScore: 3000, ceiling: autoCeiling(field),
      ceilingFloor: 3000, ceilingDecayPerClue: null, targetMinutes: 30 } });

  let guard = 0;
  while (!g.finished && guard++ < 600) {
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
  const w = [...g.players.values()]
    .find((p) => p.state === 'winner' || (g.finished && p.state === 'live'));
  if (!w) return null;
  // When did the last person get in, as a share of the match?
  const lastIn = Math.max(...[...g.players.values()].map((p) => p.enteredAtClue ?? 0));
  return { draw: w.originalDraw ?? w.drawNumber, clues: g.cluesRevealed,
    lastInAt: g.cluesRevealed ? lastIn / g.cluesRevealed : 1 };
}

const RUNS = 2500;
function study(field, iv) {
  const wins = new Array(field + 1).fill(0);
  const lens = []; let d = 0, lastIn = 0;
  for (let s = 1; s <= RUNS; s++) {
    const r = run(field, iv, s);
    if (!r) continue;
    d++; wins[r.draw]++; lens.push(r.clues); lastIn += r.lastInAt;
  }
  lens.sort((a, b) => a - b);
  const half = Math.ceil(field / 2);
  const early = wins.slice(1, half + 1).reduce((a, b) => a + b, 0) / d * 100;
  const late = wins.slice(half + 1).reduce((a, b) => a + b, 0) / d * 100;
  return {
    iv, field,
    backHalf: +late.toFixed(1),
    ratio: +(late / early).toFixed(3),
    mins: Math.round(lens[Math.floor(d / 2)] * 17.5 / 60),
    clues: lens[Math.floor(d / 2)],
    lastInAt: +(lastIn / d * 100).toFixed(0),
    byDraw: wins.slice(1).map((w) => +(w / d * 100).toFixed(1)),
  };
}

const IVS = [3, 4, 5, 6, 8, 10, 12, 15, 20];
const FIELDS = [4, 6, 8, 12];
const out = { ivs: IVS, fields: FIELDS, rows: {} };
console.log('Entry interval against fairness. 2,500 matches each.\n');
for (const field of FIELDS) {
  out.rows[field] = [];
  console.log(`${field} players — a fair back half is 50%`);
  console.log('  every   back half   late/early   median length   all in by');
  for (const iv of IVS) {
    const r = study(field, iv);
    out.rows[field].push(r);
    console.log(`  ${String(iv).padStart(5)}   ${(r.backHalf + '%').padStart(9)}`
      + `   ${r.ratio.toFixed(2).padStart(10)}   ${(r.clues + ' clues').padStart(14)}`
      + `   ${(r.lastInAt + '%').padStart(9)}`);
  }
  console.log('');
}
writeFileSync('/tmp/entrypace.json', JSON.stringify(out));
