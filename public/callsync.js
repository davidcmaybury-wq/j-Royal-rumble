// Call-audio delay sync: each player's buzzer light comes on when THEY hear
// the host finish, not when the game's message happens to arrive.
//
// Matt Schiffler built and measured this for j-trivia (callSync.js, v722); this
// is a reimplementation for the Rumble from his written description, not a
// copy of his code. Credited in CREDITS.md and docs/call-sync.md, which also
// records which constants were stated in his notes and which were filled in
// here because the notes stopped before the table of numbers.
//
// The problem. The host reads over a video call (Zoom, Discord, Meet, Teams).
// The game's messages reach a player through our server, usually well before
// the call's sound does, and each player's call delay is different — under
// 0.1 s for one, a second or more for another — and moves during a game. A
// single host-wide delay setting is right for at most one person in the room.
//
// The idea. The host's page and each player's page turn sound into the same
// loudness pattern (every 5 ms, 32 mel bands, 100–4,000 Hz, over the last
// 32 ms), each stamped with its own computer's clock. The host's pattern rides
// the game server; the player's page captures the call as that player hears
// it and slides one along the other. The offset where they line up is L:
//
//     player clock = host clock + L
//
// L carries both the call's delay and the difference between the two clocks,
// so no clock ever needs syncing. Anything the host does at host time T (the
// key press that opens the buzzers, a clue going up) happens on that player's
// page at T + L.
//
// Everything here is plain arithmetic on arrays except the capture classes at
// the bottom, so the matcher runs under node in test/callsync.mjs.

// ---------------------------------------------------------------- numbers
//
// "notes" = stated in Matt's write-up of v722. "here" = not in the notes we
// were given (they end before the table); chosen here, with the reason.
export const CS = {
  HOP_MS: 5,               // notes: a frame every 5 ms
  WIN_MS: 32,              // notes: over the last 32 ms of sound, Hann window
  BANDS: 32,               // notes: 32 mel-spaced bands
  F_LO: 100, F_HI: 4000,   // notes: 100 to 4,000 Hz
  DB_MIN: -110,            // notes: one byte a band, 0.5 dB steps from −110 dB
  DB_STEP: 0.5,
  FRAMES_PER_MSG: 20,      // notes: 20 frames (100 ms) a message
  KEEP_MS: 15000,          // notes: each side keeps the last 15 s
  STAMP_FALLBACK_MS: 20000,// notes: earliest arrival over the last 20 s
  TICK_MS: 500,            // notes: every half second
  TRANSIT_KEEP_MS: 10000,  // notes: smallest transit over the last 10 s
  SEARCH_LO_MS: -500,      // notes: search from transit − 0.5 s
  SEARCH_HI_MS: 3000,      //        to transit + 3 s
  WINDOW_MS: 6000,         // notes: a 6 s window of the host's frames
  MIN_SPEECH_MS: 2000,     // notes: skip it if under 2 s is speech
  SPEECH_DB: 15,           // notes: 15 dB louder than the window's quietest 3%
  QUIET_PCT: 0.03,
  FLOOR_PCT: 0.10,         // notes: the band's 10th-percentile power
  EDGE_MS: 50,             // notes: discard a peak within 50 ms of either end
  SIDE_MS: 50,             // notes: next highest point more than 50 ms away
  COUNT_CONF: 1.3,         // notes: a match counts at conf ≥ 1.3
  STRONG_CONF: 2.0,        // notes: strong at conf ≥ 2.0 and z ≥ 6
  STRONG_Z: 6,
  FIRST_N: 3,              // notes: 3 strong matches within 30 ms,
  FIRST_AGREE_MS: 30,      //        from speech spread over at least 3 s
  FIRST_SPREAD_MS: 3000,
  LOCAL_WINDOW_MS: 2500,   // notes: once synced, the host's latest 2.5 s
  LOCAL_LO_MS: -300,       //        from 300 ms below L
  LOCAL_HI_MS: 150,        //        to 150 ms above it
  LOCAL_MIN_SPEECH_MS: 1000, // here: the notes say "2.5 s of speech" without a
                           //   floor for the short window; half of the full
                           //   window's 2-of-6 ratio would be 0.8 s, and 1 s
                           //   keeps a single word from steering L.
  DRIFT_MS: 50,            // notes: drift up to 50 ms followed at once,
  DRIFT_N: 3,              //        as the median of the last 3
  STEP_MS: 150,            // notes: a change up to 150 ms needs
  STEP_N: 2,               //        2 strong recent matches,
  STEP_GAP_MS: 500,        //        at least 0.5 s apart
  STEP_AGREE_MS: 30,       // here: "agree" — the first-value tolerance reused
  RECENT_MS: 10000,        // here: what "recent" means for the step rule
  UNHEARD_MS: 20000,       // notes: 20 s of the host's speech with no match
  HOST_SILENT_MS: 60000,   // notes: host mic warns after 60 s with no speech
  BLUETOOTH_MS: 180,       // notes: j-trivia's fixed allowance for earbuds
  LIGHT_GUARD_MS: 50,      // notes: no matching from now until 50 ms after a light
  WAIT_RTT_MULT: 3.5,      // notes: 3.5 × a waiting player's worst round trip
  WAIT_MIN_MS: 250,        // notes: never decide sooner than 250 ms
};

