// The historical archetypes.
//
// Five robots built from 46 recorded matches of this game rather than from
// broadcast play. The test that matters is whether a robot reproduces the
// player type it was built from — median, tail and anticipation all three,
// because the whole point of the set is that speed and consistency are
// separate properties.
import { readFileSync } from 'fs';
import { makeBot, planClue, loadArchetypes, ARCHETYPES, ARCHETYPE_LEVELS,
         archetypeField, drawArchetype, describe } from '../src/bots.js';
import { makeRng } from '../src/engine.js';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

loadArchetypes(JSON.parse(readFileSync(new URL('../data/archetype-distributions.json', import.meta.url), 'utf8')));
const rng = makeRng(11);

check('there are five', ARCHETYPE_LEVELS.length === 5, ARCHETYPE_LEVELS.join(', '));
check('and their shares add to one',
  Math.abs(Object.values(ARCHETYPES).reduce((a, x) => a + x.share, 0) - 1) < 0.02);

console.log('\nEACH ROBOT REPRODUCES ITS SOURCE');
for (const [name, a] of Object.entries(ARCHETYPES)) {
  const bot = makeBot(rng, { set: 'archetypes', level: name });
  const s = [];
  for (let i = 0; i < 20000; i++) {
    const p = planClue(bot, 1 + (i % 5), rng, 250, 0, 0);
    if (p.attempt && !p.early) s.push(p.ms);
  }
  s.sort((x, y) => x - y);
  const med = s[Math.floor(s.length / 2)];
  const tail = s[Math.floor(s.length * 0.9)] / med;
  const antic = s.filter((x) => x < 150).length / s.length;
  check(`${name} lands on its median`, Math.abs(med - a.median) / a.median < 0.10,
    `${med.toFixed(0)}ms against ${a.median} recorded`);
  check(`  ...and its tail`, Math.abs(tail - a.tail) / a.tail < 0.20,
    `${tail.toFixed(1)}x against ${a.tail}x`);
  check(`  ...and how often it is on rhythm`, Math.abs(antic - a.anticipation) < 0.06,
    `${(antic * 100).toFixed(0)}% against ${(a.anticipation * 100).toFixed(0)}%`);
}

console.log('\nTHE TWO AXES ARE REALLY SEPARATE');
check('a gambler and a rhythm regular buzz at a similar speed',
  Math.abs(ARCHETYPES.gambler.median - ARCHETYPES.rhythm.median) < 40,
  `${ARCHETYPES.gambler.median} vs ${ARCHETYPES.rhythm.median}`);
check('but the gambler is far less dependable',
  ARCHETYPES.gambler.tail > ARCHETYPES.rhythm.tail * 2,
  `${ARCHETYPES.gambler.tail}x vs ${ARCHETYPES.rhythm.tail}x`);
check('a metronome is slow and the steadiest of the lot',
  ARCHETYPES.metronome.tail === Math.min(...Object.values(ARCHETYPES).map((a) => a.tail)));
check('accuracy does NOT vary with speed — the old ladder modelled nothing',
  Math.max(...Object.values(ARCHETYPES).map((a) => a.accuracy))
  - Math.min(...Object.values(ARCHETYPES).map((a) => a.accuracy)) < 0.08);

console.log('\nA FIELD LOOKS LIKE A REAL NIGHT');
const counts = {};
for (let i = 0; i < 4000; i++) { const a = drawArchetype(rng); counts[a] = (counts[a] || 0) + 1; }
for (const [name, a] of Object.entries(ARCHETYPES)) {
  check(`${name} turns up about ${(a.share * 100).toFixed(0)}% of the time`,
    Math.abs((counts[name] || 0) / 4000 - a.share) < 0.04,
    `${((counts[name] || 0) / 40).toFixed(0)}%`);
}
const f = archetypeField(20, rng);
check('a field of twenty deals twenty', f.length === 20);
check('and is not twenty of the same', new Set(f).size >= 3, [...new Set(f)].join(', '));

console.log('\nIT DESCRIBES ITSELF WITHOUT REACHING INTO THE LEVEL TABLES');
const b = makeBot(rng, { set: 'archetypes', level: 'metronome' });
check('describe() works on an archetype', /metronome/.test(describe(b)), describe(b));
const old = makeBot(rng, { level: 'champ' });
check('and still works on the level ladder', /champ/.test(describe(old)), describe(old));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
