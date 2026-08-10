// The mechanics over real sockets, since the engine tests bypass the server.
import { io } from 'socket.io-client';
const U = 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, startScore: 3000, delay: 0,
    topRope: true, targeting: true, bounties: true, revival: true } }) })).json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['Ann', 'Bo', 'Cy', 'Dee', 'Eve']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name: n, s, token: null, view: null, targetedBy: null };
  s.on('state', (v) => { p.view = v; });
  s.on('targeted', (d) => { p.targetedBy = d.by; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(150);
host.emit('start-match');
await wait(250);

const by = (t) => ps.find((p) => p.token === t);
const ring = () => st.live.map((p) => p.token);
const openClue = () => {
  const o = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); }));
  return o;
};

check('mechanics reach the player view', by(ring()[0]).view.mechanics.topRope === true);

// top rope must be refused once a clue is up
const [a, b] = ring();
by(a).s.emit('top-rope', { on: true });
await wait(150);
check('top rope can be declared between clues', st.live.find((p) => p.token === a).topRope === true);
const [s0, r0] = openClue()[0];
host.emit('pick-clue', { slot: s0, row: r0 });
await wait(120);
by(b).s.emit('top-rope', { on: true });
await wait(150);
check('top rope is refused while a clue is live',
  st.live.find((p) => p.token === b).topRope === false);

const beforeA = st.live.find((p) => p.token === a).score;
const val = st.clue.value;
const opp = st.live.length - 1;
host.emit('activate');
await wait(120);
by(a).s.emit('buzz', { ms: 300, status: 'good' });
await wait(120);
host.emit('resolve', { winnerToken: a });
await wait(200);
check('the top rope doubled the winnings',
  st.live.find((p) => p.token === a).score - beforeA === val * opp * 2,
  `gained ${st.live.find((p) => p.token === a).score - beforeA} on a $${val} clue vs ${opp}`);

// targeting alerts the target
const [x, y] = ring();
by(x).s.emit('set-target', { target: y });
await wait(200);
check('the target is told they are in the sights', by(y).targetedBy === by(x).view.you.name,
  by(y).targetedBy || 'no alert');
check('the room can see the aim', st.live.find((p) => p.token === x).target === y);
check('the target knows it too', (by(y).view.you.targetedBy || []).length === 1);

// bounty from the queue
const queued = ps.find((p) => p.view && p.view.you.state === 'queued');
const r = await new Promise((res) => queued.s.emit('place-bounty',
  { target: ring()[0], amount: 600 }, res));
check('a queued player places a bounty', r.ok === true, `${r.amount}, ${r.remaining} left`);
await wait(150);
check('the console shows the bounty board', (st.bounties || []).length === 1,
  (st.bounties || []).map((b) => `${b.amount} on ${b.target}`).join());
check('over the cap is refused', !!(await new Promise((res) =>
  queued.s.emit('place-bounty', { target: ring()[0], amount: 9000 }, res))).error);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
