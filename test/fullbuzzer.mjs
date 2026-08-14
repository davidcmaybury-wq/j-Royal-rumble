// Full buzzer mode: the board alongside the buzzer, for a player who is not
// looking at a shared screen.
//
// The thing that matters is that it cannot leak an answer. It reuses the same
// watchView() the public screen gets — built field-by-field with no answer in
// it — rather than assembling a second payload from the host view, which is how
// an answer would eventually get through.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((r) => s.once(e, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 999, delay: 0 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let hs = null;
host.on('state', (s) => { hs = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { hs = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, mine: null, board: null };
  s.on('state', (v) => { p.mine = v; });
  s.on('watch-state', (v) => { p.board = v; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; p.mine = x.state; r(); }));
  ps.push(p);
}
await wait(250);
host.emit('start-match');
await wait(400);

const me = ps[0];
check('a player gets no board until they ask', me.board === null);

const r = await new Promise((x) => me.s.emit('want-board', { on: true }, x));
check('asking for it works', r.ok === true && r.on === true, JSON.stringify(r));
await wait(250);
check('and the board arrives', !!me.board && Array.isArray(me.board.board),
  me.board ? `${me.board.board.length} categories` : 'nothing');

// Put a clue up so there is an answer to leak.
const open = [];
hs.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });

await wait(350);

const answer = hs.clue?.answer;
check('the host has an answer to leak', typeof answer === 'string' && answer.length > 0,
  answer ? `"${answer.slice(0, 24)}"` : 'none');

check('the board payload has no answer field', me.board.clue && !('answer' in me.board.clue),
  Object.keys(me.board.clue || {}).join(', '));

// A blanket substring search over the payload is the strongest check, but it
// fires on coincidence: an answer like "margarita" can legitimately appear in a
// category title. Restrict it to answers distinctive enough that a match means
// something, and say where it turned up so a real leak is diagnosable.
if (String(answer).length >= 10) {
  const blob = JSON.stringify(me.board).toLowerCase();
  const needle = String(answer).toLowerCase();
  const where = Object.entries(me.board)
    .filter(([, v]) => JSON.stringify(v).toLowerCase().includes(needle))
    .map(([k]) => k);
  check('nor anywhere else in the payload', !blob.includes(needle),
    where.length ? `found under: ${where.join(', ')}` : 'searched the whole payload');
} else {
  console.log(`  --   answer "${answer}" is too short to search for safely`);
}

// The player's own buzzer view must be untouched by all this.
check('their own view still knows who they are',
  me.mine.you && me.mine.you.name === 'A', me.mine.you?.name);
check('and is not the board payload', !('board' in me.mine) || me.mine.you !== undefined);

// Somebody who did not ask gets nothing.
check('a player who did not ask still has no board', ps[1].board === null);

const off = await new Promise((x) => me.s.emit('want-board', { on: false }, x));
check('and it can be turned off', off.ok === true && off.on === false);
const had = JSON.stringify(me.board);
host.emit('resolve', { winnerToken: null });
await wait(400);
check('after which no more board updates arrive', JSON.stringify(me.board) === had);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
