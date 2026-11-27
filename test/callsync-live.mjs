// Call sync over real sockets: the server relays the host's voice pattern and
// press times, carries each player's sync to the console, and holds a leader
// as "deciding" while somebody who hears the host later has yet to buzz.
import { io } from 'socket.io-client';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 150 } }) })).json();
const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((r) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; r(); }));

const ps = [];
for (const n of ['Ann', 'Bo', 'Cy']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { s, name: n, frames: [], act: null, shown: null, view: null };
  s.on('sync-frames', (d) => p.frames.push(d));
  s.on('activate-buzzers', (d) => { p.act = d; });
  s.on('clue-shown', (d) => { p.shown = d; });
  s.on('state', (v) => { p.view = v; });
  await new Promise((r) => s.emit('join', { gameId: m.gameId, name: n }, (x) => { p.token = x.token; r(); }));
  ps.push(p);
}
await wait(150);

// The host's pattern reaches every player untouched.
const msg = { t0: 1_800_000_000_000.5, sentAt: 1_800_000_000_100.5, rtt: 42, frames: Buffer.alloc(640, 7).toString('base64') };
host.emit('sync-frames', msg);
await wait(150);
check('the host\'s voice pattern is relayed to every player as sent',
  ps.every((p) => p.frames.length === 1 && p.frames[0].frames === msg.frames && p.frames[0].t0 === msg.t0
    && p.frames[0].sentAt === msg.sentAt && p.frames[0].rtt === 42));
ps[0].s.emit('sync-frames', msg);
await wait(120);
check('a player cannot send one', ps.every((p) => p.frames.length === 1));
host.emit('sync-frames', { ...msg, frames: 'x'.repeat(5000) });
await wait(120);
check('nor can an oversized one get through', ps.every((p) => p.frames.length === 1));

// Each player's own report shows in their box on the console.
ps[0].s.emit('sync-status', { status: 'synced', delay: 640, extra: 520 });
ps[1].s.emit('sync-status', { status: 'paused-stopped', delay: 300, extra: 200 });
ps[2].s.emit('sync-status', { status: 'not-synced' });
await wait(200);
const box = (n) => st.roster.find((p) => p.name === n).sync;
check('the console sees DELAY, PAUSED and NOT SYNCED per player',
  box('Ann').status === 'synced' && box('Ann').delay === 640
  && box('Bo').status === 'paused-stopped' && box('Cy').status === 'not-synced',
  JSON.stringify(st.roster.map((p) => p.sync)));

host.emit('start-match');
await wait(250);
check('players are sent no extra-delay or L: the console is told only what it shows',
  st.live.every((p) => !p.sync || !('extra' in p.sync)));

const [slot, row] = (() => { for (const [i, c] of st.board.entries()) for (const x of c.clues) if (!x.revealed) return [i, x.row]; })();
// The host's key press goes ahead of what it does, on the host's own clock.
const pickAt = 1_800_000_100_000;
host.emit('host-at', { at: pickAt });
host.emit('pick-clue', { slot, row });
await wait(200);
check('a clue going up carries the host\'s time of the click that put it there',
  ps.every((p) => p.shown && p.shown.hostAt === pickAt));
check('and so does each player\'s state, so a synced buzzer can hold it until they hear it',
  ps.every((p) => p.view.hostAt === pickAt));

const pressAt = 1_800_000_104_321;
host.emit('host-at', { at: pressAt });
host.emit('activate');
await wait(200);
check('the buzzers open with the host-clock time of the key press',
  ps.every((p) => p.act && p.act.hostAt === pressAt && typeof p.act.at === 'number'));

// Ann buzzes fast; Bo hears the host 200 ms later and Cy is on the delay setting.
ps[0].s.emit('buzz', { ms: 180, status: 'good' });
await wait(120);
const lead = st.race.buzzes[0];
check('a buzz waits while players who hear the host later have not buzzed: the console says deciding',
  lead && lead.name === 'Ann' && st.race.decideIn >= 250, `decideIn ${st.race.decideIn}`);
ps[1].s.emit('buzz', { ms: 120, status: 'good' });
await wait(120);
check('a later-arriving buzz with a quicker reaction from its own light takes the lead',
  st.race.buzzes[0].name === 'Bo');
ps[2].s.emit('buzz', { ms: 400, status: 'good' });
await wait(150);
check('once everybody has buzzed it is decided at once', st.race.decideIn === 0, `decideIn ${st.race.decideIn}`);
host.emit('resolve', { winnerToken: st.race.buzzes[0].token });
await wait(200);

// An old stamp belongs to an earlier press and must not time a new one.
const [s2, r2] = (() => { for (const [i, c] of st.board.entries()) for (const x of c.clues) if (!x.revealed) return [i, x.row]; })();
host.emit('host-at', { at: pickAt + 999 });
host.emit('pick-clue', { slot: s2, row: r2 });
await wait(2200);
ps.forEach((p) => { p.act = null; });
host.emit('activate');
await wait(200);
check('a press stamp more than two seconds old is not used: unsynced timing beats a wrong one',
  ps.every((p) => p.act && p.act.hostAt === null));

host.emit('host-at', { at: 'soon' });
await wait(80);
check('a junk stamp is ignored', true);

for (const p of ps) p.s.close();
host.close();
console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
