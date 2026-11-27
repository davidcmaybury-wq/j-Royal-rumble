// Call-audio delay sync: the host's voice finds each player's own call delay.
//
// Synthetic speech goes through the real FrameMaker on both sides — the host's
// clean, the player's delayed by the "call", turned down, with room noise and
// a second talker mixed in, on a computer whose clock is minutes out — and the
// Matcher is driven tick by tick the way the page drives it. No audio device,
// no network, no browser.
import { CS, FrameMaker, Matcher, matchOnce, onsets, buzzWaitMs, shownDelay, footerText,
  dbToByte, byteToDb, toBase64, fromBase64 } from '../public/callsync.js';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const SR = 16000;

// Seeded, so a failure reproduces.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/**
 * Speech-like sound: syllables of a few harmonics with a gliding pitch,
 * 80–300 ms long, in phrases separated by pauses.
 */
function speech(seconds, seed, { gapEvery = 3, gap = 0.6 } = {}) {
  const r = rng(seed), n = Math.round(seconds * SR), out = new Float32Array(n);
  let i = 0, phrase = 0;
  while (i < n) {
    if (phrase > gapEvery * SR) { i += Math.round((gap + r() * 0.8) * SR); phrase = 0; continue; }
    const len = Math.round((0.08 + r() * 0.22) * SR);
    const f0 = 100 + r() * 140, glide = (r() - 0.5) * 60, amp = 0.1 + r() * 0.3;
    const formant = 500 + r() * 2000;
    for (let k = 0; k < len && i + k < n; k++) {
      const t = k / SR, att = 0.015 * SR, env = k < att ? k / att : Math.exp(-(k - att) / (len / 3));
      const f = f0 + glide * t / (len / SR);
      let v = 0;
      for (let h = 1; h <= 12; h++) {
        const fh = f * h;
        v += Math.sin(2 * Math.PI * fh * t + h) / h * (1 + 2 * Math.exp(-(((fh - formant) / 400) ** 2)));
      }
      out[i + k] += amp * env * v * 0.3;
    }
    i += len + Math.round(r() * 0.05 * SR);
    phrase += len;
  }
  return out;
}

function noise(n, seed, level) {
  const r = rng(seed), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (r() * 2 - 1) * level;
  return out;
}

/** Frames of a whole signal, stamped on a clock whose sample 0 is at `t0`. */
function frames(signal, t0) {
  const out = [];
  const fm = new FrameMaker(SR, (b, last) => out.push({ t: t0 + (last / SR) * 1000, b }));
  for (let i = 0; i < signal.length; i += 1024) fm.push(signal.subarray(i, i + 1024), i);
  return out;
}

// ---------------------------------------------------------------- the pattern

check('a level survives the byte: 0.5 dB steps from −110 dB',
  byteToDb(dbToByte(-42.3)) === -42.5 && dbToByte(-200) === 0 && dbToByte(100) === 255);
check('frames go over the wire intact',
  fromBase64(toBase64(new Uint8Array([0, 1, 254, 255]))).join() === '0,1,254,255');

{
  const tone = new Float32Array(SR);
  for (let i = 0; i < SR; i++) tone[i] = Math.sin(2 * Math.PI * 1000 * i / SR);
  const f = frames(tone, 0);
  const mid = f[100].b;
  const loudest = mid.indexOf(Math.max(...mid));
  check('a frame every 5 ms, stamped on the audio clock', Math.abs(f.length - 194) <= 1 && Math.abs((f[1].t - f[0].t) - 5) < 0.01,
    `${f.length} frames`);
  check('a 1 kHz tone lands in one band, near the middle of 100–4,000 Hz', loudest > 12 && loudest < 24,
    `band ${loudest}`);
  check('and a full-scale sine reads close to 0 dB there', Math.abs(byteToDb(mid[loudest])) < 4,
    `${byteToDb(mid[loudest])} dB`);
  check('32 bytes a frame, 20 frames a message: 6.4 KB a second before base64',
    mid.length === 32 && CS.FRAMES_PER_MSG * 32 * (1000 / (CS.FRAMES_PER_MSG * CS.HOP_MS)) === 6400);
}

{
  const quiet = Array.from({ length: 200 }, () => new Uint8Array(32).fill(40));
  const loud = quiet.map((r, i) => (i % 20 < 10 ? r : new Uint8Array(32).fill(120)));
  const o = onsets(loud);
  check('onsets are rises only, z-scored per band', o.length === 32 && Math.abs(o[0].reduce((a, b) => a + b, 0)) < 1e-6);
}

// ---------------------------------------------------------------- one match

const HOST_T0 = 1_800_000_000_000;      // host computer's clock at sample 0
const SECONDS = 40;
// The host's microphone has a noise floor of its own, as every real one does.
const host = speech(SECONDS, 7);
{ const n = noise(host.length, 77, 0.004); for (let i = 0; i < host.length; i++) host[i] += n[i]; }
const hostFrames = frames(host, HOST_T0);

