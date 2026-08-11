// Each queued player must see their own entry, not the match's next entry.
// The sixth draw was watching a two-clue timer that belonged to the fourth.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const IV = 5;
const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: IV, delay: 0 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, view: null };
  s.on('state', (v) => { p.view = v; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(400);

const queued = ps.filter((p) => p.view && p.view.you.state === 'queued')
  .sort((a, b) => a.view.you.queuePlace - b.view.you.queuePlace);
check('four players are waiting', queued.length === 4, `${queued.length}`);

const counts = queued.map((p) => p.view.you.cluesToEntry);
check('they do not all see the same number', new Set(counts).size === counts.length,
  counts.join(', '));
check('the countdowns rise down the queue',
  counts.every((v, i) => i === 0 || v > counts[i - 1]), counts.join(' < '));
check('each is one interval further than the last',
  counts.every((v, i) => i === 0 || v - counts[i - 1] === IV),
  `steps of ${counts.map((v, i) => i ? v - counts[i-1] : v).slice(1).join(', ')} against an interval of ${IV}`);
check('the first in the queue matches the match-wide next entry',
  counts[0] === st.cluesUntilNextEntry,
  `${counts[0]} against ${st.cluesUntilNextEntry}`);
check('queue places are numbered from one',
  queued.map((p) => p.view.you.queuePlace).join() === '1,2,3,4');

// Play a clue and check the numbers all step down together.
const before = queued.map((p) => p.view.you.cluesToEntry);
const open = [];
st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
await wait(120);
host.emit('resolve', { winnerToken: null });
await wait(300);
const after = queued.map((p) => p.view.you.cluesToEntry);
check('every countdown ticks down as clues are played',
  after.every((v, i) => v === before[i] - 1),
  `${before.join(',')} -> ${after.join(',')}`);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
