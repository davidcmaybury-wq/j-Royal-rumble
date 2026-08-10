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

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close(); ps.forEach((p) => p.s.close());
process.exit(fails ? 1 : 0);
