// The host's clock: a room pressing slower together under one host is the
// host's offset, not everybody's skill.
import { pressMedians, buildHistory, hostOffset, MIN_PRESSES } from '../src/hostclock.js';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

// A match where each named player presses at their own base plus a shift.
const match = (startedAt, shift, bases, extra = {}) => ({
  startedAt, host: extra.host,
  standings: Object.keys(bases).map((name) => ({ name })).concat(extra.bots || []),
  clues: Array.from({ length: MIN_PRESSES + 2 }, (_, i) => ({
    buzzes: Object.entries(bases).map(([name, base]) => ({ name, ms: base + shift + (i % 3) * 4 }))
      .concat(extra.buzzes ? extra.buzzes(i) : []),
  })),
});
const field = { A: 120, B: 180, C: 240, D: 300 };

const past = [match('2026-09-01T00:00:00Z', 0, field), match('2026-09-08T00:00:00Z', 0, field)];
const tonight = match('2026-09-15T00:00:00Z', 90, field, { host: 'Host B' });
const h = buildHistory([...past, tonight]);

const o = hostOffset(tonight, h);
check('a whole room shifted 90ms slower reads as a +90ms host, not four slower players',
  o.offsetMs === 90, JSON.stringify(o.spread));
check('and the match being measured is left out of its own reference',
  o.players === 4 && Object.values(o.byPlayer).every((d) => d === 90));

const quick = match('2026-09-15T00:00:00Z', -40, field);
check('a quicker room reads negative', hostOffset(quick, h).offsetMs === -40);

// One player's bad night moves one difference; the median holds.
const oneBad = match('2026-09-15T00:00:00Z', 0, { ...field, D: 300 + 400 });
check('one player having a bad night does not move the host',
  hostOffset(oneBad, h).offsetMs === 0, `${hostOffset(oneBad, h).offsetMs}ms`);

const newcomers = match('2026-09-15T00:00:00Z', 90, { X: 150, Y: 200, A: 120 });
const n = hostOffset(newcomers, h);
check('with fewer than three returning players it says why and records no number',
  n.offsetMs === null && /3 are needed/.test(n.reason), n.reason);

const withBots = match('2026-09-15T00:00:00Z', 0, field, {
  bots: [{ name: 'Robot', isBot: true }],
  buzzes: () => [{ name: 'Robot', ms: 50 }, { name: 'A', ms: 10, early: true }, { name: 'B', ms: 5, spectator: true }],
});
const pm = pressMedians(withBots);
check('robots, early presses and spectators are not part of anybody\'s clock',
  !pm.has('Robot') && pm.get('A').presses === MIN_PRESSES + 2 && pm.get('B').presses === MIN_PRESSES + 2);

const partialThenFinal = buildHistory([
  { ...match('2026-09-01T00:00:00Z', 500, field), partial: true },
  match('2026-09-01T00:00:00Z', 0, field),
]);
check('a match\'s partial and final logs count once, the final one winning',
  partialThenFinal.get('A').length === 1 && partialThenFinal.get('A')[0].median < 200);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
