// Covers the host setup surface: room codes, host-key auth, material uploads
// in both formats, blend selection, and the start alert reaching players.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const api = (path, opts = {}, key) => fetch(U + path, { ...opts,
  headers: { 'content-type': 'application/json', ...(key ? { 'x-host-key': key } : {}) } });

const m = await (await api('/api/match', { method: 'POST', body: '{}' })).json();
check('room code is four letters', /^[A-Z]{4}$/.test(m.gameId), m.gameId);
check('setup url carries the host key', m.setupUrl.includes(m.hostKey));

check('setup rejects a wrong host key', (await api(`/api/match/${m.gameId}`, {}, 'nope')).status === 403);
const setup = await (await api(`/api/match/${m.gameId}`, {}, m.hostKey)).json();
check('setup reports available material', setup.available.archive > 40000 && setup.available.original > 200,
  `${setup.available.archive} archive, ${setup.available.original} original`);

// --- uploads -----------------------------------------------------------
const json = JSON.stringify({ title: 'Test board', author: 'Tester', rounds: [[{
  category: 'ROOM CODES', comments: 'four letters', clues: [200, 400, 600, 800, 1000]
    .map((v, i) => ({ value: v, text: `clue ${i + 1}`, correctResponse: `answer ${i + 1}` })) }]] });
let r = await (await api(`/api/match/${m.gameId}/material`, { method: 'POST',
  body: JSON.stringify({ name: 'board.json', content: json }) }, m.hostKey)).json();
check('j-trivia JSON upload lands', r.added === 1, `${r.added} categories`);
check('upload keeps its gimmick note',
  setup.available.upload === 0 && r.available.upload === 1);

const csv = 'Round,Value,Daily Double,Category,Response,Clue,Media\n' +
  [200, 400, 600, 800, 1000].map((v, i) =>
    `Jeopardy,${v},${i === 3 ? 'TRUE' : ''},CSV CAT,resp ${i},"clue ${i}, with a comma",`).join('\n');
r = await (await api(`/api/match/${m.gameId}/material`, { method: 'POST',
  body: JSON.stringify({ name: 'board.csv', content: csv, format: 'csv' }) }, m.hostKey)).json();
check('jparty CSV upload lands', r.available.upload === 2, `${r.added} added`);
check('both files listed', r.uploads.length === 2, r.uploads.map((u) => u.name).join(', '));

const bad = await api(`/api/match/${m.gameId}/material`, { method: 'POST',
  body: JSON.stringify({ name: 'x.json', content: '{"nope":1}' }) }, m.hostKey);
check('a wrong-shaped file is refused with a readable reason',
  bad.status === 400 && (await bad.json()).error.includes('j-trivia.org format'));

// --- blend + season range ----------------------------------------------
r = await (await api(`/api/match/${m.gameId}`, { method: 'PATCH', body: JSON.stringify({
  blend: { archive: 0, original: 1, upload: 3 }, settings: { seasonRange: [40, 41] },
}) }, m.hostKey)).json();
check('own-material-only blend saves', r.blend.archive === 0 && r.blend.upload === 3);
check('season range narrows the archive', r.available.archive < 6000, `${r.available.archive} categories`);

// --- players join by code, and hear the start --------------------------
const ps = [];
for (const name of ['One', 'Two', 'Three']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, started: null };
  s.on('rumble-starting', (d) => { p.started = d; });
  await new Promise((res) => s.emit('join', { gameId: m.gameId.toLowerCase(), name }, res));
  ps.push(p);
}
await wait(150);
const view = await (await api(`/api/match/${m.gameId}`, {}, m.hostKey)).json();
check('players join with a lowercase code', view.roster.length === 3, `${view.roster.length} in the lobby`);

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
await new Promise((res) => host.emit('watch-setup', { gameId: m.gameId, hostKey: m.hostKey }, res));
host.emit('start-match');
await wait(400);
check('every player is told the Rumble is beginning', ps.every((p) => p.started), 
  ps.filter((p) => p.started).length + ' of 3');
check('the alert carries the entry interval', ps[0].started && ps[0].started.entryInterval > 0);

const locked = await api(`/api/match/${m.gameId}`, { method: 'PATCH', body: '{"settings":{}}' }, m.hostKey);
check('settings lock once the match starts', locked.status === 409);

