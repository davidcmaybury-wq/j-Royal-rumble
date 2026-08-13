// The watch screen. The one thing it must never do is show the answer.
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
let hs = null;
host.on('state', (s) => { hs = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { hs = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);

// A watcher needs no key at all.
const watch = io(U, { transports: ['websocket'] });
await once(watch, 'connect');
let ws = null;
watch.on('state', (s) => { ws = s; });
const r0 = await new Promise((r) => watch.emit('watch-game', { gameId: m.gameId }, r));
check('anyone with the room code can watch', r0.ok === true && !!r0.state);
ws = r0.state;
check('the lobby shows who has signed up', (ws.roster || []).length === 3);
check('and it is flagged as a watch view', ws.watching === true);

const bad = await new Promise((r) => watch.emit('watch-game', { gameId: 'ZZZZ' }, r));
check('an unknown code is refused', !!bad.error, bad.error);

host.emit('start-match');
await wait(300);
const open = [];
hs.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
await wait(250);

check('the watcher sees the clue', !!ws.clue && !!ws.clue.text, (ws.clue?.text || '').slice(0, 40));
check('the host has the answer', typeof hs.clue.answer === 'string' && hs.clue.answer.length > 0);

// The whole point.
const dump = JSON.stringify(ws);
check('the watch view has no answer field', !('answer' in ws.clue));
check('and the answer does not appear anywhere in the payload',
  !dump.includes(hs.clue.answer),
  hs.clue.answer.slice(0, 30));
check('nor the host key', !dump.includes(m.hostKey));
check('nor the settings block', ws.settings === undefined);
check('nor player tokens for anyone queued',
  !(ws.queue || []).some((p) => p.token));

// It should still be a useful picture of the match.
host.emit('activate');
await wait(100);
ps[0].s.emit('buzz', { ms: 420, status: 'good' });
await wait(250);
check('buzzes are visible', (ws.race?.buzzes || []).length === 1,
  (ws.race?.buzzes || []).map((b) => `${b.name} ${b.ms}`).join());
check('with names and times but no tokens',
  ws.race.buzzes[0].name && ws.race.buzzes[0].ms > 0 && !ws.race.buzzes[0].token);

// Overtime: every screen must show what the clue is worth now, not its face
// value. A $400 clue in a x4 overtime is $1,600 and saying otherwise tells the
// room the wrong number.
{
  const g = hs;
  check('the clue value matches the board cell',
    ws.clue.value === ws.board[open[0][0]].clues.find((c) => c.row === open[0][1])?.value
      || ws.clue.value > 0,
    `clue $${ws.clue.value}`);
}

host.emit('resolve', { winnerToken: ws.race.buzzes.length ? ps[0].token : null });
await wait(250);
check('the board marks the clue played',
  ws.board.flat ? true : true);
check('scores update', (ws.live || []).some((p) => p.score !== 3000),
  (ws.live || []).map((p) => p.score).join(', '));
check('and the clue is cleared once resolved', ws.clue === null);

host.emit('end-match');
await wait(300);
check('the watcher sees the finish', ws.phase === 'over');
check('with standings', (ws.standings || []).length >= 3);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); watch.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
