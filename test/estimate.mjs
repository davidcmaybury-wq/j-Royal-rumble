// Tests the same estimate module the setup page imports.
import { estimate, reachable, warnings, cluesFor, IV_MIN, IV_MAX } from '../public/estimate.js';
import { expectedClues } from '../src/engine.js';

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
  //
  // It does not simply rise with the field. A small field needs the most
  // headroom — a lone strong player there faces the fewest opponents per clue,
  // climbs slowly, and the match runs long enough to sit at the cap. A live
  // 53-clue six-player match had the winner pinned for 20 clues.
  check('every field size gets a ceiling well clear of the stake',
    [6, 10, 16, 20, 30].every((n) => autoCeiling(n) >= 3000 * 2.5),
    [6, 10, 16, 20, 30].map((n) => `${n}:${autoCeiling(n)}`).join(' '));
  check('and the smallest fields are not the tightest',
    autoCeiling(6) >= autoCeiling(16),
    `${autoCeiling(6)} vs ${autoCeiling(16)}`);

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

// The line and the warnings must describe the same match.
//
// A screenshot arrived with the estimate saying entry every 10 clues and 15
// minutes while the warning beside it complained auto could not stretch to 30.
// Passing one estimate to both makes that impossible.
{
  const s = { targetMinutes: 15, secondsPerClue: 17.5, entryInterval: null,
    startScore: 3000, ceiling: null, ceilingFloor: 3000, stumperFraction: 0.5 };
  const e = estimate(6, s);
  const ws = warnings(6, s, e);
  const stretch = ws.find((w) => /can.t stretch/.test(w.text));
  check('a reachable target draws no stretch warning', !stretch,
    stretch ? stretch.text.slice(0, 70) : `${e.mins} min, every ${e.iv}`);

  // And when it is genuinely unreachable it says so, about the right number.
  const s2 = { ...s, targetMinutes: 30 };
  const e2 = estimate(6, s2);
  const w2 = warnings(6, s2, e2).find((w) => /can.t stretch/.test(w.text));
  check('an unreachable one does', !!w2, w2 && w2.text.slice(0, 60));
  check('and names the target actually asked for',
    !w2 || w2.text.includes('30 minutes'), w2 && w2.text.slice(0, 40));

  // The warning must never describe a different estimate from the one shown.
  check('the warning agrees with the line it sits under',
    !w2 || w2.text.includes(String(e2.mins)), `line says ${e2.mins} min`);
}

// --- the page and the record must predict the same match ------------------
//
// These were two separate implementations and they drifted: estimate.js applied
// the revival multiplier, the engine's expectedClues() did not, and server.js
// recorded the engine's. So the host was shown one length and the match record
// stored another, and every `estimateError` in every saved log was grading a
// function nobody had ever seen. On the Aug 22 matches that read as a 94% miss
// where the host-facing number was off by 12% and by one clue.
//
// cluesFor() now delegates, so this asserts the delegation stays in place —
// including the revival term, which is the part that went missing.
{
  const grid = [];
  for (const n of [3, 4, 5, 8, 12, 20, 30]) {
    for (const iv of [IV_MIN, 5, 8, 15, IV_MAX]) {
      grid.push([n, iv, {}]);
      grid.push([n, iv, { revival: true, revivalLimit: 1, revivalFraction: 0.5 }]);
      grid.push([n, iv, { revival: true, revivalLimit: 1, revivalFraction: 0.75 }]);
      grid.push([n, iv, { revival: true, revivalLimit: 2, revivalFraction: 0.75 }]);
    }
  }
  const off = grid.filter(([n, iv, set]) => cluesFor(n, iv, set) !== expectedClues(n, iv, set));
  check('the page and the engine agree on match length everywhere',
    off.length === 0,
    off.length ? `${off.length}/${grid.length} disagree, first ${JSON.stringify(off[0])}`
      : `${grid.length} combinations`);

  // The specific thing that broke: revival has to lengthen the prediction, and
  // it has to do so on both sides. A delegation that dropped the settings
  // argument would still pass the equality check above.
  const flat = { revival: false }, rev = { revival: true, revivalLimit: 1, revivalFraction: 0.75 };
  check('revival lengthens the predicted match',
    expectedClues(5, 15, rev) > expectedClues(5, 15, flat),
    `${expectedClues(5, 15, flat)} -> ${expectedClues(5, 15, rev)} clues`);
  check('and the page sees the same increase',
    cluesFor(5, 15, rev) === expectedClues(5, 15, rev),
    `${cluesFor(5, 15, rev)} clues`);

  // Reproduces the two Aug 22 matches: what the host was shown, which is now
  // also what the record keeps. Actuals were 101 and 56.
  check('match 12 (5 players, interval 15, revival 0.75) predicts 89',
    expectedClues(5, 15, rev) === 89, `${expectedClues(5, 15, rev)} vs 101 actual`);
  check('match 13 (5 players, interval 5, revival 0.75) predicts 55',
    expectedClues(5, 5, rev) === 55, `${expectedClues(5, 5, rev)} vs 56 actual`);
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
