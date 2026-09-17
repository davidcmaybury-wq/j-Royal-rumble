# Autohost steps four and five — the ears and the judge

*From the design chat, 2026-09-17. Left in the working tree per `docs/autohost-contract.md`; nothing committed, nothing shipped, `npm run ship` not run.*

## In one paragraph

The computer host now listens and rules. When the board is handed over, the holder's own microphone opens and they say what they want — "presidents for four hundred" — and the clue goes up; clicking still works and is unchanged. When somebody wins the race, their microphone opens for `answerSeconds` and nobody else's does; what the browser heard comes back as text, the judge rules on it, and the same `runResolve` / `runMarkWrong` the console drives settles the clue. A player who names only part of the answer hears "be more specific" once and keeps the rest of their window. No audio leaves any player's machine — the recognition is the browser's, on their own computer, and the server only ever receives words. A match can now be played with nobody at a console at all, which is what steps four and five were for. **Objections are still not built**; they are the remaining work.

The shape of all of this follows **Matt Schiffler's j-trivia**, which David handed over mid-step. It changed the design: our revision 5 specified streaming every answer to Deepgram, and that whole subsystem — the key, the bill, the third party holding our players' audio, the hard dependency — is gone, replaced by the browser's own `SpeechRecognition`. `docs/autohost-from-jtrivia.md` records every rule taken and every one deliberately not taken.

## Touched

**New.** `src/judge.js` — the ruling ladder: normalize, repaired starter, bare-interrogative guard, the `"in"`/`"and"` grace, then the model, with four verdicts and a `status()` for health. `src/pick-match.js` — the spoken pick: the dollar value and the category found by separate machinery, double-metaphone matching, a tie refused rather than guessed, and an optional model proposal that is thrown away unless its own cited evidence survives the phonetic check. `public/listen.js` — the player's microphone. `test/judge.mjs` — 45 checks, pure, no server and no key. `docs/autohost-from-jtrivia.md`.

**`src/autohost.js`** — the listening half. `openWindow(kind, token, seconds)` emits `listen {sid, kind, ms}` to exactly one player and `closeWindow()` takes it back; `onLeader` opens an answer window and says the player's name; `onAnswerTimeout` says "Time." and marks wrong; `onAnswerHeard` validates the window and its owner, judges, and `rule()` turns a verdict into a ruling — `too_broad` into "be more specific" once per clue, `correct` into `runResolve`, anything else into `runMarkWrong` with `suppressWrongLine` so the room hears the miss once. `onPickHeard` runs `matchPick` and either picks or asks again out loud, by reason. Every transcript and ruling is recorded and surfaced on the host view as `transcripts`.

**`src/server.js`** — `answer-heard` and `pick-heard` sockets, both routed through the autohost and refused by reason when the window is closed or the sender does not own it; `announceLeader` tells the autohost a player is on the clock; `judge.status()` on `/api/health`; `start-match` refuses an autohost match with no judge configured, naming the variable; the judge is handed to the autohost as a dependency rather than imported by it.

