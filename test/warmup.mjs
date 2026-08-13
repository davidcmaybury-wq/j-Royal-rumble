// Warm-up presses are practice. They must not reach the live record.
//
// A player eliminated at clue 9 who kept buzzing for the remaining 75 finished
// a real match credited with 159 attempts against a real 1, and 43% of every
// buzz recorded that night was warm-up. Every attempt count and win rate in the
// standings was wrong.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 999, delay: 0, recordMatch: true } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C', 'D']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(300);

// Use an eliminated player rather than a queued one: standings only carry
// people who have been in the ring, and an eliminated player who keeps buzzing
// is the case that actually caused the trouble.
const inRing = st.live.map((p) => p.token);
const bench = ps.find((p) => p.token === inRing[0]);
const player = ps.find((p) => p.token === inRing[1]);
check('two players are in the ring', !!bench && !!player);

const playClue = async (buzzers) => {
  const open = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(70);
  host.emit('activate');
  await wait(80);
  for (const [p, ms] of buzzers) p.s.emit('buzz', { ms, status: 'good' });
  await wait(140);
  const first = (st.race.buzzes || [])[0];
  host.emit('resolve', { winnerToken: first ? first.token : null });
  await wait(120);
};

// Drain the first player out of the ring.
{
  const g = st.live.find((p) => p.token === bench.token);
  host.emit('adjust-score', { token: bench.token, delta: -(g.score + 100) });
  await wait(200);
  await playClue([[player, 400]]);
  check('the first player is out', !st.live.some((p) => p.token === bench.token),
    st.live.map((p) => p.name).join(', '));
}

// Now they press every clue from the bench, always faster than the ring.
for (let i = 0; i < 8; i++) await playClue([[bench, 5], [player, 400]]);

const b = st.live.concat(st.queue || [], st.out || []).find((p) => p.token === bench.token)
  || (st.queue || []).find((p) => p.token === bench.token);
host.emit('end-match');
await wait(400);

const sb = st.standings.find((p) => p.token === bench.token);
const sp = st.standings.find((p) => p.token === player.token);
check('the bench player made no live attempts', sb.att === 0, `${sb.att}`);
check('but their practice is counted separately', sb.warmAtt === 8, `${sb.warmAtt} warm-up`);
check('the player in the ring has their real attempts', sp.att === 9, `${sp.att}`);

// The bench buzzed at 5ms every time; the ring player at 400ms.
check('the fastest buzz of the match is a real one',
  st.fastest && st.fastest.ms >= 400, `${st.fastest?.ms}ms by ${st.fastest?.name}`);
check('and it is not the bench player', st.fastest?.name !== bench.name, st.fastest?.name);
check('best time ignores practice', sb.best === null || sb.best >= 400,
  `bench best ${sb.best}`);

const rec = await (await fetch(`${U}/api/match/${m.gameId}/record?key=${encodeURIComponent(m.hostKey)}`)).json();
const warm = rec.clues.flatMap((c) => c.buzzes).filter((x) => x.spectator);
check('the log still records the practice presses', warm.length === 8, `${warm.length}`);
check('flagged so they can be told apart', warm.every((x) => x.spectator === true));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
