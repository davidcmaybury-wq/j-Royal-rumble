// The Kokoro child. See src/tts.js for why this is a separate process.
//
// Loads the model once on the first request (or on {warm:true}), then answers
// {id, text, voice} with {id, pcm, rate} — 16-bit samples, so the parent can
// wrap them in a WAV header without a decoder. Any failure answers {id, error}
// with a sentence that names the fix; the parent never sees a bare rejection.
//
// kokoro-js is imported lazily and is NOT in package.json: it measured out on
// the live box (738 MB of node_modules, 461 MB of worker RSS, p90 18.9 s a
// clue — see src/tts.js), so a box that will never run it does not carry it.
// To try it on a bigger box, `npm install --no-save kokoro-js` first. A missing
// package is reported, not swallowed.

import { float32ToPcm16 } from './tts.js';

// The q8 weights are the smallest build that still sounds like a person, about
// a third the size of fp32. On a 1 GB box the size is the whole argument.
const MODEL = process.env.KOKORO_MODEL || 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = process.env.KOKORO_DTYPE || 'q8';

let tts = null;
let loading = null;

async function load() {
  if (tts) return tts;
  if (loading) return loading;
  loading = (async () => {
    let mod;
    try {
      mod = await import('kokoro-js');
    } catch (e) {
      throw new Error(`kokoro-js is not installed (${e.message.split('\n')[0]}); run \`npm install --no-save kokoro-js\` to try it, or set RUMBLE_TTS=piper`);
    }
    // Model files go beside the clips rather than into node_modules, which
    // `npm install` on deploy would throw away, forcing a re-download at every
    // boot after a release.
    const dir = process.env.RUMBLE_TTS_DIR;
    if (dir) {
      try {
        const { env } = await import('@huggingface/transformers');
        env.cacheDir = `${dir}/models`;
      } catch { /* older kokoro-js bundles its own transformers; the default cache still works */ }
    }
    let t;
    try {
      t = await mod.KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' });
    } catch (e) {
      // The first run downloads the model from huggingface.co; a box with no
      // route there fails here, and "fetch failed" on its own does not say so.
      const cause = e.cause?.message || e.message;
      throw new Error(`could not load ${MODEL} (${cause}); the first run downloads it from huggingface.co, so the box needs outbound HTTPS there once, after which it is cached under ${dir || 'the transformers cache'}`);
    }
    tts = t;
    return t;
  })();
  try { return await loading; } finally { loading = null; }
}

process.on('message', async (m) => {
  try {
    const t = await load();
    if (m.warm) return process.send({ id: m.id, ok: true, rss: process.memoryUsage().rss });
    const audio = await t.generate(m.text, { voice: m.voice });
    const samples = audio.audio ?? audio.data;
    const rate = audio.sampling_rate ?? audio.samplingRate ?? 24000;
    if (!samples || !samples.length) throw new Error('kokoro returned no samples');
    process.send({ id: m.id, pcm: float32ToPcm16(samples), rate, rss: process.memoryUsage().rss });
  } catch (e) {
    process.send({ id: m.id, error: e.message });
  }
});

// A parent that disconnects has died or restarted; there is nobody to answer.
process.on('disconnect', () => process.exit(0));
