// The delay has to be changeable while people are playing, and the board has
// to tell the truth about what a clue is worth once overtime starts.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 200, overtimeEvery: 3 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, armAt: null, view: null };
  s.on('activate-buzzers', (d) => { p.armAt = d.at; });
  s.on('state', (v) => { p.view = v; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(150);
host.emit('start-match');
await wait(250);
check('the delay is reported to the console', st.delay === 200, String(st.delay));

const openClue = () => {
  const o = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row, x.value]); }));
  return o;
};
check('the board reports a clue value', openClue()[0][2] > 0, `$${openClue()[0][2]}`);

// change it mid-match and confirm it takes effect on the next arming
host.emit('set-delay', { delay: 450 });
await wait(200);
check('the delay changes mid-match', st.delay === 450, String(st.delay));
check('players are told about it', ps[0].view.you !== undefined);

let [slot, row] = openClue()[0];
host.emit('pick-clue', { slot, row });
await wait(120);
const t0 = Date.now();
host.emit('activate');
await wait(250);
const lead = ps[0].armAt - t0;
check('the new delay is actually used when arming', lead > 380 && lead < 520,
  `buzzers set to arm ${Math.round(lead)} ms out`);
host.emit('resolve', { winnerToken: null });
await wait(200);

check('it is out of bounds proof', (() => { host.emit('set-delay', { delay: -900 }); return true; })());
await wait(200);
check('a negative delay is clamped to zero', st.delay === 0, String(st.delay));
host.emit('set-delay', { delay: 99999 });
await wait(200);
check('an absurd delay is clamped', st.delay === 2000, String(st.delay));
host.emit('set-delay', { delay: 200 });
await wait(150);

// drive it to overtime and check the board values climb
while (st.live.length > 2 && st.clues < 40) {
  const [s2, r2] = openClue()[0];
  host.emit('pick-clue', { slot: s2, row: r2 });
  await wait(80);
  const weakest = st.live.slice().sort((a, b) => a.score - b.score)[0];
  host.emit('adjust-score', { token: weakest.token, delta: -(weakest.score + 100) });
  await wait(80);
  host.emit('resolve', { winnerToken: st.live[0].token });
  await wait(140);
}
const face = [100, 200, 300, 400, 500];
for (let i = 0; i < 8 && !st.overtime; i++) {
  const [s3, r3] = openClue()[0];
  host.emit('pick-clue', { slot: s3, row: r3 });
  await wait(80);
  host.emit('resolve', { winnerToken: st.live[0].token });
  await wait(140);
}
check('overtime opens with two left', !!st.overtime,
  st.overtime ? `x${st.overtime.multiplier}` : `${st.live.length} in the ring`);
// Keep both players solvent so the match doesn't end before the escalation.
for (let i = 0; i < 10 && st.overtime && st.overtime.multiplier < 2 && !st.standings; i++) {
  for (const p of st.live) {
    if (p.score < 4000) { host.emit('adjust-score', { token: p.token, delta: 4000 - p.score }); await wait(60); }
  }
  const [s4, r4] = openClue()[0];
  host.emit('pick-clue', { slot: s4, row: r4 });
  await wait(80);
  host.emit('resolve', { winnerToken: st.live[i % st.live.length].token });
  await wait(140);
}
if (st.overtime && st.overtime.multiplier > 1) {
  const cells = openClue();
  const raised = cells.filter(([, r, v]) => v === face[r - 1] * st.overtime.multiplier);
  check('the board shows the raised values, not the face values',
    raised.length === cells.length,
    `x${st.overtime.multiplier}, e.g. row ${cells[0][1]} shows $${cells[0][2]}`);
} else {
  check('the board shows the raised values, not the face values', false, 'never reached x2');
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