// One clock for every stamp on a page: milliseconds since the epoch, but read
// from performance.now() so it never jumps when the OS adjusts the wall clock
// mid-game. Host frames, host key presses and player frames all use it.
export const pageNow = () =>
  (typeof performance !== 'undefined' && performance.timeOrigin
    ? performance.timeOrigin + performance.now() : Date.now());

// ---------------------------------------------------------------- the pattern

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

/** In-place radix-2 FFT on separate real and imaginary arrays. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const mel = (f) => 2595 * Math.log10(1 + f / 700);
const unmel = (m) => 700 * (10 ** (m / 2595) - 1);

/**
 * Turns raw samples into 5 ms frames of 32 one-byte band levels.
 *
 * Fed in chunks of any size, with the index of each chunk's first sample, so
 * the frame times come from the sample count (the audio's own clock) and the
 * caller maps sample index to page time. A frame is stamped with its last
 * sample: the moment the sound in it had all been heard.
 */
export class FrameMaker {
  constructor(sampleRate, onFrame) {
    this.sr = sampleRate;
    this.onFrame = onFrame;
    this.win = Math.round(sampleRate * CS.WIN_MS / 1000);
    this.n = nextPow2(this.win);
    this.hop = sampleRate * CS.HOP_MS / 1000;      // fractional at 44.1 kHz
    this.hann = new Float32Array(this.win);
    let wsum = 0;
    for (let i = 0; i < this.win; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.win - 1));
      wsum += this.hann[i];
    }
    // Scaled so a full-scale sine reads about 0 dB in its band.
    this.norm = 4 / (wsum * wsum);
    this.ring = new Float32Array(this.win);
    this.filled = 0;          // samples seen in total
    this.nextFrame = 1;       // index of the next frame to emit
    this.re = new Float64Array(this.n); this.im = new Float64Array(this.n);
    // Triangular mel filters over FFT bins.
    const edges = [];
    for (let i = 0; i < CS.BANDS + 2; i++) {
      edges.push(unmel(mel(CS.F_LO) + (mel(CS.F_HI) - mel(CS.F_LO)) * i / (CS.BANDS + 1)));
    }
    const binHz = sampleRate / this.n;
    this.filters = [];
    for (let b = 0; b < CS.BANDS; b++) {
      const lo = edges[b], mid = edges[b + 1], hi = edges[b + 2];
      const taps = [];
      for (let k = Math.floor(lo / binHz); k <= Math.ceil(hi / binHz); k++) {
        const f = k * binHz;
        const w = f <= lo || f >= hi ? 0 : f <= mid ? (f - lo) / (mid - lo) : (hi - f) / (hi - mid);
        if (w > 0) taps.push([k, w]);
      }
      // A band narrower than a bin still gets its nearest bin.
      if (!taps.length) taps.push([Math.round(mid / binHz), 1]);
      this.filters.push(taps);
    }
    this.firstIndex = null;
  }

  push(samples, firstIndex) {
    if (this.firstIndex == null) this.firstIndex = firstIndex;
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.filled % this.win] = samples[i];
      this.filled++;
      const end = Math.round(this.nextFrame * this.hop);
      if (this.filled >= end && this.filled >= this.win) {
        this.nextFrame++;
        this.onFrame(this.levels(), this.firstIndex + this.filled - 1);
      } else if (this.filled >= end) {
        this.nextFrame++;       // not a full window yet
      }
    }
  }

  levels() {
    const { re, im, win, n } = this;
    const start = this.filled % win;     // oldest sample in the ring
    for (let i = 0; i < win; i++) { re[i] = this.ring[(start + i) % win] * this.hann[i]; im[i] = 0; }
    for (let i = win; i < n; i++) { re[i] = 0; im[i] = 0; }
    fft(re, im);
    const out = new Uint8Array(CS.BANDS);
    for (let b = 0; b < CS.BANDS; b++) {
      let p = 0;
      for (const [k, w] of this.filters[b]) p += w * (re[k] * re[k] + im[k] * im[k]);
      out[b] = dbToByte(10 * Math.log10(p * this.norm + 1e-30));
    }
    return out;
  }
}

export const dbToByte = (db) =>
  Math.max(0, Math.min(255, Math.round((db - CS.DB_MIN) / CS.DB_STEP)));
export const byteToDb = (v) => CS.DB_MIN + v * CS.DB_STEP;

