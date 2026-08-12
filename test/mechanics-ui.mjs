// The console has to be able to see a top-rope declaration and a target.
// These are the fields it draws with — if any is missing the signal is dead.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 0,
    topRope: true, targeting: true } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C', 'D']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(300);
const ring = st.live.map((p) => p.token);
const by = (t) => ps.find((p) => p.token === t);

// --- top rope ---
by(ring[0]).s.emit('top-rope', { on: true });
await wait(250);
const up = st.live.find((p) => p.token === ring[0]);
check('the console can see who is up top', up.topRope === true);
check('and nobody else is flagged',
  st.live.filter((p) => p.topRope).length === 1);
by(ring[0]).s.emit('top-rope', { on: false });
await wait(200);
check('coming back down clears it',
  !st.live.find((p) => p.token === ring[0]).topRope);

// --- targeting, and the multiplier ---
by(ring[1]).s.emit('set-target', { target: ring[0] });
await wait(220);
let t0 = st.live.find((p) => p.token === ring[0]);
check('one aggressor shows as one', (t0.targetedBy || []).length === 1);

by(ring[2]).s.emit('set-target', { target: ring[0] });
await wait(220);
t0 = st.live.find((p) => p.token === ring[0]);
check('two aggressors stack into a count', (t0.targetedBy || []).length === 2,
  `${(t0.targetedBy || []).length} aiming`);
check('the aggressors are identified, not just counted',
  t0.targetedBy.includes(ring[1]) && t0.targetedBy.includes(ring[2]));

by(ring[1]).s.emit('set-target', { target: null });
await wait(220);
t0 = st.live.find((p) => p.token === ring[0]);
check('standing down decrements it', (t0.targetedBy || []).length === 1);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
