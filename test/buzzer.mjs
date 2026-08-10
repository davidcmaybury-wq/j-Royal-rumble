// Focuses on buzz arbitration: early presses, lockouts, ordering, duplicates.
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
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const name of ['Early', 'Fast', 'Slow']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, token: null };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(150);
host.emit('start-match');
await wait(250);

const [early, fast, slow] = ps;
host.emit('pick-clue', { slot: 0, row: 1 });
await wait(120);

// --- the whole point: an early press must not enter the race -----------
early.s.emit('early-buzz');
await wait(120);
check('an early press does not enter the race',
  !(st.race && st.race.buzzes || []).length, `${(st.race?.buzzes || []).length} buzzes`);

host.emit('activate');
await wait(150);
fast.s.emit('buzz', { ms: 480, status: 'good' });
slow.s.emit('buzz', { ms: 950, status: 'good' });
await wait(150);
check('legitimate buzzes rank normally', st.race.buzzes.length === 2);
check('the fastest legitimate buzz is on the clock',
  st.race.buzzes[0].token === fast.token, `${st.race.buzzes[0].name} at ${st.race.buzzes[0].ms}`);
check('the early presser is not in the race',
  !st.race.buzzes.some((b) => b.token === early.token));

// --- a client that mislabels an early press as a buzz is ignored -------
early.s.emit('buzz', { ms: 0, status: 'early' });
await wait(120);
check('a zero-time buzz is refused', !st.race.buzzes.some((b) => b.token === early.token),
  `${st.race.buzzes.length} in the race`);
early.s.emit('buzz', { ms: 0, status: 'good' });
await wait(120);
check('a zero-time buzz is refused even when labelled good',
  !st.race.buzzes.some((b) => b.token === early.token));

// --- the early presser can still win once they buzz properly ----------
early.s.emit('buzz', { ms: 300, status: 'good' });
await wait(150);
check('after the penalty they can buzz and take the lead',
  st.race.buzzes[0].token === early.token, `${st.race.buzzes[0].ms} ms`);

// --- one buzz each -----------------------------------------------------
const before = st.race.buzzes.length;
fast.s.emit('buzz', { ms: 100, status: 'good' });
await wait(120);
check('a second buzz from the same player is ignored', st.race.buzzes.length === before);

// --- early presses land in the stats ------------------------------------
host.emit('resolve', { winnerToken: early.token });
await wait(200);
host.emit('end-match');
await wait(250);
const row = (st.standings || []).find((p) => p.token === early.token);
check('the early press is counted in that player\u2019s stats', row && row.early === 1,
  row ? `early ${row.early}, attempts ${row.att}` : 'no row');
check('the early press is not counted as an attempt', row && row.att === 1, row ? `att ${row.att}` : '');
check('best time excludes the early press', row && row.best === 300, row ? `best ${row.best}` : '');

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
