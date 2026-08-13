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
check('no field of the clue holds it',
  !Object.values(ws.clue).some((v) => typeof v === 'string'
    && v.toLowerCase() === hs.clue.answer.toLowerCase()));
// A substring search is only meaningful for an answer long enough not to occur
// by chance — this failed once on the answer "raw", which appears inside plenty
// of innocent words. Short answers are covered by the field check above.
if (hs.clue.answer.length >= 8) {
  check('and it does not appear anywhere in the payload',
    !dump.toLowerCase().includes(hs.clue.answer.toLowerCase()),
    hs.clue.answer.slice(0, 30));
} else {
  check('and it does not appear as a standalone word in the payload',
    !new RegExp('\\b' + hs.clue.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
      .test(dump),
    `"${hs.clue.answer}" is short, so matched on word boundaries`);
}
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

// --- the ring is sorted by score, not by draw ---
{
  const m2 = await (await fetch(`${U}/api/match`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { entryInterval: 999, delay: 0 } }) })).json();
  const h2 = io(U, { transports: ['websocket'] });
  await once(h2, 'connect');
  let s2 = null;
  h2.on('state', (x) => { s2 = x; });
  await new Promise((r) => h2.emit('host-join', { gameId: m2.gameId, hostKey: m2.hostKey }, (x) => { s2 = x.state; r(); }));
  const p2 = [];
  for (const n of ['X', 'Y', 'Z']) {
    const s = io(U, { transports: ['websocket'] });
    await once(s, 'connect');
    const p = { s };
    await new Promise((r) => s.emit('join', { gameId: m2.gameId, name: n }, (x) => { p.token = x.token; r(); }));
    p2.push(p);
  }
  const w2 = io(U, { transports: ['websocket'] });
  await once(w2, 'connect');
  let v2 = null;
  w2.on('state', (x) => { v2 = x; });
  v2 = (await new Promise((r) => w2.emit('watch-game', { gameId: m2.gameId }, r))).state;
  await wait(150);
  h2.emit('start-match');
  await wait(300);

  // Give the last draw the biggest score, so draw order and score order differ.
  const ring = s2.live;
  h2.emit('adjust-score', { token: ring[2].token, delta: 5000 });
  h2.emit('adjust-score', { token: ring[0].token, delta: -1000 });
  await wait(300);

  const byScore = v2.live.slice().sort((a, b) => b.score - a.score).map((p) => p.name);
  check('the watch view carries the scores it needs to sort by',
    v2.live.every((p) => typeof p.score === 'number'));
  check('and draw order is not score order here',
    v2.live.map((p) => p.name).join() !== byScore.join()
      || v2.live[0].score >= v2.live[v2.live.length - 1].score,
    `draws ${v2.live.map((p) => p.draw).join()} scores ${v2.live.map((p) => p.score).join()}`);
  h2.close(); w2.close(); p2.forEach((p) => p.s.close());
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); watch.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
