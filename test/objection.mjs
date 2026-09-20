// The room overruling the host, over real sockets.
//
// The computer host will be wrong sometimes — that is the whole reason this
// exists — so what matters is not that a reversal happens but that every
// *shape* of reversal leaves the game in a state the rules can describe. There
// are four outcomes and this suite drives all of them: the objection that
// lapses, the clean reversal, the walk-back through the snapshot, and the
// ambiguous one the room settles with a vote.
//
// Runs against the silent voice, like `autohost.mjs`, so every line arrives as
// text with a length from the clock. Slow by nature: the host speaks at reading
// pace and a stumper has to wait out the lights.
//
// Needs the server listening on :8080 with a judge configured — CI uses
// RUMBLE_JUDGE=local, which rules on overlap and never says "wrong", so every
// miss below is an `unclear`. That is the miss the room is most likely to
// object to in real play, which makes it the right one to test with.
import { io } from 'socket.io-client';

const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
const until = async (fn, ms = 30000, every = 40) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(every); }
  return false;
};

let fails = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};

// lecternSeconds is 3 rather than 1: a clean reversal has to be cast while the
// reopened race is still running, and a one-second lectern turns every miss
// into a stumper before a test can press anything.
const res = await fetch(`${U}/api/match`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: {
    autohost: true, pickSeconds: 30, lecternSeconds: 3, delay: 0,
    entryInterval: 999, startScore: 3000, ceiling: 9000, anonymousNext: false,
    comeback: false, revival: false,
  } }),
});
const { gameId, hostKey } = await res.json();

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let H = null;
host.on('state', (s) => { H = s; });
await new Promise((r) => host.emit('host-join', { gameId, hostKey }, (x) => { H = x.state; r(); }));

// Five people: three in the ring and two on the bench. A bench player can
// object — the design is explicit that the crowd polices the host too — and
// with five in the match a majority is three while two-thirds of a ring of
// three is two, so the two thresholds are genuinely different numbers here.
const players = [];
for (const name of ['Ada', 'Nam', 'Wayne', 'Bo', 'Cy']) {
  const s = io(U, { transports: ['websocket'] });
  await once(s, 'connect');
  const p = { name, s, token: null, V: null, said: [], windows: [], live: null };
  s.on('state', (v) => { p.V = v; });
  s.on('host-speaks', (m) => p.said.push(m));
  s.on('listen', (w) => { p.windows.push(w); p.live = w.close || !w.ms ? null : w; });
  await new Promise((r) => s.emit('join', { gameId, name }, (x) => { p.token = x.token; r(); }));
  players.push(p);
}
await wait(150);
await new Promise((r) => host.emit('start-match', {}, r));
await until(() => H && H.phase === 'live' && H.control, 8000);

const byToken = (t) => players.find((p) => p.token === t);
// The host view keeps the ring in `live` and the eliminated in `out`; `roster`
// is the connection list and carries no score.
const ring = () => (H.live || []).map((r) => r.token);
const inRing = (p) => ring().includes(p.token);
const scoreOf = (p) => [...(H.live || []), ...(H.out || [])]
  .find((r) => r.token === p.token)?.score ?? null;
const clueCount = () => H.clues ?? null;
const missedBy = (p) => [...(H.live || []), ...(H.out || [])]
  .find((r) => r.token === p.token)?.missed ?? null;
// One player's feed, not everybody's: each line reaches all five buzzers, so
// flattening the room counts five of every sentence the host ever said.
const heardAll = () => players[0].said.map((m) => m.text);

/** Get to a fresh clue: wait for the handover, then click one off the board. */
async function newClue() {
  const ok = await until(() => H.control && !H.clue && H.phase === 'live', 40000);
  if (!ok) throw new Error('no handover');
  const holder = byToken(H.control);
  const cell = (() => {
    for (let slot = 0; slot < (H.board || []).length; slot++) {
      const c = H.board[slot].clues.find((x) => !x.revealed);
      if (c) return { slot, row: c.row };
    }
    return null;
  })();
  if (!cell) throw new Error('board is empty');
  await until(() => holder.live && holder.live.kind === 'pick', 20000);
  await new Promise((r) => holder.s.emit('player-pick', cell, r));
  await until(() => H.clue && H.race?.open, 30000);
  return { holder, ...cell };
}

/** One player buzzes in and says something; returns once the host has ruled. */
async function answer(p, text) {
  p.windows.length = 0;
  p.s.emit('buzz', { ms: 120 + Math.random() * 40, status: 'good' });
  const got = await until(() => p.live && p.live.kind === 'answer', 15000);
  if (!got) throw new Error(`${p.name} never got the microphone`);
  await new Promise((r) => p.s.emit('answer-heard', { sid: p.live.sid, text }, r));
}

