// Drives the shipping engine with simulated buzzer outcomes to verify that
// the tuning presets still hold after any rules change.

import { RumbleGame, makeRng, ROW_VALUES, autoEntryInterval } from '../src/engine.js';

const KNOW_BY_ROW = [0.82, 0.72, 0.62, 0.50, 0.38];
const WRONG_BUZZ = 0.07;

function makePool(rng) {
  let n = 0;
  return () => {
    n += 1;
    return {
      id: `cat${n}`, title: `CATEGORY ${n}`,
      clues: ROW_VALUES.map((v, i) => ({
        id: `c${n}-${i + 1}`, row: i + 1, text: '', answer: '',
      })),
    };
  };
}

function simulate(playerCount, settings, seed) {
  const rng = makeRng(seed);
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`, name: `P${i}`,
  }));
  const skillAdj = new Map(players.map((p) => [p.id, gauss(rng) * 0.10]));
  const g = new RumbleGame({ players, settings, categoryPool: makePool(rng), rng });

  let guard = 0;
  while (!g.finished && guard++ < 4000) {
    const open = [];
    g.board.forEach((cat, slot) =>
      cat.clues.forEach((c) => { if (!c.revealed) open.push([slot, c.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];

    const contenders = shuffle(g.live().slice(), rng);
    let winnerId = null;
    const missedIds = [];
    for (const p of contenders) {
      const know = clamp(KNOW_BY_ROW[row - 1] + skillAdj.get(p.id), 0.05, 0.97);
      if (rng() < know) { winnerId = p.id; break; }
      if (rng() < WRONG_BUZZ) missedIds.push(p.id);
    }
    g.resolveClue(slot, row, { winnerId, missedIds });
  }

  const winner = g.players.get(g.winnerId);
  const skillRank = [...g.players.values()]
    .sort((a, b) => skillAdj.get(b.id) - skillAdj.get(a.id))
    .findIndex((p) => p.id === g.winnerId) + 1;
  return {
    clues: g.cluesRevealed,
    draw: winner?.drawNumber ?? null,
    skillRank,
    fieldClears: g.fieldClears,
    finalCeiling: g.ceiling,
  };
}

// 600 is enough for the preset check this runs on every deploy, and is not
// enough to compare two configurations: at 600 the back-half figure moved 2-3
// points between neighbouring settings that turned out to be identical at 6,000.
// Raise it with RUMBLE_RUNS when measuring rather than verifying.
function run(label, playerCount, settings, runs = Number(process.env.RUMBLE_RUNS || 600)) {
  const rows = [];
  for (let s = 1; s <= runs; s++) rows.push(simulate(playerCount, settings, s));
  const clues = rows.map((r) => r.clues).sort((a, b) => a - b);
  const sec = settings.secondsPerClue ?? 17.5;
  const half = Math.ceil(playerCount / 2);
  const backHalf = rows.filter((r) => r.draw > half).length / runs;
  const top3 = rows.filter((r) => r.skillRank <= 3).length / runs;
  const med = clues[Math.floor(runs / 2)];
  const p90 = clues[Math.floor(runs * 0.9)];
  console.log(
    `${label.padEnd(24)} ${fmt(med * sec / 60, 5)}m  p90 ${fmt(p90 * sec / 60, 4)}m` +
    `   back-half ${pct(backHalf)}   skill ${pct(top3)}` +
    `   clears ${mean(rows.map((r) => r.fieldClears)).toFixed(2)}`);
}

const gauss = (rng) =>
  Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (v) => `${(v * 100).toFixed(0)}%`.padStart(4);
const fmt = (v, w) => v.toFixed(0).padStart(w);
function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

console.log('Verifying presets against the shipping engine.');
console.log('back-half = win rate of draws in the second half (50% is fair)');
console.log('skill = win rate of the 3 strongest players (10% is chance)\n');
// The intervals the app actually computes at a 30-minute target, not the ones
// from the original 60-minute tuning. The old presets meant this harness had
// been reporting on settings nobody uses — its back-half figure said 65% where
// the live settings give 41%.
run('10 players', 10, { startScore: 3000, ceiling: 7500, entryInterval: autoEntryInterval(10, 30, 17.5) });
run('16 players', 16, { startScore: 3000, ceiling: 7500, entryInterval: autoEntryInterval(16, 30, 17.5) });
run('20 players', 20, { startScore: 3000, ceiling: 7500, entryInterval: autoEntryInterval(20, 30, 17.5) });
run('30 players', 30, { startScore: 3000, ceiling: 11000, entryInterval: autoEntryInterval(30, 30, 17.5) });
console.log('');
run('30p, no ceiling decay', 30, { startScore: 3000, ceiling: 11000, ceilingDecayPerClue: 0, entryInterval: 5 });
run('30p, flat gain (no pot)', 30, { startScore: 5000, ceiling: 99999, ceilingDecayPerClue: 0, entryInterval: 6, potScoring: false });
