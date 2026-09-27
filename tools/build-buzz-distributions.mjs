// Rebuild data/buzz-distributions.json from this game's own recorded matches.
//
//   node tools/build-buzz-distributions.mjs <logs-dir> [--out data/buzz-distributions.json] [--min 40]
//
// The robots used to sample press times recorded from another game: 2,493
// buzzes of the original model's play, two tiers of which buzzed at the median
// of the single quickest human ever recorded here, with no bucket past 500 ms
// although one real press in sixteen is slower than that. The analysis chat
// made the case on 5,191 live presses (fairness/bot-model-recalibration.md);
// this is the build it said needed no code.
//
// What it does, so the numbers can be reproduced from any log bundle:
//   - one full record per match (a -partial snapshot only when it has no twin);
//     matches with at least one human in the standings
//   - live presses only (`spectator: false`), by human players only; warm-up
//     and robots are out
//   - players pooled by name across matches; players with fewer than --min
//     presses (40) do not tier
//   - five tiers of equal size by each player's own median, fastest first:
//     elite, superchamp, champ, normie, rookie — the standards keep their
//     names because they are broadcast tiers, not verdicts
//   - 25 ms buckets keyed by lower bound, running to 4,000 ms with an open
//     top bucket, so the tail exists
//   - `human` is everybody pooled, the reference the field-matching offset
//     reads (referenceHumanMedian)
//
// Early presses are the one thing the logs cannot give a time for: a press
// before the lights is refused before it reaches the race, so it is counted in
// the standings and never written on a clue. So each tier's early mass is OUR
// measured rate (standings `early` over attempts) laid over the timing shape
// of the old recordings' early presses for that tier. The rate is real; the
// shape is borrowed, and says so in the file.
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const [, , dir, ...rest] = process.argv;
if (!dir) { console.error('usage: node tools/build-buzz-distributions.mjs <logs-dir> [--out file] [--min 40]'); process.exit(1); }
const opt = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
const OUT = opt('--out', null);
const MIN = Number(opt('--min', 40));
const WIDTH = 25, TOP = 4000;
const TIERS = ['elite', 'superchamp', 'champ', 'normie', 'rookie'];

const OLD = JSON.parse(readFileSync(new URL('../data/buzz-distributions-schiffler.json', import.meta.url), 'utf8'));

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const full = new Set(files.filter((f) => !f.endsWith('-partial.json')));
const chosen = files.filter((f) => !f.endsWith('-partial.json') || !full.has(f.replace('-partial.json', '.json')));

