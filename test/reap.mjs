// The reaper, which had no test and therefore grew a leak.
//
// It ended idle live matches and dropped idle lobbies, but a match whose phase
// was 'over' was excluded from deletion by the very condition meant to filter
// it — so finished matches accumulated in memory for the life of the process.
// A server up five days was holding every match ever played on it.
//
// Needs its own server: the windows and the tick are set absurdly low here so
// the reaper can be watched, which is not something the shared test server can
// do. Same shape as security.mjs.
import { io } from 'socket.io-client';
const U = process.env.REAP_URL || 'http://127.0.0.1:8096';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = process.env.RUMBLE_ADMIN_KEY || 'ci-admin-key';

const listed = async () => {
  const r = await fetch(`${U}/api/control?key=${KEY}`);
  if (!r.ok) throw new Error(`control said ${r.status}`);
  return (await r.json()).matches.map((m) => m.id);
};
const make = async () => (await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: '{}' })).json());

// --- an abandoned lobby is dropped ---------------------------------------
const lobby = await make();
check('a new lobby is listed', (await listed()).includes(lobby.gameId), lobby.gameId);
await wait(2500);
check('and an idle lobby is dropped', !(await listed()).includes(lobby.gameId));

// --- a finished match survives its grace, then goes ------------------------
//
// It has to be a genuinely live match: ending a lobby deletes it outright
// (there is nothing to record), so a lobby would never exercise the leak. This
// starts a real match with robots, lets the reaper end it for being idle, and
// then watches for the deletion that never used to come.
const done = await make();
await fetch(`${U}/api/match/${done.gameId}/bots`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-host-key': done.hostKey },
  body: JSON.stringify({ count: 3, profile: 'measured' }) });

const host = io(U, { transports: ['websocket'] });
await new Promise((r) => host.once('connect', r));
await new Promise((r) => host.emit('host-join',
  { gameId: done.gameId, hostKey: done.hostKey }, () => r()));
host.emit('start-match');
await wait(1200);

const phaseOf = async (id) => {
  const r = await (await fetch(`${U}/api/control?key=${KEY}`)).json();
  return (r.matches.find((m) => m.id === id) || {}).phase;
};
check('the match is live once started', (await phaseOf(done.gameId)) === 'live',
  String(await phaseOf(done.gameId)));

// Go quiet. The reaper should end it for idleness — but not delete it yet.
host.close();
await wait(3000);
check('the reaper ends an idle live match', (await phaseOf(done.gameId)) === 'over',
  String(await phaseOf(done.gameId)));
check('and keeps it while the grace runs', (await listed()).includes(done.gameId),
  'a finished match must outlive the idle window');

await wait(5000);
check('then drops it once the grace expires',
  !(await listed()).includes(done.gameId),
  'this is the leak: over matches were never deleted');

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
