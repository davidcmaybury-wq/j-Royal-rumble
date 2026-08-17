// Trigger study: WHEN should the comeback fire?
// Sweeps the gate (wins threshold, tenure, hybrid, none) and the overtime
// behavior (fire flat / don't fire in OT / fire with multiplier-scaled stake).
// Boost held at the shipped 70% for 40 races. Same calibrated model as before.
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
  const entered = new Map();     // id -> clue index entered the ring
  const used = new Set();
  const boostUntil = new Map();
  let raceIdx = 0, clueIdx = 0;
  const fires = { elite: 0, mid: 0, casual: 0 };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const sample = (p) => {
    let t = p.ms * Math.exp(SIGMA * gauss());
    if ((boostUntil.get(p.name) ?? -1) >= raceIdx) t *= 0.3;
    return t;
  };

  let guard = 0;
  while (!g.finished && guard++ < 5000) {
    for (const pl of g.live()) if (!entered.has(pl.id)) entered.set(pl.id, clueIdx);
    const open = [];
    g.board.forEach((cat, slot) =>
      cat.clues.forEach((c) => { if (!c.revealed) open.push([slot, c.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];
    const attempters = g.live().filter((pl) => {
      const prof = FIELD.find((f) => f.name === pl.id);
      return rng() < Math.pow(prof.att, ROW_EXP[row - 1]);
    });
    const timed = attempters.map((pl) => {
      const prof = FIELD.find((f) => f.name === pl.id);
      return [pl.id, sample(prof)];
    }).sort((a, b) => a[1] - b[1]);
    let winnerId = null; const missedIds = [];
    for (const [id] of timed) {
      const prof = FIELD.find((f) => f.name === id);
      if (rng() < prof.acc) { winnerId = id; break; }
      missedIds.push(id);
    }
    if (timed.length) { raceIdx++; if (winnerId) raceWins.set(winnerId, raceWins.get(winnerId) + 1); }
    const mult = g.overtimeMultiplier ? g.overtimeMultiplier() : 1;
    g.resolveClue(slot, row, { winnerId, missedIds });
    clueIdx++;

    if (cfg.comeback) {
      for (const p of g.players.values()) {
        if (p.state !== 'eliminated' || used.has(p.id)) continue;
        used.add(p.id);   // one eligibility check per player, fire or not
        const wins = raceWins.get(p.id);
        const ten = clueIdx - (entered.get(p.id) ?? 0);
        let ok = false;
        if (cfg.gate === 'none') ok = true;
        else if (cfg.gate === 'wins') ok = wins < cfg.k;
        else if (cfg.gate === 'tenure') ok = ten < cfg.t;
        else if (cfg.gate === 'hybrid') ok = wins < cfg.k || ten < cfg.t;
        if (!ok) continue;
        const inOT = mult > 1;
        if (inOT && cfg.ot === 'skip') continue;
        const stake = Math.round(settings.startScore * 0.5 * (inOT && cfg.ot === 'scaled' ? mult : 1));
        g.adjustScore(p.id, stake - p.score);
        boostUntil.set(p.id, raceIdx + 40);
        fires[TIER[p.id]]++;
      }
    }
  }
  return { winner: g.winnerId, clues: g.cluesRevealed, fires };
}

function run(label, cfg, runs = 1500) {
  const wins = { elite: 0, mid: 0, casual: 0, A: 0 };
  const fires = { elite: 0, mid: 0, casual: 0 };
  let clues = 0, done = 0;
  for (let s = 1; s <= runs; s++) {
    const r = simulate(cfg, s);
    if (!r.winner) continue;
    done++;
    wins[TIER[r.winner]]++;
    if (r.winner === 'EliteA') wins.A++;
    clues += r.clues;
    for (const k of ['elite','mid','casual']) fires[k] += r.fires[k];
  }
  const pc = (v) => (v / done * 100).toFixed(1).padStart(5) + '%';
  const fm = (v) => (v / done).toFixed(1);
  console.log(`${label.padEnd(30)} topShark ${pc(wins.A)}  elite ${pc(wins.elite)}  mid ${pc(wins.mid)}  casual ${pc(wins.casual)}  ` +
    `clues ${(clues/done).toFixed(0)}  fires e/m/c ${fm(fires.elite)}/${fm(fires.mid)}/${fm(fires.casual)}`);
}

console.log('Gate sweep — boost fixed at 70% for 40 races, half stake. 1,500 sims each.\n');
run('no comeback', {});
run('gate: wins < 1', { comeback: true, gate: 'wins', k: 1, ot: 'flat' });
run('gate: wins < 2', { comeback: true, gate: 'wins', k: 2, ot: 'flat' });
run('gate: wins < 3  (shipped)', { comeback: true, gate: 'wins', k: 3, ot: 'flat' });
run('gate: wins < 5', { comeback: true, gate: 'wins', k: 5, ot: 'flat' });
run('gate: none (everyone)', { comeback: true, gate: 'none', ot: 'flat' });
run('gate: tenure < 12 clues', { comeback: true, gate: 'tenure', t: 12, ot: 'flat' });
run('gate: wins<3 OR tenure<12', { comeback: true, gate: 'hybrid', k: 3, t: 12, ot: 'flat' });
console.log('\nOvertime behavior — gate fixed at wins<3:\n');
run('OT: fire flat (shipped)', { comeback: true, gate: 'wins', k: 3, ot: 'flat' });
run('OT: no fire in overtime', { comeback: true, gate: 'wins', k: 3, ot: 'skip' });
run('OT: stake scales with mult', { comeback: true, gate: 'wins', k: 3, ot: 'scaled' });
