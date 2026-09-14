// The host's voice: text in, a WAV clip and its length out.
//
// The autohost never speaks live. It schedules the buzzers off the length of
// the clip it is about to play, so the one thing this module must always get
// right is `durationMs` — everything else is an engine detail. Every engine
// therefore ends in the same place: a 16-bit mono WAV in memory, whose header
// says how long it is. A clip that plays is a clip whose length is known.
//
// Four engines share one shape, `speak(text, voice) → { audio, durationMs }`:
//
//   silent     a WAV of silence, as long as the text would take to read. Used
//              by the tests and by the text fallback when the real engine is
//              down: the clue is on every screen, so the game waits the
//              reading time and arms.
//   kokoro     Kokoro-82M through kokoro-js, in a child process. The better
//              voice of the two open ones, and measured OUT on this box
//              (2026-09-14, tools/tts-bench.mjs): p50 10.7 s and p90 18.9 s per
//              clue against a 12 s pick window, RTF above 2, 461 MB of worker
//              RSS on a 1 GB box that already peaks near 375 MB. The adapter
//              stays so a bigger box can measure again; the package is not a
//              dependency and must be installed by hand to try it. Out of
//              process because a model that OOMs must take only itself down.
//   piper      the piper binary, spawned per clip. Smaller and faster on a
//              small CPU; the open-source candidate still standing, and
//              unmeasured until `npm run tts-bench` runs with it installed.
//   elevenlabs hosted, paid, the upgrade for later. Same shape, so the swap is
//              RUMBLE_TTS=elevenlabs and a key, nothing in the caller.
//
// Clips are cached on disk by engine, voice and text, so a clue is synthesized
// once per library rather than once per match, an undo-and-replay never
// re-synthesizes, and — with a paid engine — the cache is the bill.
//
// It fails closed and says why. An unknown engine, a missing binary, a missing
// key: `speak()` throws with the variable it wants in the message, and
// `status()` reports the same for /api/health. The entrance-music path used to
// swallow every refusal in a `catch(() => {})`, and a silent entrance was
// indistinguishable from one the room could not hear. Not again.

import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));

export const ENGINES = ['silent', 'kokoro', 'piper', 'elevenlabs'];

// Where clips (and, for kokoro, the downloaded model) live. /data is the box's
// persistent volume, the same choice the logs and bug reports make; a local
// run writes beside the app and .gitignore keeps it out of the tree.
export const DIR = process.env.RUMBLE_TTS_DIR
  || (existsSync('/data') ? '/data/tts' : join(__dir, '../tts-cache'));

// A default voice per engine and per host. Mike reads the clues; Gene calls the
// ring. These are placeholders for David to audition, not a decision — the
// bench prints a clip in each so they can be heard side by side.
export const DEFAULT_VOICES = {
  silent:     { mike: 'silent', gene: 'silent' },
  kokoro:     { mike: 'am_michael', gene: 'am_fenrir' },
  piper:      { mike: 'en_US-ryan-medium', gene: 'en_US-joe-medium' },
  elevenlabs: { mike: '', gene: '' },   // voice ids; there is no sensible default
};

// How fast the host speaks, in characters per second of audio. This sizes the
// silent clip the tests use and, more importantly, the text fallback: when the
// engine is down the clue is on every screen and the buzzers arm after this
// long, so an estimate that runs fast arms them while the host would still be
// speaking — the one failure that costs a race. It therefore errs slow.
//
// Measured on the box 2026-09-14 (tools/tts-bench.mjs, twelve real clues).
// Piper, which is the engine that shipped: en_US-ryan 16.0, en_US-joe 14.9.
// The default is the slower of the two shipping voices.
//
// This number has now been wrong twice in two directions, which is the whole
// lesson. It was 15 by guess. It was then set to 11.5, correctly measured — on
// Kokoro, the engine that was eliminated the same evening, leaving it 30% slow.
// A constant is only as good as the engine it was taken from: re-measure when
// the engine changes, when a voice changes, and pass the measured figure rather
// than relying on this default where the voice is known.
export const READ_CHARS_PER_SEC = 14.9;
export function readingTimeMs(text, charsPerSec = READ_CHARS_PER_SEC) {
  const chars = String(text || '').replace(/\s+/g, ' ').trim().length;
  return Math.max(400, Math.round(chars / charsPerSec * 1000));
}

// One request must not stall a match. Kokoro on a cold cache can take several
// seconds for a long clue on two cores; twenty is far past anything that
// counts as working, and past that the caller falls back to the reading time.
const SPEAK_TIMEOUT_MS = Number(process.env.RUMBLE_TTS_TIMEOUT_MS || 20000);

const stats = { engine: null, spoken: 0, cached: 0, failed: 0, lastError: null, worker: null };

export class TtsError extends Error {}

