// Stables over the wire: founding, joining, betraying, and the guards.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((r) => s.once(e, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 999, delay: 0, stables: true } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let hs = null;
host.on('state', (x) => { hs = x; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { hs = x.state; r(); }));

const ps = [];
for (const n of ['Ann', 'Ben', 'Cal']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, view: null };
  s.on('state', (v) => { p.view = v; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; p.view = x.state; r(); }));
  ps.push(p);
}
await wait(300);
await new Promise((r) => host.emit('start-match', {}, r));
await wait(500);

const made = await new Promise((r) => ps[0].s.emit('make-stable', { name: 'The Firm' }, r));
check('a player can found a stable', made.ok === true, made.name);
const joined = await new Promise((r) => ps[1].s.emit('join-stable', { id: made.id }, r));
check('another can join it', joined.ok === true, joined.name);
await wait(300);
check('everybody can see the stable and who is in it',
  (ps[2].view.stables || []).some((s2) => s2.members.length === 2),
  JSON.stringify(ps[2].view.stables));
check('and a player knows their own', ps[1].view.you.stable === made.id);

// The clue exchange.
const before = ps.map((p) => p.view.you.score);
const open = [];
hs.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
await wait(90);
host.emit('resolve', { winnerToken: ps[0].token });
await wait(500);
check('a teammate pays nothing', ps[1].view.you.score === before[1],
  `${before[1]} -> ${ps[1].view.you.score}`);
check('the outsider pays', ps[2].view.you.score < before[2],
  `${before[2]} -> ${ps[2].view.you.score}`);

// Betrayal.
const stack = ps[0].view.you.score;
const benBefore = ps[1].view.you.score;
const bet = await new Promise((r) => ps[0].s.emit('betray', {}, r));
check('betrayal works', bet.ok === true, JSON.stringify({ stack: bet.stack, each: bet.each }));
await wait(400);
check('the traitor is at zero', ps[0].view.you.score === 0, String(ps[0].view.you.score));
check('and the abandoned teammate has the stack',
  ps[1].view.you.score === benBefore + stack, `${benBefore} -> ${ps[1].view.you.score}`);

// Guards.
host.emit('pick-clue', { slot: open[1][0], row: open[1][1] });
await wait(200);
const mid = await new Promise((r) => ps[2].s.emit('join-stable', { id: made.id }, r));
check('you cannot switch sides while a clue is up', !!mid.error, mid.error);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
