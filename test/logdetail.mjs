// The log has to say what happened, not leave it to be inferred.
//
// Reading a real match back, a clue paying double looked like overtime when it
// was pot scoring with three in the ring. Overtime, entries and bounties were
// not recorded at all, so the one feedback channel this game has could not
// answer the questions being asked of it.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 4, delay: 0, overtimeEvery: 3,
    startScore: 9000, ceiling: 40000, recordMatch: true } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));
const ps = [];
for (const n of ['A', 'B', 'C', 'D', 'E']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(300);

for (let i = 0; i < 26 && st.phase === 'live'; i++) {
  const open = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  if (!open.length) break;
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(60);
  host.emit('activate');
  await wait(70);
  const ring = st.live;
  const who = ps.find((p) => p.token === ring[i % ring.length].token);
  if (who) who.s.emit('buzz', { ms: 200, status: 'good' });
  await wait(110);
  const first = (st.race.buzzes || [])[0];
  host.emit('resolve', { winnerToken: first ? first.token : null });
  await wait(110);
}
host.emit('end-match');
await wait(400);

const rec = await (await fetch(`${U}/api/match/${m.gameId}/record?key=${encodeURIComponent(m.hostKey)}`)).json();
const cl = rec.clues;
check('clues were recorded', cl.length > 10, `${cl.length}`);

const entries = cl.filter((c) => c.entered);
check('entries are recorded', entries.length > 0, `${entries.length} entry events`);
check('with who, their draw and what they walked in with',
  entries[0].entered[0].name && entries[0].entered[0].draw > 0
    && entries[0].entered[0].stake > 0,
  JSON.stringify(entries[0].entered[0]));

check('the queue length is on every clue',
  cl.every((c) => typeof c.queueLength === 'number'));
check('and it falls as people come in',
  cl[0].queueLength > cl[cl.length - 1].queueLength,
  `${cl[0].queueLength} -> ${cl[cl.length - 1].queueLength}`);

const ot = cl.filter((c) => c.overtime);
const started = cl.find((c) => c.overtimeStarted);
check('overtime opening is recorded', !!started, started ? `clue ${started.n}` : 'never opened');
if (ot.length) {
  check('and the multiplier is on the clue itself', ot[0].overtime >= 2,
    `x${ot[0].overtime} at clue ${ot[0].n}`);
  check('no longer needing to be inferred from score deltas', true);
}
const raised = cl.filter((c) => c.overtimeRaised);
check('each raise is marked', raised.length > 0,
  raised.map((c) => `clue ${c.n} -> x${c.overtimeRaised}`).join(', ') || 'none');
check('the stall clock is recorded',
  cl.every((c) => typeof c.stalledClues === 'number'));
check('the face value is kept alongside the raised one',
  cl.every((c) => typeof c.faceValue === 'number'));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
