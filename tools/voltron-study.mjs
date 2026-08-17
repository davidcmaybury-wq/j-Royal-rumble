// Voltron study: can six normies in a stable defeat two sharks in a stable?
//
// Field of 12: 2 sharks (95/130ms) + 4 average players (150-180ms) + 6 normies
// (210-270ms), same calibration family as the six-player studies (SIGMA 0.45,
// ROW_EXP attempt exponents). NOT comparable to the six-player rows — new field.
//
// Engine mechanics are the real 0.89 ones: built-in comeback (gate correct<3,
// OT-scaled half stake, 70%/40-race edge via g.buzzEdge), stables (join capped
// at half the live ring, pot immunity between mates, stableFocus loads the
// mates' share onto outsiders, share mode per settings), targeting with the
// backfire rule. Staged release is the engine's own: 3 random openers
// (drawOrderFor shuffle), then one per entryInterval, +2 on field clear.
//
// Stable formation is modeled as players joining when live and the cap allows
// (max(2, floor(live/2))), retrying each clue — so the six-normie voltron only
// fully assembles once the ring is big enough, exactly as in a real match.
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
    // Pinned, not inherited. arrivalGrace shipped on-by-default mid-stream in
    // 0.90.0, so any study spanning that boundary silently compares two engines:
    // it is exactly what made one backfire row irreproducible across the two
    // chats. Same rule as targetBackfire — set every setting you claim to vary,
    // and pin the ones you do not.
    arrivalGrace: true,
    startScore: 3000, targetMinutes: 45,           // 12-player room assumption
    // Explicit, and set to the whole-pot rule on purpose. These rows were
    // measured when that was the engine default; 0.94.0 made it a dial that
    // defaults to 0, and leaving this implicit meant every "targeting" row here
    // silently measured backfire-OFF while claiming to be the baseline the
    // backfire study regresses against. Third tool to hit that trap.
    targetBackfire: 1,
    stables: !!(cfg.sharkStable || cfg.voltron),
    ...(cfg.share ? { stableShare: cfg.share } : {}),
  };
  const g = new RumbleGame({ players, settings, categoryPool: pool, rng });
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

  let sharkStableId = null, voltId = null, voltWon = false, voltPeak = 0;
  let guard = 0;
  while (!g.finished && guard++ < 5000) {
    // --- stable formation: join when live, retry while the cap blocks you ---
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
      if (voltId) voltPeak = Math.max(voltPeak, g.live().filter((p) => p.stable === voltId).length);
    }
    // --- targeting strategy ---
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

    const open = [];
    g.board.forEach((cat, slot) =>
      cat.clues.forEach((c) => { if (!c.revealed) open.push([slot, c.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];

    const live = g.live();
    const attempters = live.filter((pl) => rng() < Math.pow(PROF.get(pl.id).att, ROW_EXP[row - 1]));
    const timed = attempters.map((pl) => {
      let t = PROF.get(pl.id).ms * Math.exp(SIGMA * gauss());
      t *= g.buzzEdge(pl.id);            // engine's own comeback edge
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
  return { winner: g.winnerId, clues: g.cluesRevealed, voltWon, voltPeak };
}

const RUNS = Number(process.env.RUMBLE_RUNS_STUDY || 6000);
function run(label, cfg) {
  const wins = { shark: 0, avg: 0, norm: 0, A: 0 };
  let clues = 0, done = 0, vwon = 0, peak = 0;
  for (let s = 1; s <= RUNS; s++) {
    const r = simulate(cfg, s);
    if (!r.winner) continue;
    done++;
    wins[isShark(r.winner) ? 'shark' : isNorm(r.winner) ? 'norm' : 'avg']++;
    if (r.winner === 'SharkA') wins.A++;
    clues += r.clues; if (r.voltWon) vwon++; peak += r.voltPeak;
  }
  const pc = (v) => (v / done * 100).toFixed(1).padStart(5) + '%';
  console.log(`${label.padEnd(40)} sharks ${pc(wins.shark)} (top ${pc(wins.A)})  avg ${pc(wins.avg)}  normies ${pc(wins.norm)}  voltron-clears ${pc(vwon)}  peak ${(peak/done).toFixed(1)}  clues ${(clues/done).toFixed(0)}`);
}

console.log(`Voltron study — 12-player field, ${RUNS} matches per row. Engine comeback on throughout.\n`);
run('baseline: everyone stag', {});
run('shark stable only', { sharkStable: true });
run('normie voltron only (sharks stag)', { voltron: true });
run('voltron vs shark stable (share even)', { voltron: true, sharkStable: true });
run('  same, share=winner (pact only)', { voltron: true, sharkStable: true, share: 'winner' });
run('  same, share=surplus', { voltron: true, sharkStable: true, share: 'surplus' });
run('voltron + target richest shark', { voltron: true, sharkStable: true, normTarget: true });
run('  + sharks target back', { voltron: true, sharkStable: true, normTarget: true, sharkTarget: true });
