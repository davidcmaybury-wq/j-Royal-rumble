// What a robot says when it is about to be wrong.
//
// The point of this suite is the fallback, not the model. Wrong answers are
// written by Claude Haiku when a key is set, and borrowed from the board when
// it is not — and for a long time the second case was invisible: every failure
// went through a bare `catch {}` with nothing logged, so a missing key, a
// rejected key, a wrong model name and a timeout all surfaced the same way, as
// robots saying nonsense in a live match.
//
// So the checks here are: the local answer is still sane, and the fact that it
// is being used is reported rather than swallowed. Nothing here calls the API —
// the suite runs in CI with no key, which is exactly the path worth pinning.
import { wrongAnswer, status } from '../src/wrongs.js';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const clue = {
  category: 'US PRESIDENTS',
  text: 'He was the last president born a British subject',
  answer: 'William Henry Harrison',
};
const siblings = ['Millard Fillmore', 'James K. Polk', 'Zachary Taylor'];

console.log('WITHOUT A KEY, THE BOARD FILLS IN');
{
  const before = status();
  check('it reports the model it would use', before.model === 'claude-haiku-4-5', before.model);
  check('and whether a key is configured', typeof before.configured === 'boolean',
    String(before.configured));

  const a = await wrongAnswer(clue, siblings);
  check('an answer comes back', typeof a === 'string' && a.length > 0, String(a));
  check('and it is not the right one', a !== clue.answer, String(a));
  check('it is one of the board\'s other answers', siblings.includes(a), String(a));

  // The same clue re-tossed must not produce a different wrong answer, or the
  // room hears the robot change its mind about something it already said.
  const b = await wrongAnswer(clue, siblings);
  check('the same clue gives the same answer', a === b, `${a} / ${b}`);
}

console.log('\nAND SAYS SO, RATHER THAN SWALLOWING IT');
{
  const s = status();
  const noKey = !s.configured;
  check('it counts what it was asked for', s.asked >= 2, String(s.asked));
  if (noKey) {
    check('the mode is what the room is hearing', s.mode === 'local', s.mode);
    check('the fallbacks are counted', s.fellBack >= 2, String(s.fellBack));
    check('and the reason names the fix', /ANTHROPIC_API_KEY/.test(s.lastError || ''),
      s.lastError || 'none');
  } else {
    // A key is present in this environment; the model path is exercised for
    // real and the suite checks the shape rather than the sentence.
    check('something was written or the reason is recorded',
      s.written > 0 || !!s.lastError, s.lastError || `${s.written} written`);
  }
}

console.log('\nNOTHING TO BORROW');
{
  // A category whose other answers are all gone, or a one-clue board. Silence
  // beats a robot repeating the correct answer.
  const a = await wrongAnswer(clue, []);
  check('it returns null rather than the right answer', a === null || a !== clue.answer,
    String(a));
}

console.log('\nIT NEVER THROWS, WHATEVER IT IS HANDED');
{
  // The engine calls this with whatever the board holds; a malformed clue must
  // not take a match down.
  for (const [label, bad] of [
    ['an empty clue', {}],
    ['null fields', { category: null, text: null, answer: null }],
    ['answers containing the right one', clue],
  ]) {
    let threw = null;
    try { await wrongAnswer(bad, [null, undefined, '', clue.answer]); }
    catch (e) { threw = e; }
    check(`survives ${label}`, threw === null, threw ? String(threw.message) : '');
  }
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
