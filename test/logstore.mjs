// Match logs must survive the host walking away.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const before = await (await fetch(`${U}/api/logs`)).json();
check('the server says where logs go', !!before.dir, before.dir);
check('and whether they survive a deploy', typeof before.durable === 'boolean',
  before.note);


// A match with recording never switched on: it should still be recorded.
const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 0 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));
const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(300);
check('a match is recorded without anyone asking', st.recording === true);

for (let i = 0; i < 4; i++) {
  const open = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(70);
  host.emit('activate');
  await wait(70);
  ps[0].s.emit('buzz', { ms: 300, status: 'good' });
  await wait(100);
  host.emit('resolve', { winnerToken: st.race.buzzes[0]?.token ?? null });
  await wait(120);
}
host.emit('end-match');
await wait(600);

const after = await (await fetch(`${U}/api/logs`)).json();
check('the log is written when the match ends', after.saved > before.saved,
  `${before.saved} -> ${after.saved}`);
const mine = after.matches.find((x) => x.file.includes(m.gameId));
check('and it is listed with a useful summary', !!mine,
  mine ? `${mine.clues} clues, ${mine.players} players, winner ${mine.winner}` : 'not listed');

const body = await (await fetch(`${U}/api/logs/${mine.file}`)).json();
check('it downloads whole', Array.isArray(body.clues) && body.clues.length === 4,
  `${(body.clues || []).length} clues`);
check('with the buzz detail intact', body.clues.some((c) => c.buzzes.length));
check('and says when it was saved', !!body.savedAt);

// Path traversal must not work.
const bad = await fetch(`${U}/api/logs/${encodeURIComponent('../package.json')}`);
check('a log name cannot climb out of the directory', bad.status === 404,
  `HTTP ${bad.status}`);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
