// Wrestler avatars, and the animations drawing the right people.
import { avatar, lookFor, distinctLook, looksAlike, wrestler,
         SINGLET_STYLES, HAIR_STYLES } from '../public/wrestlers.js';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const a = lookFor('Marko'), b = lookFor('Marko');
check('a look is stable for the same player', JSON.stringify(a) === JSON.stringify(b));
check('and different players differ', JSON.stringify(lookFor('Colin')) !== JSON.stringify(a));

// Thirty players in a room must all be tellable apart.
const taken = [];
for (let i = 0; i < 30; i++) taken.push(distinctLook('player-' + i, taken));
let clashes = 0;
for (let i = 0; i < taken.length; i++) {
  for (let j = i + 1; j < taken.length; j++) if (looksAlike(taken[i], taken[j])) clashes++;
}
check('thirty players get thirty distinguishable wrestlers', clashes === 0,
  `${clashes} clashes`);
check('across a real spread of styles',
  new Set(taken.map((t) => t.hair)).size >= 4
  && new Set(taken.map((t) => t.colour)).size >= 6,
  `${new Set(taken.map((t) => t.hair)).size} hairstyles, ${new Set(taken.map((t) => t.colour)).size} colours`);

const svg = avatar(lookFor('Marko'), 24);
check('the avatar is an svg at the size asked for',
  svg.startsWith('<svg') && svg.includes('width="24"'));
check('and every style draws something',
  SINGLET_STYLES.every((s) => avatar({ ...a, singlet: s }, 24).length > 300));
check('including a referee', avatar({ referee: true }, 24).includes('#EEEBE1'));
check('every hairstyle too',
  HAIR_STYLES.every((h) => avatar({ ...a, hair: h }, 24).length > 300));

// Two players with different singlet colours must actually render differently.
const one = avatar({ ...a, colour: 'crimson' }, 24);
const two = avatar({ ...a, colour: 'jade' }, 24);
check('a different singlet colour changes the drawing', one !== two);
check('a different hairstyle changes it too',
  avatar({ ...a, hair: 'mohawk' }, 24) !== avatar({ ...a, hair: 'bald' }, 24));

check('the body sprite draws too', wrestler(20, 17, a, { arms: 'raise' }).length > 200);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