/**
 * Sample index → page time.
 *
 * The audio runs on its own sample clock. Stamping a frame with the time its
 * chunk happened to reach the page adds that page's own scheduling jitter, so
 * where the browser offers getOutputTimestamp() the audio clock is mapped
 * through it. Where it does not, each chunk's arrival minus its audio time is
 * an upper bound on the true offset, and the smallest over the last 20 s is
 * the best estimate.
 */
export class SampleClock {
  constructor(sampleRate, ctx = null) {
    this.sr = sampleRate; this.ctx = ctx; this.samples = [];
  }
  /** Call as each chunk arrives, with the index just past its last sample. */
  arrived(endIndex, nowPage = pageNow()) {
    const off = nowPage - (endIndex / this.sr) * 1000;
    this.samples.push({ at: nowPage, off });
    while (this.samples.length && this.samples[0].at < nowPage - CS.STAMP_FALLBACK_MS) this.samples.shift();
  }
  toPage(index) {
    const ts = this.ctx?.getOutputTimestamp?.();
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0 && typeof performance !== 'undefined') {
      return performance.timeOrigin + ts.performanceTime + (index / this.sr - ts.contextTime) * 1000;
    }
    let off = Infinity;
    for (const s of this.samples) if (s.off < off) off = s.off;
    return (index / this.sr) * 1000 + (isFinite(off) ? off : pageNow());
  }
}

// ---------------------------------------------------------------- wire format