const object = (p) => new Promise((r) => p.s.emit('object', {}, r));
const voteAward = (p, to) => new Promise((r) => p.s.emit('award-vote', { to }, r));
const objectionOf = (p) => p.V?.host?.objection || null;
// The host's lines are queued and played in order, so a line is asserted only
// after waiting for it: checking the instant an objection lands measures the
// queue rather than the behavior.
const spoken = async (re, ms = 20000) => until(() => heardAll().some((t) => re.test(t)), ms);
const spokenTimes = (re) => heardAll().filter((t) => re.test(t)).length;

// ---------------------------------------------------------------------------

console.log('AN OBJECTION NOBODY JOINS');
{
  const { holder } = await newClue();
  const misser = players.find((p) => inRing(p));
  await answer(misser, 'something that is not the answer at all');
  await until(() => (H.race?.lockedOut || []).length > 0, 15000);
  const before = scoreOf(misser);

  const first = await object(misser);
  check('the player who was ruled against can object to their own ruling',
    first?.ok === true && first.votes === 1, JSON.stringify(first));
  await spoken(/Objection on the last ruling/, 15000);
  check('and the host says so out loud, once, so the room knows to join',
    spokenTimes(/Objection on the last ruling/) === 1,
    `${spokenTimes(/Objection on the last ruling/)} times`);
  const again = await object(misser);
  check('a second press from the same player is not a second vote',
    again?.ok === true && again.votes === 1 && again.already === true, JSON.stringify(again));

  await until(() => objectionOf(misser), 5000);
  const view = objectionOf(misser);
  check('every buzzer sees the count and what it would take',
    !!view && view.votes === 1 && view.needAll === 3 && view.needRing === 2,
    JSON.stringify(view));
  check('and a player can see their own O is in', view?.mine === true);
  check('somebody else sees the same count without having voted',
    objectionOf(players.find((p) => p !== misser))?.mine === false);

  // Let the clue run out and the next ruling land: the window is a clue cycle.
  await until(() => !H.clue, 25000);
  // The ruling standing means the miss was paid for, which happens when the
  // clue resolves rather than when the host says no — so what "unchanged" is
  // measured against is the settled score, not the score mid-clue.
  const settled = scoreOf(misser);
  const missesBefore = missedBy(misser);
  check('the miss cost them the clue, as a standing ruling should',
    settled < before, `${before} -> ${settled}`);
  await newClue();
  const taker = players.find((p) => inRing(p) && p !== misser) || misser;
  await answer(taker, H.clue.answer);
  await until(() => !H.clue, 20000);

  // Their score moves again on the next clue — they pay whoever took it — so
  // what says the ruling stood is their miss count, which a reversal would
  // have walked back along with everything else.
  check('the objection is closed once another ruling has been made',
    objectionOf(misser) === null);
  check('and the ruling stands: the miss is still on their record',
    missedBy(misser) === missesBefore, `${missesBefore} -> ${missedBy(misser)}`);
}

console.log('\nTWO THIRDS OF THE RING IS ENOUGH, AND THE CLUE IS STILL OPEN');
{
  await newClue();
  const misser = players.find((p) => inRing(p));
  const value = H.clue.value;
  await answer(misser, 'not it');
  await until(() => (H.race?.lockedOut || []).includes(misser.token), 15000);
  check('the ruling locked them out and reopened the race', H.race?.open === true);
  const before = scoreOf(misser);

  await object(misser);
  const second = players.find((p) => inRing(p) && p !== misser);
  const met = await object(second);
  check('two of a ring of three meets the supermajority', met?.met === true, JSON.stringify(met));

  await until(() => !H.clue, 20000);
  check('the clue is settled rather than left open', !H.clue);
  check('and it was settled in favor of the player who objected',
    scoreOf(misser) > before, `${before} -> ${scoreOf(misser)}`);
  check('by the clue\'s own value, not some other number',
    scoreOf(misser) - before === value * (players.filter((p) => inRing(p)).length - 1),
    `+${scoreOf(misser) - before} on a ${value} clue`);
  await spoken(/room overrules me/i);
  check('and the host says the room overruled it', spokenTimes(/room overrules me/i) >= 1);
  check('board control went with the reversal', H.control === misser.token);
}

