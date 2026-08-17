// Entry-order study: where should identified sharks enter the draw, and how
// fast should the field flow in behind them, to minimize shark win share?
//
// The scenario under test is the observed one: two sharks land in the opening
// trio, the flow of average players is too slow, and each arrival is wishboned
// by the two sharks — the pot has almost nobody else to split across, so the
// newcomer pays huge shares and is picked off before the ring fills.
//
// Same 12-player field as voltron-study (2 sharks + 4 average + 6 normies),
// stables OFF, targeting unused — this is stag play. Engine comeback on
// (shipped). Draw order is forced per config: sharks at chosen positions,
// everyone else Fisher-Yates shuffled into the remaining slots (the engine's
// own shuffle handles the 'random' reference row).
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

// Fisher-Yates — house rule; sort(() => rng() - .5) once reversed a finding.
function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rebuild the draw before any clue is played: the placed players at the given
// 1-based positions, the rest shuffled into the remaining slots. Replicates
// the constructor's end state (3 openers admitted) on the forced order.
function forceOrder(g, placements, rng) {
  const placed = new Set(Object.keys(placements));
  const rest = shuffle(FIELD.map((p) => p.name).filter((id) => !placed.has(id)), rng);
  const order = new Array(12);
  for (const [id, pos] of Object.entries(placements)) order[pos - 1] = id;
  for (let i = 0; i < 12; i++) if (!order[i]) order[i] = rest.shift();
  for (const p of g.players.values()) {
    p.state = 'queued'; p.score = 0; p.enteredAtClue = null;
  }
  order.forEach((id, i) => {
    const p = g.players.get(id); p.drawNumber = i + 1; p.originalDraw = i + 1;
  });
  g.drawOrder = order;
  for (let i = 0; i < 3; i++) g.admit('opening');
}

function simulate(cfg, seed) {
  const rng = makeRng(seed);
  const players = FIELD.map((p) => ({ id: p.name, name: p.name }));
  let n = 0;
  const pool = () => ({
    id: `cat${++n}`, title: `C${n}`,
    clues: ROW_VALUES.map((v, i) => ({ id: `c${n}-${i + 1}`, row: i + 1, text: '', answer: '' })),
  });
  const settings = { startScore: 3000, entryInterval: cfg.interval };  // fixed, no auto recalc
  const g = new RumbleGame({ players, settings, categoryPool: pool, rng });
  if (cfg.place) forceOrder(g, cfg.place, rng);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

  let guard = 0;
  while (!g.finished && guard++ < 5000) {
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
  }
  // Cannon-fodder rate input: non-sharks who went out having taken <=1 clue —
  // with the shipped comeback they burned their extra life and still never played.
  let fodder = 0;
  for (const p of g.players.values()) {
    if (!isShark(p.id) && p.state === 'eliminated' && p.correct <= 1) fodder++;
  }
  return { winner: g.winnerId, clues: g.cluesRevealed, fodder };
}

const RUNS = Number(process.env.RUMBLE_RUNS_STUDY || 6000);
function run(label, cfg) {
  const wins = { shark: 0, avg: 0, norm: 0, A: 0 };
  let clues = 0, done = 0, fodder = 0;
  for (let s = 1; s <= RUNS; s++) {
    const r = simulate(cfg, s);
    if (!r.winner) continue;
    done++;
    wins[isShark(r.winner) ? 'shark' : isNorm(r.winner) ? 'norm' : 'avg']++;
    if (r.winner === 'SharkA') wins.A++;
    clues += r.clues; fodder += r.fodder;
  }
  const pc = (v) => (v / done * 100).toFixed(1).padStart(5) + '%';
  console.log(`${label.padEnd(44)} sharks ${pc(wins.shark)} (top ${pc(wins.A)})  avg ${pc(wins.avg)}  normies ${pc(wins.norm)}  fodder/match ${(fodder/done).toFixed(2)}  clues ${(clues/done).toFixed(0)}`);
}

console.log(`Entry-order study — 12-player field, ${RUNS} matches per row, stables off, shipped comeback on.`);
console.log('fodder/match = non-sharks eliminated having taken <=1 clue (burned the comeback, never played).\n');
console.log('--- shark draw position, interval 10 (the auto value for this room) ---');
run('random draw (engine shuffle) — reference', { interval: 10 });
run('sharks open together (slots 1,2)', { interval: 10, place: { SharkA: 1, SharkB: 2 } });
run('sharks early (slots 4,5)', { interval: 10, place: { SharkA: 4, SharkB: 5 } });
run('sharks middle (slots 6,7)', { interval: 10, place: { SharkA: 6, SharkB: 7 } });
run('sharks last (slots 11,12)', { interval: 10, place: { SharkA: 11, SharkB: 12 } });
run('sharks split (slots 1 and 12)', { interval: 10, place: { SharkA: 1, SharkB: 12 } });
run('sharks split (slots 4 and 9)', { interval: 10, place: { SharkA: 4, SharkB: 9 } });
console.log('\n--- control: is the last slot just generically winning? ---');
run('two normies last, sharks random', { interval: 10, place: { NormA: 11, NormB: 12 } });
run('two average last, sharks random', { interval: 10, place: { AvgA: 11, AvgB: 12 } });
console.log('\n--- flow rate, sharks opening together (the wishbone scenario) ---');
run('fast flow, interval 5', { interval: 5, place: { SharkA: 1, SharkB: 2 } });
run('interval 10', { interval: 10, place: { SharkA: 1, SharkB: 2 } });
run('slow flow, interval 15', { interval: 15, place: { SharkA: 1, SharkB: 2 } });
console.log('\n--- flow rate, sharks last ---');
run('fast flow, interval 5', { interval: 5, place: { SharkA: 11, SharkB: 12 } });
run('interval 10', { interval: 10, place: { SharkA: 11, SharkB: 12 } });
run('slow flow, interval 15', { interval: 15, place: { SharkA: 11, SharkB: 12 } });
