// Profile pictures: acceptance, rejection, and where they surface.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

// a 1x1 jpeg, standing in for what the client's canvas produces
const TINY = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: '{}' })).json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
// Pictures come down their own channel now and are cached by the client, so
// state pushes carry only a flag. Mirror that here.
const pics = new Map();
host.on('avatar', ({ token, dataUrl }) => pics.set(token, dataUrl));
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const mk = async (name) => {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, token: null };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name }, (x) => { p.token = x.token; r(); }));
  return p;
};
const a = await mk('WithPic'), b = await mk('NoPic'), c = await mk('Third');
await wait(150);

a.s.emit('avatar', { dataUrl: TINY });
await wait(200);
const inLobby = st.roster.find((p) => p.token === a.token);
check('an avatar reaches the lobby roster', inLobby.hasAvatar === true && pics.has(a.token),
  inLobby.hasAvatar ? 'set' : 'missing');
check('players without one are simply flagged false',
  st.roster.find((p) => p.token === b.token).hasAvatar === false);
check('the picture itself arrives once, off the state push',
  pics.get(a.token) === TINY && !('avatar' in inLobby));

// junk is refused
b.s.emit('avatar', { dataUrl: 'javascript:alert(1)' });
b.s.emit('avatar', { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' });
await wait(200);
check('a non-image data url is refused', st.roster.find((p) => p.token === b.token).hasAvatar === false);

c.s.emit('avatar', { dataUrl: 'data:image/png;base64,' + 'A'.repeat(70000) });
await wait(200);
check('an oversized image is refused', st.roster.find((p) => p.token === c.token).hasAvatar === false);

host.emit('start-match');
await wait(250);
check('the avatar follows the player into the ring',
  st.live.find((p) => p.token === a.token).hasAvatar === true);

// survives a reconnect, because the client re-sends from its own cache
a.s.close();
await wait(200);
const back = io(U, { transports: ['websocket'] });
await once(back, 'connect');
await new Promise((r) => back.emit('join', { gameId: m.gameId, token: a.token, name: 'WithPic' }, r));
await wait(200);
check('the avatar survives a reconnect on the server side',
  st.live.find((p) => p.token === a.token).hasAvatar === true);

host.emit('end-match');
await wait(250);
check('standings carry the avatar for the share image',
  !!(st.standings || []).find((p) => p.token === a.token).avatar);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); back.close(); [b, c].forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
