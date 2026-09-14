# Step two, answered — for the chat that built it

*Dev chat, 2026-09-14, against `9e1e54a`. This is the reply the contract asks
for: synthesis time per clue on the box, and which engine was chosen. Your code
is still uncommitted and the reason is in §4, which is not a complaint about the
code.*

## 1. You were not blocked. The box was never blocked.

huggingface.co is reachable from the Lightsail box. The model downloaded on
first run and loaded in 4,904 ms. What stopped you was policy in your own two
environments, not anything about this deployment — worth knowing, because it
means "cannot measure" was never the true state of the world and the same shape
of blocker will come up again. When an environment refuses a host, say so and
hand the command over rather than shipping the decision unmeasured. You did
exactly that, which is why this took one evening to close.

## 2. Kokoro is out, on both bars, by a wide margin

Twelve real clues, both voices, on the live box with no match in play.

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

**Six of thirty-five clips never finished** — they hit `SPEAK_TIMEOUT_MS` and
were recorded as failures.

- The pick window is 12 s. p90 is 18.9 s, and the **median** clue is slower than
  the whole window.
- RSS 461 MB against a server that already peaks near 375 MB, on a 911 MB box:
  836 MB, and available memory fell to 96 MB during the run.

RTF above 2 is the number that kills it rather than either threshold on its own.
Every clue costs more than twice the speech it produces, a board carries thirty
clues, and `warm()` cannot help because the cost is per clue and not at load.
A faster box would not change the shape, only where it bites.

**Your adapter is not implicated.** The caller does not change and neither does
`speak()`. What changes is which engine is the default and which one the design
calls first choice.

## 3. Three things to change in the code you already wrote

**`kokoro-js` should come out of `optionalDependencies`.** It cost 738 MB on the
box, not the ~400 MB in your report — `node_modules` went 24 MB → 762 MB. You
offered `npm install --no-optional` as the switch; with Kokoro eliminated the
honest move is to drop the dependency and keep the adapter, so a box that will
never run it never carries it. If it returns later it returns with a measurement.

**`readingTimeMs()` assumes 15 chars/s. Measured: 11.6 (Mike), 12.7 (Gene).**
The text fallback is about 20% fast, which means it would arm the buzzers while
Mike is still speaking — the one failure mode that actually costs a race. Retune
it, and re-measure on whichever engine ships, because rate is a property of the
voice.

**Out of process was the right call and the numbers say so louder than the
design did.** A 461 MB in-process model on this box would have taken the server
and every live match with it. Keep the worker, keep it `unref`'d.

## 4. Why it is not committed

Nothing is wrong with it. It is uncommitted because its default engine and its
documented first choice were both written on the assumption Kokoro would win,
and committing that now would put a recommendation in the repo that the box has
already refuted. Change §3 and it lands.

Two review notes, neither blocking:

- Outbound surface is clean: one fixed host (`api.elevenlabs.io`), key in a
  header, timeout on the signal, non-2xx thrown with status. `spawn` is called
  without a shell, so piper's args cannot be injected. No new redirects.
- **Your open question about a worker that hangs without exiting is partly
  answered.** Thirteen clips completed for Mike alongside five timeouts, and
  sixteen for Gene alongside one, so the worker went on answering after a
  timeout rather than wedging. The bench does not timestamp failures, so that is
  evidence and not proof — if all five had landed last it would look the same.
  Worth an explicit test rather than an inference.

## 5. Piper is the open question, and part of it is not ours

It skipped with `no piper binary: set PIPER_BIN or put piper on the PATH`. I did
not install it, on purpose: with Kokoro gone, the choice between Piper and
ElevenLabs is partly how it sounds and partly whether David wants to pay per
character, and neither is a benchmark's call. He has the numbers and the clips.

When it runs, in this order:

1. Piper p90 for a clue against the 12-second window.
2. Worker RSS against the same 836 MB arithmetic.
3. Whether it sounds like a game-show host, against
   `/data/tts/bench/*.wav` from this run.

If Piper also misses the window, the real options are ElevenLabs, a bigger box,
or speaking less — and the third is a design change, not an engineering one.
Do not let step three assume an engine that has not cleared bar 1.

## 6. For step three, so it lands first time

The contract still holds; these are the parts it will actually touch.

- Drive `runActivate` / `runResolve` / `runMarkWrong`. Do not write a second
  implementation of a rule. `hostOnly` stays on the socket side; pass your own
  `report`.
- **The buzzer has no overlay guard and step three adds overlays to it.** The
  console and `theme-player.js` are covered — any `position:fixed` with a
  `bottom:` must be `pointer-events:none` — and the buzzer is not. Write that
  guard in the same change. This bug has now shipped four times.
- `activate-buzzers` is not volatile. The arm scheduled off a clip's duration
  must go through the same send.
- The clip is per client and the spread is the thing to measure. `heard
  {lateMs}` from a test match decides the `settle` default; report it.
- Player-facing docs in the same commit, with an assertion per rule in
  `test/guides.mjs`: sound on, mic allowed, say your pick, who Mike and Gene are.

Leave it in the tree, green, and tell me what you touched. I will not run
`ship.sh` on your behalf and neither should you — it commits the whole tree with
`git add -A`, and this repo has had three chats' work in it at once this week.
