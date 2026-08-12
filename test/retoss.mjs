// A missed clue must go back out as a *fresh* race.
//
// The first implementation kept the original buzz queue and promoted the
// next-fastest, so pressing "wrong" put somebody on the clock instantly and no
// second race ever happened. Players who hadn't buzzed the first time never got
// the chance the rules promise them.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 0 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null; let retossed = 0;
host.on('state', (s) => { st = s; });
host.on('retoss', () => { retossed++; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, arms: 0 };
  s.on('activate-buzzers', () => { p.arms++; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(300);
const inRing = new Set(st.live.map((p) => p.token));
const players = ps.filter((p) => inRing.has(p.token));
check('three players are in the ring', players.length === 3, `${players.length}`);

const open = [];
st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
await wait(120);
host.emit('activate');
await wait(150);

// Two of the three buzz. The third stays out of it.
players[0].s.emit('buzz', { ms: 300, status: 'good' });
players[1].s.emit('buzz', { ms: 600, status: 'good' });
await wait(300);
check('two are in the race', st.race.buzzes.length === 2,
  st.race.buzzes.map((b) => b.name).join(', '));
const armsBefore = players.map((p) => p.arms);

// The leader is wrong.
host.emit('mark-wrong', { token: st.race.buzzes[0].token });
await wait(300);

check('the clue stays up', !!st.clue);
check('the queue is cleared rather than promoted', st.race.buzzes.length === 0,
  st.race.buzzes.map((b) => b.name).join(', ') || 'empty');
check('nobody is put on the clock automatically', !st.race.buzzes[0]);
check('the buzzers are open again', st.race.open === true);
check('everyone is re-armed', players.every((p, i) => p.arms === armsBefore[i] + 1),
  players.map((p) => p.arms).join(','));
check('the host is told it went back out', retossed === 1, `${retossed}`);
check('and the console can show how many times', st.retoss === 1, `${st.retoss}`);
check('the wrong player is locked out', st.race.lockedOut.length === 1);

// The player who never buzzed can now win it.
players[2].s.emit('buzz', { ms: 400, status: 'good' });
await wait(250);
check('a player who sat out the first race can take it',
  st.race.buzzes.length === 1 && st.race.buzzes[0].token === players[2].token,
  st.race.buzzes.map((b) => b.name).join(', '));

// The one who buzzed second, but was never wrong, can race again too.
players[1].s.emit('buzz', { ms: 900, status: 'good' });
await wait(250);
check('so can the one who lost the first race', st.race.buzzes.length === 2,
  st.race.buzzes.map((b) => b.name).join(', '));

// The locked-out player cannot.
players[0].s.emit('buzz', { ms: 100, status: 'good' });
await wait(250);
check('but the locked-out player cannot',
  !st.race.buzzes.some((b) => b.token === players[0].token),
  st.race.buzzes.map((b) => b.name).join(', '));

// Resolving still charges the miss.
const before = st.live.find((p) => p.token === players[0].token).score;
host.emit('resolve', { winnerToken: st.race.buzzes[0].token });
await wait(300);
const after = st.live.find((p) => p.token === players[0].token).score;
check('the wrong answer still costs them', after < before, `${before} -> ${after}`);
check('and the counter resets for the next clue', (st.retoss || 0) === 0);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