/** The call as a player hears it: `delayMs` late, quieter, noisy, with somebody else talking. */
function heard(delayMs, { gain = 0.4, noiseLevel = 0.01, other = 0.5, seed = 11 } = {}) {
  const d = Math.round(delayMs * SR / 1000);
  const out = new Float32Array(host.length);
  const talk = speech(SECONDS, seed + 100, { gapEvery: 2, gap: 1.5 });
  const nz = noise(host.length, seed, noiseLevel);
  for (let i = 0; i < out.length; i++) out[i] = (i >= d ? host[i - d] * gain : 0) + talk[i] * other * gain + nz[i];
  return out;
}

{
  const clockDiff = 123_456;           // the player's computer is two minutes ahead
  const p = frames(heard(437), HOST_T0 + clockDiff);
  const truth = clockDiff + 437;
  const r = matchOnce(hostFrames, p, HOST_T0 + 8000, HOST_T0 + 14000, truth - 900, truth + 2600);
  check('one 6 s window on a mic over speakers finds the delay to within 10 ms',
    r.L != null && Math.abs(r.L - truth) < 10, `L−truth ${(r.L - truth).toFixed(2)} ms`);
  check('and scores it strong, with another player talking over the host',
    r.conf >= CS.STRONG_CONF && r.z >= CS.STRONG_Z, `conf ${r.conf?.toFixed(2)} z ${r.z?.toFixed(1)}`);

  const edge = matchOnce(hostFrames, p, HOST_T0 + 8000, HOST_T0 + 14000, truth - 30, truth + 2000);
  check('a peak at the end of the search range is thrown away, since the true one may lie beyond',
    edge.why === 'edge');

  const silent = frames(noise(host.length, 3, 0.01), HOST_T0 + clockDiff);
  const none = matchOnce(hostFrames, silent, HOST_T0 + 8000, HOST_T0 + 14000, truth - 900, truth + 2600);
  check('sound without the host in it does not score as a match',
    none.L == null || none.conf < CS.COUNT_CONF || none.z < CS.STRONG_Z,
    `conf ${none.conf?.toFixed(2)} z ${none.z?.toFixed(1)}`);

  const pauses = hostFrames.map((f) => ({ t: f.t, b: new Uint8Array(32).fill(10) }));
  check('a window with under 2 s of speech is skipped',
    matchOnce(pauses, p, HOST_T0 + 8000, HOST_T0 + 14000, truth - 900, truth + 2600).why === 'quiet');
}

// ---------------------------------------------------------------- the trust rules

/**
 * Play a session: host messages arrive `transitMs` after they are sent (on
 * the player's clock, which is `clockDiff` ahead), the player's capture runs
 * with the call `delayAt(t)` late, and the matcher ticks every 500 ms.
 */
function session({ delayAt, clockDiff = 50_000, transitMs = 40, seconds = SECONDS, captureFrom = 0 }) {
  // Build the player's capture piecewise when the delay changes mid-session.
  const out = new Float32Array(host.length);
  const nz = noise(host.length, 5, 0.001);   // the computer's own sound: clean
  for (let i = 0; i < out.length; i++) {
    const d = Math.round(delayAt(i / SR * 1000) * SR / 1000);
    out[i] = (i >= d ? host[i - d] * 0.5 : 0) + nz[i];
  }
  const pFrames = frames(out, HOST_T0 + clockDiff);
  const m = new Matcher();
  m.started();
  const log = [];
  let hi = 0, pi = 0;
  for (let t = 0; t < seconds * 1000; t += CS.TICK_MS) {
    const pNow = HOST_T0 + clockDiff + t;
    // Host messages sent by host time t arrive transit later.
    while (hi + CS.FRAMES_PER_MSG <= hostFrames.length
      && hostFrames[hi + CS.FRAMES_PER_MSG - 1].t + transitMs + clockDiff <= pNow) {
      const chunk = hostFrames.slice(hi, hi + CS.FRAMES_PER_MSG);
      const bytes = new Uint8Array(chunk.length * 32);
      chunk.forEach((f, k) => bytes.set(f.b, k * 32));
      const sentAt = chunk[chunk.length - 1].t;
      m.addHost({ t0: chunk[0].t, sentAt, rtt: 60, frames: toBase64(bytes) }, sentAt + transitMs + clockDiff);
      hi += CS.FRAMES_PER_MSG;
    }
    while (pi < pFrames.length && pFrames[pi].t <= pNow) {
      if (t >= captureFrom) m.addPlayer(pFrames[pi].t, pFrames[pi].b);
      pi++;
    }
    const r = m.tick(pNow);
    log.push({ t, status: r.status, L: r.L == null ? null : r.L - clockDiff });
  }
  return { m, log };
}

