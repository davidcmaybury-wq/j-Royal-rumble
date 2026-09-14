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

## Piper, measured — and it clears both bars

```
                    Mike (en_US-ryan)   Gene (en_US-joe)
  synthesis p50         3,116 ms            3,132 ms
  synthesis p90         4,741 ms            3,800 ms
  max                   4,856 ms            5,343 ms
  RTF p50                  0.74               0.66
  peak RSS                 36 MB              27 MB
  clips completed         18 of 18           17 of 17
  warm-up                   0 ms (no model to load)
```

**Thirty-five of thirty-five clips, no failures.** p90 is 4.7 s against a
12-second window; Kokoro's was 18.9. RTF below 1 means a clue is synthesized
faster than it is spoken, which is the property the whole schedule depends on.
And there is no resident worker — piper is spawned per clip and peaks at 36 MB,
against 461 MB — so the 836 MB arithmetic that killed Kokoro does not arise.

**Piper is the engine.** Nothing in the caller changes, exactly as the design
said it would not.

Two things the numbers carry that a table hides:

- **RTF p90 reads 5.79 for Mike and means nothing.** It is process start-up
  divided by the length of "No." — the short fixed phrases are all start-up.
  Those are cached after first use, so it costs once per phrase per voice, ever.
  Judge piper on the p50 and on absolute p90, not on RTF for one-word lines.
- **A full board is about ninety seconds of CPU.** Thirty clues at ~3 s each,
  on two vCPU, in the background while a match runs. That is fine if it starts
  when the board is dealt and nothing waits on it, which is the design — but it
  is the first thing step three should confirm under a live match rather than
  assume.

### `READ_CHARS_PER_SEC` has to move again, and this is the trap

It was just set to **11.5**, correctly, from Kokoro. Piper measures **16.0**
(Mike) and **14.9** (Gene). The constant was measured on the engine that then
got eliminated — so it is now about 30% slow, and the text fallback would arm
the buzzers late rather than early. Set it from the slower shipping voice
(14.9) and re-measure if the voice changes. A constant is only as good as the
engine it was taken from.

## Piper's install is not what the report assumed

**Voices are not downloaded on first use.** The report said they were; on
`piper1-gpl` a missing voice is a hard `ValueError: Unable to find voice
(use piper.download_voices)` and every single clip fails. They have to be
fetched once, explicitly.

Ubuntu 24.04 also marks the system interpreter externally-managed, so a plain
`pip install` is refused. What actually worked, and what the box now has:

```bash
sudo apt-get install -y python3-venv
python3 -m venv /home/ubuntu/piper-venv
/home/ubuntu/piper-venv/bin/pip install piper-tts
/home/ubuntu/piper-venv/bin/python -m piper.download_voices \
    en_US-ryan-medium en_US-joe-medium --data-dir /data/piper
```

Then `PIPER_BIN=/home/ubuntu/piper-venv/bin/piper` and
`PIPER_DATA_DIR=/data/piper`. The venv is 55 MB, the two voices 121 MB, and both
live outside the app directory so a deploy cannot take them. Neither belongs in
`npm install`, which means **the deploy needs a line about them or a fresh box
has no voice** — that is a `HOSTING.md` entry, not a code change.

What is left is the one thing a benchmark cannot answer: whether it sounds like
a game-show host. `/data/tts/bench/piper-mike.wav` and `piper-gene.wav` are the
clips to judge, and they are David's call.

## What the box looks like now

`kokoro-js` was installed with `--no-save` to run this and left extraneous in
`node_modules` (762 MB, from 24 MB); the next deploy's `npm install --omit=dev`
prunes it, and 34 GB is free. `package-lock.json` was restored and the staged
`src/tts.js`, `src/tts-worker.mjs` and `tools/tts-bench.mjs` were removed, so
the working tree on the box is clean — a `git pull` refuses when an incoming
file would overwrite an untracked one, which is how a deploy died at 0.89.0.
