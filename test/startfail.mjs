// Starting a match has to say why when it will not.
//
// The setup screen used to save quietly and navigate on a timer, so a refusal
// showed nothing at all: the button did nothing and the host landed on a
// console for a match that had never begun.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((r) => s.once(e, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, r));

const empty = await new Promise((r) => host.emit('start-match', {}, r));
check('an empty lobby is refused, out loud', !!empty.error, empty.error);

const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, r));
  ps.push(s);
}
await wait(300);
const ok = await new Promise((r) => host.emit('start-match', {}, r));
check('with three players it starts', ok.ok === true, JSON.stringify(ok));

const twice = await new Promise((r) => host.emit('start-match', {}, r));
check('and starting twice says so', !!twice.error, twice.error);

// Somebody who is not the host must be told, not ignored.
const rando = io(U, { transports: ['websocket'] });
await once(rando, 'connect');
await new Promise((r) => rando.emit('join', { gameId: m.gameId, name: 'D' }, r));
const refused = await new Promise((r) => {
  rando.emit('start-match', {}, r);
  setTimeout(() => r({ error: null, silent: true }), 1500);
});
check('a non-host is refused rather than ignored', !refused.silent,
  refused.error || 'SILENT — the button would just do nothing');

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((s) => s.close()); rando.close();
process.exit(fails ? 1 : 0);
