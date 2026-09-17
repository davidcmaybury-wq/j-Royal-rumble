# What came from Matt Schiffler's j-trivia, and what did not

*Written alongside steps four and five, 2026-09-17. Read against `j-trivia-v615`,
a copy David was given directly by its author.*

Matt Schiffler built an autohost for j-trivia and ran it against real rooms
before we started ours. David passed the codebase over with one instruction —
use it to advance our work — and it did, in two places that were blocking us
outright and one that was quietly costing every clue.

This document exists so that nobody reading `src/judge.js` or
`public/listen.js` a year from now has to wonder where a strange-looking rule
came from. Every borrowed rule is commented in place as well; this is the
index.

## The two things that unblocked us

**The ears are the browser's, not one we operate.** Our design (revision 5,
`docs/autohost-design.md`) specified streaming each answer to Deepgram over a
socket: an API key, a per-minute bill, a third party with our players' audio,
and a hard dependency that fails the whole match when it is down. Matt uses the
browser's own `SpeechRecognition` instead — Chrome and Edge already send that
audio to their own speech service for any dictation feature, so the page reuses
that rather than opening a second pipe of our own. It sends the SERVER only the
resulting text: no audio reaches us, there is nothing for us to pay for, there
is no key of ours to fail closed on, and a player who denies the microphone
costs only themselves. It is Chrome and Edge only, which is a real limit, and
it is a limit we can live with — we already assume desktop players, and the
fallback is the console that has always existed.

This deletes a whole subsystem from the design. `public/listen.js` is ours, but
the approach and most of the details in it are his.

**A ruling ladder that mostly does not call a model.** Matt's `/api/ruling`
decides the large majority of answers before any model is involved: normalize
away the question form and the thinking-out-loud, compare, and only then ask.
Every rung of that ladder is something a live match taught him, and we would
have had to learn each one the same way. `src/judge.js` is that ladder.

## What was taken, rule by rule

**From `server/server.js`, `/api/ruling` → `src/judge.js`**

- `normalizeForRulingMatch`: strip the question form, the filler ("I think it's
  the…"), articles and punctuation before comparing. Ours strips the same
  things.
- `MISHEARD_QUESTION_STARTERS`: a recognizer hears "What is" as "chris", "Who
  are" as "core", "Who is" as "quiz". Repairing the starter instead of failing
  the match is his, and so is the guard that leaves a real word alone —
  "Christopher Columbus" must not become "What ishopher Columbus".
- The bare-interrogative guard: a player who says "what…" and trails off has
  not answered. His case was a Daily Double where the model ruled a bare "what"
  correct.
- The `"in"` → `"and"` grace: "Antony in Cleopatra" is a recognizer artifact,
  not a wrong answer, and it is deterministic enough to fix without a model.
- The `too_broad` verdict, and the rubric line that produces it — check the
  answer against every specific element in the clue. This is the one that maps
  onto a host behavior rather than a ruling: we say "be more specific" and give
  the player the rest of their window.
- The rubric line that added facts must be correct — a player who says the
  right name and the wrong year has said something wrong.
- Parsing the verdict out of the model's reply with a regex rather than
  `JSON.parse`. His reasoning: a truncated or chatty reply is a parse error and
  therefore a crash, when the verdict word is right there in the text.

**From `server/server.js`, `/api/clue-select` → `src/pick-match.js`**

- The whole two-halves shape: find the dollar value and the category with
  completely separate machinery, so a garbled category cannot cost you the
  value.
- Homophone repair on a *separate copy* of the utterance — "for" → 4, "to" →
  2 — with the category matcher still seeing the original. His reason is the
  kind you only get from shipping: a category called THINGS TO DO becomes
  THINGS 2 DO under the substitution.
- Last number wins, and only a number actually on the board counts.
- Digits glued inside a token: "starts with h2000" is what a recognizer does
  with a category called STARTS WITH H and a $2000 clue.
- Double-metaphone matching word against word, with his three rules for "close
  enough": same code, one code contained in the other ("metal" in
  "medalists"), or a four-character shared prefix ("precedence" against
  "presidents").