{
  const { m, log } = session({ delayAt: () => 650 });
  const first = log.find((x) => x.L != null);
  check('a first value needs three strong, agreeing matches over 3 s of speech — and then locks',
    first && first.t >= 3000 && first.t <= 15000, first ? `locked at ${first.t / 1000} s` : 'never locked');
  check('the locked value is the call delay to within 2 ms, through a clock two minutes out',
    first && Math.abs(first.L - 650) < 2, first ? `${first.L.toFixed(2)} ms` : '');
  check('and stays there for the rest of the session', log.filter((x) => x.L != null).every((x) => Math.abs(x.L - 650) < 3));
  check('extra is L minus the message transit', Math.abs(m.extra() - (650 - 40)) < 3, `${m.extra()?.toFixed(1)}`);
  check('the delay shown adds back half of each side\'s round trip', shownDelay(610, 60, 80) === 680);
}

for (const d of [80, 900, 2400]) {
  const { log } = session({ delayAt: () => d });
  const last = log[log.length - 1];
  check(`a ${d} ms call is found as readily (search runs to transit + 3 s)`,
    last.L != null && Math.abs(last.L - d) < 2.5, last.L == null ? 'no lock' : `${last.L.toFixed(2)} ms`);
}

{
  // The call drifts 30 ms partway through: followed at once.
  const { log } = session({ delayAt: (t) => (t < 20000 ? 500 : 530) });
  const late = log.filter((x) => x.t > 30000);
  check('a drift of 30 ms is followed', late.length && late.every((x) => x.L != null && Math.abs(x.L - 530) < 4),
    late.length ? `${late[late.length - 1].L?.toFixed(1)} ms` : '');
}

{
  // A 120 ms step: needs two strong recent matches before it is taken.
  const { log } = session({ delayAt: (t) => (t < 18000 ? 400 : 520) });
  const at = log.find((x) => x.t > 18000 && x.L != null && Math.abs(x.L - 520) < 5);
  const before = log.filter((x) => x.t > 18000 && x.t < 19500 && x.L != null);
  check('a 120 ms change is taken once two strong matches agree, a few seconds after it happens',
    at && at.t - 18000 <= 12000, at ? `taken ${((at.t - 18000) / 1000).toFixed(1)} s after the change` : 'never taken');
  check('and not on the first match that sees it', before.every((x) => Math.abs(x.L - 400) < 5));
}

{
  // A 1 s jump needs the same three strong matches as a first value.
  const { log } = session({ delayAt: (t) => (t < 15000 ? 300 : 1300) });
  const last = log[log.length - 1];
  check('a jump of a whole second is re-found from scratch', last.L != null && Math.abs(last.L - 1300) < 3,
    `${last.L?.toFixed(1)} ms`);
}

{
  // Capture runs but hears nothing of the host (a mic with headphones on).
  const m = new Matcher(); m.started();
  let hi = 0;
  const silent = frames(noise(host.length, 9, 0.01), HOST_T0 + 40);
  let pi = 0, status = null;
  for (let t = 0; t < 39000; t += 500) {
    const pNow = HOST_T0 + 40 + t;
    while (hi + 20 <= hostFrames.length && hostFrames[hi + 19].t + 40 <= pNow) {
      const c = hostFrames.slice(hi, hi + 20), bytes = new Uint8Array(640);
      c.forEach((f, k) => bytes.set(f.b, k * 32));
      m.addHost({ t0: c[0].t, sentAt: c[19].t, rtt: 50, frames: bytes }, c[19].t + 40); hi += 20;
    }
    while (pi < silent.length && silent[pi].t <= pNow) { m.addPlayer(silent[pi].t, silent[pi].b); pi++; }
    status = m.tick(pNow).status;
  }
  check('a capture that never hears the host stays Listening and never invents a value', status === 'listening' && m.L == null);
  check('and after 20 s of the host\'s speech it says the mic cannot hear the host', m.cantHear === true,
    `unheard ${m.unheardMs} ms`);
}

{
  const { m } = session({ delayAt: () => 600 });
  m.stopped();
  check('a capture that ends keeps the last value, paused', m.status === 'stopped' && m.L != null);
  m.started();
  check('a new capture resumes from it until it matches again', m.status === 'resuming' && m.L != null);
}

// ---------------------------------------------------------------- fair buzzing

check('a buzz waits for every player still to buzz: 3.5 × worst round trip plus their extra',
  buzzWaitMs({ waiting: [{ rttWorst: 100, extra: 0 }, { rttWorst: 60, extra: 700 }], B: 200, R: 300 }) === 810);
check('never less than 250 ms', buzzWaitMs({ waiting: [{ rttWorst: 10, extra: 0 }], B: 100, R: 900 }) === 250);
check('and decided at once when everybody has buzzed', buzzWaitMs({ waiting: [], B: 100, R: 300 }) === 0);

check('the player\'s footer reads the status',
  footerText({ status: 'synced', delay: 412 }) === 'Synced · delay 412 ms'
  && footerText({ status: 'not-synced' }) === 'Not synced: click to sync'
  && footerText({ status: 'paused-stopped' }) === 'Sync paused: click to resume');

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
