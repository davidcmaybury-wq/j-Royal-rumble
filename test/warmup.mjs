// comeback:false throughout — these are about elimination, and the
// standard comeback keeps anybody under its gate in the ring.
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
  body: JSON.stringify({ settings: { comeback: false,  entryInterval: 999, delay: 0, recordMatch: true } }) })).json();
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

// --- a warm-up buzz that lands first --------------------------------------
//
// The placing used to be worked out once, at the moment the buzz arrived.
// Somebody warming up is usually early, so the live field was still empty and
// every practice press came back "1st of 1" no matter how slow it was.
{
  const m2 = await (await fetch(`${U}/api/match`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { comeback: false,  entryInterval: 999, delay: 0 } }) })).json();
  const h2 = io(U, { transports: ['websocket'] });
  await once(h2, 'connect');
  let s2 = null;
  h2.on('state', (x) => { s2 = x; });
  await new Promise((r) => h2.emit('host-join', { gameId: m2.gameId, hostKey: m2.hostKey },
    (x) => { s2 = x.state; r(); }));

  const people = [];
  for (const n of ['R1', 'R2', 'R3', 'Watcher']) {
    const c = io(U, { transports: ['websocket'] });
    await once(c, 'connect');
    const p = { c, name: n };
    await new Promise((r) => c.emit('join', { gameId: m2.gameId, name: n }, (x) => { p.token = x.token; r(); }));
    people.push(p);
  }
  await wait(300);
  h2.emit('start-match', {}, () => {});
  await wait(400);
  const open2 = [];
  s2.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open2.push([si, x.row]); }));
  h2.emit('pick-clue', { slot: open2[0][0], row: open2[0][1] });
  await wait(90);
  h2.emit('activate');
  await wait(60);

  // The person in the queue presses first, and slowly.
  const spec = people[3];
  let specView = null;
  spec.c.on('state', (v) => { specView = v; });
  spec.c.emit('buzz', { ms: 900, status: 'good' });
  await wait(200);
  // Then the ring buzzes, all faster.
  for (const [i, p] of people.slice(0, 3).entries()) {
    p.c.emit('buzz', { ms: 200 + i * 40, status: 'good' });
    await wait(60);
  }
  await wait(500);

  // The host view hides warm-up buzzes on purpose, so the placing has to be
  // read where the player actually sees it: their own myBuzz.
  const mine = specView && specView.myBuzz;
  check('a warm-up buzz comes back ranked', !!mine && mine.outOf != null,
    mine ? JSON.stringify(mine) : 'nothing');
  check('and is not stuck at 1st of 1', mine && mine.outOf > 1,
    mine ? `${mine.place} of ${mine.outOf}` : '-');
  check('a slow practice press places last', mine && mine.place === mine.outOf,
    mine ? `${mine.place} of ${mine.outOf}` : '-');
  h2.close(); people.forEach((p) => p.c.close());
}

// --- jumping the lights while warming up ----------------------------------
//
// The early-buzz path counted an attempt without checking whether the player
// was in the ring, so practice presses landed in the live record: a real match
// finished with somebody credited with 28 attempts across a tenure of one clue.
{
  const m3 = await (await fetch(`${U}/api/match`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    // A short interval so the warmer-up actually enters: somebody who never
    // reaches the ring is left out of the standings altogether, so there would
    // be no row to inspect.
    body: JSON.stringify({ settings: { comeback: false,  entryInterval: 1, delay: 0 } }) })).json();
  const h3 = io(U, { transports: ['websocket'] });
  await once(h3, 'connect');
  let v3 = null;
  h3.on('state', (x) => { v3 = x; });
  await new Promise((r) => h3.emit('host-join', { gameId: m3.gameId, hostKey: m3.hostKey },
    (x) => { v3 = x.state; r(); }));

  const crowd = [];
  for (const n of ['A1', 'B1', 'C1', 'D1']) {
    const c = io(U, { transports: ['websocket'] });
    await once(c, 'connect');
    const p = { c, name: n, view: null };
    c.on('state', (v) => { p.view = v; });
    await new Promise((r) => c.emit('join', { gameId: m3.gameId, name: n },
      (x) => { p.token = x.token; p.view = x.state; r(); }));
    crowd.push(p);
  }
  await wait(300);
  h3.emit('start-match', {}, () => {});
  await wait(500);

  // Whoever the draw left in the queue, not whoever I named last: three of the
  // four start and which one sits out is shuffled.
  const bench = crowd.find((p) => p.view?.you?.state === 'queued');
  check('somebody is in the queue to warm up', !!bench,
    crowd.map((p) => `${p.name}:${p.view?.you?.state}`).join(' '));

  if (bench) {
    for (let i = 0; i < 6; i++) { bench.c.emit('early-buzz'); await wait(40); }
    await wait(400);

    // Play a couple of clues so they come in off the queue, then end it.
    for (let k = 0; k < 2; k++) {
      const o3 = [];
      v3.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o3.push([si, x.row]); }));
      h3.emit('pick-clue', { slot: o3[0][0], row: o3[0][1] });
      await wait(120);
      h3.emit('resolve', { winnerToken: null });
      await wait(250);
    }
    h3.emit('end-match');

    let row = null;
    for (let i = 0; i < 60 && !row; i++) {
      await wait(200);
      try {
        const list = await (await fetch(`${U}/api/logs`)).json();
        const mine = (list.matches || []).find((x) => (x.file || '').includes(m3.gameId));
        if (!mine) continue;
        const log = await (await fetch(`${U}/api/logs/${encodeURIComponent(mine.file)}`)).json();
        row = (log.standings || []).find((p) => p.name === bench.name) || null;
      } catch { /* not written yet */ }
    }
    check('the queued player is in the saved record', !!row, row ? 'found' : 'never appeared');
    if (row) {
      check('jumping the lights in the queue is not a live attempt',
        row.att === 0, `att ${row.att}`);
      check('nor an early buzz against their record',
        (row.early || 0) === 0, `early ${row.early}`);
      check('but it is still kept as practice',
        (row.warmAtt || 0) >= 6, `warmAtt ${row.warmAtt}`);
    }
  }
  h3.close(); crowd.forEach((p) => p.c.close());
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
