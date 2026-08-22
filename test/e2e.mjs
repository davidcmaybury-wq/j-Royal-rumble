// End-to-end: creates a match, joins players over sockets, and plays clues
// through the real server. Verifies scoring, re-toss, entry and elimination.
// Run with the server already listening on :8080.
import { io } from 'socket.io-client';

const U = process.env.URL || 'http://127.0.0.1:8080';
// Deliberately invented names. Two of the originals collided with real
// players' handles, which is how a fixture becomes a privacy question.
const NAMES = ['Ada', 'Nam', 'Wayne', 'Bo', 'Ward', 'Weiss'];
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
// Check the field, not a substring of the whole view.
//
// A blanket search matches on coincidence — a short answer like "Bounty" hits
// because the payload names the bounties mechanic — and CI failed on a commit
// that touched nothing near player payloads. What actually matters is that the
// clue object carries no answer at all.
check('the clue a player is sent has no answer field',
  players.every((p) => !p.view?.clue || !('answer' in p.view.clue)),
  players.map((p) => Object.keys(p.view?.clue || {}).join('/')).join(' | ') || 'no clue yet');
// The blanket search is still worth running, but only where a match means
// something rather than being a common word.
if (state.clue.answer.length >= 10) {
  check('and it appears nowhere else in the payload',
    players.every((p) => !JSON.stringify(p.view || {}).toLowerCase()
      .includes(state.clue.answer.toLowerCase())),
    state.clue.answer.slice(0, 30));
}

host.emit('activate');
await wait(300);
const [a, b] = liveTokens().map(byToken);
byToken(liveTokens()[0]).s.emit('buzz', { ms: 412.3, status: 'good' });
byToken(liveTokens()[1]).s.emit('buzz', { ms: 501.8, status: 'good' });
await wait(150);
check('two buzzes ranked', state.race.buzzes.length === 2);
// By who pressed, not by the number they pressed.
//
// The comeback is on by default, which makes a default match Arcade — and the
// host view carries places rather than times there, because with the buzz edge
// applied the order is not the raw speed. Asserting on ms tied this check to
// one of the two modes for no reason: the thing under test is which player the
// server put on the clock, and that reads the same in both.
check('fastest is on the clock', state.race.buzzes[0].token === a.token,
  `${state.race.buzzes[0].name} first`);
check('and the places are 1..n', state.race.buzzes.every((x, i) => x.place === i + 1),
  state.race.buzzes.map((x) => x.place).join(','));

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

// --- standings at the end of the match ----------------------------------
host.emit('end-match');
await wait(400);
check('match reports as over', state.phase === 'over');
const st = state.standings || [];
check('standings cover everyone who played', st.length >= 5, st.length + ' entries');
// A host-aborted match has no winner, however many are still in the ring.
const champs = st.filter((p) => p.winner);
check('an aborted match crowns nobody', champs.length === 0, champs.map((p) => p.name).join(','));
check('standings carry buzzer stats', st.some((p) => p.att > 0 && p.best != null));
check('standings carry drain totals', st.some((p) => p.drained > 0));
check('players receive standings too', players.some((p) => p.view && p.view.standings));
check('players still never see an answer',
  players.every((p) => !JSON.stringify(p.view || {}).includes('correctResponse')));

// --- a match played to its natural end crowns exactly one --------------
{
  const r2 = await fetch(`${U}/api/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { entryInterval: 99, startScore: 200, ceiling: 2000 } }),
  });
  const m2 = await r2.json();
  const h2 = io(U, { transports: ['websocket'] });
  await once(h2, 'connect');
  let s2 = null;
  h2.on('state', (x) => { s2 = x; });
  await new Promise((r) => h2.emit('host-join', { gameId: m2.gameId, hostKey: m2.hostKey }, (x) => { s2 = x.state; r(); }));
  const ps2 = [];
  for (const name of ['A', 'B', 'C']) {
    const sk = io(U, { transports: ['websocket'] });
    await once(sk, 'connect');
    const p = { name, sk, token: null };
    await new Promise((r) => sk.emit('join', { gameId: m2.gameId, name }, (x) => { p.token = x.token; r(); }));
    ps2.push(p);
  }
  await wait(150);
  h2.emit('start-match');
  await wait(200);

  let guard = 0;
  while (s2.phase === 'live' && guard++ < 60) {
    const open = [];
    s2.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
    const [slot, row] = open[open.length - 1];          // biggest clues, fastest bleed
    h2.emit('pick-clue', { slot, row });
    await wait(90);
    h2.emit('activate');
    await wait(120);
    const alive = s2.live.map((p) => p.token);
    const who = ps2.find((p) => p.token === alive[0]);
    if (who) who.sk.emit('buzz', { ms: 400, status: 'good' });
    await wait(110);
    const on = s2.race && s2.race.buzzes[0];
    h2.emit('resolve', { winnerToken: on ? on.token : null });
    await wait(160);
  }
  check('match ended on its own', s2.phase === 'over', `after ${guard} clues`);
  const w2 = (s2.standings || []).filter((p) => p.winner);
  check('exactly one winner crowned', w2.length === 1, w2.map((p) => p.name).join(',') || 'none');
  check('the winner is still shown in the ring',
    s2.live.length === 1 && w2.length === 1 && s2.live[0].token === w2[0].token,
    `ring has ${s2.live.length}`);
  h2.close(); ps2.forEach((p) => p.sk.close());
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); back.close(); players.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
