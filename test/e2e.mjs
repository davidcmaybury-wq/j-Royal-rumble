// End-to-end: creates a match, joins players over sockets, and plays clues
// through the real server. Verifies scoring, re-toss, entry and elimination.
// Run with the server already listening on :8080.
import { io } from 'socket.io-client';

const U = process.env.URL || 'http://127.0.0.1:8080';
const NAMES = ['Dave', 'Nam', 'Wayne', 'Zach', 'Ward', 'Weiss'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));

let fails = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};

const res = await fetch(`${U}/api/match`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 2, startScore: 3000, ceiling: 9000 } }),
});
const { gameId, hostKey } = await res.json();
console.log(`match ${gameId}\n`);

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let state = null;
host.on('state', (s) => { state = s; });
await new Promise((r) => host.emit('host-join', { gameId, hostKey }, (x) => { state = x.state; r(); }));
check('host joined', !!state && state.phase === 'lobby');

const players = [];
for (const name of NAMES) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, token: null, view: null, armAt: null };
  s.on('state', (v) => { p.view = v; });
  s.on('activate-buzzers', ({ at }) => { p.armAt = at; });
  await new Promise((r) => s.emit('join', { gameId, name }, (x) => { p.token = x.token; r(); }));
  players.push(p);
}
await wait(150);
check('roster filled', state.roster.length === NAMES.length, `${state.roster.length} players`);

host.emit('start-match');
await wait(200);
check('match started', state.phase === 'live');
check('three in the ring', state.live.length === 3, `${state.live.length}`);
check('queue holds the rest', state.queue.length === NAMES.length - 3);
check('board has six categories', state.board.length === 6);
check('entry countdown set', state.cluesUntilNextEntry != null);

const liveTokens = () => state.live.map((p) => p.token);
const byToken = (t) => players.find((p) => p.token === t);

// --- one clue, buzzed by two live players, first is correct --------------
host.emit('pick-clue', { slot: 0, row: 3 });
await wait(120);
check('clue on the board', !!state.clue, state.clue && state.clue.category);
check('players are not sent the answer',
  players.every((p) => !JSON.stringify(p.view || {}).includes(state.clue.answer)));

host.emit('activate');
await wait(300);
const [a, b] = liveTokens().map(byToken);
byToken(liveTokens()[0]).s.emit('buzz', { ms: 412.3, status: 'good' });
byToken(liveTokens()[1]).s.emit('buzz', { ms: 501.8, status: 'good' });
await wait(150);
check('two buzzes ranked', state.race.buzzes.length === 2);
check('fastest is on the clock', state.race.buzzes[0].ms === 412.3);

const before = Object.fromEntries(state.live.map((p) => [p.token, p.score]));
const winner = state.race.buzzes[0].token;
const value = state.clue.value;
host.emit('resolve', { winnerToken: winner });
await wait(200);
const after = Object.fromEntries(state.live.map((p) => [p.token, p.score]));
const opponents = Object.keys(before).filter((t) => t !== winner);
check('winner collects from each opponent',
  after[winner] - before[winner] === value * opponents.length,
  `+${after[winner] - before[winner]} for ${opponents.length} opponents at $${value}`);
check('each opponent pays the value',
  opponents.every((t) => before[t] - after[t] === value));
check('clue cleared', !state.clue);
check('clue counter advanced', state.clues === 1);

// --- a miss re-opens the race -------------------------------------------
host.emit('pick-clue', { slot: 1, row: 1 });
await wait(100);
host.emit('activate');
await wait(250);
const first = liveTokens()[0];
byToken(first).s.emit('buzz', { ms: 380, status: 'good' });
await wait(120);
host.emit('mark-wrong', { token: first });
await wait(150);
check('misser locked out', state.race.lockedOut.includes(first));
check('race re-opened', state.race.open === true);
check('misser cleared from the board', !state.race.buzzes.some((x) => x.token === first));
const second = liveTokens().find((t) => t !== first);
byToken(second).s.emit('buzz', { ms: 640, status: 'good' });
await wait(120);
check('another player can take it', state.race.buzzes[0].token === second);
const preMiss = Object.fromEntries(state.live.map((p) => [p.token, p.score]));
const v2 = state.clue.value;
host.emit('resolve', { winnerToken: second });
await wait(200);
const postMiss = Object.fromEntries(state.live.map((p) => [p.token, p.score]));
check('misser is double-dipped', preMiss[first] - postMiss[first] === v2 * 2,
  `lost ${preMiss[first] - postMiss[first]} on a $${v2} clue`);

