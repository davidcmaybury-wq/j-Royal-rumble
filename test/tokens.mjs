// Weapon tokens: assigned on arrival, changeable, and de-conflicted by colour.
import { io } from 'socket.io-client';
import { TOKEN_NAMES, COLOUR_NAMES, assignToken, resolveChoice } from '../src/tokens-server.js';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

console.log('ASSIGNMENT');
{
  // Every shape is used before any shape repeats.
  const taken = [];
  for (let i = 0; i < TOKEN_NAMES.length; i++) taken.push(assignToken(taken));
  const shapes = new Set(taken.map((t) => t.art));
  check('a full board of shapes comes out with no repeats',
    shapes.size === TOKEN_NAMES.length, `${shapes.size} of ${TOKEN_NAMES.length}`);

  // Past that it repeats shapes in new colours rather than giving up.
  const more = [];
  for (let i = 0; i < 30; i++) more.push(assignToken([...taken, ...more]));
  const pairs = new Set([...taken, ...more].map((t) => `${t.art}:${t.colour}`));
  check('past that it repeats shapes in fresh colours',
    pairs.size === taken.length + more.length, `${pairs.size} distinct of ${taken.length + more.length}`);
  check('and thirty players never collide', new Set(more.slice(0, 30)
    .map((t) => `${t.art}:${t.colour}`)).size === 30);
}

console.log('\nDE-CONFLICTION');
{
  const taken = [{ art: 'crowbar', colour: 'brass' }];
  const r = resolveChoice('crowbar', 'brass', taken);
  check('asking for a taken shape still gets that shape',
    r.art === 'crowbar', r.art);
  check('but in a different colour', r.colour !== 'brass', `${r.colour} rather than brass`);
  const free = resolveChoice('anchor', 'brass', taken);
  check('a free shape is granted as asked',
    free.art === 'anchor' && free.colour === 'brass');
  check('an unknown shape is refused', resolveChoice('bazooka', 'brass', []) === null);
  check('an unknown colour falls back rather than failing',
    COLOUR_NAMES.includes(resolveChoice('anchor', 'octarine', []).colour));
}

console.log('\nIN A MATCH');
const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, token: null };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(250);

const arts = st.roster.map((p) => p.tokenArt).filter(Boolean);
check('everyone is given a token on arrival', arts.length === 6, `${arts.length} of 6`);
check('and no two are alike',
  new Set(arts.map((a) => `${a.art}:${a.colour}`)).size === 6,
  arts.map((a) => a.art).join(', '));

// Two players ask for the same shape.
//
// The shape has to be chosen from what the room does NOT already have. Naming
// one outright made this test depend on the random assignment above: locally
// nobody had drawn the morningstar, on CI somebody had, and the test failed on
// its own premise rather than on the code.
const held = new Set(st.roster.map((p) => p.tokenArt && p.tokenArt.art).filter(Boolean));
const wantArt = TOKEN_NAMES.find((n) => !held.has(n));
check('there is a free shape to contest over', !!wantArt, wantArt);

const want = { art: wantArt, colour: 'brass' };
const first = await new Promise((r) => ps[0].s.emit('token-art', want, r));
const second = await new Promise((r) => ps[1].s.emit('token-art', want, r));
await wait(200);
check('the first to ask gets the colour they wanted',
  first.art === wantArt && first.colour === 'brass', `${first.art} in ${first.colour}`);
check('the second gets the same shape in another colour',
  second.art === wantArt && second.colour !== first.colour,
  `${second.art} in ${second.colour}`);
check('the console sees both',
  st.roster.filter((p) => p.tokenArt && p.tokenArt.art === wantArt).length === 2,
  `${st.roster.filter((p) => p.tokenArt && p.tokenArt.art === wantArt).length} holding it`);

// Junk is refused rather than stored.
const before = st.roster.find((p) => p.token === ps[2].token).tokenArt;
ps[2].s.emit('token-art', { art: '<script>', colour: 'brass' });
await wait(200);
check('a junk shape is refused',
  JSON.stringify(st.roster.find((p) => p.token === ps[2].token).tokenArt) === JSON.stringify(before));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
