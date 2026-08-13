// The robots are levelled to the human field once, and then left alone.
//
// Recomputing every clue made them chase the human: in a real match the gap
// went from the bots being 132ms faster to 318ms slower as the player's running
// median drifted. A player who started slowly got easier opposition all match.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 0, recordMatch: true } }) })).json();
const H = { 'content-type': 'application/json', 'x-host-key': m.hostKey };
await fetch(`${U}/api/match/${m.gameId}/bots`, { method: 'POST', headers: H,
  body: JSON.stringify({ count: 2 }) });

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(300);

check('no calibration before anyone has buzzed', st.botOffsetFrozen === false,
  `offset ${st.botOffset}`);
// The default matters more than it looks. A human crushed in the opening clues
// can be eliminated before the calibration ever fires — which is exactly what
// happened in one recorded match, where the player went out at clue 12 having
// buzzed seven times and lost every race to robots that had never been levelled
// to him.
check('but the robots start on a sensible default rather than raw speed',
  st.botOffset >= 150 && st.botOffset <= 250,
  `${st.botOffset}ms, against human medians of 198-422ms across recorded matches`);

const playClue = async (humanMs) => {
  const open = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  if (!open.length) return;
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(60);
  host.emit('activate');
  await wait(80);
  for (const p of ps) {
    if (st.live.some((x) => x.token === p.token)) p.s.emit('buzz', { ms: humanMs, status: 'good' });
  }
  await wait(120);
  host.emit('resolve', { winnerToken: null });
  await wait(100);
};

// Only three players start, so one of the two humans may be queued — play
// enough clues that at least ten human buzzes have certainly landed.
for (let i = 0; i < 30 && !st.botOffsetFrozen; i++) await playClue(600);
check('it calibrates once there are enough buzzes', st.botOffsetFrozen === true,
  `offset ${st.botOffset}ms`);
const frozen = st.botOffset;
check('and the offset lands near the human buzzing 600ms', frozen > 350 && frozen < 750,
  `${frozen}ms, against a reference human at 43ms`);

// Now buzz much faster for a long stretch. The offset must not follow.
for (let i = 0; i < 12; i++) await playClue(120);
check('speeding up does not move it', st.botOffset === frozen,
  `${st.botOffset}ms against ${frozen}ms`);

// And slowing right down must not make the robots easier either.
for (let i = 0; i < 12; i++) await playClue(1500);
check('slowing down does not move it either', st.botOffset === frozen,
  `${st.botOffset}ms against ${frozen}ms`);

host.emit('end-match');
await wait(300);
const rec = await (await fetch(`${U}/api/match/${m.gameId}/record?key=${encodeURIComponent(m.hostKey)}`)).json();
check('the record says what the robots were levelled to',
  rec.latency && rec.latency.botOffset === frozen, `${rec.latency?.botOffset}`);
check('and explains it', /frozen/.test(rec.latency?.botOffsetNote || ''));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
