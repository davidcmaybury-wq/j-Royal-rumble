// The computer host, over real sockets: it hands the board to draw 1, reads
// what the holder calls, arms the buzzers off the end of the read, settles a
// stumper on its own, calls the ring, and picks for a holder who will not.
//
// Runs against the server's default voice, which in CI is `silent`: every
// line arrives as text with a length from the clock and no clip, and that is
// the path a box with a broken voice falls back to, so it is the one worth
// pinning. A real engine changes the sound, not the sequence.
//
// Run with the server already listening on :8080. Slow by nature — the host
// speaks at reading pace — so the settings are turned down as far as they go.
import { io } from 'socket.io-client';

const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
const until = async (fn, ms = 30000, every = 50) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(every); }
  return false;
};

let lastArm = null;
let fails = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};

const res = await fetch(`${U}/api/match`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: {
    autohost: true, pickSeconds: 4, lecternSeconds: 1, delay: 0,
    entryInterval: 1, startScore: 3000, ceiling: 9000, anonymousNext: false,
  } }),
});
const { gameId, hostKey } = await res.json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let H = null;
const resolved = [];
host.on('state', (s) => { H = s; });
host.on('resolved', (e) => resolved.push(e));
await new Promise((r) => host.emit('host-join', { gameId, hostKey }, (x) => { H = x.state; r(); }));

// Four humans, no robots: nobody buzzes unless the test does, so the first
// clue is a stumper the host has to settle by itself.
const players = [];
for (const name of ['Ada', 'Nam', 'Wayne', 'Bo']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, token: null, V: null, said: [], arms: [], shown: 0 };
  s.on('state', (v) => { p.V = v; });
  s.on('host-speaks', (m) => p.said.push({ ...m, got: Date.now() }));
  s.on('activate-buzzers', (a) => { lastArm = { ...a, got: Date.now() }; p.arms.push(lastArm); });
  s.on('clue-shown', () => { p.shown++; });
  await new Promise((r) => s.emit('join', { gameId, name }, (x) => { p.token = x.token; r(); }));
  players.push(p);
}
await wait(150);

console.log('THE BELL');
{
  const ack = await new Promise((r) => host.emit('start-match', {}, r));
  check('an autohost match starts', !!ack && !ack.error, ack?.error || 'ok');
  await until(() => H && H.phase === 'live' && H.control, 5000);
  const draw1 = (H.roster || []).find((p) => p.draw === 1) || null;
  // The host view's roster carries draw numbers; fall back to the record's
  // draw if the field is named differently in this version.
  const control = H.control;
  const holder = players.find((p) => p.token === control);
  check('draw 1 holds the board at the bell', !!holder && (!draw1 || draw1.token === control),
    holder ? `${holder.name}` : 'nobody');
  await until(() => players.every((p) => p.V && p.V.autohost), 5000);
  check('every buzzer knows the computer is hosting', players.every((p) => p.V?.autohost === true));
  await until(() => holder.said.some((m) => /You have the board/.test(m.text)), 8000);
  const hand = holder.said.find((m) => /You have the board/.test(m.text));
  check('Mike hands the board to the holder by name', !!hand && hand.host === 'mike' && hand.text.includes(holder.name),
    hand ? hand.text : 'nothing said');
  check('every player hears the same line', players.every((p) => p.said.some((m) => m.sid === hand?.sid)));
  check('a line carries its length, and no clip when the voice is silent',
    !!hand && hand.durationMs > 0 && (hand.url === null || typeof hand.url === 'string'),
    hand ? `${hand.durationMs} ms, url ${hand.url}` : '');
  await until(() => holder.V?.host?.state === 'handover', 5000);
  check('the buzzer state says whose call it is', holder.V?.host?.state === 'handover' && holder.V.control === holder.token,
    JSON.stringify(holder.V?.host));

  const other = players.find((p) => p !== holder);
  const refused = await new Promise((r) => other.s.emit('player-pick', { slot: 0, row: 1 }, r));
  check('a player who does not hold the board is refused, by name of the reason',
    !!refused?.error && /hold the board/.test(refused.error), refused?.error);
  const t0 = Date.now();
  const ok = await new Promise((r) => holder.s.emit('player-pick', { slot: 0, row: 1 }, r));
  check('the holder can call a clue by clicking it', !!ok?.ok, ok?.error || 'ok');
  // Wait for what is actually asserted. This waited for the *holder* to see the
  // clue and then asserted that *everybody* had, so whenever another client's
  // push landed a few milliseconds later the check failed and the very next one
  // passed. Roughly one run in four, on an idle machine, with nothing wrong in
  // the product. Same family as the double-evaluation flake already on record:
  // the condition waited on has to be the condition checked.
  await until(() => players.every((p) => p.shown >= 1), 3000);
  check('and the clue goes up for everybody', players.every((p) => p.shown >= 1));

  await until(() => holder.said.some((m) => m.got > t0 && /For 100/.test(m.text)), 8000);
  const cat = holder.said.find((m) => m.got > t0 && /For 100/.test(m.text));
  check('Mike announces the category and value', !!cat && cat.host === 'mike', cat?.text);
  await until(() => holder.said.filter((m) => m.got > t0).length >= 2, 15000);
  const clueLine = holder.said.filter((m) => m.got > t0)[1];
  check('then reads the clue text itself', !!clueLine && clueLine.text.length > 20, clueLine?.text?.slice(0, 50));
  await until(() => holder.arms.length >= 1, clueLine ? clueLine.durationMs + 4000 : 15000);
  const arm = holder.arms[0];
  const expected = clueLine ? clueLine.got + clueLine.durationMs : null;
  check('the buzzers arm after the read, not during it', !!arm && expected && arm.got >= expected - 50,
    arm && expected ? `${arm.got - expected} ms after the clip ended` : 'no arm');
  check('and within a beat of it', !!arm && expected && arm.got - expected < 1500,
    arm && expected ? `${arm.got - expected} ms` : '');
  check('the buzzers arm through the same message a human host sends', !!arm && typeof arm.at === 'number' && typeof arm.lockout === 'number');

  // A client says when it played the line; the console can see the spread.
  holder.s.emit('heard', { sid: clueLine.sid, lateMs: 40 });
  other.s.emit('heard', { sid: clueLine.sid, lateMs: 95 });
  other.s.emit('heard', { sid: clueLine.sid, lateMs: 999 });   // a second report is ignored
}

