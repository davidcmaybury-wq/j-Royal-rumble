// Backfire study: is the targeting backfire rule counterproductive for the
// weak side of the field?
//
// Finding that prompted it: in the voltron study, six normies coordinating
// their targets on the richest shark COLLAPSED (normies 5.5% vs 17.3% with no
// targeting) because an aimed miss pays the whole pot and sharks win most
// races. Question: remove the backfire rule (a miss at your target costs no
// more than any other miss) — do the normies get their targeting lever back?
//
// Needs the engine's `targetBackfire: false` experiment gate (instrumentation
// patch no-backfire-experiment.patch against 8a831e0 — revert before shipping).
// Same 12-player field and race model as voltron-study; 6,000 runs per row.
// Backfire-ON rows use the same seeds as voltron-study and must reproduce it —
// that is the regression check that the patch's default path is untouched.
//
// Also measured: the no-backfire equilibrium. Without the penalty, holding a
// target is a free option (upside when you win, no cost when you lose), so
// EVERYONE should always aim at the leader — that row is what the game
// becomes if the rule is removed, not the polite one-sided rows.
import { RumbleGame, makeRng, ROW_VALUES } from '../src/engine.js';

const ROW_EXP = [0.48, 0.67, 0.85, 1.10, 1.40];
const FIELD = [
  { name: 'SharkA', ms: 95,  att: 0.85, acc: 0.88 },
  { name: 'SharkB', ms: 130, att: 0.80, acc: 0.88 },
  { name: 'AvgA',   ms: 150, att: 0.68, acc: 0.84 },
  { name: 'AvgB',   ms: 160, att: 0.65, acc: 0.84 },
  { name: 'AvgC',   ms: 170, att: 0.62, acc: 0.83 },
  { name: 'AvgD',   ms: 180, att: 0.60, acc: 0.82 },
  { name: 'NormA',  ms: 210, att: 0.55, acc: 0.80 },
  { name: 'NormB',  ms: 222, att: 0.53, acc: 0.79 },
  { name: 'NormC',  ms: 234, att: 0.51, acc: 0.79 },
  { name: 'NormD',  ms: 246, att: 0.49, acc: 0.78 },
  { name: 'NormE',  ms: 258, att: 0.47, acc: 0.77 },
  { name: 'NormF',  ms: 270, att: 0.45, acc: 0.76 },
];
const PROF = new Map(FIELD.map((p) => [p.name, p]));
const isShark = (id) => id.startsWith('Shark');
const isNorm = (id) => id.startsWith('Norm');
const SIGMA = 0.45;

