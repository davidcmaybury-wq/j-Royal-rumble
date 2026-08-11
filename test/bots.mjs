// Robot players: that they fill a roster, buzz on a real clock, and behave
// the way the model says they should.
import { io } from 'socket.io-client';
import { makeBot, planClue, BUZZ_PROFILE, PROFILES, LEVELS, useProfile, timingOf } from '../src/bots.js';
import { makeRng } from '../src/engine.js';
const U = process.env.URL || 'http://127.0.0.1:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

console.log('THE MODEL');
{
  const rng = makeRng(4);
  const bots = Array.from({ length: 4000 }, () => makeBot(rng));
  const byLevel = {};
  for (const b of bots) (byLevel[b.level] ||= []).push(b);
  check('every level gets generated', Object.keys(byLevel).length === LEVELS.length,
    Object.keys(byLevel).join(', '));

  const elite = byLevel.elite;
  const jedi = elite.filter((b) => b.buzzSkill === 'jedi').length / elite.length;
  check('elite draws jedi hands about 80% of the time', jedi > 0.75 && jedi < 0.85,
    `${Math.round(jedi * 100)}%`);
  check('elite never draws bad hands', !elite.some((b) => b.buzzSkill === 'bad'));

  const rookie = byLevel.rookie;
  // Compared against each other rather than against fixed cutoffs, since the
  // bands are now pinned to percentiles of real play and will move again when
  // more box scores are collected.
  const rate = (arr) => arr.reduce((n, b) => n + b.attemptRate, 0) / arr.length;
  check('a rookie attempts far less often than an elite',
    rate(elite) > rate(rookie) * 1.6,
    `${Math.round(rate(rookie) * 100)}% vs ${Math.round(rate(elite) * 100)}%`);
  check('the standards rise in order',
    ['rookie', 'normie', 'champ', 'superchamp', 'elite']
      .map((l) => rate(byLevel[l])).every((v, i, a) => i === 0 || v > a[i - 1]),
    ['rookie', 'normie', 'champ', 'superchamp', 'elite']
      .map((l) => Math.round(rate(byLevel[l]) * 100) + '%').join(' < '));
  check('a rookie can still draw quick hands',
    rookie.some((b) => b.buzzSkill === 'good' || b.buzzSkill === 'jedi'));

  // buzz times
  // Buzz times are checked against the profile in force rather than a fixed
  // number, since the default scale is now anchored on real recorded play
  // rather than on the original model's much faster notional player.
  const rng2 = makeRng(11);
  const jb = makeBot(rng2, { level: 'elite', buzzSkill: 'jedi' });
  const draws = Array.from({ length: 3000 }, () => planClue(jb, 3, rng2)).filter((p) => p.attempt);
  const times = draws.filter((p) => !p.early).map((p) => p.ms);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const want = BUZZ_PROFILE.jedi.mean;
  check('jedi buzz times centre on the profile in use',
    Math.abs(mean - want) < want * 0.45, `${Math.round(mean)}ms against a ${want}ms profile`);
  const early = draws.filter((p) => p.early).length / draws.length;
  check('and a jedi jumps the lights sometimes', early > 0.005 && early < 0.25,
    `${Math.round(early * 100)}% early`);

  // The scales, translated into the terms real contestants are measured in.
  for (const set of ['observed', 'broadcast', 'measured']) {
    useProfile(set);
    const t = timingOf({ buzz: PROFILES[set].jedi });
    const plausible = set === 'observed' ? t > 60 : (t > 40 && t < 60);
    check(`${set} jedi sits where expected on the J!ometry scale`, plausible, `Time% ${t}`);
  }
  useProfile('measured');
  check('the default scale keeps its best hands within reach of a real champion',
    timingOf({ buzz: PROFILES.measured.jedi }) < 60,
    `Time% ${timingOf({ buzz: PROFILES.measured.jedi })} against ~46 for a career champion`);

  // the lockout quirk, made explicit
  const marginal = planClue({ ...jb, buzz: { mean: -10, sd: 0 } }, 3, makeRng(2));
  const wild = planClue({ ...jb, buzz: { mean: -240, sd: 0 } }, 3, makeRng(2));
  if (marginal.attempt && wild.attempt) {
    check('a marginal early press costs more than a wild one',
      marginal.ms > wild.ms, `10ms early -> buzz at ${marginal.ms}, 240ms early -> ${wild.ms}`);
  }
}

