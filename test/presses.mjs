// Every press that is not a buzz, recorded with its timing.
//
// An early press used to arrive as one bare tick of a counter, so somebody
// timing the host and missing by 20ms looked identical to somebody mashing
// 800ms early. The rule this test exists to protect is the other half: none
// of these may EVER reach the race, because an early press has no reaction
// time and would put a zero at the front of it.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((r) => s.once(e, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 999, delay: 0, comeback: false } }) })).json();
const host = io(U, { transports: ['websocket'] }); await once(host, 'connect');
let hs = null; host.on('state', (s) => { hs = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey },
  (x) => { hs = x.state; r(); }));

const players = [];
for (const name of ['Ada', 'Bo', 'Cy']) {
  const c = io(U, { transports: ['websocket'] }); await once(c, 'connect');
  const r = await new Promise((res) => c.emit('join', { gameId: m.gameId, name }, res));
  players.push({ c, token: r.token, name });
}
await wait(300);
await new Promise((r) => host.emit('start-match', {}, r)); await wait(500);

const o = []; hs.board.forEach((col, si) => col.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); }));
host.emit('pick-clue', { slot: o[0][0], row: o[0][1] }); await wait(150);
host.emit('activate'); await wait(150);

const [a, b] = players;
// A press while the host is still reading: nothing has armed yet, so `at` is
// null — but on the clue's own timeline it is 1.8s in. This was the blank that
// Matt's timeline-from-display approach fills.
a.c.emit('early-buzz', { kind: 'early', at: null, sinceShown: 1800.4, armSinceShown: null });
// Ada jumps the lights, then mashes through the penalty, then gets through.
a.c.emit('early-buzz', { kind: 'early', at: -240.5, sinceShown: 2860, armSinceShown: 3100.5, sinceEarly: null });
a.c.emit('early-buzz', { kind: 'locked', at: -180.2, sinceEarly: 60.3, penaltyLeft: 190 });
a.c.emit('early-buzz', { kind: 'locked', at: -120.0, sinceEarly: 120.5, penaltyLeft: 130 });
// Bo presses cleanly, then again out of habit.
b.c.emit('buzz', { ms: 212.4, status: 'good', sinceShown: 3312.9, armSinceShown: 3100.5 });
b.c.emit('early-buzz', { kind: 'duplicate', at: 300.1, sinceEarly: null });
// Cy leans on the key: fifty presses during one penalty.
const cy = players[2];
cy.c.emit('early-buzz', { kind: 'early', at: -90, sinceEarly: null });
for (let i = 0; i < 50; i++) {
  cy.c.emit('early-buzz', { kind: 'locked', at: -80 + i, sinceEarly: 10 + i, penaltyLeft: 200 - i });
}
await wait(500);

const race = hs.race || {};
const inRace = (race.buzzes || []).map((x) => x.ms);
check('nothing but the real buzz reached the race', inRace.length === 1 && inRace[0] === 212.4,
  JSON.stringify(inRace));


host.emit('resolve', { winnerToken: b.token }); await wait(300);
host.emit('end-match'); await wait(700);

const st = hs.standings || [];
// NOTE: the real buzz's clue timeline is written to disk through the field
// whitelist in the clue-log writer (server.js, "A whitelist, so a new field").
// The host's `history` is a different structure with no buzzes in it, so this
// suite cannot see the saved buzz — check a real log file after a match.
const ada = st.find((p) => p.name === 'Ada');
const bo = st.find((p) => p.name === 'Bo');
check('the early press is kept with its timing',
  ada?.presses?.some((p) => p.kind === 'early' && p.at === -240.5),
  JSON.stringify(ada?.presses?.[0]));
check('so are both presses during the penalty',
  ada?.presses?.filter((p) => p.kind === 'locked').length === 2,
  `${ada?.presses?.filter((p) => p.kind === 'locked').length} locked`);
check('with how long after the jump each one came',
  ada?.presses?.some((p) => p.sinceEarly === 120.5));
check('a press during the reading keeps its place on the clue timeline',
  ada?.presses?.some((p) => p.at === null && p.sinceShown === 1800.4),
  'at null, sinceShown 1800.4');
check('and every press knows when the lights came on',
  ada?.presses?.some((p) => p.armSinceShown === 3100.5));
check('only the jumps count as attempts, not the volley after them',
  ada?.early === 2 && ada?.att === 2, `early ${ada?.early}, att ${ada?.att}`);
check('a press after buzzing is recorded',
  bo?.presses?.some((p) => p.kind === 'duplicate'), JSON.stringify(bo?.presses));
check('but is not a second attempt', bo?.att === 1, `att ${bo?.att}`);

const cyr = st.find((p) => p.name === 'Cy');
check('a held key cannot grow the log without limit',
  (cyr?.presses?.length ?? 0) <= 20, `${cyr?.presses?.length} kept of 51 sent`);
check('and still counts as only one attempt', cyr?.att === 1, `att ${cyr?.att}`);
console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
