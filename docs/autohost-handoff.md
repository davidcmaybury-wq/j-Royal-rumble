# Autohost — handoff to the dev chat

*Prepared 2026-09-14 from the design chat. The dev chat is mid-way through committing a different feature; this packet is for whoever picks the autohost up next, in this chat or another. Read this, then `docs/autohost-design.md`, then `CLAUDE.md` as usual. Nothing is built yet.*

## What is being handed over

A fully decided design for an AI host that runs a match with no human host and no console. David reviewed it in four rounds and closed every open question; the decisions are recorded in `docs/autohost-design.md` (revision 5) and there is nothing to re-litigate. The design chat did not touch code. The repo is at 0.96.1 and the only file added is the design doc itself, at `docs/autohost-design.md`, uncommitted in the working tree — commit it with the first autohost change, or on its own if that lands first.

## The decisions, in one screen

An autohost match has no console. Whoever sets it up lands on a normal buzzer, in full-board mode, and nobody opens `/host/:id`. Desktop clients only for now. Board control at the bell goes to draw 1.

Two voices on one local engine, free: **Mike** is the straight game-show host and does everything that touches the rules — hands over the board, confirms the pick, reads the clue, names who he is listening to, rules, reveals on a stumper, runs objections and the award vote. **Gene** is the ring announcer, wrestling register, and calls the events — entrances, eliminations, revivals, top rope, field clears, overtime, bounties, longevity, comebacks. They never speak in the same step. The engine is Kokoro (`kokoro-js`, in-process, ONNX) with Piper as the fallback if the Lightsail box cannot keep up; ElevenLabs is a later adapter behind the same one-file interface. Timing both on the actual VM is the second build step.

The voice plays on every client, not through Zoom. The server owns each clip, knows its duration, and schedules the arm off it. Every clue on a board is synthesized in the background when the board is dealt; fixed phrases, numbers and player names are cached per voice; nothing is synthesized on the clock.

The player with the board picks by speaking (Deepgram, matched locally against the open cards, Claude Haiku only to disambiguate). A click on the board is the fallback and Mike announces it. 12 s to pick, nudge at 8, then Mike picks at random and says so.

The buzz winner's own mic streams to Deepgram for 6 s or until end of utterance. Claude Haiku judges — content only, no question form — and returns a verdict and a line. Rulings fire immediately; nothing waits on a possible objection. A judge failure or a player with no mic puts the ruling to the room as a Y/N vote.

Objections are hotkey O, window is until the next ruling. Reversal on a simple majority of everyone in the match or two-thirds of the ring, whichever hits first; the answering player's O counts. A clean reversal walks back through the existing `undoStack` / `restore()` path. An ambiguous one — three ruled wrong, a rebound taken, a reversed *right* — opens an award popup on every buzzer: award the clue to one of the answerers or to nobody, plurality, 15 s, tie throws it out. The game keeps going during the vote; a vote that lands after the next ruling is too late and the ruling stands. Throwing a clue out needs one engine addition, `voidClue(slot, row)`, which must not advance `cluesRevealed`.

## Build order, and where to start

The design doc's build order is the plan; do not reorder it. Each step ships on its own and is measured before the next.

**Step one, the refactor**, is where to start and is deliberately boring: pull the bodies of the `activate`, `resolve` and `mark-wrong` handlers in `src/server.js` (around lines 2176, 2245 and 2409 at 0.96.1) into plain functions the socket handlers call, with `hostOnly` staying on the socket side and *no behavior change*. Full suite green, ship it. Everything after depends on the autohost and the console sharing one implementation rather than two copies. This step can land while the other feature is still in flight because it touches nothing user-facing.

**Step two** is timing Kokoro and Piper on the real box, and building `src/tts.js` with the cache. Nothing user-facing. Report the numbers before choosing.

**Step three** is the voice with no ears — clips on every client, the arm off the clip, robots' answers spoken, Gene's calls from `entry`, the starter landing on a buzzer, click-to-pick, autopick. A match is playable end to end here with a console's Correct / Wrong as the only human duty, and it measures the client playback spread before the mic exists.

**Step four** is the ears, not yet ruling: mic at join, streaming, transcripts shown but a human still presses. One night of that is the judge's calibration set. The spoken pick ships here.

**Step five** is the judge, then objections, `voidClue`, the walk-back and the award popup.

## Things that will bite

The design doc names these in place; they are collected here because each one has already cost this project a release somewhere else.

Every new setting must render in `setup.html` in both quick and expert mode and be read back by `collect()`, or Save dies silently. `pagerefs.mjs` checks both directions; run it.

Every `position:fixed` rule with a `bottom:` in `console.html` or `theme-player.js` must be `pointer-events:none`. The award popup and any objection banner on the buzzer are new overlays; the buzzer is not covered by that guard, so write one.

`activate-buzzers` is not volatile and must stay that way. The autohost sends it through the extracted function, so this is automatic unless somebody rewrites the send.

Warm-up buzzes stay out of the live record. A spectator's O, or a spectator's answer stream, must never touch `stat()`.

The buzzer must never receive the answer. The award popup shows what the *transcript heard each player say*, not the accepted answer; the accepted answer is spoken by Mike after the walk-back and is not in the payload. `test/watch.mjs` asserts the answer is absent from the watch payload; add the same assertion for `award-vote`.

`cluesRevealed` is the clock for entries, the ceiling and overtime. `voidClue` must not advance it. A voided clue that moved the entry clock would be a rules change nobody decided.

`undo-clue` pops `undoStack`, `history` and `record.clues` together. The walk-back must do all three or the log and the engine disagree, which is the shape of every estimator bug on record.

The player-facing docs ship with the code: `docs/discord-rules-v2.md`, `docs/discord-advanced-mechanics.md`, `docs/handbook.html`, `public/howto.html`. Sound on, mic allowed, say your pick, O to object, the two thresholds, who Mike and Gene are — all in the same change as the mechanic, and `test/guides.mjs` gets an assertion per rule.

Before step one, read `~/Developer/j-royal-rumble-data/README-FOR-DEV-CHAT.md`, per the standing rule. The design chat did not have access to it, so anything the analysis chat has decided that bears on this is not reflected in the design doc.

Morning deploys. Autohost matches live in memory like every other match; `deploy-remote.sh --wait` still guards them.

## Keys and services

`DEEPGRAM_API_KEY` is new and required for any autohost match; `ANTHROPIC_API_KEY` already exists for `wrongs.js` and the judge reuses the client pattern there, Haiku, 2 s timeout, one retry, status reported at `/api/health`. `RUMBLE_TTS` selects the engine; `ELEVENLABS_API_KEY` only when that engine is selected. A missing key makes setup refuse to enable the autohost with a sentence naming the key. David has not yet said whether the Deepgram account exists; ask before step four.

## What to send back

At the end of step one: the diff summary and the suite result. At the end of step two: synthesis time per clue for both engines on the box, and which one was chosen. After step three: the measured client playback spread (`heard {lateMs}`) from a test match, since that number decides the `settle` default. After step four: the transcript-versus-human-ruling agreement rate from one real night, since that decides whether step five ships on by default. After each step, the design doc gets a *Built* note under the relevant section rather than a rewrite, the way `CLAUDE.md` keeps its old notes.