console.log('\nA STUMPER WITH ONE ANSWER IS WALKED BACK THROUGH THE SNAPSHOT');
{
  await newClue();
  const misser = players.find((p) => inRing(p));
  const value = H.clue.value;
  await answer(misser, 'no idea');
  // Let the reopened race run out: nobody else buzzes, so it ends as a stumper
  // and the clue is resolved with no winner. The objection window is still open
  // — a stumper reveal is the engine, not a ruling, so it does not close it.
  await until(() => !H.clue, 25000);
  const clues = clueCount();
  const before = scoreOf(misser);
  check('the clue ended as a stumper with the miss standing',
    before < 3000, `${before}`);

  await object(misser);
  const met = await object(players.find((p) => inRing(p) && p !== misser));
  check('the room can still object after the clue has ended', met?.met === true);
  await until(() => scoreOf(misser) > before, 25000);
  check('the walk-back undoes the stumper and pays the objected player',
    scoreOf(misser) > before, `${before} -> ${scoreOf(misser)}`);
  check('and the clue counted exactly once, not twice',
    clues == null || clueCount() === clues,
    `${clues} -> ${H.clues ?? H.game?.cluesRevealed}`);
}

console.log('\nTWO PLAYERS ANSWERED, SO THE ROOM IS ASKED WHICH');
{
  await newClue();
  const a = players.find((p) => inRing(p));
  const b = players.find((p) => inRing(p) && p !== a);
  await answer(a, 'the first wrong thing');
  await until(() => (H.race?.lockedOut || []).includes(a.token), 15000);
  await answer(b, 'the second wrong thing');
  await until(() => !H.clue, 25000);
  const beforeA = scoreOf(a), beforeB = scoreOf(b);

  await object(a);
  await object(b);
  await until(() => a.V?.host?.award, 8000);
  const pop = a.V?.host?.award;
  check('an ambiguous reversal opens the award vote on every buzzer',
    !!pop && pop.candidates.length === 2, JSON.stringify(pop?.candidates));
  check('and each candidate is listed with what the room heard them say',
    !!pop && pop.candidates.every((c) => c.text) &&
    pop.candidates.some((c) => /first wrong thing/.test(c.text)),
    (pop?.candidates || []).map((c) => `${c.name}: ${c.text}`).join(' / '));
  check('a vote for somebody who never answered is refused',
    (await voteAward(a, players.find((p) => !inRing(p)).token))?.error === 'not a candidate');

  for (const v of [a, b, players.find((p) => inRing(p) && p !== a && p !== b)].filter(Boolean)) {
    await voteAward(v, a.token);
  }
  await until(() => !a.V?.host?.award && scoreOf(a) > beforeA, 25000);
  check('the plurality winner is paid', scoreOf(a) > beforeA, `${beforeA} -> ${scoreOf(a)}`);
  check('and the other answerer is still charged for their miss',
    scoreOf(b) <= beforeB, `${beforeB} -> ${scoreOf(b)}`);
  await spoken(new RegExp(`room gives it to ${a.name}`));
  check('the host says who the room gave it to',
    spokenTimes(new RegExp(`room gives it to ${a.name}`)) >= 1);
}

console.log('\nA ROOM THAT CANNOT AGREE THROWS THE CLUE OUT');
{
  // Captured before the clue is read, because that is the state a thrown-out
  // clue has to leave behind: it is not "no change since the ruling", it is
  // "this clue never happened".
  await until(() => H.control && !H.clue && H.phase === 'live', 40000);
  const holderBefore = H.control;
  const clues = clueCount();
  const scores = Object.fromEntries(players.map((p) => [p.name, scoreOf(p)]));
  await newClue();
  const a = players.find((p) => inRing(p));
  const b = players.find((p) => inRing(p) && p !== a);
  await answer(a, 'one guess');
  await until(() => (H.race?.lockedOut || []).includes(a.token), 15000);
  await answer(b, 'another guess');
  await until(() => !H.clue, 25000);

  await object(a);
  await object(b);
  await until(() => a.V?.host?.award, 8000);
  await voteAward(a, a.token);
  await voteAward(b, b.token);
  await until(() => !a.V?.host?.award, 25000);
  await spoken(/thrown out/);
  await wait(400);

  check('a tied vote throws the clue out', spokenTimes(/thrown out/) >= 1);
  check('and the room still hears the correct response',
    spokenTimes(/The correct response/) >= 1);
  check('nobody is paid and nobody is charged for a thrown-out clue',
    players.every((p) => scoreOf(p) === scores[p.name]),
    players.map((p) => `${p.name} ${scores[p.name]}->${scoreOf(p)}`).join(', '));
  check('the clue clock does not move, so nobody enters a clue early',
    clues == null || clueCount() === clues,
    `${clues} -> ${H.clues ?? H.game?.cluesRevealed}`);
  check('and the board goes back to whoever called it',
    H.control === holderBefore || !inRing(byToken(holderBefore) || {}),
    `${byToken(holderBefore)?.name} had it, ${byToken(H.control)?.name} has it`);
}

