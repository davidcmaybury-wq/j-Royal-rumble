// Library text as the room sees it (src/library-text.js): every title, note
// and clue in data/library.ndjson.gz, cleaned the way the server cleans it at
// boot, carries no escape and no stray backslash. Runs with no server.
//
// test/escapes.mjs checks the same thing on live boards, but by sampling, and
// a sample missed the one clue that ended in a lone backslash.
//
//   node test/library-text.mjs

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unescapeText, cleanLibrary } from '../src/library-text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failures++; };

check('an escaped quote is undone', unescapeText('FOREVER "YOUNG\\"') === 'FOREVER "YOUNG"');
check('an escape escaped twice is undone too', unescapeText('\\\\\\"AIN\\" DROPS') === '"AIN" DROPS');
check('HTML entities become their characters', unescapeText('Q&amp;A &quot;yes&quot; it&#39;s') === 'Q&A "yes" it\'s');
check('a lone backslash at the end is trimmed', unescapeText('from 1473 to 1481\\') === 'from 1473 to 1481');
check('text with nothing to clean is left alone', unescapeText('The C:/ drive & "quotes"') === 'The C:/ drive & "quotes"');
check('a missing note stays missing', unescapeText(null) === null);

const lib = gunzipSync(readFileSync(join(ROOT, 'data', 'library.ndjson.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const { cats, clues } = cleanLibrary(lib);
const dirty = [];
for (const c of lib) for (const s of [c.title, c.note, ...c.clues.flatMap((x) => [x.text, x.answer])]) {
  if (typeof s === 'string' && /\\|&quot;|&amp;|&#39;/.test(s)) dirty.push(`${c.id}: ${s.slice(0, 80)}`);
}
check(`no title, note or clue in the library reaches the screen with a backslash or an entity (${lib.length} categories)`, dirty.length === 0, dirty.slice(0, 3).join(' | '));
check('the cleaning has work to do, so this suite is testing something', cats > 1000 && clues > 10000, `${cats} categories, ${clues} clues repaired`);
check('ids are never touched', lib.every((c) => !/\\/.test(c.id)));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
