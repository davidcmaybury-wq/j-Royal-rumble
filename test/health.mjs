// Health has to distinguish a match being played from a lobby sitting idle.
//
// The deploy script asks this before restarting, and a restart ends every live
// match — in memory, mid-clue, for everybody. `matches.size` counts lobbies and
// finished games too, so deploying on that number would refuse for no reason
// and, worse, would not refuse when it mattered if the count were wrong.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const health = async () => (await fetch(`${U}/api/health`)).json();

const before = await health();
check('health answers', !!before.version, before.version);

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 999, delay: 0 } }) })).json();
await wait(200);
let h = await health();
check('a lobby is not a match in play', h.matchesInPlay === before.matchesInPlay,
  `${h.liveMatches} rooms, ${h.matchesInPlay} in play`);

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
await wait(400);

h = await health();
check('a started match counts', h.matchesInPlay === before.matchesInPlay + 1,
  `${h.matchesInPlay} in play`);
check('and so do the people in it', h.playersInPlay >= 3, `${h.playersInPlay} players`);

host.emit('end-match');
await wait(500);
h = await health();
check('a finished match stops counting', h.matchesInPlay === before.matchesInPlay,
  `${h.matchesInPlay} in play`);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