// --- spectator ranking ---------------------------------------------------
host.emit('pick-clue', { slot: 2, row: 2 });
await wait(100);
host.emit('activate');
await wait(250);
const queued = players.find((p) => p.view?.you?.state === 'queued');
liveTokens().slice(0, 2).forEach((t, i) => byToken(t).s.emit('buzz', { ms: 500 + i * 100, status: 'good' }));
await wait(100);
queued.s.emit('buzz', { ms: 450, status: 'good' });
await wait(200);
check('spectator buzz is not in the host race',
  !state.race.buzzes.some((x) => x.token === queued.token));
check('spectator gets a rank against the live field',
  queued.view.myBuzz && queued.view.myBuzz.place === 1 && queued.view.myBuzz.outOf === 3,
  queued.view.myBuzz ? `${queued.view.myBuzz.place} of ${queued.view.myBuzz.outOf}` : 'none');

// --- entry fires on the interval ----------------------------------------
// Entry lands when the clue counter hits a multiple of entryInterval, so
// resolve this one and then advance to the next boundary before checking.
host.emit('resolve', { winnerToken: state.race.buzzes[0].token });
await wait(250);
const interval = 2;
const fieldBefore = state.live.length;
const cluesBefore = state.clues;
while (state.clues % interval !== 0 && state.queue.length) {
  const open = [];
  state.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(120);
  host.emit('resolve', { winnerToken: null });
  await wait(200);
}
check('a new player entered at the interval boundary',
  state.live.length > fieldBefore || state.clues === cluesBefore,
  `clue ${state.clues}, field ${fieldBefore} → ${state.live.length}`);

// --- stumper -------------------------------------------------------------
host.emit('pick-clue', { slot: 3, row: 5 });
await wait(100);
const preStump = Object.fromEntries(state.live.map((p) => [p.token, p.score]));
const v3 = state.clue.value;
host.emit('resolve', { winnerToken: null });
await wait(200);
const postStump = Object.fromEntries(state.live.map((p) => [p.token, p.score]));
const drops = Object.keys(preStump)
  .filter((t) => postStump[t] !== undefined)
  .map((t) => preStump[t] - postStump[t]);
check('stumper costs everyone half value',
  drops.length > 0 && drops.every((d) => d === Math.round(v3 * 0.5)),
  `−${drops[0]} on a $${v3} clue`);

// --- reconnect keeps identity -------------------------------------------
const victim = byToken(liveTokens()[0]);
const scoreBefore = state.live.find((p) => p.token === victim.token).score;
const drawBefore = state.live.find((p) => p.token === victim.token).draw;
victim.s.close();
await wait(200);
check('host sees the drop', state.live.find((p) => p.token === victim.token).connected === false);
const back = io(U, { transports: ['websocket'] });
await once(back, 'connect');
await new Promise((r) => back.emit('join', { gameId, token: victim.token, name: victim.name }, r));
await wait(200);
const rejoined = state.live.find((p) => p.token === victim.token);
check('score survives reconnect', rejoined.score === scoreBefore, `${rejoined.score}`);
check('draw number survives reconnect', rejoined.draw === drawBefore);
check('marked connected again', rejoined.connected === true);

// --- veto ----------------------------------------------------------------
const cat0 = state.board[0].title;
host.emit('veto', { slot: 0 });
await wait(150);
check('veto swaps the category', state.board[0].title !== cat0,
  `${cat0} → ${state.board[0].title}`);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); back.close(); players.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