**`src/tts.js`** — trailing silence is trimmed off every clip (Matt's threshold), which for us is timing rather than polish: the buzzers arm at `durationMs`, so the padding was dead air on every clue. The Edge engine (`RUMBLE_TTS=edge`, `en-US-GuyNeural` for Mike and `en-US-ChristopherNeural` for Gene) is added behind the same adapter, and `fixWavSizes` exists because ffmpeg writing to a pipe cannot seek back to fill in the header's sizes.

**`src/engine.js`** — `answerSeconds: 5` and `specificRetry: true`, and nothing else. **`public/setup.html`** — both, in the hosting card as plain controls rather than `adv()` (how a host behaves is not a rule of the game), read back in `collect()`.

**`public/buzzer.html`** — opens and closes the microphone on the server's `listen`, sends `answer-heard` / `pick-heard`, sends its best guess if the window closes before the recognizer commits, primes the recognizer on the first real gesture, and shows a live mic strip so a player can see that they are being heard.

**Docs and wiring.** `public/howto.html` — what the host expects a player to do, that the question form is not required, what "be more specific" means, that no audio leaves their machine, which browsers work and what to do if theirs does not. `test/guides.mjs` — an assertion per new rule. `CLAUDE.md` — the ears, the never-guess-wrong rule, the announce-once rule, the `heard`/`transcripts` collision. `CREDITS.md` — Matt. `docs/autohost-design.md` — a *Built* note. `package.json` — `judge-test`; `deploy.yml` — `node test/judge.mjs` as a standalone step and `RUMBLE_JUDGE=local` on the socket server.

## What passed

`test/judge.mjs`: all 45, with no server and no key. `test/autohost.mjs`, extended: the pick window opens for the board-holder and only them; somebody else speaking into it is refused by reason; a call that matches nothing is refused rather than guessed and the host asks again out loud; a spoken call puts the right clue up and closes the window behind it; the buzz winner's microphone opens and nobody else's; a transcript from a closed window and one from a player not on the clock are both refused; the right answer settles the clue with no console involved, control passes, and the ruling is on the host view with how it was decided; a wrong answer locks that player out, reopens the race, is announced exactly once, and leaves the clue up for whoever is left.

The whole socket suite and every standalone suite ran green here, plus `security.mjs` against a keyless server on 8097. One exception, unrelated: `themes.mjs` fails its YouTube assertions in this sandbox because `youtube.com` is unreachable from it — `entrance.mjs` skips its own YouTube check for the same reason and says so. Worth confirming on the box, but nothing here touches it.

## Two things that bit

**A status field called `heard` is silently clobbered.** `hostView()` spreads `autohost.status()` and then overrides `heard` with the clip playback spread, so the transcripts vanished with no error anywhere. They are `transcripts` now, and it is in `CLAUDE.md`.

**A miss was announced twice.** The ruling wants to say it and `runMarkWrong` wants to say it. `suppressWrongLine` silences the second, and the test counts the lines rather than trusting the flag.

## What this could not measure, and what I am handing over

**The Edge voice is unmeasured, and I could not reach it.** `speech.platform.bing.com:443` is refused from this sandbox (`connect_rejected`), and it also returned nothing from David's local VM — the same shape as `huggingface.co` in step two. The engine is written, fails closed with the reason named, and is not the default. Per the standing step-two instruction, the number has to come off the box rather than from me:

```
RUMBLE_TTS=edge node tools/tts-bench.mjs
```

What matters is the same three questions Piper faced: p90 against the 12-second pick window, RSS beside a server that peaks near 375 MB on a 911 MB box, and how it sounds next to the Piper clips in `/data/tts/bench/`. If Edge is reachable and fast, it is free and needs no local model; if it is not reachable from the box either, Piper stays and the engine is dead code kept behind its flag.

**The judge has never ruled with a key.** Everything above runs `RUMBLE_JUDGE=local`, which rules on word overlap and never returns `wrong` — deliberately, because a failed model call must not be able to cost a player money. The model path's parser is tested; the model path's *judgment* is not, and cannot be from here. Step four's design owed one night of transcripts against human rulings as the judge's calibration set, and that debt is still open: the honest way to collect it is one real match with the autohost reading and listening while somebody at a console still presses Correct or Wrong, and the transcripts and verdicts already land in the record for exactly that comparison.

**`answerSeconds` defaults to 5, not the 6 David settled.** Matt's window is 5,000 ms and it is the only number in this area anybody has run against real players, so it is the default and it is one field on the setup page. The first real match should move it.

## Not done, on purpose

**Objections.** The O key, the two thresholds, the immediate ruling with the walk-back through `undoStack`, `voidClue`, and the award popup. Revision 5 of the design specifies all of it and none of it is built. It is the last piece, and it is the one that needs the reversal rate from a real match to be worth tuning — which is another reason it wants to come after the calibration night rather than before it.

No typed fallback for a player with no microphone; they click and answer on the call, and a console rules. The console still works and is still the fallback for everything.

## Two things to check first

**Anything that redirects or takes a URL.** Nothing new here does either. No new routes; `listen.js` is a static module; the two new sockets take `{sid, text}` and `{sid, alternatives}` and both are validated against the server's own current window before anything is done with them.

**Any new failure path that could be silent.** A browser that cannot do speech recognition reports itself at join rather than at the moment a player wins a race. A microphone that is denied surfaces on the buzzer with the browser's own reason. A transcript that arrives for a closed or wrongly-owned window is refused with a reason in the ack, not dropped. A judge that fails returns `unclear` with the error on `status()` and `/api/health`, and `failed` and `lastError` are counted there; it never becomes a `wrong`. `start-match` refuses an autohost match with no judge configured, naming `ANTHROPIC_API_KEY` or `RUMBLE_JUDGE`. Every ruling and every transcript is on the host view and in the record with `via` saying which rung decided it, so a judge quietly doing the wrong thing is visible after one match rather than after ten.
