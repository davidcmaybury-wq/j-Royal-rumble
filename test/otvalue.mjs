// During overtime, every surface must show what a clue is worth now.
// The board cells applied the multiplier; the clue itself did not, so the watch
// screen announced "$400" on a clue actually worth $1,600.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 999, delay: 0, overtimeEvery: 2,
    startScore: 9000, ceiling: 40000, ceilingDecayPerClue: 0 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let hs = null;
host.on('state', (s) => { hs = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { hs = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, seen: null };
  s.on('clue-shown', (c) => { p.seen = c; });
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

const playOne = async () => {
  const open = [];
  hs.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(140);
  const row = open[0][1];
  host.emit('resolve', { winnerToken: hs.live[0].token });
  await wait(160);
  return row;
};

// Stall until the stakes have doubled at least once.
for (let i = 0; i < 8 && (hs.overtime?.multiplier ?? 1) < 2; i++) await playOne();
const mult = hs.overtime?.multiplier ?? 1;
check('overtime is running', mult >= 2, `x${mult}`);

const open = [];
hs.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
const [slot, row] = open[0];
host.emit('pick-clue', { slot, row });
await wait(250);

const face = [100, 200, 300, 400, 500][row - 1];
const want = face * mult;
check('the host sees the raised value', hs.clue.value === want,
  `$${hs.clue.value}, face $${face} at x${mult}`);
check('the watch screen sees the raised value', ws.clue.value === want,
  `$${ws.clue.value} against $${want}`);
check('the players see the raised value', ps.every((p) => !p.seen || p.seen.value === want),
  ps.map((p) => '$' + (p.seen?.value ?? '-')).join(', '));
check('and it matches the board cell it came from',
  ws.board[slot].clues.find((c) => c.row === row).value === want);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); watch.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
