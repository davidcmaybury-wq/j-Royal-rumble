// Entrance music.
//
// Synthesised rather than sourced, for the same reason as the game's cues: the
// licensing is unambiguous. The library is read from the folder, so dropping a
// file in adds it without a deploy — and the key a player chooses must never be
// able to become a path.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((r) => s.once(e, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const lib = await (await fetch(`${U}/api/themes`)).json();
check('the library is served', Array.isArray(lib.themes) && lib.themes.length > 0,
  `${lib.themes.length} themes`);
check('across all three moods',
  new Set(lib.themes.map((t) => t.mood)).size >= 3,
  [...new Set(lib.themes.map((t) => t.mood))].join(', '));
check('each with a title and a playable url',
  lib.themes.every((t) => t.title && t.url.startsWith('/audio/themes/')));

const one = await fetch(`${U}${lib.themes[0].url}`);
check('and the audio actually downloads', one.ok
  && Number(one.headers.get('content-length')) > 10000,
  `${Math.round(Number(one.headers.get('content-length')) / 1024)}KB`);

// Every theme should be about five seconds and matched in loudness — they play
// back to back all night, so one twice as loud as the rest is a real problem.
check('the library is a sensible size for a phone to fetch',
  lib.themes.length >= 8 && lib.themes.length <= 20, `${lib.themes.length}`);

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 1, delay: 0 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let hs = null;
host.on('state', (s) => { hs = s; });
const resolved = [];
host.on('resolved', (e) => resolved.push(e));
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { hs = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C', 'D']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(250);

const pick = await new Promise((r) => ps[3].s.emit('set-theme',
  { theme: { kind: 'library', key: lib.themes[0].key } }, r));
check('a player can choose a theme', pick.ok === true, JSON.stringify(pick.theme));

const yt = await new Promise((r) => ps[2].s.emit('set-theme',
  { theme: { kind: 'youtube', id: 'dQw4w9WgXcQ', start: 42, seconds: 8 } }, r));
check('or supply a YouTube link with a start time',
  yt.ok && yt.theme.id === 'dQw4w9WgXcQ' && yt.theme.start === 42, JSON.stringify(yt.theme));
check('and choose how long it plays for', yt.theme.seconds === 8, `${yt.theme.seconds}s`);

// Ten seconds is the ceiling: the room should not wait on somebody's music.
const long = await new Promise((r) => ps[2].s.emit('set-theme',
  { theme: { kind: 'youtube', id: 'dQw4w9WgXcQ', seconds: 45 } }, r));
check('a longer clip is capped at ten seconds', long.theme.seconds === 10,
  `${long.theme.seconds}s`);
const short = await new Promise((r) => ps[2].s.emit('set-theme',
  { theme: { kind: 'youtube', id: 'dQw4w9WgXcQ', seconds: 0 } }, r));
check('and a zero-length one still plays', short.theme.seconds >= 1,
  `${short.theme.seconds}s`);

// A chosen key must not be able to reach outside the folder.
const eviltoken = await new Promise((r) => ps[1].s.emit('set-theme',
  { theme: { kind: 'library', key: '../../../etc/passwd' } }, r));
check('a key cannot become a path',
  !eviltoken.ok || !/[/.]/.test(eviltoken.theme.key),
  JSON.stringify(eviltoken));
const badurl = await new Promise((r) => ps[1].s.emit('set-theme',
  { theme: { kind: 'url', url: 'javascript:alert(1)' } }, r));
check('and a link has to be https', !!badurl.error, badurl.error || 'ACCEPTED');

// The watch screen learns what to play when somebody walks in.
host.emit('start-match');
await wait(400);
const open = [];
hs.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
await wait(80);
host.emit('resolve', { winnerToken: hs.live[0].token });
await wait(400);

const withEntry = resolved.find((e) => (e.entrances || []).length);
check('an entrance is announced with its music', !!withEntry,
  withEntry ? JSON.stringify(withEntry.entrances[0]) : 'no entrance seen');
if (withEntry) {
  check('carrying a name so the screen can caption it',
    typeof withEntry.entrances[0].name === 'string');
}

// Entrance music is five seconds, whatever the source.
//
// A YouTube clip is played through a covered iframe rather than a hidden one —
// browsers refuse autoplay to a player with no size, which is how the first
// version failed silently. The cover is what makes it audio only.
{
  const { readFileSync } = await import('fs');
  const watch = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  check('the clip is cut off at the chosen length, capped at ten',
    /Math\.min\(10, Math\.max\(1, t\.seconds \|\| 5\)\) \* 1000/.test(watch));
  check('the player is covered, not hidden',
    watch.includes('ytcover') && !/width\s*=\s*.?0/.test(watch));
  const buzz = readFileSync(new URL('../public/buzzer.html', import.meta.url), 'utf8');
  check('and the test does the same', /}, secs \* 1000\)/.test(buzz) && buzz.includes('trycover'));
}

// Entrance music is five seconds, whatever the source.
//
// A YouTube clip is played through a covered iframe rather than a hidden one —
// browsers refuse autoplay to a player with no size, which is how the first
// version failed silently. The cover is what makes it audio only.
{
  const { readFileSync } = await import('fs');
  const watch = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  check('the clip is cut off at the chosen length, capped at ten',
    /Math\.min\(10, Math\.max\(1, t\.seconds \|\| 5\)\) \* 1000/.test(watch));
  check('the player is covered, not hidden',
    watch.includes('ytcover') && !/width\s*=\s*.?0/.test(watch));
  const buzz = readFileSync(new URL('../public/buzzer.html', import.meta.url), 'utf8');
  check('and the test does the same', /}, secs \* 1000\)/.test(buzz) && buzz.includes('trycover'));
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
