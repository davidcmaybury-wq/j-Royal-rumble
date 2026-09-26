// Release notes: the file parses, every note fits Discord, the version being
// shipped has one, the posted record round-trips, and nothing is ever posted
// without a bot. Standalone — no server, no network, and the record is written
// to a temp file, never to /data.
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'rumble-notes-'));
process.env.RUMBLE_NOTES_POSTED = join(dir, 'posted.json');
delete process.env.RUMBLE_DISCORD_BOT_TOKEN;
delete process.env.RUMBLE_DISCORD_ROOM_CHANNEL;
delete process.env.RUMBLE_NOTES;
const notes = await import('../src/notes.js');

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

console.log('THE FILE');
const all = notes.parse();
check('the notes file has sections', all.length > 0, `${all.length}`);
check('every section is a version and a title', all.every((n) => /^\d+\.\d+\.\d+$/.test(n.version) && n.title.length > 3),
  all.filter((n) => !n.title).map((n) => n.version).join(',') || 'all named');
check('and has a body', all.every((n) => n.body.length > 20), all.filter((n) => n.body.length <= 20).map((n) => n.version).join(',') || 'all');
check('newest first', all.every((n, i) => i === 0 || notes.compare(all[i - 1].version, n.version) > 0),
  all.map((n) => n.version).slice(0, 4).join(' > '));
check('no version appears twice', new Set(all.map((n) => n.version)).size === all.length);

// A release with nothing to tell the room is a release nobody wrote up. This is
// the check that refuses it.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
check(`the version being shipped, ${pkg.version}, has a note`, !!notes.find(pkg.version, all));

console.log('\nFITS DISCORD');
const long = all.filter((n) => notes.message(n).length > notes.DISCORD_CAP);
check('every single-version message is under the cap', long.length === 0,
  long.length ? long.map((n) => `${n.version}: ${notes.message(n).length}`).join(', ') : `${all.length} checked`);
const d = notes.digest(all);
check('the digest of every version fits, split at version boundaries if it must',
  d.every((m) => m.length <= notes.DISCORD_CAP), `${d.length} message(s), longest ${Math.max(...d.map((m) => m.length))}`);
check('and lists oldest first', /• \*\*0\.97\.0\*\*/.test(d[0]) && d[0].indexOf('0.97.0') < d[0].indexOf('0.98.0'));
check('links are wrapped so Discord does not unfurl them', d.every((m) => /<https?:\/\/[^>]+>/.test(m)));
const m0 = notes.message(all[0]);
check('a message names the game and the version first', m0.startsWith(`**J! Royal Rumble ${all[0].version}`));
check('no handles or P-labels in the notes', !/\bP\d{1,3}\b/.test(readFileSync(notes.NOTES_FILE, 'utf8')));

console.log('\nTHE RECORD');
check('starts empty', notes.posted().versions.length === 0);
notes.markPosted(['0.1.0', '0.2.0']);
notes.markPosted(['0.2.0', '0.3.0']);
check('records without duplicates, through a rename', JSON.stringify(notes.posted().versions) === '["0.1.0","0.2.0","0.3.0"]'
  && existsSync(process.env.RUMBLE_NOTES_POSTED) && !existsSync(process.env.RUMBLE_NOTES_POSTED + '.tmp'),
  JSON.stringify(notes.posted().versions));
check('and says it is not durable here', notes.durable() === false);

console.log('\nNEVER WITHOUT A BOT');
check('not ready with no bot configured', notes.ready() === false);
const r = await notes.autoPost(pkg.version);
check('autoPost at boot is a quiet no-op without one', r.posted === false && /no Discord/.test(r.why), r.why);
check('and records nothing', !notes.posted().versions.includes(pkg.version));
const c = await notes.catchUp({ dryRun: true });
check('a dry-run catch-up composes the digest of everything unposted', c.messages.length >= 1 && c.versions.includes(pkg.version),
  `${c.versions.length} versions, ${c.messages.length} message(s)`);
check('and records nothing either', !notes.posted().versions.includes(pkg.version));
let threw = null;
try { await notes.catchUp({}); } catch (e) { threw = e.message; }
check('a real catch-up refuses rather than posting into the void', /no Discord/.test(threw || ''), threw || 'did not throw');
const since = await notes.catchUp({ dryRun: true, since: pkg.version });
check('--since trims the older versions off the digest', since.versions.length === 1 && since.versions[0] === pkg.version,
  since.versions.join(','));
process.env.RUMBLE_NOTES = 'off';
process.env.RUMBLE_DISCORD_BOT_TOKEN = 'x'; process.env.RUMBLE_DISCORD_ROOM_CHANNEL = '1';
check('RUMBLE_NOTES=off wins over a configured bot', notes.ready() === false && /RUMBLE_NOTES=off/.test((await notes.autoPost(pkg.version)).why));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