// ---------------------------------------------------------------- WAV helpers

// The clip's own header is the source of truth for its length. Parsing it
// rather than trusting what an engine reported means every engine is held to
// the same number the browser will play.
export function wavDurationMs(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF'
      || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new TtsError('not a WAV file');
  }
  let off = 12, rate = 0, channels = 0, bits = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 10);
      rate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === 'data') {
      if (!rate || !channels || !bits) throw new TtsError('WAV data before fmt');
      const bytes = Math.min(size, buf.length - off - 8);
      return Math.round(bytes / (rate * channels * bits / 8) * 1000);
    }
    off += 8 + size + (size & 1);
  }
  throw new TtsError('WAV has no data chunk');
}

// Wrap 16-bit little-endian PCM in a header. Used by the silent engine, by
// the kokoro worker (which hands back raw samples) and by elevenlabs (asked
// for PCM so that the length is computable without an MP3 decoder).
export function pcm16ToWav(pcm, rate, channels = 1) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function float32ToPcm16(samples) {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return out;
}

// ----------------------------------------------------------------- the engines

const engines = {
  silent: {
    configure: () => ({ ok: true }),
    async speak(text) {
      const ms = readingTimeMs(text);
      const rate = 8000;   // nothing to hear; keep the file small
      return pcm16ToWav(Buffer.alloc(Math.round(rate * ms / 1000) * 2), rate);
    },
  },

  kokoro: {
    configure: () => ({ ok: true }),
    async speak(text, voice) {
      const w = kokoroWorker();
      const { pcm, rate } = await w.ask({ text, voice });
      return pcm16ToWav(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), rate);
    },
    stop: () => { stats.worker?.child.kill(); stats.worker = null; },
  },

  piper: {
    configure: () => (process.env.PIPER_BIN || whichSync('piper'))
      ? { ok: true }
      : { ok: false, reason: 'no piper binary: set PIPER_BIN or put `piper` on the PATH' },
    async speak(text, voice) {
      const bin = process.env.PIPER_BIN || 'piper';
      const out = join(tmpdir(), `rumble-piper-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
      // `-m` takes a voice name (piper1-gpl downloads it) or a path to an .onnx
      // (the archived binary). `-f` is the output file. Both spellings of piper
      // accept the short flags, which is why they are used rather than the long
      // ones that differ between the two.
      const args = ['-m', voice, '-f', out];
      if (process.env.PIPER_DATA_DIR) args.push('--data-dir', process.env.PIPER_DATA_DIR);
      await run(bin, args, text + '\n');
      const buf = readFileSync(out);
      try { unlinkSync(out); } catch { /* a stray temp file is not a failure */ }
      return buf;
    },
  },

  elevenlabs: {
    configure: () => process.env.ELEVENLABS_API_KEY
      ? { ok: true }
      : { ok: false, reason: 'no ELEVENLABS_API_KEY set' },
    async speak(text, voice) {
      if (!voice) throw new TtsError('elevenlabs needs a voice id: set RUMBLE_VOICE_MIKE and RUMBLE_VOICE_GENE');
      const model = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
      // PCM rather than MP3 so the length comes from the bytes, same as every
      // other engine, with no decoder in the server.
      const rate = 22050;
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_${rate}`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: model }),
        signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
      });
      if (!res.ok) throw new TtsError(`elevenlabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return pcm16ToWav(Buffer.from(await res.arrayBuffer()), rate);
    },
  },
};

function whichSync(name) {
  for (const p of (process.env.PATH || '').split(':')) {
    if (p && existsSync(join(p, name))) return join(p, name);
  }
  return null;
}

function run(bin, args, stdin) {
  return new Promise((resolve, reject) => {
    let err = '';
    const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new TtsError(`${bin} took longer than ${SPEAK_TIMEOUT_MS}ms`)); }, SPEAK_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(new TtsError(`could not start ${bin}: ${e.message}`)); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new TtsError(`${bin} exited ${code}: ${err.trim().split('\n').pop() || 'no output'}`));
    });
    child.stdin.end(stdin);
  });
}

// The kokoro child. Forked once, kept for the life of the server, restarted
// on the next request if it dies. Requests carry an id so a slow one cannot
// answer a later one.
function kokoroWorker() {
  if (stats.worker && !stats.worker.dead) return stats.worker;
  // Overridable so the timeout and restart paths can be tested with a stub
  // that answers, hangs or dies on cue, with no model behind it.
  const script = process.env.RUMBLE_TTS_WORKER || join(__dir, 'tts-worker.mjs');
  const child = fork(script, [], {
    env: { ...process.env, RUMBLE_TTS_DIR: DIR },
    serialization: 'advanced',     // so a Float32Array crosses without a copy to JSON
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  // The worker must not be the thing keeping the parent alive: a bench or a
  // test that has finished should exit without remembering to kill it, and the
  // server has its own listeners to stay up on.
  child.unref();
  child.channel?.unref();
  const pending = new Map();
  let seq = 0;
  const w = {
    child, dead: false, pid: child.pid,
    ask(msg) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new TtsError(`kokoro took longer than ${SPEAK_TIMEOUT_MS}ms`));
        }, SPEAK_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, ...msg });
      });
    },
  };
  child.on('message', (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id);
    if (m.error) p.reject(new TtsError(m.error)); else p.resolve(m);
  });
  child.on('exit', (code, signal) => {
    w.dead = true;
    const why = signal ? `killed by ${signal}` : `exited ${code}`;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new TtsError(`kokoro worker ${why}`)); }
    pending.clear();
    stats.lastError = `kokoro worker ${why}`;
  });
  stats.worker = w;
  return w;
}

// -------------------------------------------------------------- configuration

function chooseEngine() {
  const name = process.env.RUMBLE_TTS || 'silent';
  if (!ENGINES.includes(name)) {
    return { name, ok: false, reason: `RUMBLE_TTS=${name} is not an engine; one of ${ENGINES.join(', ')}` };
  }
  const c = engines[name].configure();
  return { name, ok: c.ok, reason: c.ok ? null : c.reason };
}
let chosen = chooseEngine();
stats.engine = chosen.name;

// For the bench and the tests, which want to try engines the environment did
// not choose. Not for the server, which reads RUMBLE_TTS once at boot.
export function useEngine(name) {
  const prev = process.env.RUMBLE_TTS;
  process.env.RUMBLE_TTS = name;
  chosen = chooseEngine();
  stats.engine = chosen.name;
  if (prev === undefined) delete process.env.RUMBLE_TTS; else process.env.RUMBLE_TTS = prev;
  return chosen;
}

// The voice each host speaks in, engine-specific. Overridable so David can
// audition without editing code.
export function voiceFor(host) {
  const key = host === 'gene' ? 'RUMBLE_VOICE_GENE' : 'RUMBLE_VOICE_MIKE';
  return process.env[key] || DEFAULT_VOICES[chosen.name]?.[host === 'gene' ? 'gene' : 'mike'] || '';
}

// ---------------------------------------------------------------------- speak

function cachePath(engine, voice, text) {
  const key = createHash('sha1').update(`${engine}\n${voice}\n${text}`).digest('hex');
  return join(DIR, engine, key.slice(0, 2), `${key}.wav`);
}

/**
 * A clip for one line, in one voice.
 *
 * `voice` is an engine-specific id; callers normally pass `voiceFor('mike')`
 * or `voiceFor('gene')`. Throws a TtsError naming the fix when the engine is
 * not usable — callers that must not stall (the autohost) catch it and fall
 * back to `readingTimeMs`, and say so.
 */
export async function speak(text, voice = voiceFor('mike')) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) throw new TtsError('nothing to say');
  if (!chosen.ok) {
    stats.failed++; stats.lastError = chosen.reason;
    throw new TtsError(chosen.reason);
  }
  const engine = chosen.name;
  const path = cachePath(engine, voice, t);
  if (engine !== 'silent' && existsSync(path)) {
    const audio = readFileSync(path);
    stats.cached++;
    return { audio, mime: 'audio/wav', durationMs: wavDurationMs(audio), engine, voice, cached: true };
  }
  const started = Date.now();
  let audio;
  try {
    audio = await engines[engine].speak(t, voice);
  } catch (e) {
    stats.failed++; stats.lastError = e.message;
    throw e instanceof TtsError ? e : new TtsError(`${engine}: ${e.message}`);
  }
  const durationMs = wavDurationMs(audio);
  stats.spoken++;
  if (engine !== 'silent') {
    // Written whole then renamed, so a crash mid-write cannot leave a clip the
    // next boot will trust.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path + '.tmp', audio);
    renameSync(path + '.tmp', path);
  }
  return { audio, mime: 'audio/wav', durationMs, engine, voice, cached: false, synthMs: Date.now() - started };
}

/** Warm the engine (load the model, spawn the worker) without speaking. */
export async function warm() {
  if (!chosen.ok) throw new TtsError(chosen.reason);
  if (chosen.name === 'kokoro') await kokoroWorker().ask({ warm: true });
}

export function stop() { engines[chosen.name]?.stop?.(); }

/** For /api/health and the bench. */
export function status() {
  return {
    engine: chosen.name, configured: chosen.ok, reason: chosen.reason, dir: DIR,
    voices: { mike: voiceFor('mike'), gene: voiceFor('gene') },
    spoken: stats.spoken, cached: stats.cached, failed: stats.failed, lastError: stats.lastError,
    workerPid: stats.worker && !stats.worker.dead ? stats.worker.pid : null,
  };
}
