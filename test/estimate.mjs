// Tests the same estimate module the setup page imports.
import { estimate, reachable, warnings, IV_MIN, IV_MAX } from '../public/estimate.js';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const S = (over = {}) => ({ targetMinutes: 60, secondsPerClue: 17.5, entryInterval: null, ...over });

check('under three players there is nothing to estimate', estimate(2, S()) === null);

// Against the simulator's measured medians for the published presets.
const sim = { 16: 52, 20: 54, 30: 65 };
for (const [n, mins] of Object.entries(sim)) {
  const e = estimate(+n, S());
  const off = Math.abs(e.mins - mins) / mins;
  check(`${n} players estimates near the simulated ${mins} min`, off < 0.15,
    `${e.mins} min, ${Math.round(off * 100)}% off`);
}

const three = estimate(3, S());
check('three players is not estimated at zero', three.mins > 0, `${three.mins} min`);
check('three players is flagged rough', three.rough === true);

const six = estimate(6, S());
check('a small roster clamps the interval', six.iv === IV_MAX && six.clamped, `every ${six.iv}`);
check('a small roster falls well short of a 60 min target', six.mins < 30, `${six.mins} min`);

const big = estimate(30, S());
check('a full roster does not clamp', !big.clamped, `every ${big.iv}`);
check('interval stays inside its bounds', big.iv >= IV_MIN && big.iv <= IV_MAX);

const r = reachable(6, S());
check('reachable range is ordered', r.min < r.max, `${r.min}–${r.max} min`);
const fixed = estimate(6, S({ targetMinutes: r.max }));
check('taking the suggested target clears the clamp', !fixed.clamped,
  `target ${r.max} → every ${fixed.iv}`);

// --- warnings ---
const w6 = warnings(6, S());
check('six players warns about the target', w6.some((x) => x.fix && x.target === r.max));
check('six players is called a duel', w6.some((x) => /duel/.test(x.text)));

const w3 = warnings(3, S());
check('three players explains there is no queue', w3.some((x) => /no queue/.test(x.text)));

const wLong = warnings(30, S({ entryInterval: 14 }));
check('a very long match is warned about', wLong.some((x) => x.level === 'warn' && /long sitting/.test(x.text)),
  `${estimate(30, S({ entryInterval: 14 })).mins} min`);

const wOk = warnings(20, S());
check('a sensible setup warns about nothing', !wOk.some((x) => x.level === 'warn'),
  wOk.map((x) => x.level).join(',') || 'no notes');

// every fix must actually resolve the thing it complains about
for (const n of [4, 5, 6, 8, 10]) {
  const ws = warnings(n, S());
  const fix = ws.find((x) => x.target);
  if (!fix) continue;
  const after = warnings(n, S({ targetMinutes: fix.target }));
  check(`the suggested fix silences the warning at ${n} players`,
    !after.some((x) => x.level === 'warn'), `target ${fix.target}`);
}

// --- draw fairness, from the measured grid --------------------------------
//
// The setup card warns but never refuses. A host who wants a two-hour
// thirty-player match can have one; they should just know late draws will run
// away with it.
{
  const { fairnessWarning, bestInterval, predictMatch, autoCeiling } =
    await import('../src/engine.js');

  check('a sensible pacing draws no complaint', !fairnessWarning(20, 4));
  const bad = fairnessWarning(16, 15);
  check('a punishing one does', !!bad, bad && bad.kind);
  check('and says how bad', bad && bad.spread > 2, bad && bad.spread.toFixed(2));
  check('with something to do about it', bad && bad.suggest < 15, bad && String(bad.suggest));
  check('and the suggestion is actually fair',
    !fairnessWarning(16, bad.suggest), `every ${bad.suggest}`);

  // The ceiling turned out to matter more than the interval, and measuring
  // fairness with it fixed gave badly wrong answers.
  check('the ceiling scales with the field',
    autoCeiling(8) < autoCeiling(20) && autoCeiling(20) < autoCeiling(30),
    `${autoCeiling(8)} / ${autoCeiling(20)} / ${autoCeiling(30)}`);

  check('the grid covers small and large fields',
    predictMatch(6, 4) && predictMatch(30, 4));
  check('and interpolates in between',
    predictMatch(22, 4) !== null && predictMatch(22, 4).minutes > 0,
    `22 players: ${predictMatch(22, 4).minutes} min`);

  // Warnings appear in the list the setup card renders, marked red.
  const ws = warnings(16, { targetMinutes: 63, secondsPerClue: 17.5, entryInterval: 15,
    startScore: 3000, ceiling: null, ceilingFloor: 3000 });
  check('the setup card shows it in red', ws.some((x) => x.level === 'bad'),
    ws.map((x) => x.level).join());
  check('with a button that sets the interval',
    ws.some((x) => x.level === 'bad' && x.interval > 0));
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
