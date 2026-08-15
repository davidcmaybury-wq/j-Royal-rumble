// Robots spread through the draw rather than clumped.
//
// A straight shuffle of a half-robot roster regularly deals three or four bots
// in a row, and a stretch of the match where nobody real walks in is the part a
// room notices — the entrances are the event.
import { drawOrderFor, makeRng } from '../src/engine.js';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const roster = (h, b) => [...Array(h)].map((_, i) => ({ id: 'h' + i, name: 'H' + i }))
  .concat([...Array(b)].map((_, i) => ({ id: 'b' + i, name: 'B' + i, isBot: true })));
const pattern = (o) => o.map((p) => (p.isBot ? 'R' : 'H')).join('');
const longestRun = (s, ch) => Math.max(0, ...(s.match(new RegExp(ch + '+', 'g')) || []).map((x) => x.length));

const rng = makeRng(11);

for (const [h, b, maxRun] of [[3, 3, 1], [5, 5, 1], [8, 4, 1], [10, 2, 1], [4, 8, 2], [15, 15, 1]]) {
  const pat = pattern(drawOrderFor(roster(h, b), rng));
  check(`${h} humans and ${b} robots never queue more than ${maxRun} robot(s) together`,
    longestRun(pat, 'R') <= maxRun, pat);
}

// Nobody is lost or duplicated.
const o = drawOrderFor(roster(9, 7), rng);
check('everybody is in the draw exactly once',
  o.length === 16 && new Set(o.map((p) => p.id)).size === 16, `${o.length} entries`);

// One kind only is just a shuffle.
check('an all-human roster still works', pattern(drawOrderFor(roster(6, 0), rng)) === 'HHHHHH');
check('an all-robot roster still works', pattern(drawOrderFor(roster(0, 6), rng)) === 'RRRRRR');

// The pattern is fixed, but which player holds which number must not be.
const seen = new Set();
for (let i = 0; i < 40; i++) {
  seen.add(drawOrderFor(roster(5, 5), rng).map((p) => p.id).join(','));
}
check('the individual order still varies run to run', seen.size > 30, `${seen.size} distinct in 40`);

// And robots do not systematically get the good numbers.
let botLate = 0, n = 400;
for (let i = 0; i < n; i++) {
  const ord = drawOrderFor(roster(10, 10), rng);
  botLate += ord.slice(10).filter((p) => p.isBot).length;
}
const share = botLate / (n * 10) * 100;
check('robots take about half the back-half places, not all of them',
  share > 35 && share < 65, `${share.toFixed(0)}%`);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