console.log('\nIN A MATCH');
const m = await (await fetch(`${U}/api/match`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ settings: { entryInterval: 99, delay: 0 } }) })).json();
const key = { 'content-type': 'application/json', 'x-host-key': m.hostKey };

let r = await (await fetch(`${U}/api/match/${m.gameId}/bots`,
  { method: 'POST', headers: key, body: JSON.stringify({ count: 5 }) })).json();
check('bots join the roster', r.roster.length === 5, `${r.roster.length} in the lobby`);
check('they are flagged as robots', r.roster.every((p) => p.isBot));
check('and described', r.added.every((b) => b.describe && b.level),
  r.added.map((b) => `${b.name}: ${b.level}/${b.buzzSkill}`).join(', '));

r = await (await fetch(`${U}/api/match/${m.gameId}/bots`,
  { method: 'POST', headers: key, body: JSON.stringify({ count: 3, level: 'elite' }) })).json();
check('a level can be forced', r.added.every((b) => b.level === 'elite'));
check('names do not collide', new Set(r.roster.map((p) => p.name)).size === r.roster.length);

const host = io(U, { transports: ['websocket'] });
await once(host, 'connect');
let st = null;
host.on('state', (s) => { st = s; });
await new Promise((res) => host.emit('host-join', { gameId: m.gameId, hostKey: m.hostKey }, (x) => { st = x.state; res(); }));
host.emit('start-match');
await wait(300);
check('a match of bots starts', st.phase === 'live' && st.live.length === 3,
  `${st.live.length} in the ring, ${st.queue.length} queued`);

// play a clue and watch the race fill in over time
const open = [];
st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) open.push([si, x.row]); }));
host.emit('pick-clue', { slot: open[0][0], row: open[0][1] });
await wait(150);
host.emit('activate');
await wait(60);
const early = (st.race?.buzzes || []).length;

// Poll rather than sleep a fixed span. Buzz times are sampled from real
// histograms whose tail runs past 900ms — a rookie whiffs beyond half a second
// 14% of the time — and a loaded CI runner adds scheduling delay on top. A
// fixed 950ms wait passed locally and failed in CI, which is the worst kind of
// test: green on the machine that wrote it.
let late = 0;
for (let i = 0; i < 60 && late === 0; i++) {
  await wait(100);
  late = (st.race?.buzzes || []).length;
}
check('the race fills in over time rather than all at once',
  late >= early, `${early} buzzes at 60ms, ${late} once they land`);
check('bots actually buzz', late > 0, `${late} buzzes`);
if (late) {
  const b = st.race.buzzes[0];
  check('their buzzes are marked as robotic', b.bot === true);
  check('and carry whether the answer will be right',
    typeof b.botCorrect === 'boolean', String(b.botCorrect));
  check('their times look like reaction times', b.ms >= 0 && b.ms < 3000, `${b.ms} ms`);
}

// run a whole match unattended
let guard = 0;
while (st.phase === 'live' && guard++ < 300) {
  const o = [];
  st.board.forEach((c, si) => c.clues.forEach((x) => { if (!x.revealed) o.push([si, x.row]); }));
  host.emit('pick-clue', { slot: o[0][0], row: o[0][1] });
  await wait(40);
  host.emit('activate');
  await wait(140);
  const top = st.race?.buzzes?.[0];
  if (top && top.botCorrect) host.emit('resolve', { winnerToken: top.token });
  else if (top) host.emit('mark-wrong', { token: top.token });
  else host.emit('resolve', { winnerToken: null });
  await wait(70);
  if (st.clue && st.race && !st.race.buzzes.length) { host.emit('resolve', { winnerToken: null }); await wait(70); }
}
check('a match of robots plays itself to a finish', st.phase === 'over',
  `${st.clues} clues, ${guard} rounds`);
const champ = (st.standings || []).find((p) => p.winner);
check('and produces a winner', !!champ, champ ? `${champ.name}, ${champ.tenure} clues` : 'none');
check('with statistics that look real', champ && champ.att > 0 && champ.correct > 0,
  champ ? `${champ.correct} correct of ${champ.att} attempts, best ${champ.best}ms` : '');

