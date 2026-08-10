// What each advanced mechanic does to match length and draw fairness.
// The whole ruleset was tuned around spread damage; three of these four
// concentrate it, so none should be played live before this has been read.
import { RumbleGame, makeRng, autoEntryInterval } from '../src/engine.js';

const ROW = [100, 200, 300, 400, 500];
const KNOW = [0.82, 0.72, 0.62, 0.50, 0.38];
const WRONG_BUZZ = 0.07;

function pool() {
  let n = 0;
  return () => { n++; return { id: 'c' + n, title: 'C' + n, source: 's',
    clues: ROW.map((v, i) => ({ id: `c${n}-${i}`, row: i + 1, text: '', answer: '' })) }; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function sim(n, settings, seed, style = {}) {
  const rng = makeRng(seed);
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const adj = new Map(players.map((p) => [p.id, gauss(rng) * 0.1]));
  const g = new RumbleGame({ players, rng, categoryPool: pool(),
    settings: { entryInterval: autoEntryInterval(n, 60, 17.5), startScore: 3000,
      ceiling: 11000, ceilingFloor: 3000, ceilingDecayPerClue: -40, ...settings } });

  let guard = 0;
  while (!g.finished && guard++ < 3000) {
    const ring = g.live();

    // Behaviour models, deliberately simple: players use a mechanic when it
    // looks good for them, not optimally.
    if (settings.topRope) {
      for (const p of ring) {
        const behind = p.score < 2200, ahead = p.score > 6000;
        if (rng() < (ahead ? 0.14 : behind ? 0.22 : 0.06)) g.setTopRope(p.id, true);
      }
    }
    if (settings.targeting) {
      for (const p of ring) {
        if (rng() < 0.12) {
          const others = ring.filter((x) => x.id !== p.id);
          if (!others.length) continue;
          // aim at whoever is closest to going out — the finishing instinct
          const weak = others.sort((a, b) => a.score - b.score)[0];
          g.setTarget(p.id, rng() < 0.75 ? weak.id : others[Math.floor(rng() * others.length)].id);
        } else if (rng() < 0.05) g.setTarget(p.id, null);
      }
    }
    if (settings.bounties) {
      for (const q of g.queued()) {
        if (q.bountyPlaced > 0 || rng() > 0.03) continue;
        const rich = ring.slice().sort((a, b) => b.score - a.score)[0];
        if (rich) g.placeBounty(q.id, rich.id, 400 + Math.floor(rng() * 800));
      }
    }

    const open = [];
    g.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
    const [slot, row] = open[Math.floor(rng() * open.length)];
    const order = ring.slice().sort(() => rng() - 0.5);
    let winner = null; const missed = [];
    for (const p of order) {
      if (rng() < Math.min(0.97, Math.max(0.05, KNOW[row - 1] + adj.get(p.id)))) { winner = p.id; break; }
      if (rng() < WRONG_BUZZ) missed.push(p.id);
    }
    g.resolveClue(slot, row, { winnerId: winner, missedIds: missed });
  }
  const w = g.players.get(g.winnerId);
  return { clues: g.cluesRevealed, draw: w ? (w.originalDraw ?? w.drawNumber) : null,
    revivals: g.revivedCount(), stalled: guard >= 3000 };
}

function run(label, n, settings, runs = 400) {
  const rows = [];
  for (let s = 1; s <= runs; s++) rows.push(sim(n, settings, s));
  const c = rows.map((r) => r.clues).sort((a, b) => a - b);
  const med = c[Math.floor(runs / 2)];
  const half = Math.ceil(n / 2);
  const back = rows.filter((r) => r.draw > half).length / runs;
  const stalled = rows.filter((r) => r.stalled).length;
  console.log(`${label.padEnd(30)} ${String(Math.round(med * 17.5 / 60)).padStart(4)} min` +
    `   back-half ${String(Math.round(back * 100)).padStart(3)}%` +
    `   revivals ${(rows.reduce((a, r) => a + r.revivals, 0) / runs).toFixed(1)}` +
    (stalled ? `   STALLED ${stalled}` : ''));
}

console.log('Baseline is 30 players at the published preset: 65 min, back-half 62%.\n');
run('none (baseline)', 30, {});
run('top rope', 30, { topRope: true });
run('targeting', 30, { targeting: true });
run('bounties', 30, { bounties: true });
run('revival (limit 1)', 30, { revival: true, revivalLimit: 1, revivalFraction: 0.5 });
run('everything on', 30, { topRope: true, targeting: true, bounties: true,
  revival: true, revivalLimit: 1, revivalFraction: 0.5 });
console.log('');
run('10p none', 10, {});
run('10p everything', 10, { topRope: true, targeting: true, bounties: true,
  revival: true, revivalLimit: 1, revivalFraction: 0.5 });