console.log('\nA STUMPER, SETTLED BY THE HOST');
{
  const before = resolved.length;
  await until(() => resolved.length > before, 12000);
  const e = resolved[before];
  check('with nobody on the clock, the lights run out and the host resolves it', !!e, e ? 'resolved' : 'nothing');
  const holder = players.find((p) => p.token === H.control);
  const reveal = players[0].said.find((m) => /correct response/i.test(m.text));
  check('Mike reads the correct response first', !!reveal, reveal?.text);
  check('and only after the lights ran out, never while the race was open',
    !!reveal && !!lastArm && reveal.got >= lastArm.got + 1000,
    reveal && lastArm ? `${reveal.got - lastArm.got} ms after the arm` : '');
  await until(() => players[0].said.some((m) => m.host === 'gene'), 8000);
  const gene = players[0].said.find((m) => m.host === 'gene');
  check('Gene calls the entrance the stumper caused', !!gene && /enters with/.test(gene.text), gene?.text);
  await until(() => (H.autohost?.heard || []).length >= 1, 3000);
  const row = (H.autohost?.heard || [])[0];
  check('the host view carries the playback spread per clip', !!row && row.n === 2 && row.min === 40 && row.max === 95,
    JSON.stringify(row));
  await until(() => holder && holder.said.filter((m) => /You have the board/.test(m.text)).length >= 2, 12000);
  check('control stays with the holder on a stumper, and the board is handed back',
    !!holder && holder.said.filter((m) => /You have the board/.test(m.text)).length >= 2, holder?.name);
}

console.log('\nA HOLDER WHO WILL NOT CALL, AND A CONSOLE THAT RULES');
{
  const holder = players.find((p) => p.token === H.control);
  const shownBefore = holder.shown;
  // Nobody clicks. The host nudges, then picks.
  await until(() => holder.said.some((m) => /call a clue/.test(m.text)), 10000);
  check('the holder is nudged before the host picks for them', holder.said.some((m) => /call a clue/.test(m.text)));
  await until(() => holder.shown > shownBefore, 12000);
  check('and a clue goes up without anybody clicking', holder.shown > shownBefore);
  const pickLine = holder.said.find((m) => /I'll pick one/.test(m.text));
  check("Mike says it was his pick", !!pickLine, pickLine?.text);

  // This time a player buzzes, and a human at the console rules.
  const armsBefore = holder.arms.length;
  await until(() => holder.arms.length > armsBefore, 25000);
  await wait(100);
  const buzzer = players[1];
  buzzer.s.emit('buzz', { ms: 120, status: 'good' });
  await until(() => H.race && H.race.buzzes && H.race.buzzes.length >= 1, 3000);
  check('a player can buzz on a clue the computer read', (H.race?.buzzes || []).length >= 1);
  const before = resolved.length;
  host.emit('resolve', { winnerToken: buzzer.token });
  await until(() => resolved.length > before, 5000);
  check('a console can still rule', resolved.length > before);
  await until(() => buzzer.said.some((m) => /^Correct, /.test(m.text)), 8000);
  const c = buzzer.said.find((m) => /^Correct, /.test(m.text));
  check('Mike confirms the ruling by name', !!c && c.text.includes(buzzer.name), c?.text);
  await until(() => H.control === buzzer.token, 3000);
  check('control passes to the winner', H.control === buzzer.token);
  await until(() => buzzer.said.some((m) => /You have the board/.test(m.text) && m.text.includes(buzzer.name)), 12000);
  check('and the board is handed to them next', buzzer.said.some((m) => /You have the board/.test(m.text) && m.text.includes(buzzer.name)));
}

console.log('\nWHAT THE RECORD AND THE HEALTH PAGE SAY');
{
  check('the host view reports the computer host is working', H.autohost && H.autohost.spoke > 5,
    JSON.stringify({ spoke: H.autohost?.spoke, backlog: H.autohost?.backlog }));
  check('every line so far was read from the clock, and said so', H.autohost && H.autohost.fromClock === H.autohost.spoke,
    `${H.autohost?.fromClock} of ${H.autohost?.spoke}`);
  const clip = await fetch(`${U}/clip/silent/${'0'.repeat(40)}.wav`);
  check('a clip that does not exist is a 404, not a crash', clip.status === 404);
  const bad = await fetch(`${U}/clip/piper/../../package.json`);
  check('and the clip route does not walk the filesystem', bad.status === 404 || bad.status === 400, String(bad.status));
  host.emit('end-match');
  await wait(400);
  check('ending the match stops the host', H.phase === 'over');
}

for (const p of players) p.s.close();
host.close();
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
