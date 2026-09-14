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

// --- robots walk in to music too -----------------------------------------
//
// The whole reason this is testable by one person: reproducing the failure used
// to need a human to pick a link and then walk into a live ring. Robots do both
// on demand, and they alternate YouTube with library .mp3 so a match tells you
// which half is silent instead of only that something was.
{
  const r2 = await fetch(`${U}/api/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { entryInterval: 1, startScore: 3000 } }),
  });
  const g2 = await r2.json();
  // The host key travels in the x-host-key header, not a query string.
  const addBots = (g, body) => fetch(`${U}/api/match/${g.gameId}/bots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-host-key': g.hostKey },
    body: JSON.stringify(body),
  });
  const added2 = await addBots(g2, { count: 6 });
  check('the robots were actually added', added2.ok, `HTTP ${added2.status}`);
  const h2 = io(U, { transports: ['websocket'] });
  await once(h2, 'connect');
  let s2 = null;
  await new Promise((r) => h2.emit('host-join',
    { gameId: g2.gameId, hostKey: g2.hostKey }, (x) => { s2 = x.state; r(); }));
  const bots = (s2.roster || []).filter((p) => p.isBot);
  check('every robot walks in to music', bots.length === 6 && bots.every((b) => b.hasTheme),
    `${bots.filter((b) => b.hasTheme).length} of ${bots.length} have a theme`);

  // Both kinds, or the match cannot tell you which branch is broken.
  const r3 = await fetch(`${U}/api/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { entryInterval: 1 } }),
  });
  const g3 = await r3.json();
  await addBots(g3, { count: 4, themes: false });
  const h3 = io(U, { transports: ['websocket'] });
  await once(h3, 'connect');
  let s3 = null;
  await new Promise((r) => h3.emit('host-join',
    { gameId: g3.gameId, hostKey: g3.hostKey }, (x) => { s3 = x.state; r(); }));
  const quiet = (s3.roster || []).filter((p) => p.isBot);
  check('and `themes: false` gives a silent field', quiet.length === 4 && quiet.every((b) => !b.hasTheme),
    `${quiet.filter((b) => b.hasTheme).length} unexpectedly have one`);
  h2.close(); h3.close();
}

// --- a link the room will never hear is refused at the picker --------------
//
// The failure this prevents: a player pastes a music video, it saves happily,
// and the first anybody hears of it is the host watching a silent entrance. The
// check runs when they press Save, next to the box they pasted into.
//
// Network-dependent by nature, and the implementation fails OPEN for exactly
// that reason — a blip must not take away a theme that would have worked. So
// this suite probes reachability first and only asserts the blocking behaviour
// when YouTube actually answered. A CI box with no route to youtube.com reports
// the skip rather than a failure.
{
  const shapeBad = await (await fetch(`${U}/api/theme-check?id=not a video id`)).json();
  check('the check refuses something that is not a video id at all',
    shapeBad.ok === false, JSON.stringify(shapeBad));

  let reachable = true;
  try {
    const probe = await fetch('https://www.youtube.com/oembed?url='
      + encodeURIComponent('https://www.youtube.com/watch?v=aqz-KE-bpKQ') + '&format=json',
      { signal: AbortSignal.timeout(8000) });
    reachable = probe.status === 200;
  } catch { reachable = false; }

  if (!reachable) {
    check('YouTube embeddability checks (skipped: youtube.com unreachable)', true,
      'the endpoint fails open, which is the intended behaviour here');
  } else {
    // jumyqrz1MAY is the real pick that played silently on 2026-09-07; its owner
    // has embedding turned off. 52PHX4m07aI is a pick from the same night that
    // did play. Both are kept as fixtures because a synthetic id cannot tell
    // these two answers apart.
    const blocked = await (await fetch(`${U}/api/theme-check?id=jumyqrz1MAY`)).json();
    check('a video whose owner blocks embedding is refused, with a reason',
      blocked.ok === false && /different one/.test(blocked.reason || ''),
      blocked.reason || JSON.stringify(blocked));

    const fine = await (await fetch(`${U}/api/theme-check?id=52PHX4m07aI`)).json();
    check('and a video that plays is allowed through', fine.ok === true, JSON.stringify(fine));

    // The endpoint is advice; this is the one that guards what gets stored.
    const p0 = players[0];
    const refused = await new Promise((r) =>
      p0.s.emit('set-theme', { theme: { kind: 'youtube', id: 'jumyqrz1MAY', seconds: 5 } }, r));
    check('and the socket refuses to store it even if the picker is skipped',
      !!(refused && refused.error), refused && (refused.error || 'it was stored'));
  }
}

host.close();
players.forEach((p) => p.s.close());
console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
process.exit(fails ? 1 : 0);
