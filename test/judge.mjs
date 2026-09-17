// Ruling on what a recognizer heard, and matching a spoken pick to a cell.
//
// Both modules are pure — no server, no key — so this runs anywhere and the
// paths it pins are the ones that decide a clue without a model: the fast
// paths, the guards, and the phonetic matcher. The model path is exercised
// only for its parser, because a suite that needs a key is a suite that does
// not run in CI.
//
// Most of the cases below are Matt Schiffler's, from j-trivia's live matches.
// They are named as such where the case is his rather than ours.
import { judge, normalize, repairStarter, isBareInterrogative, localJudge, status } from '../src/judge.js';
import { matchPick, extractValue, codesMatch, wordCodes, proposeCategory } from '../src/pick-match.js';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

console.log('WHAT COUNTS AS THE SAME ANSWER');
{
  check('the question form is stripped, because we do not require it',
    normalize('What is Chanel?') === 'chanel', normalize('What is Chanel?'));
  check('and so is a player thinking out loud',
    normalize("I think it's the Rhine") === 'rhine', normalize("I think it's the Rhine"));
  check('articles do not decide a ruling',
    normalize('The Beatles') === normalize('Beatles'));
  check('a misheard starter is repaired rather than failing the match',
    repairStarter('chris the capital of France') === 'What is the capital of France',
    repairStarter('chris the capital of France'));
  check('and a real word that merely starts the same is left alone',
    repairStarter('Christopher Columbus') === 'Christopher Columbus');
  check('somebody who trailed off has not answered',
    isBareInterrogative('what') && isBareInterrogative('Who is?'));
  check('but a real answer beginning that way has',
    !isBareInterrogative('what is Chanel'));
}

console.log('\nTHE FAST PATHS RULE WITHOUT A MODEL, AND ONLY EVER UPWARD');
{
  const clue = { clue: 'She was the first woman to hold the office', answer: 'Madeleine Albright', category: 'SECRETARIES OF STATE' };
  const exact = await judge({ ...clue, said: 'Who is Madeleine Albright' });
  check('an exact match after normalizing is correct, with no model call',
    exact.verdict === 'correct' && exact.via === 'exact', `${exact.verdict} via ${exact.via}`);
  check('and it is fast enough not to be worth measuring', exact.ms < 50, `${exact.ms} ms`);

  const grace = await judge({ clue: 'Shakespeare wrote it', answer: 'Antony and Cleopatra',
    category: 'THE BARD', said: 'Antony in Cleopatra' });
  check('"and" misheard as "in" is corrected deterministically (Matt\'s case)',
    grace.verdict === 'correct' && grace.via === 'grace', `${grace.verdict} via ${grace.via}`);

  const bare = await judge({ ...clue, said: 'what' });
  check('a bare interrogative is not a correct answer (Matt\'s Daily Double)',
    bare.verdict === 'unclear' && bare.via === 'bare', bare.verdict);
  const empty = await judge({ ...clue, said: '   ' });
  check('and neither is silence', empty.verdict === 'unclear', empty.verdict);
}

console.log('\nWITH NO KEY IT SAYS "I COULD NOT TELL", NEVER "NO"');
{
  // The suite runs without ANTHROPIC_API_KEY in CI; if one is present the
  // model path answers instead and these assertions would be measuring the
  // model, so they are skipped rather than made flaky.
  const s = status();
  if (s.configured) {
    check('a key is configured, so the local judge is not the path under test (skipped)', true, s.mode);
  } else {
    const wrong = await judge({ clue: 'Who wrote it', answer: 'Herman Melville',
      category: 'AUTHORS', said: 'Nathaniel Hawthorne' });
    check('a wrong answer with no model is unclear, not wrong',
      wrong.verdict === 'unclear' && wrong.local === true, `${wrong.verdict} local=${wrong.local}`);
    check('and the verdict says a model never saw it', wrong.via === 'local', wrong.via);
    const all = await judge({ clue: 'Who wrote it', answer: 'Herman Melville',
      category: 'AUTHORS', said: 'I think it is Herman Melville' });
    check('every word of the answer being said is enough to rule correct',
      all.verdict === 'correct', all.verdict);
  }
  check('the local judge never invents a wrong',
    localJudge('something else entirely', 'herman melville').verdict === 'unclear');
  check('part of the answer and nothing else is too broad, not wrong',
    localJudge('melville', 'herman melville').verdict === 'too_broad',
    JSON.stringify(localJudge('melville', 'herman melville')));
  check('and it counts what it heard, so the reason is checkable',
    /1 of 2/.test(localJudge('melville', 'herman melville').reason),
    localJudge('melville', 'herman melville').reason);
}

console.log('\nHEALTH SAYS WHICH STAGE IS DOING THE WORK');
{
  const s = status();
  check('it counts what it was asked', s.asked >= 6, String(s.asked));
  check('and how many never needed a model', s.fast >= 4, String(s.fast));
  check('and names the model it would use', s.model.startsWith('claude-'), s.model);
  check('and the verdicts it has handed down', s.verdicts.correct >= 2, JSON.stringify(s.verdicts));
}

