# Autohost step two — measured on the box

*Dev chat, 2026-09-14. Answers the missing half of `autohost-step2-report.md`:
the design chat could not reach huggingface.co from either of its environments,
so no engine had ever been timed. Run on the live Lightsail box (1 GB, 2 vCPU),
no match in play, `node tools/tts-bench.mjs` against 12 real clues.*

## Kokoro does not fit. Not close.

```
                    Mike (am_michael)   Gene (am_fenrir)
  synthesis p50        10,721 ms           13,357 ms
  synthesis p90        18,865 ms           19,551 ms
  max                  19,861 ms           19,723 ms
  RTF p50 / p90        2.00 / 2.32         2.22 / 2.54
  worker RSS             461 MB              460 MB
  clips completed        13 of 18            16 of 17
  model load           4,904 ms (once)
```

**Six of thirty-five clips never finished at all** — they hit the 20-second
timeout and were recorded as failures.

The design set two bars and both are missed by a wide margin:

- **p90 inside the 12-second pick window.** It is 18.9 s. Not marginal: the
  *median* clue takes longer than the whole window, and an RTF above 2 means
  every clue costs more than twice the speech it produces. A board is dealt with
  thirty clues on it.
- **Worker RSS plus the server's ~375 MB under 1 GB, with headroom.** 461 + 375
  is 836 MB on a 911 MB box. During the run available memory fell to 96 MB.

Either one alone would settle it. **Kokoro is out on this hardware**, at q8, on
2 vCPU. Nothing about the adapter is wrong — the caller does not change — but it
cannot be the default and `warm()` cannot rescue it, because the cost is per
clue rather than at load.

The run was capped at `MemoryMax=420M` / `CPUQuota=90%` through a systemd scope,
deliberately: this box OOM-killed node in a loop once, and the kernel picks the
largest RSS, which would have been the game server rather than the benchmark.
With the cap, the worst case was a dead benchmark. The site stayed up throughout.

## One number worth keeping regardless of engine

Measured speech rate is **11.6 chars/s (Mike) and 12.7 chars/s (Gene)**, against
the **15** that `readingTimeMs()` assumes. The fallback clock is therefore about
20% fast — it would arm the buzzers while Mike is still talking. Retune it from
these, and re-measure on whichever engine ships, since rate is a property of the
voice and not of the text.

## Piper is still unmeasured, and is now the question

It skipped with `no piper binary: set PIPER_BIN or put piper on the PATH`.
Installing it is `pip install piper-tts`, which was not done: with Kokoro
eliminated, the choice between Piper and ElevenLabs is a decision about sound
and about paying per character, and that is David's rather than a benchmark's.

What the next run needs to answer, in this order:

1. Piper p90 for a clue, against the 12-second window.
2. Piper worker RSS against the same 836 MB arithmetic.
3. Whether it sounds like a game-show host. `/data/tts/bench/*.wav` holds one
   clip per voice from this run to compare against.

If Piper also misses the window, the honest options are ElevenLabs, a bigger
box, or narrowing what gets spoken — and that last one is a design change, not
an engineering one.

## What the box looks like now

`kokoro-js` was installed with `--no-save` to run this and left extraneous in
`node_modules` (762 MB, from 24 MB); the next deploy's `npm install --omit=dev`
prunes it, and 34 GB is free. `package-lock.json` was restored and the staged
`src/tts.js`, `src/tts-worker.mjs` and `tools/tts-bench.mjs` were removed, so
the working tree on the box is clean — a `git pull` refuses when an incoming
file would overwrite an untracked one, which is how a deploy died at 0.89.0.
