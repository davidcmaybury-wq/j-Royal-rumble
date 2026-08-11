// Undo, manual corrections, score history, and the match recording.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 4, startScore: 3000, recordMatch: true, delay: 0 } }) })).json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const name of ['Ann', 'Bo', 'Cy', 'Di']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, token: null };
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(150);
host.emit('start-match');
await wait(250);
check('recording is on', st.recording === true);
// The history is only pushed at the end of a match — sending every point of
// it on every state change was most of the traffic.
check('history starts at clue zero', st.historyLength === 1, String(st.historyLength));
check('nothing to undo yet', st.canUndo === false);

const play = async (winnerIdx) => {
  const open = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(90);
  host.emit('activate');
  await wait(120);
  const live = st.live.map((p) => p.token);
  if (winnerIdx != null) {
    const tok = live[winnerIdx % live.length];
    ps.find((p) => p.token === tok)?.s.emit('buzz', { ms: 400 + Math.random() * 300, status: 'good' });
    await wait(120);
    host.emit('resolve', { winnerToken: st.race.buzzes[0]?.token ?? null });
  } else {
    host.emit('resolve', { winnerToken: null });
  }
  await wait(180);
};

await play(0);
check('history grows with the match', st.historyLength === 2, `${st.historyLength} points`);
check('undo is now available', st.canUndo === true);

const scoresAfterOne = Object.fromEntries(st.live.map((p) => [p.token, p.score]));
const cluesAfterOne = st.clues;
await play(1);
check('a second clue is recorded', st.clues === cluesAfterOne + 1);

// --- undo ----------------------------------------------------------------
host.emit('undo-clue');
await wait(250);
check('undo rewinds the clue counter', st.clues === cluesAfterOne, `${st.clues}`);
check('undo restores every score',
  st.live.every((p) => p.score === scoresAfterOne[p.token]),
  st.live.map((p) => `${p.name} ${p.score}`).join(', '));
check('undo trims the history', st.historyLength === 2, `${st.historyLength}`);
check('undo is logged as a correction', st.corrections === 1, `${st.corrections}`);
check('the board reopens the clue', st.board.flatMap((c) => c.clues).filter((c) => c.revealed).length === cluesAfterOne);

// --- manual correction ---------------------------------------------------
const target = st.live[0];
const was = target.score;
host.emit('adjust-score', { token: target.token, delta: -250, reason: 'wrong value read' });
await wait(200);
const now = st.live.find((p) => p.token === target.token);
check('a manual correction moves the score', now.score === was - 250, `${was} → ${now.score}`);
check('the correction is counted', st.corrections === 2);

host.emit('adjust-score', { token: target.token, delta: 250 });
await wait(200);
check('corrections work both ways',
  st.live.find((p) => p.token === target.token).score === was);

// --- play out and download ----------------------------------------------
for (let i = 0; i < 8 && st.phase === 'live'; i++) await play(i % 2 === 0 ? 0 : null);
host.emit('end-match');
await wait(300);

const res = await fetch(`${U}/api/match/${m.gameId}/record?key=${encodeURIComponent(m.hostKey)}`);
check('the record downloads', res.ok, `HTTP ${res.status}`);
const rec = await res.json();
check('it names the version and settings', !!rec.version && !!rec.settings);
check('it has a row per clue', rec.clues.length === st.clues, `${rec.clues.length} of ${st.clues}`);
check('clues carry buzz times', rec.clues.some((c) => c.buzzes.length && c.buzzes[0].ms > 0));
check('clues carry before and after scores',
  rec.clues.every((c) => c.scoresBefore && c.scoresAfter));
check('clues carry their source and category',
  rec.clues.every((c) => c.category) && rec.clues.some((c) => c.source));
check('it compares the estimate with reality',
  rec.estimateError && typeof rec.estimateError.minutesOffBy === 'number',
  `predicted ${rec.estimateError.cluesPredicted} clues, played ${rec.estimateError.cluesActual}`);
check('it reports the real seconds per clue',
  rec.actual.secondsPerClue > 0, `${rec.actual.secondsPerClue}s`);
check('it keeps the corrections', rec.corrections.length === 3,
  rec.corrections.map((c) => c.type).join(','));
check('it tracks the field over time', rec.fieldOverTime.length === rec.history.length);
check('it records connection latency', !!rec.latency && 'byPlayer' in rec.latency,
  rec.latency && rec.latency.overall ? 'median ' + rec.latency.overall.median + 'ms' : 'no samples yet');
check('buzzes carry the latency they arrived over',
  rec.clues.some((c) => c.buzzes.some((b) => 'latency' in b)));
check('it counts anticipated buzzes', !!rec.anticipation,
  rec.anticipation ? rec.anticipation.under150ms + ' of ' + rec.anticipation.buzzes + ' under 150ms' : '');
check('it reports a median pace as well as a mean',
  rec.actual.secondsPerClueMedian > 0,
  `mean ${rec.actual.secondsPerClue}s, median ${rec.actual.secondsPerClueMedian}s`);
check('it carries the standings', (rec.standings || []).length >= 4);

const noKey = await fetch(`${U}/api/match/${m.gameId}/record`);
check('the record needs the host key', noKey.status === 403, `HTTP ${noKey.status}`);

// an unrecorded match offers nothing
const m2 = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const none = await fetch(`${U}/api/match/${m2.gameId}/record?key=${encodeURIComponent(m2.hostKey)}`);
check('an unrecorded match has no record', none.status === 404);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
