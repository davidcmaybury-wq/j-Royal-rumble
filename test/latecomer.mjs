// Turning up after the bell, and keeping the next entrant a secret.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 6, delay: 0 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let hs = null;
host.on('state', (s) => { hs = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { hs = x.state; r(); }));
const ps = [];
for (const n of ['A', 'B', 'C', 'D']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
const watch = io(U, { transports: ['websocket'] });
await once(watch, 'connect');
let ws = null;
watch.on('state', (s) => { ws = s; });
ws = (await new Promise((r) => watch.emit('watch-game', { gameId: m.gameId }, r))).state;
await wait(200);
host.emit('start-match');
await wait(300);

const play = async () => {
  const open = [];
  hs.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(60);
  host.emit('resolve', { winnerToken: hs.live[0].token });
  await wait(120);
};
for (let i = 0; i < 3; i++) await play();

console.log('LATECOMERS');
const late = io(U, { transports: ['websocket'] });
await once(late, 'connect');
const r = await new Promise((x) => late.emit('join', { gameId: m.gameId, name: 'Latecomer' }, x));
check('somebody can join a running match', r.ok === true && r.late === true,
  r.error || `draw ${r.draw}`);
check('they go to the back of the queue', r.draw === 5, `draw ${r.draw}`);
await wait(250);
check('the host sees the queue grow',
  (hs.queue || []).length === 2, `${(hs.queue || []).length} waiting`);
check('and they enter at the standard stake later', r.state.you.state === 'queued');

console.log('\nANONYMITY');
check('the console is not told who is next',
  (hs.queue || []).every((q) => q.name === null), JSON.stringify(hs.queue?.[0]));
check('nor is the watch screen',
  (ws.queue || []).every((q) => q.name === null), JSON.stringify(ws.queue?.[0]));
check('but the countdown is still there',
  typeof hs.cluesUntilNextEntry === 'number', String(hs.cluesUntilNextEntry));
check('the admin window does get the name',
  hs.nextUp && typeof hs.nextUp.name === 'string' && hs.nextUp.draw > 0,
  JSON.stringify(hs.nextUp));
check('and the entrant knows their own place',
  r.state.you.queuePlace > 0 || r.state.you.cluesToEntry != null,
  `place ${r.state.you.queuePlace}, in ${r.state.you.cluesToEntry}`);

// With it off, everything is visible again. A fresh match rather than a PATCH:
// settings are fixed once a match starts, which is the right rule — you should
// not be able to change how the game works halfway through it.
{
  const m2 = await (await fetch(`${U}/api/match`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { entryInterval: 6, delay: 0,
      anonymousNext: false } }) })).json();
  const h2 = io(U, { transports: ['websocket'] });
  await once(h2, 'connect');
  let s2 = null;
  h2.on('state', (x) => { s2 = x; });
  await new Promise((r) => h2.emit('host-join', { gameId: m2.gameId, hostKey: m2.hostKey }, (x) => { s2 = x.state; r(); }));
  const p2 = [];
  for (const n of ['W', 'X', 'Y', 'Z']) {
    const s = io(U, { transports: ['websocket'] });
    await once(s, 'connect');
    const p = { s };
    await new Promise((r) => s.emit('join', { gameId: m2.gameId, name: n }, (x) => { p.token = x.token; r(); }));
    p2.push(p);
  }
  await wait(200);
  h2.emit('start-match');
  await wait(350);
  check('with the setting off the names are shown',
    (s2.queue || []).length > 0 && typeof s2.queue[0].name === 'string',
    JSON.stringify(s2.queue?.[0]));
  h2.close(); p2.forEach((p) => p.s.close());
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); watch.close(); late.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
