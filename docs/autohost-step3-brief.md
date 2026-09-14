# Step two is closed. Go to step three.

*Dev chat, 2026-09-14, against `aa39291`. Your step-two work is committed and CI
is green. The engine is decided, the box is provisioned, and the only thing in
your way is the buzzer overlay guard, which does not exist yet.*

## The decision

**Piper. `en_US-ryan` for Mike, `en_US-joe` for Gene.**

```
                Kokoro              Piper
  p90            18,865 ms           4,741 ms     (12s pick window)
  RTF p50        2.00                0.74
  peak RSS       461 MB              36 MB
  completed      29 of 35            35 of 35
```

David auditioned both clips: **Mike is good, Gene is marginal and parked.** Not
settled — revisit once the rest is debugged. Gene is a variable, not a code
change, and piper has plenty more voices; do not spend step three on it.

Two corrections to your report, both of which cost a run:

- **`piper1-gpl` does not download voices on first use.** A missing voice is a
  hard `ValueError` and every clip fails. They are fetched once, explicitly.
- **Ubuntu 24.04 refuses a plain `pip install`** (externally-managed). The box
  runs piper from a venv at `/home/ubuntu/piper-venv` with voices in
  `/data/piper`, and `HOSTING.md` carries the recipe, because neither arrives
  with `npm install` and a rebuilt box would otherwise have no voice at all.

`PIPER_BIN` and `PIPER_DATA_DIR` are the two variables; both are documented.

## What I changed in your code, and why

One line. `READ_CHARS_PER_SEC` 11.5 → **14.9**.

You measured 11.5 correctly, from Kokoro — hours before Kokoro was eliminated.
Piper reads 16.0 and 14.9, so the constant was left 30% slow and the text
fallback would have armed the buzzers late. The comment now records that it has
been wrong in both directions, because the failure mode is a constant outliving
the thing it was measured on, and that will happen again if a voice changes.

Everything else landed as you wrote it. The worker-stub test that makes the
parent's recovery "a fact and not an inference" is exactly right, and it closed
the one question I could only answer by inference from the bench.

## Step three, and the one thing that will fail review

The handoff's scope stands: clips on every client, the arm scheduled off the
clip, robots' answers spoken, Gene's calls from `entry`, the starter landing on
a buzzer, click-to-pick, autopick. A console's Correct / Wrong stays the only
human duty.

**Write the buzzer overlay guard in the same change.** `console.html` and
`theme-player.js` are covered — any `position:fixed` rule with a `bottom:` must
be `pointer-events:none` unless it is a full-screen modal. **The buzzer is not
covered by anything**, and step three is the change that starts putting overlays
on it. This bug has shipped four times: the entry banner twice, the YouTube
entrance box once, and a category card that grew under a hint and pushed its
column out of line. The fifth will be yours if the guard is not written.

The rest, in the order it will bite:

- Drive `runActivate` / `runResolve` / `runMarkWrong`. No second implementation
  of a rule. `hostOnly` stays socket-side; pass your own `report`.
- `activate-buzzers` is not volatile. The arm scheduled off a clip's duration
  goes through the same send.
- **A full board is about ninety seconds of CPU** — thirty clues at ~3 s on two
  vCPU, in the background while a match runs. The design says nothing waits on
  it. Confirm that under a live match rather than assuming it; if a clue is
  picked before its clip exists, the fallback has to be the clock, not a stall.
- Warm-up buzzes stay out of the live record. A spectator must never touch
  `stat()`.
- Every new setting renders in `setup.html` in **both** quick and expert mode
  and is read by `collect()`, or Save dies silently.
- Player-facing docs in the same commit — sound on, who Mike and Gene are — with
  an assertion per rule in `test/guides.mjs`.

## What to send back

The number that decides the `settle` default: **the measured client playback
spread**, `heard {lateMs}`, from a real test match. Not an estimate from one
browser on one machine — the spread across the clients actually in the room is
the whole point of measuring it.

Also say what the board-synthesis backlog did while a match was running, since
that is the first thing about this engine that only shows up live.

Leave it in the tree, green, and tell me what you touched. Do not run `ship.sh`.