console.log('\nTHE DOLLAR VALUE IS FOUND SEPARATELY FROM THE CATEGORY');
{
  const values = [100, 200, 300, 400, 500];
  check('a spoken number is the value', extractValue('presidents for 400', values).value === 400);
  check('and so is a written-out one', extractValue('presidents for four hundred', values).value === 400);
  check('"for" becoming a 4 does not beat the real number (Matt\'s homophone case)',
    extractValue('presidents for 400', values).value === 400);
  check('the last number on the board wins',
    extractValue('the 1980s for 300', values).value === 300,
    String(extractValue('the 1980s for 300', values).value));
  check('a number nobody can pick is skipped', extractValue('presidents for 450', values).value === null,
    String(extractValue('presidents for 450', values).value));
  check('the value is taken out of what the category matcher sees',
    !/400/.test(extractValue('presidents for 400', values).rest),
    extractValue('presidents for 400', values).rest);
  check('a digit glued to a word still reads (Matt\'s "starts with h2000")',
    extractValue('starts with h500', values).value === 500);
}

console.log('\nCATEGORIES ARE MATCHED ON SOUND, AND A TIE IS NOT A MATCH');
{
  const board = [
    { title: 'U.S. PRESIDENTS', clues: [1, 2, 3, 4, 5].map((row) => ({ row, revealed: false })) },
    { title: 'WORLD CAPITALS', clues: [1, 2, 3, 4, 5].map((row) => ({ row, revealed: false })) },
    { title: 'MAN-AGRAMS', clues: [1, 2, 3, 4, 5].map((row) => ({ row, revealed: false })) },
    { title: 'POTENT POTABLES', clues: [1, 2, 3, 4, 5].map((row) => ({ row, revealed: false })) },
    { title: 'THE SPORTSCASTER\'S QUOTE', clues: [1, 2, 3, 4, 5].map((row) => ({ row, revealed: false })) },
    { title: 'OLYMPIC MEDALISTS', clues: [1, 2, 3, 4, 5].map((row) => ({ row, revealed: false })) },
  ];
  const p = matchPick('presidents for 400', board);
  check('a clean call lands on the cell', p.slot === 0 && p.row === 4, JSON.stringify(p));
  const heard = matchPick('precedence for four hundred', board);
  check('a mangled word still lands, on sound (Matt\'s precedence/presidents)',
    heard.slot === 0 && heard.row === 4, JSON.stringify(heard));
  const port = matchPick('managrams for 200', board);
  check('a portmanteau said as one word matches the hyphenated title',
    port.slot === 2 && port.row === 2, JSON.stringify(port));
  const apos = matchPick('sportscaster for 100', board);
  check('an apostrophe in the title does not break matching',
    apos.slot === 4, JSON.stringify(apos));
  const none = matchPick('let us try aardvarks for 300', board);
  check('nothing that sounds like the board is refused, with a reason a host can say',
    none.slot === null && /did not sound like/.test(none.why), none.why);
  const noValue = matchPick('presidents please', board);
  check('a category with no value keeps the category and says what is missing',
    noValue.slot === 0 && noValue.row === null && /no dollar value/.test(noValue.why), noValue.why);
  const alts = matchPick(['metal ists for 500', 'medalists for 500'], board);
  check('ranked alternatives are merged, so a second guess can carry the word',
    alts.slot === 5 && alts.row === 5, JSON.stringify(alts));

  const gone = [
    { title: 'U.S. PRESIDENTS', clues: [{ row: 1, revealed: true }, { row: 2, revealed: false }] },
    { title: 'WORLD CAPITALS', clues: [{ row: 1, revealed: false }] },
  ];
  const taken = matchPick('presidents for 100', gone);
  check('a clue already played is named as gone rather than picked',
    taken.taken === true && /already gone/.test(taken.why), taken.why);
}

console.log('\nOVERTIME: PLAYERS CALL THE NUMBER ON THE BOARD, NOT THE FACE VALUE');
{
  const board = [{ title: 'PRESIDENTS', clues: [1, 2, 3, 4, 5].map((row) => ({ row, revealed: false })) }];
  const face = matchPick('presidents for 400', board, { multiplier: 4 });
  check('the face value still works', face.row === 4, JSON.stringify(face));
  const shown = matchPick('presidents for 1600', board, { multiplier: 4 });
  check('and so does what the board is showing at x4',
    shown.row === 4, JSON.stringify(shown));
}

console.log('\nA MODEL MAY PROPOSE A CATEGORY; ITS OWN EVIDENCE DECIDES');
{
  const board = [{ title: 'OF THE LAW', clues: [] }, { title: 'OLYMPIC MEDALISTS', clues: [] }];
  const hallucinated = await proposeCategory('section for 400', board,
    async () => ({ slot: 0, evidenceWord: 'section' }));
  check('a thematic guess is thrown away (Matt\'s live hallucination)',
    hallucinated.slot === null && /not in both/.test(hallucinated.why), hallucinated.why);
  const real = await proposeCategory('medal ists for 400', board,
    async () => ({ slot: 1, evidenceWord: 'medalists' }));
  check('a proposal whose evidence is in both survives', real.slot === 1, real.why);
  const nothing = await proposeCategory('anything', board, null);
  check('with no fallback configured it simply says so', nothing.slot === null, nothing.why);
  const broken = await proposeCategory('anything', board, async () => { throw new Error('rate limited'); });
  check('and a fallback that throws is a reason, not a crash',
    broken.slot === null && /rate limited/.test(broken.why), broken.why);
}

console.log('\nTHE PHONETIC RULES THEMSELVES');
{
  check('identical words match', codesMatch(wordCodes('curie'), wordCodes('curie')));
  check('one code inside another matches (metal in medalists)',
    codesMatch(wordCodes('metal'), wordCodes('medalists')));
  check('a long shared prefix matches (precedence and presidents)',
    codesMatch(wordCodes('precedence'), wordCodes('presidents')));
  check('unrelated words do not', !codesMatch(wordCodes('aardvark'), wordCodes('presidents')));
  check('a stop word carries no evidence', wordCodes('the') === null);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
