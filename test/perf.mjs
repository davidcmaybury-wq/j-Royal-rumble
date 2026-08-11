// Measures what the activation signal actually costs with a full field.
import { io } from 'socket.io-client';
const U = 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));

const N = 24;
const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 0 } }) })).json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
let stateBytes = 0, stateCount = 0;
host.onAny((ev, ...a) => { if (ev === 'state') { stateBytes += JSON.stringify(a).length; stateCount++; } });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
const TINY = 'data:image/jpeg;base64,' + 'A'.repeat(6000);   // a realistic 128px photo
for (let i = 0; i < N; i++) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, token: null, armAt: null, gotAt: null, bytes: 0 };
  s.on('activate-buzzers', () => { p.gotAt = performance.now(); });
  s.onAny((ev, ...a) => { p.bytes += JSON.stringify(a).length; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: 'P' + i }, (x) => { p.token = x.token; r(); }));
  s.emit('avatar', { dataUrl: TINY });
  ps.push(p);
}
await wait(400);
host.emit('start-match');
await wait(400);
console.log(`field of ${st.live.length} in the ring, ${st.queue.length} queued, everyone with a photo\n`);

const before = ps.map((p) => p.bytes);
const [slot, row] = (() => {
  const o = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); }));
  return o[0];
})();
host.emit('pick-clue', { slot, row });
await wait(200);

ps.forEach((p) => { p.gotAt = null; });
const sent = performance.now();
host.emit('activate');
await wait(500);
const got = ps.filter((p) => p.gotAt).map((p) => p.gotAt - sent).sort((a, b) => a - b);
// Guards against the class of mistake that made this test worth writing: an
// "optimisation" that quietly stops the activation reaching anybody.
if (got.length !== N) {
  console.log(`FAIL activation reached only ${got.length} of ${N} players`);
  process.exit(1);
}
console.log(`activation reached ${got.length}/${N} players`);
console.log(`  fastest ${got[0].toFixed(1)} ms   median ${got[Math.floor(got.length / 2)].toFixed(1)} ms   slowest ${got[got.length - 1].toFixed(1)} ms`);
console.log(`  spread ${(got[got.length - 1] - got[0]).toFixed(1)} ms  <- the number that matters; it is how unfair the race is`);

// now a burst of buzzes, the worst case for fan-out
const b0 = ps.map((p) => p.bytes);
const t0 = performance.now();
ps.slice(0, 12).forEach((p, i) => p.s.emit('buzz', { ms: 300 + i * 10, status: 'good' }));
await wait(600);
const perPlayer = ps.map((p, i) => p.bytes - b0[i]);
console.log(`\n12 simultaneous buzzes:`);
console.log(`  bytes pushed to each player: ${Math.round(perPlayer.reduce((a, b) => a + b, 0) / N)}`);
console.log(`  host state pushes during the whole test: ${stateCount}, ${Math.round(stateBytes / 1024)}KB total`);
console.log(`  average host push: ${Math.round(stateBytes / stateCount)} bytes`);

const spread = got[got.length - 1] - got[0];
const ok = spread < 60;
console.log(`\n${ok ? 'ok  ' : 'FAIL'} activation spread under 60 ms across the field`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(ok ? 0 : 1);
