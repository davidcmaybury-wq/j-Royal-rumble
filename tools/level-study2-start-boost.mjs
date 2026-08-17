// Level-the-field study 3: race-structure and knowledge levers.
// - Photo-finish window: buzzes within W ms of the fastest enter a random draw.
// - Winner cooldown: the player who took the last race can't buzz the next one.
// - Trailing pick: the lowest-score live player picks the category (modeled as a
//   1.5x attempt-rate multiplier on their own pick — assumption-heavy, labeled so).
// Comeback (shipped config, OT-scaled stake) available for combination runs.
import { RumbleGame, makeRng, ROW_VALUES, autoEntryInterval } from '../src/engine.js';

const ROW_EXP = [0.48, 0.67, 0.85, 1.10, 1.40];
const FIELD = [
  { name: 'EliteA',  ms: 95,  att: 0.85, acc: 0.88 },
  { name: 'EliteB',  ms: 130, att: 0.80, acc: 0.88 },
  { name: 'Mid',     ms: 160, att: 0.65, acc: 0.84 },
  { name: 'CasualA', ms: 210, att: 0.55, acc: 0.80 },
  { name: 'CasualB', ms: 240, att: 0.50, acc: 0.78 },
  { name: 'CasualC', ms: 270, att: 0.45, acc: 0.76 },
];
const TIER = { EliteA:'elite', EliteB:'elite', Mid:'mid', CasualA:'casual', CasualB:'casual', CasualC:'casual' };
const SIGMA = 0.45;

function simulate(cfg, seed) {
  const rng = makeRng(seed);
  const players = FIELD.map((p) => ({ id: p.name, name: p.name }));
  let n = 0;
  const pool = () => ({
    id: `cat${++n}`, title: `C${n}`,
    clues: ROW_VALUES.map((v, i) => ({ id: `c${n}-${i + 1}`, row: i + 1, text: '', answer: '' })),
  });
  const settings = { startScore: 3000, ceiling: 7500, entryInterval: autoEntryInterval(6, 30, 17.5) };
  const g = new RumbleGame({ players, settings, categoryPool: pool, rng });

  const raceWins = new Map(FIELD.map((p) => [p.name, 0]));
  const used = new Set();
  const boostUntil = new Map();
  let raceIdx = 0, lastWinner = null;
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

  let guard = 0;
  while (!g.finished && guard++ < 5000) {
    const open = [];
    g.board.forEach((cat, slot) =>
      cat.clues.forEach((c) => { if (!c.revealed) open.push([slot, c.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];

    const live = g.live();
    const trailing = live.length ? live.reduce((a, b) => (a.score <= b.score ? a : b)).id : null;
    const attempters = live.filter((pl) => {
      if (cfg.cooldown && pl.id === lastWinner) return false;
      const prof = FIELD.find((f) => f.name === pl.id);
      let att = Math.pow(prof.att, ROW_EXP[row - 1]);
      if (cfg.trailingPick && pl.id === trailing) att = Math.min(0.95, att * 1.5);
      return rng() < att;
    });
    const timed = attempters.map((pl) => {
      const prof = FIELD.find((f) => f.name === pl.id);
      let t = prof.ms * Math.exp(SIGMA * gauss());
      if ((boostUntil.get(pl.id) ?? -1) >= raceIdx) t *= 0.3;
      return [pl.id, t];
    }).sort((a, b) => a[1] - b[1]);
    // start-boost experiment: grant the 70%/40-race edge AT ENTRY
    if (cfg.startBoost) {
      for (const pl of live) {
        if (boostUntil.has(pl.id)) continue;
        const isCasual = pl.id.startsWith('Casual');
        if (cfg.startBoost === 'oracle' && !isCasual) { continue; }
        boostUntil.set(pl.id, raceIdx + 40);
      }
    }

    // photo-finish window: everyone within W of the fastest enters a uniform draw
    let order = timed.map(([id]) => id);
    if (cfg.window && timed.length > 1) {
      const t0 = timed[0][1];
      const inWin = timed.filter(([, t]) => t <= t0 + cfg.window).map(([id]) => id);
      if (inWin.length > 1) {
        const pick = inWin[Math.floor(rng() * inWin.length)];
        order = [pick, ...order.filter((id) => id !== pick)];
      }
    }
    let winnerId = null; const missedIds = [];
    for (const id of order) {
      const prof = FIELD.find((f) => f.name === id);
      if (rng() < prof.acc) { winnerId = id; break; }
      missedIds.push(id);
    }
    if (timed.length) { raceIdx++; if (winnerId) raceWins.set(winnerId, raceWins.get(winnerId) + 1); }
    if (winnerId) lastWinner = winnerId;
    const mult = g.overtimeMultiplier ? g.overtimeMultiplier() : 1;
    g.resolveClue(slot, row, { winnerId, missedIds });

    if (cfg.comeback) {
      for (const p of g.players.values()) {
        if (p.state !== 'eliminated' || used.has(p.id)) continue;
        used.add(p.id);
        if (raceWins.get(p.id) >= 3) continue;
        const stake = Math.round(settings.startScore * 0.5 * (mult > 1 ? mult : 1));
        g.adjustScore(p.id, stake - p.score);
        boostUntil.set(p.id, raceIdx + 40);
      }
    }
  }
  return { winner: g.winnerId, clues: g.cluesRevealed };
}

function run(label, cfg, runs = 1500) {
  const wins = { elite: 0, mid: 0, casual: 0, A: 0 };
  let clues = 0, done = 0;
  for (let s = 1; s <= runs; s++) {
    const r = simulate(cfg, s);
    if (!r.winner) continue;
    done++; wins[TIER[r.winner]]++;
    if (r.winner === 'EliteA') wins.A++;
    clues += r.clues;
  }
  const pc = (v) => (v / done * 100).toFixed(1).padStart(5) + '%';
  console.log(`${label.padEnd(34)} topShark ${pc(wins.A)}  mid ${pc(wins.mid)}  casual ${pc(wins.casual)}  clues ${(clues/done).toFixed(0)}`);
}

console.log('Race-structure and knowledge levers. 1,500 sims each.\n');
run('baseline', {});
run('photo-finish window 25ms', { window: 25 });
run('photo-finish window 50ms', { window: 50 });
run('photo-finish window 100ms', { window: 100 });
run('winner cooldown (sit one race)', { cooldown: true });
run('trailing player picks category', { trailingPick: true });
console.log('\nCombined with the shipped comeback (gate<3, 70%/40, OT-scaled):\n');
run('comeback alone (reference)', { comeback: true });
run('comeback + window 50ms', { comeback: true, window: 50 });
run('comeback + cooldown', { comeback: true, cooldown: true });
run('comeback + window 50 + cooldown', { comeback: true, window: 50, cooldown: true });

console.log('\n--- warm-up-triggered start boost (70%/40 races at entry) ---');
run('start boost, perfect oracle', { startBoost: 'oracle' });
run('start boost, everyone (gameable)', { startBoost: 'everyone' });
run('oracle start + shipped comeback', { startBoost: 'oracle', comeback: true });
