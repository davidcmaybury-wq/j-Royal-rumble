// How fast, and how big, is each voice on this machine?
//
//   node tools/tts-bench.mjs                # every engine that is configured
//   node tools/tts-bench.mjs kokoro piper   # just these
//   RUMBLE_RUNS=40 node tools/tts-bench.mjs # more clues
//
// Run it ON THE BOX, not on a laptop: the question it answers is whether the
// 2 vCPU / 1 GB Lightsail instance can keep the voice ahead of the game, and
// nothing about a 10-core laptop transfers. It prints, per engine and voice:
// synthesis time per clip, the clip's length, the ratio between them (RTF —
// under 1.0 means faster than real time), characters per second of speech
// (which `readingTimeMs` in src/tts.js assumes at READ_CHARS_PER_SEC and is
// retuned from), and the resident memory of the process doing the work — the
// worker for kokoro, the piper child for piper, this process for the rest.
//
// Two numbers decide the engine. The p90 synthesis time for a clue has to sit
// comfortably inside the ~12 s pick window, since on a fresh board the first
// pick can beat the background queue. And the worker's RSS plus the server's
// ~375 MB peak has to fit under 1 GB with room for the swap not to be the thing
// keeping the match up. Both are printed; neither is decided here.
//
// Clips are written to the cache like any other run, so the second pass over
// the same clues is instant — that is the cache working, not the engine, and
// the bench clears its own clues first so the numbers are synthesis.

import { gunzipSync } from 'node:zlib';
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tts from '../src/tts.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.env.RUMBLE_RUNS || 12);
const want = process.argv.slice(2);
const names = want.length ? want : tts.ENGINES.filter((e) => e !== 'silent');

// Real clues, drawn deterministically so two runs on two boxes compare.
const lib = gunzipSync(readFileSync(join(__dir, '../data/library.ndjson.gz')))
  .toString('utf8').split('\n').filter(Boolean);
let seed = 20260914;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const clues = [];
while (clues.length < RUNS && lib.length) {
  const cat = JSON.parse(lib[Math.floor(rng() * lib.length)]);
  const c = cat.clues?.[Math.floor(rng() * (cat.clues?.length || 0))];
  if (c?.text && c.text.length > 40 && c.text.length < 260) clues.push(c.text);
}
// The fixed lines every match says, in the voice that says them.
const fixed = {
  mike: ['Presidents, four hundred.', 'Correct.', 'No.', 'The correct response: Millard Fillmore.',
    'You have the board, Priya.', 'Objection on the last ruling — press O to join.'],
  gene: ['Number fourteen, Priya, enters with three thousand!', 'Eliminated!',
    'The field is clear!', 'Overtime! Stakes are doubled.', 'Top rope!'],
};

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mb = (b) => (b / 1e6).toFixed(0);

function rssOf(pid) {
  try {
    const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+) kB/);
    return m ? Number(m[1]) * 1024 : null;
  } catch { return null; }   // not Linux; the worker reports its own via IPC on kokoro
}

const outDir = join(tts.DIR, 'bench');
mkdirSync(outDir, { recursive: true });

console.log(`tts-bench on ${process.platform} ${process.arch}, ${RUNS} clues, cache at ${tts.DIR}`);
console.log(`server-side RSS before anything: ${mb(process.memoryUsage().rss)} MB\n`);

for (const name of names) {
  const cfg = tts.useEngine(name);
  console.log(`== ${name} ==`);
  if (!cfg.ok) { console.log(`  not configured: ${cfg.reason}\n`); continue; }
  // Synthesis, not the cache: drop this engine's clips before timing. The
  // whole engine directory goes, which is fine — a bench is not a live server,
  // and a match rebuilds what it needs in the background.
  if (existsSync(join(tts.DIR, name))) rmSync(join(tts.DIR, name), { recursive: true, force: true });

  const t0 = Date.now();
  try { await tts.warm(); } catch (e) { console.log(`  failed to start: ${e.message}\n`); tts.stop(); continue; }
  console.log(`  warm-up (model load / worker start): ${Date.now() - t0} ms`);

  for (const host of ['mike', 'gene']) {
    const voice = tts.voiceFor(host);
    const rows = [];
    for (const text of [...clues, ...fixed[host]]) {
      try {
        const r = await tts.speak(text, voice);
        rows.push({ chars: text.length, synthMs: r.synthMs, durationMs: r.durationMs });
      } catch (e) {
        // Numbered and timed, so a run of failures can be told apart from a
        // scatter: five timeouts that all land last mean a worker that wedged,
        // five spread through the run mean a worker that kept answering.
        console.log(`  ${host} FAILED #${rows.length + 1} at +${((Date.now() - t0) / 1000).toFixed(1)}s on "${text.slice(0, 40)}…": ${e.message}`);
        rows.push(null);
      }
    }
    const ok = rows.filter(Boolean);
    if (!ok.length) { console.log(`  ${host} (${voice}): nothing synthesized\n`); continue; }
    const synth = ok.map((r) => r.synthMs), rtf = ok.map((r) => r.synthMs / r.durationMs);
    const cps = ok.reduce((n, r) => n + r.chars, 0) / (ok.reduce((n, r) => n + r.durationMs, 0) / 1000);
    const st = tts.status();
    const rss = st.workerPid ? rssOf(st.workerPid) : null;
    console.log(`  ${host} (${voice}): ${ok.length}/${rows.length} clips`);
    console.log(`    synthesis  p50 ${pct(synth, 0.5)} ms   p90 ${pct(synth, 0.9)} ms   max ${Math.max(...synth)} ms`);
    console.log(`    RTF        p50 ${pct(rtf, 0.5).toFixed(2)}   p90 ${pct(rtf, 0.9).toFixed(2)}`);
    console.log(`    speech     ${cps.toFixed(1)} chars/s  (readingTimeMs assumes ${tts.READ_CHARS_PER_SEC})`);
    console.log(`    RSS        worker ${rss == null ? 'n/a' : mb(rss) + ' MB'}   this process ${mb(process.memoryUsage().rss)} MB`);
    // One clip to listen to, so the voice can be auditioned, not just timed.
    const sample = await tts.speak(fixed[host][0], voice);
    const f = join(outDir, `${name}-${host}.wav`);
    writeFileSync(f, sample.audio);
    console.log(`    listen     ${f}`);
  }
  tts.stop();
  console.log();
}