function simulate(cfg, seed) {
  const rng = makeRng(seed);
  const players = FIELD.map((p) => ({ id: p.name, name: p.name }));
  let n = 0;
  const pool = () => ({
    id: `cat${++n}`, title: `C${n}`,
    clues: ROW_VALUES.map((v, i) => ({ id: `c${n}-${i + 1}`, row: i + 1, text: '', answer: '' })),
  });
  const settings = {
    startScore: 3000, targetMinutes: 45,
    stables: !!(cfg.sharkStable || cfg.voltron),
    // Always explicit. This study was written when the engine's default WAS the
    // whole-pot rule, so its "backfire ON" rows relied on that default — and the
    // moment 0.94.0 made the default 0, those rows silently measured "off" and
    // printed identically to the no-backfire rows. Same trap comeback-study fell
    // into. Never let a study depend on a default it does not set.
    targetBackfire: cfg.noBackfire ? 0 : (cfg.bfFrac != null ? cfg.bfFrac : 1),
  };
  const g = new RumbleGame({ players, settings, categoryPool: pool, rng });
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

  let sharkStableId = null, voltId = null, voltWon = false;
  let guard = 0;
  while (!g.finished && guard++ < 5000) {
    if (settings.stables && !voltWon) {
      for (const p of g.live()) {
        if (p.stable) continue;
        if (cfg.sharkStable && isShark(p.id)) {
          if (!sharkStableId) { const r = g.createStable(p.id); if (r.ok) sharkStableId = r.id; }
          else g.joinStable(p.id, sharkStableId);
        } else if (cfg.voltron && isNorm(p.id)) {
          if (!voltId) { const r = g.createStable(p.id); if (r.ok) voltId = r.id; }
          else g.joinStable(p.id, voltId);
        }
      }
    }
    // targeting strategies
    if (cfg.normTarget) {
      const sharks = g.live().filter((p) => isShark(p.id));
      const t = sharks.length ? sharks.reduce((a, b) => (a.score >= b.score ? a : b)).id : null;
      for (const p of g.live()) if (isNorm(p.id)) g.setTarget(p.id, t);
    }
    if (cfg.sharkTarget) {
      for (const p of g.live()) {
        if (!isShark(p.id)) continue;
        const outs = g.live().filter((x) => x.id !== p.id && !(x.stable && x.stable === p.stable));
        g.setTarget(p.id, outs.length ? outs.reduce((a, b) => (a.score >= b.score ? a : b)).id : null);
      }
    }
    if (cfg.allTarget) {
      // The free-option equilibrium: everyone aims at the richest live opponent
      // outside their own stable.
      for (const p of g.live()) {
        const outs = g.live().filter((x) => x.id !== p.id && !(x.stable && x.stable === p.stable));
        g.setTarget(p.id, outs.length ? outs.reduce((a, b) => (a.score >= b.score ? a : b)).id : null);
      }
    }

    const open = [];
    g.board.forEach((cat, slot) =>
      cat.clues.forEach((c) => { if (!c.revealed) open.push([slot, c.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];
    const attempters = g.live().filter((pl) => rng() < Math.pow(PROF.get(pl.id).att, ROW_EXP[row - 1]));
    const timed = attempters.map((pl) => {
      let t = PROF.get(pl.id).ms * Math.exp(SIGMA * gauss());
      t *= g.buzzEdge(pl.id);
      return [pl.id, t];
    }).sort((a, b) => a[1] - b[1]);
    let winnerId = null; const missedIds = [];
    for (const [id] of timed) {
      if (rng() < PROF.get(id).acc) { winnerId = id; break; }
      missedIds.push(id);
    }
    g.resolveClue(slot, row, { winnerId, missedIds });
    if (voltId && !voltWon && g.log.some((e) => e.stableWon && e.stableWon.id === voltId)) voltWon = true;
  }
  return { winner: g.winnerId, clues: g.cluesRevealed, voltWon };
}

const RUNS = Number(process.env.RUMBLE_RUNS_STUDY || 6000);
function run(label, cfg) {
  const wins = { shark: 0, avg: 0, norm: 0, A: 0 };
  let clues = 0, done = 0, vwon = 0;
  for (let s = 1; s <= RUNS; s++) {
    const r = simulate(cfg, s);
    if (!r.winner) continue;
    done++;
    wins[isShark(r.winner) ? 'shark' : isNorm(r.winner) ? 'norm' : 'avg']++;
    if (r.winner === 'SharkA') wins.A++;
    clues += r.clues; if (r.voltWon) vwon++;
  }
  const pc = (v) => (v / done * 100).toFixed(1).padStart(5) + '%';
  console.log(`${label.padEnd(52)} sharks ${pc(wins.shark)} (top ${pc(wins.A)})  avg ${pc(wins.avg)}  normies ${pc(wins.norm)}  voltron-clears ${pc(vwon)}  clues ${(clues/done).toFixed(0)}`);
}

console.log(`Backfire study — 12-player field, ${RUNS} matches per row. Engine comeback on throughout.\n`);
console.log('--- regression check: backfire ON must reproduce voltron-study exactly ---');
run('voltron + target richest shark', { voltron: true, sharkStable: true, normTarget: true });
run('voltron + mutual targeting', { voltron: true, sharkStable: true, normTarget: true, sharkTarget: true });
console.log('\n--- backfire OFF: does the normies\' targeting lever come back? ---');
run('voltron + target richest shark, no backfire', { voltron: true, sharkStable: true, normTarget: true, noBackfire: true });
run('voltron + mutual targeting, no backfire', { voltron: true, sharkStable: true, normTarget: true, sharkTarget: true, noBackfire: true });
run('voltron, no targeting, no backfire (control)', { voltron: true, sharkStable: true, noBackfire: true });
console.log('\n--- the equilibrium rows: targeting is a free option without backfire ---');
run('stag, everyone targets the leader, backfire ON', { allTarget: true });
run('stag, everyone targets the leader, no backfire', { allTarget: true, noBackfire: true });
run('voltron + everyone targets leader, no backfire', { voltron: true, sharkStable: true, allTarget: true, noBackfire: true });
console.log('\n--- the dial: an aimed miss pays a FRACTION of the pot ---');
run('voltron + target richest shark, backfire x0.5', { voltron: true, sharkStable: true, normTarget: true, bfFrac: 0.5 });
run('voltron + target richest shark, backfire x0.25', { voltron: true, sharkStable: true, normTarget: true, bfFrac: 0.25 });
run('stag, everyone targets leader, backfire x0.5', { allTarget: true, bfFrac: 0.5 });
run('stag, everyone targets leader, backfire x0.25', { allTarget: true, bfFrac: 0.25 });
console.log('\n--- DECIDED CONFIGS (no-stack mutual rule live in the patch) ---');
console.log('Arcade/chaos default: backfire off — identical to the no-backfire rows above.');
console.log('Tournament default: backfire x0.5, mutual pays the focused pot (max, not sum):');
run('T: voltron + target richest shark, x0.5', { voltron: true, sharkStable: true, normTarget: true, bfFrac: 0.5 });
run('T: voltron + mutual targeting, x0.5', { voltron: true, sharkStable: true, normTarget: true, sharkTarget: true, bfFrac: 0.5 });
run('T: stag, everyone targets leader, x0.5', { allTarget: true, bfFrac: 0.5 });