console.log('\nOVERRULING A CORRECT ANSWER CANNOT RE-RUN THE RACE, SO THE CLUE GOES');
{
  await until(() => H.control && !H.clue && H.phase === 'live', 40000);
  const clues = clueCount();
  const scoresBefore = Object.fromEntries(players.map((p) => [p.name, scoreOf(p)]));
  await newClue();
  const winner = players.find((p) => inRing(p));
  const wasVoided = spokenTimes(/thrown out/);
  await answer(winner, H.clue.answer);
  await until(() => !H.clue, 20000);
  const paid = scoreOf(winner);
  check('the answer was ruled correct and paid',
    paid > scoresBefore[winner.name], `${scoresBefore[winner.name]} -> ${paid}`);

  const others = players.filter((p) => inRing(p) && p !== winner);
  await object(others[0]);
  const met = await object(others[1]);
  check('the ring can overrule a correct ruling too', met?.met === true, JSON.stringify(met));
  await until(() => scoreOf(winner) !== paid, 25000);
  await until(() => spokenTimes(/thrown out/) > wasVoided, 20000);
  await wait(400);
  check('the payment is taken back', scoreOf(winner) < paid, `${paid} -> ${scoreOf(winner)}`);
  check('and every score is back where it was before the clue',
    players.every((p) => scoreOf(p) === scoresBefore[p.name]),
    players.map((p) => `${p.name} ${scoresBefore[p.name]}->${scoreOf(p)}`).join(', '));
  check('the clue is thrown out rather than handed to nobody in particular',
    spokenTimes(/thrown out/) > wasVoided, `${wasVoided} -> ${spokenTimes(/thrown out/)}`);
  check('and the clue clock still has not moved', clueCount() === clues,
    `${clues} -> ${clueCount()}`);
}

console.log('\nAND NOBODY CAN OBJECT TO NOTHING');
{
  const refused = await object(players[0]);
  check('an O with no ruling standing is refused, by reason',
    !!refused?.error && /no ruling/.test(refused.error), JSON.stringify(refused));
}

console.log('\nWHAT THE RECORD SAYS THE ROOM DECIDED');
{
  // The host view carries a count of corrections, not the corrections
  // themselves, so this reads the saved log — which is the artifact the
  // analysis chat actually works from.
  // `end-match` is hostOnly and answers no acknowledgement, so this waits on
  // the state rather than on a callback that never comes.
  host.emit('end-match');
  await until(() => H?.phase === 'over', 10000);
  await wait(600);
  const after = await object(players[0]);
  check('an objection after the match is over is refused', !!after?.error, JSON.stringify(after));

  const key = process.env.RUMBLE_LOG_KEY || 'ci-log-key';
  const list = await (await fetch(`${U}/api/logs?key=${key}`)).json();
  const mine = (list.matches || []).find((f) => (f.file || f).includes(gameId));
  check('the match was written to a log', !!mine, JSON.stringify(list.matches?.slice(0, 2)));
  const log = mine ? await (await fetch(`${U}/api/logs/${mine.file || mine}?key=${key}`)).json() : {};

  const objections = (log.corrections || []).filter((c) => c.type === 'objection');
  check('every objection is a correction, beside the undos',
    objections.length >= 5, `${objections.length} recorded`);
  check('each one says what it took and what it did',
    objections.every((o) => typeof o.votes === 'number' && typeof o.of === 'number' && o.shape),
    JSON.stringify(objections[0]));
  const shapes = [...new Set(objections.map((o) => o.shape))].sort();
  check('and the shapes are the ones the design names',
    shapes.every((sh) => ['lapsed', 'reversed', 'awarded', 'voided', 'late'].includes(sh)),
    shapes.join(', '));
  check('including a lapse, a reversal, an award and a void',
    ['lapsed', 'reversed', 'awarded', 'voided'].every((sh) => shapes.includes(sh)),
    shapes.join(', '));
  const onClue = (log.clues || []).filter((c) => c.objection);
  check('and the clue itself carries what the room decided about it',
    onClue.length >= 1, JSON.stringify(onClue[0]?.objection));
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
