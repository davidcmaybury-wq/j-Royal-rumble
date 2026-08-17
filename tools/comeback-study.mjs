// Study 2: can anything give the casuals a real chance at the MATCH?
// Tests David's "one foot on the floor" comeback (instant return from elimination
// with a temporary buzz boost — duration swept), a progressive pot, the skill
// dial, and stables. Same calibrated race model as kickout-study.mjs.
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
const CASUALS = new Set(['CasualA', 'CasualB', 'CasualC']);
const SIGMA = 0.45;

function simulate(cfg, seed) {
  const rng = makeRng(seed);
  const players = FIELD.map((p) => ({ id: p.name, name: p.name }));
  let n = 0;
  const pool = () => ({
    id: `cat${++n}`, title: `C${n}`,
    clues: ROW_VALUES.map((v, i) => ({ id: `c${n}-${i + 1}`, row: i + 1, text: '', answer: '' })),
  });
  // arrivalGrace pinned rather than inherited: it shipped on-by-default in
  // 0.90.0, so a study spanning that boundary silently compares two engines.
  const settings = cfg.settings || { startScore: 3000, ceiling: 7500,
    arrivalGrace: true, entryInterval: autoEntryInterval(6, 30, 17.5) };
  const g = new RumbleGame({ players, settings, categoryPool: pool, rng });

  if (cfg.stables) {
    g.stables.set('s1', { id: 's1', name: 'Stable One', foundedBy: 'EliteA' });
    g.stables.set('s2', { id: 's2', name: 'Stable Two', foundedBy: 'EliteB' });
    for (const [id, st] of [['EliteA','s1'],['CasualA','s1'],['CasualB','s1'],
                            ['EliteB','s2'],['Mid','s2'],['CasualC','s2']]) {
      g.players.get(id).stable = st;
    }
  }

  const raceWins = new Map(FIELD.map((p) => [p.name, 0]));
  const usedComeback = new Set();
  const boostUntil = new Map();   // id -> race index the boost lasts through
  let raceIdx = 0, comebacks = 0;

  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const sample = (p) => {
    let t = p.ms * Math.exp(SIGMA * gauss());
    if ((boostUntil.get(p.name) ?? -1) >= raceIdx) t *= (1 - (cfg.boost ?? 0.5));
    return t;
  };

  let guard = 0;
  while (!g.finished && guard++ < 5000) {
    const open = [];
    g.board.forEach((cat, slot) =>
      cat.clues.forEach((c) => { if (!c.revealed) open.push([slot, c.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];

    const liveBefore = g.live().map((p) => ({ id: p.id, score: p.score }));
    const attempters = g.live().filter((pl) => {
      const prof = FIELD.find((f) => f.name === pl.id);
      return rng() < Math.pow(prof.att, ROW_EXP[row - 1]);
    });
    const timed = attempters.map((pl) => {
      const prof = FIELD.find((f) => f.name === pl.id);
      return [pl.id, sample(prof)];
    }).sort((a, b) => a[1] - b[1]);

    let winnerId = null;
    const missedIds = [];
    for (const [id] of timed) {
      const prof = FIELD.find((f) => f.name === id);
      if (rng() < prof.acc) { winnerId = id; break; }
      missedIds.push(id);
    }
    if (timed.length) {
      raceIdx++;
      if (winnerId) raceWins.set(winnerId, raceWins.get(winnerId) + 1);
    }
    const multiplier = g.overtimeMultiplier ? g.overtimeMultiplier() : 1;
    g.resolveClue(slot, row, { winnerId, missedIds });

    // --- progressive pot: reweight who paid the winner by pre-clue score share
    if (cfg.progressive && winnerId) {
      const V = ROW_VALUES[row - 1] * multiplier;
      const payers = liveBefore.filter((p) => p.id !== winnerId);
      const total = payers.reduce((a, p) => a + Math.max(p.score, 0), 0);
      if (payers.length > 1 && total > 0) {
        for (const p of payers) {
          const share = Math.max(p.score, 0) / total;
          const owed = V * payers.length * share;       // progressive share
          let delta = V - owed;                          // refund (+) or surcharge (−)
          const cur = g.players.get(p.id);
          if (cur && cur.state === 'live') {
            if (delta < 0) delta = Math.max(delta, -cur.score);  // never eliminate by surcharge
            g.adjustScore(p.id, delta);
          }
        }
      }
    }

    // --- "one foot on the floor" comeback: instant return with a boost
    if (cfg.comeback) {
      for (const p of g.players.values()) {
        if (p.state === 'eliminated' && !usedComeback.has(p.id)) {
          const eligible = !cfg.gated || raceWins.get(p.id) < 3;   // "didn't really get to play"
          if (!eligible) { usedComeback.add(p.id); continue; }     // one check only
          usedComeback.add(p.id);
          // The return stake rides the overtime multiplier, as the engine has
          // done since 0.88.0.
          //
          // This tool drives its own comeback rather than the engine's so the
          // gate and duration can be swept, and it was left behind when the
          // engine's learned to scale: it kept returning a flat half stake, so
          // every row it printed described the pre-0.88 rule while being
          // labelled SHIPPED. That understates the mechanic badly — casuals
          // read 10.8% flat against 14.3% scaled — and the mislabelled figures
          // reached the handbook. Found by the modeling chat, 2026-08-17.
          //
          // `adjustScore` is kept: it applies the same ceiling clamp the engine
          // applies on this path and un-eliminates on the way through.
          const cbMult = settings.scaleEntryStake === false ? 1 : multiplier;
          const stake = Math.round(
            settings.startScore * (settings.comebackStake ?? 0.5) * cbMult);
          // Routed through the engine's arrival hook, so whatever the engine does
          // about the ceiling on arrival applies here too. Without this the tool
          // silently measured a comeback with the old bare clamp, which is how it
          // came to be a release behind in the first place.
          //
          // `arrivalLand` sets the score only, so un-eliminate the way
          // `adjustScore` does on its way through. The engine's own comeback never
          // needs this — it `continue`s before the elimination is recorded.
          p.state = 'live';
          p.eliminatedAtClue = null;
          g.eliminationOrder = g.eliminationOrder.filter((id) => id !== p.id);
          g.arrivalLand(p, stake);
          boostUntil.set(p.id, raceIdx + cfg.duration);
          comebacks++;
        }
      }
    }
  }

  const winner = g.winnerId;
  const winnerStable = winner ? g.players.get(winner)?.stable : null;
  return { winner, winnerStable, clues: g.cluesRevealed, comebacks };
}

// 1,500 is the default; raise it with RUMBLE_RUNS_STUDY when comparing two
// configurations rather than reading absolute levels.
function run(label, cfg, runs = Number(process.env.RUMBLE_RUNS_STUDY || 1500)) {
  const wins = {}; const stableWins = {}; let clues = 0, cb = 0, unfinished = 0;
  for (let s = 1; s <= runs; s++) {
    const r = simulate(cfg, s);
    if (!r.winner) { unfinished++; continue; }
    wins[r.winner] = (wins[r.winner] || 0) + 1;
    if (r.winnerStable) stableWins[r.winnerStable] = (stableWins[r.winnerStable] || 0) + 1;
    clues += r.clues; cb += r.comebacks;
  }
  const done = runs - unfinished;
  const pc = (n) => ((wins[n] || 0) / done * 100).toFixed(1) + '%';
  const casual = (['CasualA','CasualB','CasualC'].reduce((a, n) => a + (wins[n] || 0), 0) / done * 100).toFixed(1);
  let extra = '';
  if (cfg.stables) extra = `  stable1 ${((stableWins.s1||0)/done*100).toFixed(0)}% stable2 ${((stableWins.s2||0)/done*100).toFixed(0)}%`;
  console.log(`${label.padEnd(34)} EliteA ${pc('EliteA')}  EliteB ${pc('EliteB')}  Mid ${pc('Mid')}  ` +
    `casuals ${casual}%  clues ${(clues / done).toFixed(0)}  comebacks/match ${(cb / done).toFixed(1)}${extra}` +
    (unfinished ? `  UNFINISHED ${unfinished}` : ''));
}

console.log('P(match win) by archetype, 1500 sims each.\n');
run('baseline', {});
console.log('--- "one foot on the floor": instant return at half stake, 50% buzz boost');
run('comeback, boost lasts 5 races',  { comeback: true, duration: 5 });
run('comeback, boost lasts 15 races', { comeback: true, duration: 15 });
run('comeback, boost lasts 40 races', { comeback: true, duration: 40 });
run('comeback 15, gated (<3 race wins)', { comeback: true, duration: 15, gated: true });
run('comeback 15, boost 70%',        { comeback: true, duration: 15, boost: 0.7 });
run('comeback 40, boost 70%',        { comeback: true, duration: 40, boost: 0.7 });
console.log('--- economic & format levers');
run('progressive pot',                { progressive: true });
run('skill dial: short & swingy',     { settings: { startScore: 1500, ceiling: 5000,
                                        entryInterval: autoEntryInterval(6, 15, 17.5) } });
run('stables (elite+2 vs elite+2)',   { stables: true,
  settings: { startScore: 3000, ceiling: 7500, stables: true, stableFocus: true,
              stableShare: 'even', entryInterval: autoEntryInterval(6, 30, 17.5) } });
run('comeback 15 + progressive',      { comeback: true, duration: 15, progressive: true });
run('comeback 40/70% + short-swingy', { comeback: true, duration: 40, boost: 0.7,
  settings: { startScore: 1500, ceiling: 5000, entryInterval: autoEntryInterval(6, 15, 17.5) } });
console.log('--- refinement: gate the comeback to players who never got going');
run('gated comeback 40, boost 70%  <-- SHIPPED', { comeback: true, duration: 40, boost: 0.7, gated: true });
// Kept as evidence, not as a candidate. 0.5 shipped for one release and is the
// row that showed the boost is a threshold rather than a dial: no casual in
// this field gets under the 95ms elite at 0.5, so the mechanic stops working
// almost entirely — casuals 11.0% -> 2.1%. Delete this row and somebody will
// propose 0.5 again as the moderate option.
run('gated comeback 40, boost 50%  (dead — kept as evidence)', { comeback: true, duration: 40, boost: 0.5, gated: true });
run('gated comeback 999 (rest of match), 70%', { comeback: true, duration: 999, boost: 0.7, gated: true });
run('gated 40/70% + stables', { comeback: true, duration: 40, boost: 0.7, gated: true, stables: true,
  settings: { startScore: 3000, ceiling: 7500, stables: true, stableFocus: true,
              stableShare: 'even', entryInterval: autoEntryInterval(6, 30, 17.5) } });
