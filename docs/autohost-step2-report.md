# Autohost step two — what was touched, and what was not measured

*From the design chat, 2026-09-14, against `0da9110`. Left in the working tree per `docs/autohost-contract.md`; nothing committed, nothing shipped.*

## Revised after `docs/autohost-step2-answer.md`, same day

The dev chat measured on the box and Kokoro is out — p90 18.9 s a clue against a 12 s window, RTF above 2, 461 MB of worker RSS. Everything §3 of the answer asked for is done and the tree is green:

`kokoro-js` is gone from `package.json`. The adapter and the worker stay; the worker imports the package lazily and, when it is absent, says `run npm install --no-save kokoro-js to try it, or set RUMBLE_TTS=piper`. The header comment in `src/tts.js` now records the measurement in place, so nobody reads "first choice" off the file again.

`readingTimeMs` errs slow. `READ_CHARS_PER_SEC` is 11.5 — under the slower measured voice (11.6 Mike, 12.7 Gene) — with the measurement in the comment, and the function takes a measured rate as a second argument so step three can pass whichever voice ships. The bench's "assumes 15" line now prints the constant.

The hanging-worker question is a test, not an inference. `test/tts-worker-stub.mjs` is a fork target that answers like the real worker but never replies to a line containing HANG and exits mid-request on DIE; `test/tts.mjs` points `RUMBLE_TTS_WORKER` at it with a 300 ms timeout and proves: the lost request rejects at the timeout, the next request is answered by the *same* worker (it was not wedged), a late answer to the lost request cannot be mistaken for the next one (ids), a worker that exits is a named error with no live pid reported, and the request after that starts a fresh worker. The bench now numbers and timestamps each failure, so a wedged worker and a slow one read differently in its output.

The original report follows, uncorrected, so the "not measured" reasoning stays on the page.

## Touched

New: `src/tts.js` (the voice adapter and clip cache), `src/tts-worker.mjs` (the Kokoro child process), `tools/tts-bench.mjs` (the on-box measurement), `test/tts.mjs` (the suite).

Edited: `package.json` — scripts `tts-test` and `tts-bench`, and `kokoro-js ^1.2.1` under `optionalDependencies`; `.github/workflows/deploy.yml` — `node test/tts.mjs` after `wrongs.mjs`; `.gitignore` — `tts-cache/`; `docs/autohost-design.md` — a *Built* note under "The voice", including the one correction below.

Nothing in `server.js`, the engine, or any page. `runActivate` / `runResolve` / `runMarkWrong` were not touched and step three will drive them as they are.

## Suite

Run in the local VM (Linux, node 22) with a server up: `pagerefs`, `guides`, `watch`, `wrongs`, `workflows`, `tts` all pass; `harness` prints its table unchanged. `tts` runs in CI with nothing installed: the default engine is `silent`, and the real engines are refused with a sentence rather than exercised.

## The correction to the design

Kokoro runs **out of process**. The design said in-process; the box is 1 GB / 2 vCPU with node peaking near 375 MB on the clue library, so an in-process model that runs out of memory would take the server and every match with it. The worker is forked once, `unref`'d so it never keeps a parent alive, and restarted on the next request if it dies; a dead worker is a named error, not a hang. `kokoro-js` is imported lazily and is an optional dependency, so a box that never enables the autohost never loads it, and a platform without a prebuilt onnxruntime binary does not fail the deploy. CI will still install it (~400 MB of `node_modules`, mostly onnxruntime) — if that is unwelcome, `npm install --no-optional` in `deploy.yml` is the switch, and the suite passes either way.

## Not measured, and why

The design's step two was "time Kokoro and Piper on the box." **The numbers do not exist.** Kokoro's first run downloads the model from huggingface.co, and that host is policy-blocked from both environments the design chat can run code in (the local VM and the cloud sandbox); Piper's voices come from the same host. So the bench is built and exercised but has not been run against a real engine.

What was exercised: the full piper path with a stand-in binary (any executable that reads text on stdin and writes a WAV to `-f`), including spawn, flags, the WAV parse, the disk cache and the cache-hit counters; the kokoro worker path as far as the download, which fails with `could not load onnx-community/Kokoro-82M-v1.0-ONNX (getaddrinfo EAI_AGAIN huggingface.co); the first run downloads it from huggingface.co…` and exits cleanly.

To measure, on the box:

```bash
cd /home/ubuntu/app && npm install            # brings in kokoro-js
RUMBLE_TTS_DIR=/data/tts npm run tts-bench     # kokoro, piper, elevenlabs — each skipped with a reason if not configured
```

Piper needs a binary: `pip install piper-tts` gives `piper` on the PATH (the OHF-Voice `piper1-gpl` package; the rhasspy repo is archived), or set `PIPER_BIN`. Voice names default to `en_US-ryan-medium` / `en_US-joe-medium`; the package downloads them on first use. The bench prints, per engine and voice, synthesis p50/p90/max, RTF, chars-per-second (so `readingTimeMs`'s assumed 15 can be retuned from a measurement), and the worker's RSS from `/proc`, and writes one clip per voice under `/data/tts/bench/` to listen to.

The two numbers that decide the engine: p90 synthesis for a clue inside the 12 s pick window, and worker RSS + ~375 MB under 1 GB with headroom. Kokoro at q8 is the first choice on sound; if the RSS does not fit, Piper is the answer and nothing in the caller changes.

## Shape of the API step three will call

`speak(text, voice) → { audio: Buffer, mime: 'audio/wav', durationMs, engine, voice, cached, synthMs? }`, throwing `TtsError` with the fix in the message. `voiceFor('mike' | 'gene')` gives the engine's default voice for each host, overridable by `RUMBLE_VOICE_MIKE` / `RUMBLE_VOICE_GENE`. `readingTimeMs(text)` is the text fallback's clock. `warm()` loads the model without speaking; `status()` is for `/api/health`. Default kokoro voices are `am_michael` (Mike) and `am_fenrir` (Gene) — placeholders for David to audition from the bench's clips, not a decision.

## Two things to check first

Redirects and URLs: none added. The only outbound request is `elevenlabs`'s POST to a fixed host, key in a header, timeout on the signal, non-2xx thrown with the status.

Silent failure paths: every refusal throws and is counted; the worker's exit is caught and named; a stray piper temp file is the one swallowed error, by design. The one path I could not prove is a worker that hangs without exiting — `SPEAK_TIMEOUT_MS` (20 s) rejects the request, but the worker is left running until the next `stop()`. Worth a line in step three when the autohost decides what to do with a voice that is alive but not answering.