- A tie is not a match. Guessing between two categories that scored the same is
  how a host puts the wrong clue up.
- The model may only *propose* a category, and its proposal is discarded unless
  the word it cites as evidence really sounds like a word in both the category
  and what the player said. His live case was a model insisting that "Section"
  matched OF THE LAW, which shares no sound with it at all.
- The evidence word is its own field rather than a quoted span in prose,
  because a category with an apostrophe in it (THE SPORTSCASTER'S QUOTE) breaks
  any naive quote-pairing regex. It broke his.

**From `src/autohost/AutohostGame.jsx` → `public/listen.js`**

- Priming the recognizer with two throwaway sessions on a real user gesture, so
  the first genuine request of the match is not happening deep in an async
  chain twenty seconds after anybody last touched the page.
- Continuous mode with interim results, so Chrome's own silence cutoff cannot
  end a session while a player is still thinking. The real deadline is the
  server's.
- Ranked alternatives (`maxAlternatives: 5`) for the pick only: a recognizer's
  second guess often carries the category word the first one mangled.
- Nulling `onend` and `onerror` *before* `abort()`. `.abort()` commonly fires
  `onerror` on its way out, and an `onerror` whose job is "restart if we are
  still listening" will spin up an orphan recognizer nobody is tracking.
- Treating `no-speech` and `aborted` as the normal shape of a quiet window
  rather than as trouble worth telling a player about.

**From `server/server.js`, `trimMp3` → `src/tts.js`**

- Trimming trailing silence off a synthesized clip, at his threshold (0.002)
  and with a short tail kept. For him this was polish. For us it is timing: our
  buzzers arm at `durationMs`, so every millisecond of encoder padding was dead
  air the whole room waited through on every single clue.

**From `server/server.js`, `/api/tts/edge` → `src/tts.js`**

- Microsoft Edge's voices through `edge-tts-universal`, as a free engine that
  needs no local model and no GPU. `en-US-GuyNeural` is his host voice and is
  our Mike; Gene is `en-US-ChristopherNeural`. Unmeasured from here — see the
  step four and five report.

## What was deliberately not taken

**The question form.** Matt requires it; David decided against it for the
Rumble, in the second review round. Our rubric drops the rule explicitly rather
than by omission, so nobody re-adds it thinking it was an oversight.

**His relay socket.** `server/autohostSocket.js` is a dumb relay:
`autohost-broadcast`, `autohost-to-player`, `autohost-to-leader`. It suits
j-trivia, where the host is a client. Ours is a server-side state machine that
drives the same four extracted rulings the console drives (`runPick`,
`runActivate`, `runResolve`, `runMarkWrong`), which is the contract's rule
about never writing a second implementation of a rule. Keeping his relay would
have meant exactly that.

**His answer window.** 5,000 ms in j-trivia. Ours is a setting
(`answerSeconds`), and David settled six seconds in review; step four left the
default at five so the first real match can move it in one place.

## What is ours, because his game does not have it

**Overtime values.** In overtime our board multiplies, so a $400 clue reads
$1,600 and a player calls the number they can see. `matchPick` accepts both the
face value and the multiplied one. His board never multiplies.

**A local judge that never says "wrong".** With no key — or with
`RUMBLE_JUDGE=local` set on purpose, which is how CI runs — our judge rules on
word overlap alone and returns `correct`, `too_broad` or `unclear`, never
`wrong`. A failed model call must not be able to produce a confident bad
ruling that costs a player money. Matt's path assumes the key is there.

**Announcing a miss exactly once.** Our ruling and the rule it drives both want
to say it, so one of them is told to stay quiet. That is a consequence of
driving the shared rulings rather than reimplementing them, so it is a problem
he does not have.

## Licence and attribution

`j-trivia` is Matt Schiffler's private project, shared with David directly. The
code here was written for this repository against his as a reference; nothing
was copied file for file. He is credited in `CREDITS.md`, in the two module
headers, and here. If any of this is ever published, that is the point at which
to ask him what he would like the notice to say.