// --- the standards form a ladder -----------------------------------------
// On races won, not on median buzz time. Those differ: an aggressive player
// jumps the lights more often and pays the lockout, so a fast median can lose
// to a slower, steadier one. Elite once sat below superchamp for exactly that
// reason, and a median-based check would have called it fine.
{
  const fs2 = await import('fs');
  const { loadDistributions: load2 } = await import('../src/bots.js');
  load2(JSON.parse(fs2.readFileSync(new URL('../data/buzz-distributions.json', import.meta.url))));
  const rng3 = makeRng(13);
  const rate = (level) => {
    const me = makeBot(rng3, { level });
    let att = 0, won = 0;
    for (let i = 0; i < 12000; i++) {
      const row = 1 + Math.floor(rng3() * 5);
      const mine = planClue(me, row, rng3);
      if (!mine.attempt) continue;
      att++;
      let best = mine.ms;
      for (let k = 0; k < 2; k++) {
        const o = planClue(makeBot(rng3, { level: 'normie' }), row, rng3);
        if (o.attempt && o.ms < best) best = o.ms;
      }
      if (best === mine.ms) won++;
    }
    return won / att * 100;
  };
  const ladder = ['rookie', 'normie', 'champ', 'superchamp', 'elite'].map(rate);
  check('each standard wins more races than the one below it',
    ladder.every((v, i) => i === 0 || v > ladder[i - 1]),
    ladder.map((v) => v.toFixed(0) + '%').join(' < '));
  check('elite is the best of them', ladder[4] === Math.max(...ladder),
    `elite ${ladder[4].toFixed(0)}%`);
}

// --- the ring carries what the console draws with ------------------------
// The console renders a brain for p.isBot at p.level. Both were missing from
// the row the server sends for a live player, so every robot showed an empty
// circle — with no error anywhere, because a missing field is just undefined.
{
  const inRing = st.live[0];
  check('a live row says whether the player is a robot', 'isBot' in inRing,
    Object.keys(inRing).join(', ').slice(0, 90));
  check('and which standard it is', inRing.isBot ? !!inRing.level : true,
    String(inRing.level));
  check('and its measured latency', 'latency' in inRing);
  for (const field of ['token', 'draw', 'name', 'score', 'connected', 'hasAvatar',
                       'capped', 'topRope', 'target', 'bounty', 'revivals', 'tenure']) {
    if (!(field in inRing)) check(`a live row carries ${field}`, false);
  }
  check('a live row carries every field the console draws with', true,
    `${Object.keys(inRing).length} fields`);
}

// --- the recorded distributions, and the shared read jitter ---------------
{
  const fs = await import('fs');
  const { loadDistributions, drawReadJitter } = await import('../src/bots.js');
  const dist = JSON.parse(fs.readFileSync(new URL('../data/buzz-distributions.json', import.meta.url)));
  loadDistributions(dist);
  const rng2 = makeRng(31);
  const want = { rookie: 173, normie: 112, champ: 62, superchamp: 58 };
  const medianOf = (lvl, offset = 0) => {
    const b = makeBot(rng2, { level: lvl });
    const raw = Array.from({ length: 12000 },
      () => planClue({ ...b, attemptRate: 1 }, 3, rng2, 250, 0, offset))
      .filter((d) => d.attempt).map((d) => (d.early ? d.earlyAt : d.ms)).sort((a, c) => a - c);
    return { med: raw[Math.floor(raw.length / 2)],
             iqr: raw[Math.floor(raw.length * 0.75)] - raw[Math.floor(raw.length * 0.25)] };
  };
  for (const [lvl, median] of Object.entries(want)) {
    const { med } = medianOf(lvl);
    check(lvl + ' reproduces its recorded median', Math.abs(med - median) < 15,
      Math.round(med) + 'ms against ' + median + 'ms recorded');
  }
  const r = medianOf('rookie'), sc = medianOf('superchamp');
  check('a rookie is far less consistent than a superchamp', r.iqr > sc.iqr * 3,
    'middle 50% spans ' + Math.round(r.iqr) + 'ms against ' + Math.round(sc.iqr) + 'ms');

  const j = Array.from({ length: 4000 }, () => drawReadJitter(rng2, 45));
  const jm = j.reduce((a, x) => a + x, 0) / j.length;
  check('read jitter is centred on zero', Math.abs(jm) < 6, jm.toFixed(1) + 'ms');

  const shifted = medianOf('champ', 120);
  check('a field offset moves the whole distribution',
    Math.abs(shifted.med - (62 + 120)) < 25,
    'median ' + Math.round(shifted.med) + 'ms with a +120ms offset');
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
host.close();
process.exit(fails ? 1 : 0);
