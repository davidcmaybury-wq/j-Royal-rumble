// "Kickout on 2" study: does a buzz boost earned by losing races give
// weaker players a real chance to WIN THE MATCH, without breaking the game?
// Drives the shipping engine with a reaction-time race model calibrated to the
// nine recorded live matches (elite medians ~95-130ms, casuals 210-270ms).
import { RumbleGame, makeRng, ROW_VALUES, autoEntryInterval } from '../src/engine.js';

const ROW_EXP = [0.48, 0.67, 0.85, 1.10, 1.40]; // attempt-rate exponents, from the bot model

// A game-night field: two broadcast-caliber sharks, one decent, three casual.
const FIELD = [
  { name: 'EliteA',  ms: 95,  att: 0.85, acc: 0.88 },
  { name: 'EliteB',  ms: 130, att: 0.80, acc: 0.88 },
  { name: 'Mid',     ms: 160, att: 0.65, acc: 0.84 },
  { name: 'CasualA', ms: 210, att: 0.55, acc: 0.80 },
  { name: 'CasualB', ms: 240, att: 0.50, acc: 0.78 },
  { name: 'CasualC', ms: 270, att: 0.45, acc: 0.76 },
];
const CASUALS = new Set(['CasualA', 'CasualB', 'CasualC']);
const SIGMA = 0.45; // per-race lognormal spread; calibrated below against live race shares

function simulate(cfg, seed) {
  const rng = makeRng(seed);
  const players = FIELD.map((p, i) => ({ id: p.name, name: p.name }));
  let n = 0;
  const pool = () => ({
    id: `cat${++n}`, title: `C${n}`,
    clues: ROW_VALUES.map((v, i) => ({ id: `c${n}-${i + 1}`, row: i + 1, text: '', answer: '' })),
  });
  const settings = { startScore: 3000, ceiling: 7500,
    entryInterval: autoEntryInterval(6, 30, 17.5) };
  const g = new RumbleGame({ players, settings, categoryPool: pool, rng });

  const losses = new Map(FIELD.map((p) => [p.name, 0]));
  const boosted = new Set();
  let fires = 0, boostWins = 0, casualRaceWins = 0, raceCount = 0;

  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const sample = (p) => {
    let t = p.ms * Math.exp(SIGMA * gauss());
    if (cfg.pity && boosted.has(p.name)) t *= (1 - cfg.boost);
    if (cfg.heat) t *= (1 - Math.min(cfg.heatCap, cfg.heatStep * losses.get(p.name)));
    if (cfg.underdog) {
      const me = g.players.get(p.name);
      const ring = g.live();
      const median = ring.map((x) => x.score).sort((a, b) => a - b)[Math.floor(ring.length / 2)];
      if (me && me.state === 'live' && me.score < median) t *= (1 - cfg.underdog);
    }
    return t;
  };

  let guard = 0;
  while (!g.finished && guard++ < 4000) {
    const open = [];
    g.board.forEach((cat, slot) =>
      cat.clues.forEach((c) => { if (!c.revealed) open.push([slot, c.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];

    const live = g.live();
    const attempters = live.filter((pl) => {
      const prof = FIELD.find((f) => f.name === pl.id);
      return rng() < Math.pow(prof.att, ROW_EXP[row - 1]);
    });
    // sequential contest: fastest answers; wrong -> retoss among the rest
    const timed = attempters.map((pl) => {
      const prof = FIELD.find((f) => f.name === pl.id);
      return [pl.id, sample(prof)];
    }).sort((a, b) => a[1] - b[1]);

    let winnerId = null;
    const missedIds = [];
    const raceLosers = new Set(timed.map(([id]) => id));
    for (const [id] of timed) {
      const prof = FIELD.find((f) => f.name === id);
      if (rng() < prof.acc) { winnerId = id; break; }
      missedIds.push(id);
    }
    if (timed.length) {
      raceCount++;
      if (winnerId && CASUALS.has(winnerId)) casualRaceWins++;
      if (winnerId && boosted.has(winnerId)) boostWins++;
      raceLosers.delete(winnerId);
      for (const id of raceLosers) losses.set(id, losses.get(id) + 1);
      if (winnerId) { losses.set(winnerId, 0); boosted.delete(winnerId); }
      if (cfg.pity) {
        for (const [id, c] of losses) {
          if (c >= cfg.after && !boosted.has(id)) { boosted.add(id); fires++; }
        }
      }
    }
    g.resolveClue(slot, row, { winnerId, missedIds });
  }
  return { winner: g.winnerId, clues: g.cluesRevealed, fires, boostWins,
           casualShare: raceCount ? casualRaceWins / raceCount : 0 };
}

function run(label, cfg, runs = 1500) {
  const wins = {}; let clues = 0, fires = 0, boostWins = 0, share = 0;
  for (let s = 1; s <= runs; s++) {
    const r = simulate(cfg, s);
    wins[r.winner] = (wins[r.winner] || 0) + 1;
    clues += r.clues; fires += r.fires; boostWins += r.boostWins; share += r.casualShare;
  }
  const pc = (n) => ((wins[n] || 0) / runs * 100).toFixed(1) + '%';
  const casual = (['CasualA','CasualB','CasualC'].reduce((a, n) => a + (wins[n] || 0), 0) / runs * 100).toFixed(1);
  console.log(`${label.padEnd(26)} EliteA ${pc('EliteA')}  EliteB ${pc('EliteB')}  Mid ${pc('Mid')}  ` +
    `casuals ${casual}%   races-to-casuals ${(share / runs * 100).toFixed(1)}%   ` +
    `clues ${(clues / runs).toFixed(0)}  boosts/match ${(fires / runs).toFixed(1)}  boost-wins/match ${(boostWins / runs).toFixed(1)}`);
}

console.log('P(match win) by archetype, 1500 sims each. Field: 95/130/160/210/240/270ms medians.\n');
run('baseline (no kickout)', { pity: false });
run('kickout 70% after 10', { pity: true, boost: 0.70, after: 10 });
run('kickout 50% after 10', { pity: true, boost: 0.50, after: 10 });
run('kickout 70% after 6',  { pity: true, boost: 0.70, after: 6 });
run('kickout 50% after 6',  { pity: true, boost: 0.50, after: 6 });
run('kickout 30% after 6',  { pity: true, boost: 0.30, after: 6 });
console.log('');
run('heat +7%/loss, cap 50%',  { heat: true, heatStep: 0.07, heatCap: 0.50 });
run('heat +10%/loss, cap 70%', { heat: true, heatStep: 0.10, heatCap: 0.70 });
run('underdog 25% (sub-median)', { underdog: 0.25 });
run('underdog 40% (sub-median)', { underdog: 0.40 });
run('heat 10%/70% + underdog 25%', { heat: true, heatStep: 0.10, heatCap: 0.70, underdog: 0.25 });
run('underdog 60% (parity+)', { underdog: 0.60 });
run('underdog 80% (casuals fastest)', { underdog: 0.80 });