const players = new Map();
let matches = 0, presses = 0;
for (const f of chosen) {
  let d;
  try { d = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
  const humans = new Set((d.standings || []).filter((p) => !p.isBot).map((p) => p.name));
  if (!humans.size || !(d.clues || []).length) continue;
  let any = false;
  for (const c of d.clues) {
    for (const b of c.buzzes || []) {
      if (b.spectator || b.early || !humans.has(b.name) || typeof b.ms !== 'number') continue;
      if (!players.has(b.name)) players.set(b.name, { presses: [], att: 0, early: 0 });
      players.get(b.name).presses.push(b.ms);
      presses++; any = true;
    }
  }
  for (const s of d.standings || []) {
    if (s.isBot || !players.has(s.name)) continue;
    const p = players.get(s.name);
    p.att += s.att || 0; p.early += s.early || 0;
  }
  if (any) matches++;
}

const sorted = (a) => [...a].sort((x, y) => x - y);
const q = (a, f) => { const s = sorted(a); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
const med = (a) => q(a, 0.5);

const qualified = [...players.entries()]
  .filter(([, p]) => p.presses.length >= MIN)
  .map(([name, p]) => ({ name, median: med(p.presses), ...p }))
  .sort((a, b) => a.median - b.median);
const size = Math.ceil(qualified.length / TIERS.length);
const groups = TIERS.map((tier, i) => ({ tier, members: qualified.slice(i * size, (i + 1) * size) }));

const bucketize = (times) => {
  const b = {};
  for (const ms of times) { const lo = ms >= TOP ? TOP : Math.floor(ms / WIDTH) * WIDTH; b[lo] = (b[lo] || 0) + 1; }
  return b;
};
const earlyShape = (tier) => {
  const src = OLD.levels[tier === 'elite' ? 'human' : tier]?.buckets || {};
  const neg = Object.entries(src).map(([lo, n]) => [Number(lo), n]).filter(([lo]) => lo < 0);
  const tot = neg.reduce((s, [, n]) => s + n, 0) || 1;
  return neg.map(([lo, n]) => [lo, n / tot]);
};
const describe = (times, members) => {
  // `att` in the standings counts early presses too, so the early share is early/att.
  const att = members.reduce((s, m) => s + m.att, 0), early = members.reduce((s, m) => s + m.early, 0);
  const rate = att ? early / att : 0;
  return { att, early, rate, median: Math.round(med(times)), p25: Math.round(q(times, 0.25)), p75: Math.round(q(times, 0.75)),
    p90: Math.round(q(times, 0.9)), under150: times.filter((t) => t < 150).length / times.length };
};

const levels = {};
const rows = [];
for (const g of groups) {
  const times = g.members.flatMap((m) => m.presses);
  const s = describe(times, g.members);
  const buckets = bucketize(times);
  const nEarly = Math.round(times.length * s.rate / (1 - s.rate || 1));
  for (const [lo, share] of earlyShape(g.tier)) { const n = Math.round(nEarly * share); if (n) buckets[lo] = (buckets[lo] || 0) + n; }
  levels[g.tier] = { players: g.members.length, attempts: times.length, median: s.median,
    under150: +s.under150.toFixed(3), earlyRate: +s.rate.toFixed(3), buckets };
  rows.push([g.tier, g.members.length, times.length, s.median, s.p25, s.p75, s.p90, `${Math.round(s.under150 * 100)}%`, `${Math.round(s.rate * 100)}%`]);
}
const everyone = [...players.values()];
const allTimes = everyone.flatMap((p) => p.presses);
const hs = describe(allTimes, everyone);
levels.human = { players: everyone.length, attempts: allTimes.length, median: hs.median,
  under150: +hs.under150.toFixed(3), earlyRate: +hs.rate.toFixed(3), buckets: bucketize(allTimes) };

const out = {
  note: 'Buzz timing histograms from this game’s own recorded matches, built by tools/build-buzz-distributions.mjs. '
    + 'Bucket keys are the lower bound in ms, 25 ms wide, running to an open bucket at 4000. Tiers are five equal groups of '
    + `players with ${MIN}+ live presses, by each player’s own median, fastest first. \`median\`, \`under150\` and \`attempts\` `
    + 'describe presses that were presses, early ones excluded. `human` is everybody pooled and is '
    + 'the reference the field-matching offset reads. Negative buckets are early presses: the rate is measured here '
    + '(standings early over attempts); the timing shape is borrowed from the previous recordings, because a press before '
    + 'the lights is not written on a clue with a time.',
  source: { matches, players: players.size, tiered: qualified.length, presses, built: new Date().toISOString().slice(0, 10), minPresses: MIN },
  bucketWidth: WIDTH,
  levels,
};

console.log(`${matches} matches with people in them, ${players.size} players, ${presses} live presses; ${qualified.length} players with ${MIN}+ tier`);
console.log('tier        players presses median  p25  p75  p90 <150ms early');
for (const r of rows) console.log(r.map((x, i) => String(x).padStart([11, 7, 7, 6, 4, 4, 4, 6, 5][i])).join(' '));
console.log(`${'human'.padStart(11)} ${String(everyone.length).padStart(7)} ${String(allTimes.length).padStart(7)} ${String(hs.median).padStart(6)} ${String(hs.p25).padStart(4)} ${String(hs.p75).padStart(4)} ${String(hs.p90).padStart(4)} ${(Math.round(hs.under150 * 100) + '%').padStart(6)} ${(Math.round(hs.rate * 100) + '%').padStart(5)}`);
const slow = allTimes.filter((t) => t > 500).length / allTimes.length, vslow = allTimes.filter((t) => t > 1000).length / allTimes.length;
console.log(`over 500 ms ${(slow * 100).toFixed(1)}%, over 1,000 ms ${(vslow * 100).toFixed(1)}%`);
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n'); console.log(`written: ${OUT}`); }