export function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function fromBase64(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- matching

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs, p) => {
  const s = Float64Array.from(xs).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

/** Overall level of a frame in dB: the power sum of its bands. */
function frameDb(b) {
  let p = 0;
  for (let i = 0; i < b.length; i++) p += 10 ** (byteToDb(b[i]) / 10);
  return 10 * Math.log10(p + 1e-30);
}

/** Frames on a regular 5 ms grid starting at `start`, carrying the last frame across gaps. */
function grid(frames, start, count) {
  const out = new Array(count);
  let j = 0, last = null;
  for (let i = 0; i < count; i++) {
    const t = start + i * CS.HOP_MS;
    while (j < frames.length && frames[j].t <= t + CS.HOP_MS / 2) { last = frames[j].b; j++; }
    out[i] = last;
  }
  return out;
}

/**
 * Rises per band, z-scored.
 *
 * Level → power, plus the band's noise floor (its 10th percentile), log, keep
 * only the rise from the frame before. Rises survive changes in the call's
 * volume and tone better than raw levels: a codec that turns the host down 6
 * dB moves every level and almost no rise.
 */
export function onsets(rows) {
  const n = rows.length, out = [];
  for (let b = 0; b < CS.BANDS; b++) {
    const pw = new Float64Array(n);
    for (let i = 0; i < n; i++) pw[i] = rows[i] ? 10 ** (byteToDb(rows[i][b]) / 10) : 0;
    const floor = pct(pw, CS.FLOOR_PCT) + 1e-12;
    const o = new Float64Array(n);
    let prev = Math.log(pw[0] + floor), sum = 0;
    for (let i = 1; i < n; i++) {
      const cur = Math.log(pw[i] + floor);
      o[i] = Math.max(0, cur - prev);
      prev = cur; sum += o[i];
    }
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (o[i] - mean) ** 2;
    const sd = Math.sqrt(v / n) || 1;
    for (let i = 0; i < n; i++) o[i] = (o[i] - mean) / sd;
    out.push(o);
  }
  return out;
}

/** How much of a run of frames is speech: frames 15 dB above its quietest 3%. */
export function speechMs(rows) {
  const lv = rows.filter(Boolean).map(frameDb);
  if (!lv.length) return 0;
  const q = pct(lv, CS.QUIET_PCT);
  return lv.filter((x) => x > q + CS.SPEECH_DB).length * CS.HOP_MS;
}

/**
 * One match: where does this stretch of the host's speech sit in what the
 * player heard, for L in [lo, hi]?
 *
 * Returns { L, conf, z } or a reason it found nothing usable.
 */
export function matchOnce(hostFrames, playerFrames, hStart, hEnd, lo, hi, minSpeechMs = CS.MIN_SPEECH_MS) {
  const H = Math.round((hEnd - hStart) / CS.HOP_MS);
  const hRows = grid(hostFrames, hStart, H);
  if (hRows.some((r) => !r)) return { why: 'host-gap' };
  if (speechMs(hRows) < minSpeechMs) return { why: 'quiet' };
  const pStart = hStart + lo;
  const K = Math.round((hi - lo) / CS.HOP_MS) + 1;       // lags searched
  const P = H + K - 1;
  const pRows = grid(playerFrames, pStart, P);
  if (pRows.filter(Boolean).length < P * 0.9) return { why: 'player-gap' };
  const ho = onsets(hRows), po = onsets(pRows);
  const N = nextPow2(P + H);
  const accRe = new Float64Array(N), accIm = new Float64Array(N);
  for (let b = 0; b < CS.BANDS; b++) {
    const ar = new Float64Array(N), ai = new Float64Array(N);
    const br = new Float64Array(N), bi = new Float64Array(N);
    ar.set(po[b]); br.set(ho[b]);
    fft(ar, ai); fft(br, bi);
    // Cross-correlation: P · conj(H). Summed across bands before the one inverse.
    for (let k = 0; k < N; k++) {
      accRe[k] += ar[k] * br[k] + ai[k] * bi[k];
      accIm[k] += ai[k] * br[k] - ar[k] * bi[k];
    }
  }
  fft(accRe, accIm, true);
  const c = accRe.subarray(0, K);
  let k0 = 0;
  for (let k = 1; k < K; k++) if (c[k] > c[k0]) k0 = k;
  const edge = CS.EDGE_MS / CS.HOP_MS;
  if (k0 < edge || K - 1 - k0 < edge) return { why: 'edge', L: lo + k0 * CS.HOP_MS };
  // A parabola through the peak and its neighbors places L between frames.
  const y0 = c[k0 - 1], y1 = c[k0], y2 = c[k0 + 1];
  const den = y0 - 2 * y1 + y2;
  const frac = den ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
  // The rest of the search: everything more than 50 ms from the peak.
  const side = CS.SIDE_MS / CS.HOP_MS;
  let n = 0, sum = 0, sum2 = 0, second = -Infinity;
  for (let k = 0; k < K; k++) {
    if (Math.abs(k - k0) <= side) continue;
    n++; sum += c[k]; sum2 += c[k] * c[k];
    if (c[k] > second) second = c[k];
  }
  if (n < 3) return { why: 'narrow' };
  const mean = sum / n, sd = Math.sqrt(Math.max(1e-12, sum2 / n - mean * mean));
  const conf = second > mean ? (y1 - mean) / (second - mean) : Infinity;
  const z = (y1 - mean) / sd;
  return { L: lo + (k0 + frac) * CS.HOP_MS, conf, z };
}

/**
 * Keeps the two patterns and decides when L can be trusted.
 *
 * Fed host frames as they arrive through the server and player frames as the
 * capture makes them; `tick(now)` every half second. Pure state: no timers,
 * no audio, no sockets, so the whole rule set runs under node.
 */
export class Matcher {
  constructor() { this.reset(); this.L = null; this.status = 'off'; }

  reset() {
    this.host = []; this.player = [];
    this.transits = [];
    this.matches = [];
    this.drift = [];
    this.ticks = 0;
    this.lastHeardT = null;     // host time up to which speech has been matched
    this.basisT = -Infinity;    // newest speech the current L rests on
    this.hostRtt = 0;
  }

  /** A host message: frames from host time t0, plus its send time, arrived at `arrival` (player clock). */
  addHost({ t0, sentAt, rtt, frames }, arrival) {
    const bytes = typeof frames === 'string' ? fromBase64(frames) : frames;
    for (let i = 0; i * CS.BANDS < bytes.length; i++) {
      this.host.push({ t: t0 + i * CS.HOP_MS, b: bytes.subarray(i * CS.BANDS, (i + 1) * CS.BANDS) });
    }
    if (typeof rtt === 'number') this.hostRtt = rtt;
    if (typeof sentAt === 'number') this.transits.push({ at: arrival, v: arrival - sentAt });
    this.trim(arrival);
  }

  addPlayer(t, bands) { this.player.push({ t, b: bands }); }

  trim(now) {
    while (this.transits.length && this.transits[0].at < now - CS.TRANSIT_KEEP_MS) this.transits.shift();
    const hEnd = this.host.length ? this.host[this.host.length - 1].t : 0;
    while (this.host.length && this.host[0].t < hEnd - CS.KEEP_MS) this.host.shift();
    while (this.player.length && this.player[0].t < now - CS.KEEP_MS) this.player.shift();
    this.matches = this.matches.filter((m) => m.at > now - CS.KEEP_MS * 2);
  }

  /** Message transit: arrival minus send time, smallest over the last 10 s. Includes the clock difference, like L. */
  transit() {
    if (!this.transits.length) return null;
    return Math.min(...this.transits.map((x) => x.v));
  }

  /** Host frames older than this (host clock) have certainly reached the player by `pNow`, for an L as large as `Lmax`. */
  arrivedBy(pNow, Lmax) {
    const pLast = this.player.length ? this.player[this.player.length - 1].t : pNow;
    return Math.min(pLast, pNow) - Lmax;
  }

  /** Begin capturing (or resume after a capture ended). */
  started() {
    this.player = [];
    this.status = this.L == null ? 'listening' : 'resuming';
    this.lastHeardT = null;
    this.unheardMs = 0;
  }
  /** The capture ended: Stop sharing, mic unplugged. */
  stopped() {
    this.player = [];
    this.status = this.L == null ? 'off' : 'stopped';
  }

  /**
   * One half-second step. Returns what changed, for the page and for tests:
   * { status, L, match } where match is the accepted match if any.
   */
  tick(now) {
    this.trim(now);
    this.ticks++;
    const out = { status: this.status, L: this.L, match: null };
    const transit = this.transit();
    if (transit == null || !this.host.length || !this.player.length
      || this.status === 'off' || this.status === 'stopped') return out;

    const tries = [];
    // Full search: every tick until synced, every other tick after.
    if (this.L == null || this.ticks % 2 === 0) {
      const lo = transit + CS.SEARCH_LO_MS, hi = transit + CS.SEARCH_HI_MS;
      const hEnd = this.arrivedBy(now, hi);
      const hStart = hEnd - CS.WINDOW_MS;
      if (this.host[0].t <= hStart) {
        const r = matchOnce(this.host, this.player, hStart, hEnd, lo, hi);
        if (r.L != null && r.conf != null) tries.push({ ...r, kind: 'full', tEnd: hEnd, at: now });
      }
    }
    // Local search around the current value, on the host's latest speech.
    if (this.L != null) {
      const lo = this.L + CS.LOCAL_LO_MS, hi = this.L + CS.LOCAL_HI_MS;
      const hEnd = this.arrivedBy(now, hi);
      const hStart = hEnd - CS.LOCAL_WINDOW_MS;
      if (this.host[0].t <= hStart) {
        const r = matchOnce(this.host, this.player, hStart, hEnd, lo, hi, CS.LOCAL_MIN_SPEECH_MS);
        if (r.L != null && r.conf != null) tries.push({ ...r, kind: 'local', tEnd: hEnd, at: now });
      }
    }

    for (const m of tries) {
      if (m.conf < CS.COUNT_CONF) continue;
      m.strong = m.conf >= CS.STRONG_CONF && m.z >= CS.STRONG_Z;
      this.matches.push(m);
      if (this.accept(m)) out.match = m;
      // Proof the page is hearing the host: a strong match anywhere, or a
      // counting one near the value in use. A bare conf of 1.3 is not enough
      // on its own, because sound with no host in it reaches that by chance
      // (j-trivia: mostly under 1.5), and it would keep resetting the count.
      const near = this.L != null && Math.abs(m.L - this.L) <= CS.STEP_MS;
      if (m.strong || near) {
        this.lastHeardT = Math.max(this.lastHeardT ?? -Infinity, m.tEnd);
        this.unheardMs = 0;
      }
      // Heard again near the value in use: a pause is over.
      if (near && (this.status === 'unheard' || this.status === 'resuming')) this.status = 'synced';
    }

    // Unheard speech: the host's own pattern says they talked, and nothing
    // matched it. Counted as it goes, because 20 s of speech is more than the
    // 15 s of frames kept.
    const limit = this.arrivedBy(now, (this.L ?? transit) + CS.LOCAL_HI_MS);
    const from = Math.max(this.countedT ?? -Infinity, this.lastHeardT ?? -Infinity, this.startedAt ?? -Infinity);
    if (limit > from) {
      this.unheardMs = (this.unheardMs || 0) + speechSince(this.host, from, limit);
      this.countedT = limit;
    }
    if (this.unheardMs >= CS.UNHEARD_MS) {
      if (this.L != null) this.status = 'unheard';
      else this.cantHear = true;
    }
    out.status = this.status; out.L = this.L;
    return out;
  }

  /** The trust rules. True when L changed or was confirmed. */
  accept(m) {
    // A match from speech older than what L rests on cannot overturn it.
    if (this.L != null && m.tEnd < this.basisT) return false;

    if (this.L == null || Math.abs(m.L - this.L) > CS.STEP_MS) {
      // First value, or a big change: the same three strong, agreeing matches.
      const v = this.firstValue();
      if (v == null) return false;
      this.set(v.L, v.basisT);
      this.drift = [];
      return true;
    }
    const d = Math.abs(m.L - this.L);
    if (d <= CS.DRIFT_MS) {
      this.drift.push(m.L);
      if (this.drift.length > CS.DRIFT_N) this.drift.shift();
      this.set(median(this.drift), m.tEnd);
      return true;
    }
    // Up to 150 ms: two strong recent matches that agree, half a second apart.
    if (!m.strong) return false;
    const near = this.matches.filter((x) => x.strong && x !== m && x.at > m.at - CS.RECENT_MS
      && Math.abs(x.L - m.L) <= CS.STEP_AGREE_MS && Math.abs(x.tEnd - m.tEnd) >= CS.STEP_GAP_MS
      && x.tEnd >= this.basisT);
    if (near.length + 1 < CS.STEP_N) return false;
    this.set((m.L + near[near.length - 1].L) / 2, m.tEnd);
    this.drift = [this.L];
    return true;
  }

  firstValue() {
    const strong = this.matches.filter((x) => x.strong && x.tEnd >= (this.L == null ? -Infinity : this.basisT));
    for (let i = strong.length - 1; i >= 0; i--) {
      const group = strong.filter((x) => Math.abs(x.L - strong[i].L) <= CS.FIRST_AGREE_MS);
      if (group.length < CS.FIRST_N) continue;
      const ends = group.map((x) => x.tEnd);
      if (Math.max(...ends) - Math.min(...ends) < CS.FIRST_SPREAD_MS) continue;
      return { L: median(group.map((x) => x.L)), basisT: Math.max(...ends) };
    }
    return null;
  }

  set(L, basisT) {
    this.L = L;
    this.basisT = Math.max(this.basisT, basisT);
    this.status = 'synced';
    this.cantHear = false;
  }

  /** extra = L − transit: how much later than the game's message this player's light comes on. */
  extra() {
    const t = this.transit();
    return this.L == null || t == null ? null : this.L - t;
  }
}

function speechSince(host, from, to) {
  // Speech against the quietest 3% of the last 15 s, as the host's own check does.
  const rows = host.filter((f) => f.t > from && f.t <= to).map((f) => f.b);
  if (rows.length < 20) return 0;
  const lv = host.map((f) => frameDb(f.b));
  const q = pct(lv, CS.QUIET_PCT);
  let n = 0;
  for (const r of rows) if (frameDb(r) > q + CS.SPEECH_DB) n++;
  return n * CS.HOP_MS;
}

/**
 * How long the host must wait before a buzz can win (fair buzzing).
 *
 * Buzzes are ranked by each player's reaction time from their OWN light, so a
 * player who hears the host 800 ms later is not 800 ms behind — but only if
 * the host waits for them. Every player who has not buzzed is allowed 3.5 ×
 * their worst round trip plus their extra; W is the largest. With B the
 * buzz's reaction time and R the time from the host's press to the buzz's
 * arrival, the buzz waits max(W + B − R, 250 ms) after it arrives.
 *
 *   waiting: [{ rttWorst, extra }] for players yet to buzz (extra 0 if unsynced)
 */
export function buzzWaitMs({ waiting, B, R }) {
  if (!waiting.length) return 0;
  const W = Math.max(...waiting.map((p) => CS.WAIT_RTT_MULT * (p.rttWorst || 0) + Math.max(0, p.extra || 0)));
  return Math.max(W + B - R, CS.WAIT_MIN_MS);
}

/** The delay a player sees: extra plus the time the message spent getting from host to player. */
export function shownDelay(extra, hostRtt, playerRtt) {
  if (extra == null) return null;
  return Math.round(extra + ((hostRtt || 0) + (playerRtt || 0)) / 2);
}

// ---------------------------------------------------------------- capture
//
// Browser only. Both sides turn off echo cancellation, noise suppression and
// automatic gain: each reshapes the sound, and the host's version of it and
// the player's would be reshaped differently.

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

// The worklet posts raw samples with the index of the first one. Loaded from a
// Blob so every page can use it without a second file to serve.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; this.first = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.n === 0) this.first = currentFrame;
      this.buf.set(ch, this.n); this.n += ch.length;
      if (this.n >= 1024) {
        this.port.postMessage({ first: this.first, samples: this.buf.slice(0, this.n) });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('callsync-tap', Tap);`;

/**
 * Open a capture and feed frames to `onFrame(t, bands)`.
 *   kind: 'mic' (host, or a player on speakers) | 'system' (a player on headphones)
 * Resolves to { stop(), kind, ctx } or rejects with an Error whose `code`
 * says why: 'denied', 'no-audio' (shared without ticking audio), 'unsupported'.
 */
export async function openCapture(kind, { onFrame, onEnded }) {
  const md = navigator.mediaDevices;
  let stream;
  try {
    if (kind === 'system') {
      if (!md?.getDisplayMedia) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
      // The video is unused; one frame a second keeps it cheap.
      stream = await md.getDisplayMedia({ video: { frameRate: 1 }, audio: { ...RAW, suppressLocalAudioPlayback: false },
        systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' });
    } else {
      if (!md?.getUserMedia) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
      stream = await md.getUserMedia({ audio: RAW });
    }
  } catch (e) {
    if (e.code) throw e;
    throw Object.assign(new Error(e.message || 'denied'), { code: 'denied' });
  }
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw Object.assign(new Error('no audio was shared'), { code: 'no-audio' });
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  // Browsers start audio suspended until the page is clicked; the caller opens
  // a capture from a click, so this resume is allowed.
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const clock = new SampleClock(ctx.sampleRate, ctx);
  const maker = new FrameMaker(ctx.sampleRate, (bands, lastIndex) => onFrame(clock.toPage(lastIndex), bands));
  const mute = ctx.createGain(); mute.gain.value = 0;
  let node;
  const feed = (first, samples) => {
    clock.arrived(first + samples.length);
    maker.push(samples, first);
  };
  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'callsync-tap');
    node.port.onmessage = (e) => feed(e.data.first, e.data.samples);
  } else {
    // Old Safari. Deprecated, but it still runs.
    node = ctx.createScriptProcessor(1024, 1, 1);
    let index = 0;
    node.onaudioprocess = (e) => {
      const s = new Float32Array(e.inputBuffer.getChannelData(0));
      feed(index, s); index += s.length;
    };
  }
  // Routed into a muted gain so the graph runs without playing the call twice.
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  let done = false;
  const stop = () => {
    if (done) return; done = true;
    stream.getTracks().forEach((t) => t.stop());
    try { node.disconnect(); src.disconnect(); } catch (e) { /* already gone */ }
    ctx.close().catch(() => {});
  };
  // Stop sharing, the mic unplugged, the tab shared closed.
  for (const t of stream.getTracks()) t.addEventListener('ended', () => { if (!done) { stop(); onEnded?.(); } });
  return { stop, kind, ctx };
}

// ---------------------------------------------------------------- host side

/**
 * The host's page: listen to the host's microphone and send its pattern,
 * 20 frames at a time, through `send`. Also watches its own mic: warns when
 * it cannot be opened, or when it has heard no speech for 60 s.
 *
 *   send({ t0, sentAt, rtt, frames })   frames base64, 32 bytes a frame
 *   onStatus({ state: 'off'|'on'|'error'|'silent', error })
 */
export class HostSync {
  constructor({ send, onStatus }) {
    this.send = send; this.onStatus = onStatus || (() => {});
    this.buf = []; this.t0 = null; this.rtt = 0;
    this.state = 'off'; this.cap = null;
    this.levels = [];       // { t, db } for the silence check
    this.lastSpeech = null;
  }
  setRtt(ms) { this.rtt = ms; }
  async start() {
    if (this.cap) return;
    try {
      this.cap = await openCapture('mic', {
        onFrame: (t, b) => this.frame(t, b),
        onEnded: () => { this.cap = null; this.set('error', 'The microphone stopped.'); },
      });
      this.startedAt = pageNow(); this.lastSpeech = null;
      this.set('on');
      clearInterval(this.watch);
      this.watch = setInterval(() => this.check(), 5000);
    } catch (e) {
      this.set('error', e.code === 'denied' ? 'The browser refused the microphone.' : 'The microphone could not be opened.');
    }
  }
  stop() { this.cap?.stop(); this.cap = null; clearInterval(this.watch); this.set('off'); }
  set(state, error = null) { this.state = state; this.error = error; this.onStatus({ state, error }); }
  frame(t, bands) {
    if (this.t0 == null) this.t0 = t;
    this.buf.push(bands);
    const db = frameDb(bands);
    this.levels.push({ t, db });
    while (this.levels.length && this.levels[0].t < t - CS.KEEP_MS) this.levels.shift();
    if (this.buf.length >= CS.FRAMES_PER_MSG) {
      const all = new Uint8Array(this.buf.length * CS.BANDS);
      this.buf.forEach((b, i) => all.set(b, i * CS.BANDS));
      // The first frame's time is the one that matters: the rest are 5 ms apart.
      this.send({ t0: Math.round(this.t0 * 10) / 10, sentAt: Math.round(pageNow() * 10) / 10,
        rtt: Math.round(this.rtt), frames: toBase64(all) });
      this.buf = []; this.t0 = null;
    }
  }
  check() {
    if (!this.cap || this.levels.length < 200) return;
    const q = pct(this.levels.map((x) => x.db), CS.QUIET_PCT);
    // Speech in the last five seconds against the quietest 3% of the last 15.
    const recent = this.levels.filter((x) => x.t > pageNow() - 5000);
    if (recent.filter((x) => x.db > q + CS.SPEECH_DB).length * CS.HOP_MS > 300) this.lastSpeech = pageNow();
    const since = pageNow() - (this.lastSpeech ?? this.startedAt);
    if (since > CS.HOST_SILENT_MS && this.state === 'on') this.set('silent', 'No speech heard from your microphone for a minute.');
    else if (since <= CS.HOST_SILENT_MS && this.state === 'silent') this.set('on');
  }
}

// ---------------------------------------------------------------- player side

const STORE = 'callsync:choice';

/**
 * The player's page: capture the call as this player hears it, match it to
 * the host's pattern, and say when the host's moments happen here.
 *
 *   onStatus(info)  whenever the status or the delay changes; see info()
 */
export class PlayerSync {
  constructor({ onStatus } = {}) {
    this.m = new Matcher();
    this.onStatus = onStatus || (() => {});
    this.cap = null; this.kind = null;
    this.bluetooth = load('callsync:bt') === '1';
    this.rtt = 0;
    this.holdUntil = 0;
    this.skipped = false;
    this.lastKey = '';
  }

  /** The host's pattern message, as relayed by the server. */
  hostFrames(msg) { this.m.addHost(msg, pageNow()); }

  setRtt(ms) { this.rtt = ms; }
  setBluetooth(on) { this.bluetooth = !!on; save('callsync:bt', on ? '1' : '0'); this.emit(true); }

  async start(kind) {
    this.cap?.stop(); this.cap = null;
    this.skipped = false;
    this.kind = kind;
    this.m.started();
    this.m.startedAt = this.m.host.length ? this.m.host[this.m.host.length - 1].t : -Infinity;
    try {
      this.cap = await openCapture(kind === 'headphones' ? 'system' : 'mic', {
        onFrame: (t, b) => this.m.addPlayer(t, b),
        onEnded: () => { this.cap = null; this.m.stopped(); this.emit(true); },
      });
    } catch (e) {
      this.m.stopped();
      this.emit(true);
      throw e;
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), CS.TICK_MS);
    this.emit(true);
  }

  stop() { this.cap?.stop(); this.cap = null; this.m.stopped(); this.emit(true); }
  skip() { this.stop(); this.skipped = true; this.emit(true); }

  tick() {
    // Matching takes a moment of work; never while a light is due.
    if (pageNow() < this.holdUntil) return;
    const was = this.m.L;
    this.m.tick(pageNow());
    // Speakers is remembered only once it has worked.
    if (this.kind === 'speakers' && this.m.L != null && was == null) save(STORE, 'speakers');
    this.emit();
  }

  /** L in use: synced, or paused with a value kept from earlier. */
  usable() { return this.m.L != null; }

  /**
   * The page-clock moment the host's `hostAt` reaches this player, including
   * the Bluetooth allowance. Null when there is no value yet.
   */
  localTime(hostAt) {
    if (!this.usable() || typeof hostAt !== 'number') return null;
    return hostAt + this.m.L + (this.bluetooth ? CS.BLUETOOTH_MS : 0);
  }

  /** Hold matching until just after this page-clock moment. */
  holdFor(localMs) { this.holdUntil = Math.max(this.holdUntil, localMs + CS.LIGHT_GUARD_MS); }

  status() {
    const s = this.m.status;
    if (s === 'off') return 'not-synced';
    if (s === 'listening') return 'listening';
    if (s === 'synced') return 'synced';
    if (s === 'stopped') return 'paused-stopped';
    if (s === 'unheard') return 'paused-unheard';
    return 'paused-resuming';
  }

  info() {
    const extra = this.m.extra();
    return {
      status: this.status(), kind: this.kind, skipped: this.skipped,
      L: this.m.L == null ? null : Math.round(this.m.L * 10) / 10,
      extra: extra == null ? null : Math.round(extra),
      delay: shownDelay(extra, this.m.hostRtt, this.rtt),
      bluetooth: this.bluetooth,
      cantHear: !!this.m.cantHear,
      hearingHost: this.m.host.length > 0,
    };
  }

  emit(force = false) {
    const i = this.info();
    const key = `${i.status}|${i.delay == null ? '' : Math.round(i.delay / 10)}|${i.cantHear}|${i.skipped}|${i.bluetooth}|${i.kind}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.onStatus(i);
  }

  /** Speakers starts by itself next time if it locked before and the mic is already allowed. */
  static async rememberedSpeakers() {
    if (load(STORE) !== 'speakers') return false;
    try {
      const p = await navigator.permissions?.query({ name: 'microphone' });
      return p?.state === 'granted';
    } catch (e) { return false; }
  }

  /** Can this browser share the computer's sound at all? */
  static headphonesSupported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
      && /Chrome|Edg\//.test(navigator.userAgent || '') && !/Mobile/.test(navigator.userAgent || '');
  }
}

function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

/** One-line footer text for each status, the same on every game's player page. */
export function footerText(i) {
  if (!i) return '';
  switch (i.status) {
    case 'synced': return `Synced · delay ${i.delay ?? '?'} ms`;
    case 'listening': return i.cantHear ? 'The mic can’t hear the host: try Headphones' : 'Listening for the host…';
    case 'paused-stopped': return 'Sync paused: click to resume';
    case 'paused-unheard': return i.kind === 'speakers'
      ? 'Sync paused: the mic can’t hear the host'
      : 'Sync paused: the host isn’t coming through';
    case 'paused-resuming': return 'Sync paused: resuming…';
    default: return i.skipped ? 'Not synced: your light comes on early. Click to sync' : 'Not synced: click to sync';
  }
}
