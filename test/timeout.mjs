// The five lights are a promise: when they go out, the clue is over.
//
// There was no timeout at all — a clue nobody wanted stayed open until the host
// noticed. And because a re-toss reopens the race, the lights could run twice
// for what looked like one clue, which read as a glitch.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const mk = async (settings) => {
  const m = await (await fetch(`${U}/api/match`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { entryInterval: 999, delay: 0,
      lecternSeconds: 1, ...settings } }) })).json();
  const host = io(U, { transports: ['websocket'] });
  await once(host, 'connect');
  const o = { m, host, st: null, timedOut: 0 };
  host.on('state', (s) => { o.st = s; });
  host.on('race-timeout', () => { o.timedOut++; });
  await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { o.st = x.state; r(); }));
  o.ps = [];
  for (const n of ['A', 'B', 'C']) {
    const s = io(U, { transports: ['websocket'] });
    await once(s, 'connect');
    const p = { s };
    await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
    o.ps.push(p);
  }
  await wait(200);
  host.emit('start-match');
  await wait(300);
  return o;
};
const pick = (o) => {
  const open = [];
  o.st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  o.host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
};

// --- nobody buzzes ---
{
  const o = await mk({});
  pick(o); await wait(120);
  o.host.emit('activate'); await wait(200);
  check('the race opens', o.st.race.open === true);
  await wait(1800);
  check('and closes itself when the lights run out', o.st.race.open === false);
  check('the host is told', o.timedOut === 1, `${o.timedOut}`);
  check('the clue is still up for the host to call', !!o.st.clue);
  check('nothing has been scored yet',
    o.st.live.every((p) => p.score === 3000), o.st.live.map((p) => p.score).join());
  o.host.emit('resolve', { winnerToken: null });
  await wait(200);
  check('and X still resolves it as a stumper', !o.st.clue);
  o.host.close(); o.ps.forEach((p) => p.s.close());
}

// --- somebody buzzes: no timeout ---
{
  const o = await mk({});
  pick(o); await wait(120);
  o.host.emit('activate'); await wait(120);
  o.ps[0].s.emit('buzz', { ms: 300, status: 'good' });
  await wait(1900);
  check('a race with somebody on the clock is not timed out',
    o.timedOut === 0 && o.st.race.buzzes.length === 1);
  o.host.close(); o.ps.forEach((p) => p.s.close());
}

// --- the re-toss gets its own clock ---
{
  const o = await mk({});
  pick(o); await wait(120);
  o.host.emit('activate'); await wait(120);
  o.ps[0].s.emit('buzz', { ms: 300, status: 'good' });
  await wait(200);
  o.host.emit('mark-wrong', { token: o.st.race.buzzes[0].token });
  await wait(200);
  check('the re-toss reopens the race', o.st.race.open === true);
  await wait(1800);
  check('and it times out too', o.st.race.open === false && o.timedOut === 1,
    `${o.timedOut} timeouts`);
  o.host.close(); o.ps.forEach((p) => p.s.close());
}

// --- it can be turned off ---
{
  const o = await mk({ autoStumper: false });
  pick(o); await wait(120);
  o.host.emit('activate'); await wait(2200);
  check('with autoStumper off the buzzers stay open',
    o.st.race.open === true && o.timedOut === 0);
  o.host.close(); o.ps.forEach((p) => p.s.close());
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
