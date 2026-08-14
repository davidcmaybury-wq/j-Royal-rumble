// A retired host has to send people to the live one.
//
// Matches live in memory on a single instance, so half a group joining the old
// address and half the new one is two separate broken games — the worst kind of
// failure, because both halves think the match is running.
import { spawn } from 'child_process';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', ['src/server.js'], {
  env: { ...process.env, PORT: '8099', RUMBLE_MOVED_TO: 'https://j-royal-rumble.net' },
  stdio: 'ignore',
});
// The server takes a while to load the clue library, so wait for it properly
// rather than assuming a fixed delay.
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  await wait(500);
  try { const r = await fetch('http://127.0.0.1:8099/api/health'); up = r.ok; } catch {}
}
check('the retired server boots', up);
if (!up) { srv.kill(); process.exit(1); }

const html = await fetch('http://127.0.0.1:8099/j/ABCD',
  { headers: { accept: 'text/html' }, redirect: 'manual' });
check('a browser gets a page, not a silent bounce', html.status === 410, String(html.status));
const body = await html.text();
check('naming the new address, with the room code kept',
  body.includes('https://j-royal-rumble.net/j/ABCD'),
  body.includes('j-royal-rumble.net') ? 'domain present' : 'MISSING');
check('and saying why it matters', /not be the same match/.test(body));

const api = await fetch('http://127.0.0.1:8099/api/match', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: '{}', redirect: 'manual' });
check('non-browser callers are redirected', api.status === 308, String(api.status));
check('preserving the path', (api.headers.get('location') || '').endsWith('/api/match'),
  api.headers.get('location'));

const health = await fetch('http://127.0.0.1:8099/api/health');
check('health still answers, so a retired box can be watched', health.ok);

srv.kill();
console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
