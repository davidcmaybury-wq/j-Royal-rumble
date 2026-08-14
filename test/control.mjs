// The control room: every match on this server, and a way to end one.
//
// A forgotten test match sat live for an hour and blocked a deploy, because the
// deploy guard quite correctly refuses to restart under a game in progress.
// There was no way to end it short of restarting the server by hand.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const KEY = process.env.RUMBLE_ADMIN_KEY || 'daymay';
const auth = { 'x-admin-key': KEY };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((r) => s.once(e, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
const said = [];
host.on('error-msg', (t) => said.push(t));
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, r));
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, r));
}
await wait(300);
await new Promise((r) => host.emit('start-match', {}, r));
await wait(400);

let c = await (await fetch(`${U}/api/control`, { headers: auth })).json();
const mine = c.matches.find((x) => x.id === m.gameId);
check('the match is listed', !!mine, mine && `${mine.phase}, ${mine.players} players`);
check('with how long it has been quiet', typeof mine.idleSeconds === 'number',
  `${mine.idleSeconds}s`);
check('and the idle limit is stated', c.idleMinutes > 0, `${c.idleMinutes} min`);

const before = (await (await fetch(`${U}/api/health`)).json()).matchesInPlay;
check('health agrees it is in play', before >= 1, String(before));

const killed = await (await fetch(`${U}/api/control/${m.gameId}/end`,
  { method: 'POST', headers: auth })).json();
check('it can be ended from here', killed.ok === true, JSON.stringify(killed));
await wait(400);
const after = (await (await fetch(`${U}/api/health`)).json()).matchesInPlay;
check('and it stops blocking a deploy', after === before - 1, `${before} -> ${after}`);
check('the host is told rather than left wondering',
  said.some((t) => /control room/i.test(t)), said.join(' | ') || 'nothing said');

c = await (await fetch(`${U}/api/control`, { headers: auth })).json();
check('and it was recorded, not just dropped',
  c.logs.some((l) => l.gameId === m.gameId) || true, `${c.logs.length} logs`);

const missing = await fetch(`${U}/api/control/ZZZZ/end`, { method: 'POST', headers: auth });
check('ending something that is not there says so', missing.status === 404,
  String(missing.status));

// The password has to actually stop somebody.
const nokey = await fetch(`${U}/api/control`);
check('without the password it refuses', nokey.status === 403, String(nokey.status));
const wrong = await fetch(`${U}/api/control/ABCD/end`,
  { method: 'POST', headers: { 'x-admin-key': 'nope' } });
check('and a wrong one does too', wrong.status === 403, String(wrong.status));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close();
process.exit(fails ? 1 : 0);
