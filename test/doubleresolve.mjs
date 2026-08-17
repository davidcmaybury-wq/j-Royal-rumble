// Adjudicating the same clue twice must not take the game down.
//
// From a live match: the host pressed Y twice on one clue and the console
// answered "cannot destructure property 'slot' of 'match.clue' as it is null",
// with the game apparently stuck. Y fires on keydown and the guard in front of
// it reads the console's own copy of the state, which still shows the old clue
// until the server's push lands — so the second press arrives after the clue
// has been settled and match.clue is null.
//
// `resolve` was the only handler of its kind without a null check, so it
// destructured null and threw. hostOnly caught the TypeError and handed it to
// the host verbatim. The second press must be refused in words instead, and the
// match must carry on being playable.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 0 } }) })).json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
const errors = [];
host.on('state', (s) => { st = s; });
host.on('error-msg', (t) => errors.push(String(t)));
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey },
  (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['A', 'B', 'C']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n },
    (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(200);
host.emit('start-match');
await wait(300);

const inRing = new Set(st.live.map((p) => p.token));
const players = ps.filter((p) => inRing.has(p.token));
check('three players are in the ring', players.length === 3, `${players.length}`);

const openClues = () => {
  const out = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) out.push([si, x.row]); }));
  return out;
};

// --- play one clue, then adjudicate it twice -------------------------------
const [slot, row] = openClues()[0];
host.emit('pick-clue', { slot, row });
await wait(120);
host.emit('activate');
await wait(150);
players[0].s.emit('buzz', { ms: 120 });
await wait(200);

const revealedBefore = st.clues ?? null;
const scoreBefore = st.live.find((p) => p.token === players[0].token)?.score;

host.emit('resolve', { winnerToken: players[0].token });
await wait(300);
const scoreAfter = st.live.find((p) => p.token === players[0].token)?.score;
check('the first adjudication is applied', scoreAfter > scoreBefore,
  `${scoreBefore} -> ${scoreAfter}`);
check('and the clue is closed', !st.clue, String(!!st.clue));

// The second press, landing after the clue is already settled.
host.emit('resolve', { winnerToken: players[0].token });
await wait(300);

check('the second adjudication is refused in words, not a TypeError',
  errors.length === 1 && !/destructure|undefined|null/i.test(errors[0]),
  errors[0] || 'no message at all');
check('and it says what to do next', /already settled/i.test(errors[0] || ''),
  errors[0] || '');

const scoreAfterTwo = st.live.find((p) => p.token === players[0].token)?.score;
check('the score is not paid twice', scoreAfterTwo === scoreAfter,
  `${scoreAfter} -> ${scoreAfterTwo}`);

// --- and the match is still playable ---------------------------------------
const next = openClues()[0];
check('there is another clue to play', !!next, next ? next.join('/') : 'none');
host.emit('pick-clue', { slot: next[0], row: next[1] });
await wait(150);
check('the next clue goes up — the game is not hung', !!st.clue,
  st.clue ? `${st.clue.category} ${st.clue.value}` : 'no clue up');
host.emit('activate');
await wait(150);
players[1].s.emit('buzz', { ms: 100 });
await wait(200);
host.emit('resolve', { winnerToken: players[1].token });
await wait(300);
check('and it can be adjudicated normally', !st.clue, String(!!st.clue));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
