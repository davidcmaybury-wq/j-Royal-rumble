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
import { matchPick } from '../src/pick-match.js';

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

console.log('\nTHE HOST LISTENS, AND RULES WITHOUT A CONSOLE');
{
  // Each player's "browser": the server opens a window, the page answers with
  // text. Nothing here is audio — that is the whole point of the design.
  for (const p of players) {
    p.windows = [];
    p.s.on('listen', (w) => { p.windows.push(w); p.live = w.close || !w.ms ? null : w; });
  }

  // Get to a fresh clue with somebody holding the board.
  await until(() => H.control && !H.clue, 20000);
  const holder = players.find((p) => p.token === H.control);
  await until(() => holder && holder.live && holder.live.kind === 'pick', 15000);
  const pickWin = holder.live;
  check('the board-holder\'s microphone opens for the pick', !!pickWin, JSON.stringify(pickWin));
  check('and only theirs', players.filter((p) => p.live).length === 1,
    String(players.filter((p) => p.live).length));

  // The board is real, drawn content, not a fixture — six arbitrary category
  // titles. matchPick refuses a tie deliberately (a spoken title that sounds
  // like two categories at once must not be guessed at), and with six real
  // titles drawn from a library of tens of thousands, one occasionally does
  // tie against a sibling on the same board purely by chance of the draw —
  // "I'M AMEN-ABLE TO THAT" tied "EMMY TIME" here once. That is matchPick
  // working, not a bug, and the fix belongs in the test: verify the utterance
  // this section is about to speak actually resolves before relying on it,
  // the same way `test/bots.mjs` learned not to bet on which of three robots
  // takes a clue.
  let cat, openRow, spoken;
  for (const candidate of H.board || []) {
    const row = (candidate.clues || []).find((c) => !c.revealed);
    if (!row) continue;
    const say = `${candidate.title} for ${[100, 200, 300, 400, 500][row.row - 1]}`;
    const probe = matchPick(say, H.board, { multiplier: H.overtime?.multiplier || 1 });
    if (probe.slot != null && probe.row === row.row && !probe.taken) {
      cat = candidate; openRow = row; spoken = say; break;
    }
  }
  check('at least one open category resolves unambiguously when spoken verbatim',
    !!spoken, JSON.stringify((H.board || []).map((c) => c.title)));
  const bad = await new Promise((r) => players.find((p) => p !== holder).s
    .emit('pick-heard', { sid: pickWin.sid, alternatives: ['presidents for 400'] }, r));
  check('somebody else speaking into that window is refused', !!bad?.error, bad?.error);
  const nonsense = await new Promise((r) => holder.s
    .emit('pick-heard', { sid: pickWin.sid, alternatives: ['aardvarks for a million'] }, r));
  check('a call that matches nothing is refused with a reason, not guessed',
    nonsense && nonsense.ok === false && /did not sound like|dollar value/.test(nonsense.why), nonsense?.why);
  await until(() => holder.said.some((m) => /Which category|category and the amount|For how much/.test(m.text)), 8000);
  check('and the host asks for it again out loud',
    holder.said.some((m) => /Which category|category and the amount|For how much/.test(m.text)));

  const ok = await new Promise((r) => holder.s.emit('pick-heard', { sid: pickWin.sid, alternatives: [spoken] }, r));
  check('a spoken call puts the clue up', !!ok?.ok, JSON.stringify(ok));
  await until(() => H.clue, 4000);
  check('the right one', H.clue && H.clue.category === cat.title, H.clue?.category);
  check('and the pick window is closed behind it',
    holder.windows.some((w) => w.close || !w.ms), 'closed');

  // Now the race, and an answer.
  await until(() => holder.arms.length > 0 && H.race?.open, 30000);
  await wait(120);
  const answerer = players[2];
  answerer.s.emit('buzz', { ms: 130, status: 'good' });
  await until(() => answerer.live && answerer.live.kind === 'answer', 6000);
  const win = answerer.live;
  check('the buzz winner\'s microphone opens', !!win && win.ms > 0, JSON.stringify(win));
  check('nobody else\'s does', players.filter((p) => p.live).length === 1);
  await until(() => answerer.said.some((m) => m.text === answerer.name + '.'), 6000);
  check('and the host says their name', answerer.said.some((m) => m.text === answerer.name + '.'));

  const stale = await new Promise((r) => answerer.s.emit('answer-heard', { sid: win.sid - 1, text: 'anything' }, r));
  check('a transcript from a window that has closed is refused',
    !!stale?.error && /closed/.test(stale.error), stale?.error);
  const notYours = await new Promise((r) => players[1].s.emit('answer-heard', { sid: win.sid, text: 'anything' }, r));
  check('and so is one from somebody not on the clock', !!notYours?.error, notYours?.error);

  const answer = H.clue.answer;
  const before = resolved.length;
  const sent = await new Promise((r) => answerer.s.emit('answer-heard', { sid: win.sid, text: answer }, r));
  check('the right answer is accepted', !!sent?.ok, JSON.stringify(sent));
  await until(() => resolved.length > before, 12000);
  check('and settles the clue with no console involved', resolved.length > before);
  await until(() => answerer.said.some((m) => new RegExp('^Correct, ' + answerer.name).test(m.text)), 10000);
  check('the host confirms it by name',
    answerer.said.some((m) => new RegExp('^Correct, ' + answerer.name).test(m.text)));
  await until(() => H.control === answerer.token, 4000);
  check('control passes to whoever answered', H.control === answerer.token,
    `${(H.roster || []).find((x) => x.token === H.control)?.name} has it`);
  check('the ruling is on the host view, with how it was decided',
    (H.autohost?.transcripts || []).some((r) => r.kind === 'answer' && r.verdict === 'correct' && r.via),
    JSON.stringify((H.autohost?.transcripts || []).slice(-1)));
}

