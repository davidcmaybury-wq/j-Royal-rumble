// Arcade mode: the room sees the order, each player sees their own clock.
//
// With the comeback on, buzz order is ms x buzzEdge, so a player on the way back
// from a near-elimination can hold first place with a slower press. Publishing
// the times then contradicts the highlight, which is exactly how it was reported
// from a live match: "Zach actually was fastest but Dalton was highlighted as
// the first person in."
//
// So in Arcade the public surfaces carry places and no times at all. A player
// still gets their own number through myBuzz, because their own timing is the
// thing they practise against. In Tournament the comeback is off, buzzEdge is
// always 1, order is speed, and the times mean what they say — so they stay.
//
// This is the same shape of guard as test/watch.mjs: the times must be absent
// from the payload, not merely unrendered. A screen that is handed a number it
// is trusted not to draw is one refactor away from drawing it.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

async function play(settings) {
  const m = await (await fetch(`${U}/api/match`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { entryInterval: 99, delay: 0, ...settings } }) })).json();

  const host = io(U, { transports: ['websocket'] });
  await once(host, 'connect');
  let hostState = null;
  host.on('state', (s) => { hostState = s; });
  await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey },
    (x) => { hostState = x.state; r(); }));

  // A watch screen, which is what the room actually looks at.
  const watcher = io(U, { transports: ['websocket'] });
  await once(watcher, 'connect');
  let watchState = null;
  watcher.on('state', (s) => { watchState = s; });
  // The ack carries the first state; later pushes replace it.
  await new Promise((r) => watcher.emit('watch-game', { gameId: m.gameId },
    (x) => { watchState = x?.state ?? watchState; r(); }));

  const ps = [];
  for (const n of ['A', 'B', 'C']) {
    const s = io(U, { transports: ['websocket'] });
    await once(s, 'connect');
    const p = { s, name: n };
    s.on('state', (v) => { p.view = v; });
    await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n },
      (x) => { p.token = x.token; r(); }));
    ps.push(p);
  }
  await wait(200);
  host.emit('start-match');
  await wait(300);

  const open = [];
  hostState.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
  host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
  await wait(120);
  host.emit('activate');
  await wait(150);
  // Two different times, so a place is distinguishable from a time.
  ps[0].s.emit('buzz', { ms: 240 });
  ps[1].s.emit('buzz', { ms: 120 });
  await wait(350);

  return { m, host, watcher, ps, hostState, watchState, close() {
    host.close(); watcher.close(); ps.forEach((p) => p.s.close());
  } };
}

console.log('ARCADE — the comeback is on');
{
  const r = await play({ comeback: true });
  const hb = (r.hostState.race || {}).buzzes || [];
  const wb = ((r.watchState || {}).race || {}).buzzes || [];

  check('the host view says the match is arcade', r.hostState.arcade === true,
    String(r.hostState.arcade));
  check('and so does the watch view', (r.watchState || {}).arcade === true,
    String((r.watchState || {}).arcade));

  check('the console gets places', hb.length >= 2 && hb.every((b) => typeof b.place === 'number'),
    JSON.stringify(hb.map((b) => b.place)));
  check('and no times at all', hb.every((b) => b.ms === undefined),
    JSON.stringify(hb.map((b) => b.ms)));
  check('the places run 1, 2, ...', hb.map((b) => b.place).join(',') === hb.map((_, i) => i + 1).join(','),
    hb.map((b) => b.place).join(','));

  check('the watch screen gets places', wb.length >= 2 && wb.every((b) => typeof b.place === 'number'),
    JSON.stringify(wb.map((b) => b.place)));
  check('and no times either', wb.every((b) => b.ms === undefined),
    JSON.stringify(wb.map((b) => b.ms)));

  // The one number a player is still entitled to: their own.
  const mine = r.ps.map((p) => (p.view || {}).myBuzz).filter(Boolean);
  check('a player still gets their own time', mine.length >= 2 && mine.every((b) => typeof b.ms === 'number'),
    JSON.stringify(mine.map((b) => b.ms)));
  check('and their own place with it', mine.every((b) => typeof b.place === 'number'),
    JSON.stringify(mine.map((b) => b.place)));

  // Nobody's buzzer may carry somebody else's clock.
  const leaked = r.ps.filter((p) => JSON.stringify(p.view || {}).includes('"ms":240')
    && (p.view.myBuzz || {}).ms !== 240);
  check('and never anybody else\'s', leaked.length === 0,
    leaked.map((p) => p.name).join(', ') || 'no leaks');

  r.close();
}

console.log('\nTOURNAMENT — the comeback is off');
{
  const r = await play({ comeback: false });
  const hb = (r.hostState.race || {}).buzzes || [];
  const wb = ((r.watchState || {}).race || {}).buzzes || [];

  check('the views say tournament', r.hostState.arcade === false
    && (r.watchState || {}).arcade === false,
    `host ${r.hostState.arcade}, watch ${(r.watchState || {}).arcade}`);
  check('the console keeps the times', hb.length >= 2 && hb.every((b) => typeof b.ms === 'number'),
    JSON.stringify(hb.map((b) => b.ms)));
  check('and so does the watch screen', wb.length >= 2 && wb.every((b) => typeof b.ms === 'number'),
    JSON.stringify(wb.map((b) => b.ms)));
  check('the fastest press is first, because that is all ordering means here',
    hb[0] && hb[0].ms === Math.min(...hb.map((b) => b.ms)), JSON.stringify(hb.map((b) => b.ms)));

  r.close();
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
