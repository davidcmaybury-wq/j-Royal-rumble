// The front door.
//
// It used to be the host setup page, so anybody who typed the domain landed on
// the controls for running a match — and a mistyped room code sent them to a
// buzzer that simply never connected, which reads as the site being broken
// rather than as a typo.
const U = process.env.URL || 'http://127.0.0.1:8080';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const root = await fetch(`${U}/`);
const html = await root.text();
check('the root serves a page', root.ok);
check('and it is the welcome screen, not setup',
  html.includes('data-go="play"') && !html.includes('Advanced mechanics'));
check('offering all three ways in',
  ['play', 'watch', 'host'].every((w) => html.includes(`data-go="${w}"`)));

// The existence check the page leans on.
const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const good = await (await fetch(`${U}/api/match/${m.gameId}/exists`)).json();
check('a real room is found', good.exists === true, JSON.stringify(good));
check('lower case works too, since nobody types capitals',
  (await (await fetch(`${U}/api/match/${m.gameId.toLowerCase()}/exists`)).json()).exists === true);
const bad = await (await fetch(`${U}/api/match/ZZZZ/exists`)).json();
check('a made-up one is not', bad.exists === false, JSON.stringify(bad));

// It must not become a way to read a match you are not in.
const keys = Object.keys(good);
check('and it gives away nothing else',
  keys.every((k) => ['exists', 'phase'].includes(k)), keys.join(', '));

// The pages it sends people to.
for (const [path, want] of [
  [`/setup/${m.gameId}`, 'Advanced mechanics'],
  [`/j/${m.gameId}`, 'buzz'],
  [`/watch/${m.gameId}`, 'watch'],
]) {
  const r = await fetch(`${U}${path}`);
  check(`${path} serves a page`, r.ok, String(r.status));
}

// The host key must not travel in the query string, where it lands in logs.
check('the welcome page puts the host key in the fragment',
  html.includes('#${m.hostKey}') || html.includes('`/setup/${m.gameId}#${m.hostKey}`'),
  'checked in the page source');

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