// --- ceiling can never sit below the entry stake -----------------------
{
  const m2 = await (await api('/api/match', { method: 'POST', body: JSON.stringify({
    settings: { startScore: 3000, ceiling: 4000, ceilingDecayPerClue: -500, ceilingFloor: 500 },
  }) })).json();
  const ps2 = [];
  for (const n of ['P1', 'P2', 'P3', 'P4']) {
    const s = io(U, { transports: ['websocket'] });
    await once(s, 'connect');
    await new Promise((r) => s.emit('join', { gameId: m2.gameId, name: n }, r));
    ps2.push(s);
  }
  const h = io(U, { transports: ['websocket'] });
  await once(h, 'connect');
  let st = null;
  h.on('state', (x) => { st = x; });
  await new Promise((r) => h.emit('host-join', { gameId: m2.gameId, hostKey: m2.hostKey }, (x) => { st = x.state; r(); }));
  h.emit('start-match');
  await wait(250);
  for (let i = 0; i < 12 && st.phase === 'live'; i++) {
    const open = [];
    st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
    h.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
    await wait(90);
    h.emit('resolve', { winnerToken: null });
    await wait(150);
  }
  check('ceiling never falls below the entry stake', st.ceiling >= 3000,
    `ceiling ${st.ceiling} after ${st.clues} clues at −500/clue`);
  h.close(); ps2.forEach((s) => s.close());
}

// --- auto entry interval is the default -------------------------------
{
  const m3 = await (await api('/api/match', { method: 'POST', body: '{}' })).json();
  const v = await (await api(`/api/match/${m3.gameId}`, {}, m3.hostKey)).json();
  check('entry interval defaults to auto', v.settings.entryInterval === null,
    String(v.settings.entryInterval));
  const ps3 = [];
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const s = io(U, { transports: ['websocket'] });
    await once(s, 'connect');
    await new Promise((r) => s.emit('join', { gameId: m3.gameId, name: n }, r));
    ps3.push(s);
  }
  const h = io(U, { transports: ['websocket'] });
  await once(h, 'connect');
  let st = null;
  h.on('state', (x) => { st = x; });
  await new Promise((r) => h.emit('host-join', { gameId: m3.gameId, hostKey: m3.hostKey }, (x) => { st = x.state; r(); }));
  h.emit('start-match');
  await wait(300);
  check('auto resolves to a real interval at start',
    st.settings.entryInterval >= 2 && st.settings.entryInterval <= 15,
    `every ${st.settings.entryInterval} clues for 6 players`);
  h.close(); ps3.forEach((s) => s.close());
}

// --- auto ceiling floor and decay -------------------------------------
{
  const m4 = await (await api('/api/match', { method: 'POST', body: JSON.stringify({
    settings: { startScore: 4000, ceiling: 12000 } }) })).json();
  const v = await (await api(`/api/match/${m4.gameId}`, {}, m4.hostKey)).json();
  check('ceiling floor defaults to auto', v.settings.ceilingFloor === null);
  check('ceiling decay defaults to auto', v.settings.ceilingDecayPerClue === null);

  const ps = [];
  for (const n of ['A','B','C','D','E','F','G','H']) {
    const s = io(U, { transports: ['websocket'] });
    await once(s, 'connect');
    await new Promise((r) => s.emit('join', { gameId: m4.gameId, name: n }, r));
    ps.push(s);
  }
  const h = io(U, { transports: ['websocket'] });
  await once(h, 'connect');
  let st = null;
  h.on('state', (x) => { st = x; });
  await new Promise((r) => h.emit('host-join', { gameId: m4.gameId, hostKey: m4.hostKey }, (x) => { st = x.state; r(); }));
  h.emit('start-match');
  await wait(300);
  check('auto floor resolves to the starting score', st.settings.ceilingFloor === 4000,
    String(st.settings.ceilingFloor));
  // Auto now holds the ceiling steady while overtime is on. The falling
  // ceiling was there to force a resolution; overtime does that job, and doing
  // both handed the match to late draws — in a 20-player field the last third
  // of the draw was worth 2.16x the first third at -40 against 1.40x at zero.
  check('auto decay holds the ceiling steady while overtime is on',
    st.settings.ceilingDecayPerClue === 0, `${st.settings.ceilingDecayPerClue}/clue`);
  check('the opening ceiling is the configured one', st.ceiling === 12000, String(st.ceiling));

  // With overtime off, nothing else ends the match, so auto must still decay.
  // Called directly rather than over a socket: the setting is only resolved
  // when a match starts, so reading it from a lobby would always see null.
  {
    const { autoCeilingDecay } = await import('../src/engine.js');
    check('with overtime off, auto still decays the ceiling',
      autoCeilingDecay(12000, 4000, 20, 4, { overtime: false }) < 0,
      `${autoCeilingDecay(12000, 4000, 20, 4, { overtime: false })}/clue`);
    check('and holds it steady with overtime on',
      autoCeilingDecay(12000, 4000, 20, 4, { overtime: true }) === 0);
  }

  // Play far enough that a decaying ceiling would have gone under the stake.
  for (let i = 0; i < 25 && st.phase === 'live'; i++) {
    const open = [];
    st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
    if (!open.length) break;
    h.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
    await wait(80);
    h.emit('resolve', { winnerToken: null });
    await wait(130);
  }
  check('the ceiling never dips below the entry stake', st.ceiling >= 4000,
    `${st.ceiling} after ${st.clues} clues`);
  h.close(); ps.forEach((s) => s.close());
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
