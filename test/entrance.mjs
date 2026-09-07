// The entrance-music path, end to end over real sockets.
//
// Reported twice from live matches: "their music doesn't play". The pieces all
// looked right in isolation — the library serves, the picker saves, the console
// calls playTheme — which is exactly the shape of failure that needs a test
// through the whole path rather than another read of each part.
//
// Run with the server already listening on :8080.
import { io } from 'socket.io-client';

const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));

let fails = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};

const res = await fetch(`${U}/api/match`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 1, startScore: 3000, ceiling: 9000 } }),
});
const { gameId, hostKey } = await res.json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let state = null;
const resolved = [];
host.on('state', (s) => { state = s; });
host.on('resolved', (e) => resolved.push(e));
await new Promise((r) => host.emit('host-join', { gameId, hostKey }, (x) => { state = x.state; r(); }));

// Four players: three start, the fourth waits in the queue and is the one
// walking in to music.
const players = [];
for (const name of ['Ada', 'Nam', 'Wayne', 'Bo']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, token: null };
  await new Promise((r) => s.emit('join', { gameId, name }, (x) => { p.token = x.token; r(); }));
  players.push(p);
}
await wait(150);

// --- the picker's own contract -------------------------------------------
const lib = await (await fetch(`${U}/api/themes`)).json();
check('the library offers themes to pick', (lib.themes || []).length > 0,
  `${(lib.themes || []).length} in the folder`);

// Start first, then pick the entrant out of the queue. The draw is shuffled,
// so join order says nothing about who starts in the ring — an earlier draft of
// this test set the theme on the fourth player to join, who was drawn into the
// opening three, and then waited for an entrance that had already happened.
host.emit('start-match');
await wait(250);
// Identified by absence from the ring, not by reading the queue: the host view
// anonymizes the queue (anonymousNext), so its rows carry a null token by
// design and nothing there can be matched to a player.
const entrant = players.find((p) => !(state.live || []).some((l) => l.token === p.token));
check('somebody is waiting in the queue to walk in', !!entrant,
  `${(state.queue || []).length} queued`);

const pick = { kind: 'library', key: lib.themes[0].key, seconds: 5 };
const saved = await new Promise((r) => entrant.s.emit('set-theme', { theme: pick }, r));
check('a player can save a theme', !!saved && !saved.error && !!saved.theme,
  saved && saved.error ? saved.error : `saved ${saved?.theme?.key}`);
await wait(150);
const rosterRow = (state.roster || []).find((p) => p.token === entrant.token);
check('the state tells the host that entrant brought music',
  !!rosterRow && rosterRow.hasTheme === true,
  rosterRow ? `hasTheme=${rosterRow.hasTheme}` : 'not in the roster');

// --- play clues until the fourth walks in ---------------------------------
const inRing = () => (state.live || []).some((p) => p.token === entrant.token);
for (let i = 0; i < 12 && !inRing(); i++) {
  const slot = i % 6;
  host.emit('pick-clue', { slot, row: 1 });
  await wait(120);
  if (!state.clue) continue;
  host.emit('resolve', { winnerToken: null });
  await wait(160);
}
check('the queued player entered the ring', inRing(),
  `${(state.live || []).length} live`);

const withEntrance = resolved.filter((e) => (e.entrances || []).length);
const theirs = withEntrance.flatMap((e) => e.entrances)
  .find((x) => x && x.name === entrant.name);
check('the entrance reaches the host with the theme attached',
  !!theirs && !!theirs.theme && theirs.theme.key === pick.key,
  theirs ? `theme=${theirs.theme ? theirs.theme.key : 'null'}` : 'no entrance carried their name');

host.close();
players.forEach((p) => p.s.close());
console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
process.exit(fails ? 1 : 0);