console.log('\nAN ANSWER THAT IS NOT THE ANSWER');
{
  // Whoever has the board now, and their next open window — the pick clock is
  // short in this suite, so the host may already have picked once while the
  // section above was running.
  await until(() => H.control && !H.clue, 25000);
  const holder = players.find((p) => p.token === H.control) || players[0];
  const got = await until(() => holder.live && holder.live.kind === 'pick', 25000);
  if (got) {
    // Same unlucky-draw risk as the section above: verify before speaking.
    let say = null;
    for (const candidate of H.board || []) {
      const row = (candidate.clues || []).find((c) => !c.revealed);
      if (!row) continue;
      const s2 = `${candidate.title} for ${[100, 200, 300, 400, 500][row.row - 1]}`;
      const probe = matchPick(s2, H.board, { multiplier: H.overtime?.multiplier || 1 });
      if (probe.slot != null && probe.row === row.row && !probe.taken) { say = s2; break; }
    }
    await new Promise((r) => holder.s.emit('pick-heard',
      { sid: holder.live.sid, alternatives: [say || 'nothing on the board resolves'] }, r));
  }
  await until(() => H.clue, 25000);
  await until(() => holder.arms.length > 0 && H.race?.open, 30000);
  await wait(120);
  const inRing = new Set((H.live || []).map((x) => x.token));
  const misser = players.find((p) => inRing.has(p.token)) || players[0];
  misser.s.emit('buzz', { ms: 140, status: 'good' });
  await until(() => misser.live && misser.live.kind === 'answer', 8000);
  const win = misser.live;
  const lockedBefore = (H.race?.lockedOut || []).length;
  await new Promise((r) => misser.s.emit('answer-heard', { sid: win.sid, text: 'a completely different thing' }, r));
  await until(() => (H.race?.lockedOut || []).length > lockedBefore, 12000);
  check('a wrong answer locks that player out and reopens the race',
    (H.race?.lockedOut || []).length > lockedBefore && H.race?.open === true,
    `${(H.race?.lockedOut || []).length} locked, open=${H.race?.open}`);
  // Both the ruling and the rule it drives want to announce the miss; one of
  // them is told to stay quiet (`suppressWrongLine`) so the room hears it once.
  const misslines = misser.said.filter((m) => /did not catch|^No, |could not rule/.test(m.text));
  check('and the host says so once, not twice', misslines.length === 1,
    misslines.map((m) => m.text).join(' / '));
  check('the clue is still up for whoever is left', !!H.clue);
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
  const h = await (await fetch(`${U}/api/health`)).json();
  check('health reports the judge and the mode it is in',
    !!h.judge && typeof h.judge.configured === 'boolean', JSON.stringify(h.judge || null));
  check('and how the rulings were reached', h.judge.asked > 0 && !!h.judge.verdicts,
    JSON.stringify(h.judge?.verdicts));
  host.emit('end-match');
  await wait(400);
  check('ending the match stops the host', H.phase === 'over');
}

for (const p of players) p.s.close();
host.close();
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
