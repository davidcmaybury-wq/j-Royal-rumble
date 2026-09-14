# For the chat building the autohost — what will and will not pass here

From the dev chat that owns `~/Developer/j-Royal-rumble`, 2026-09-14, current
against `d919eab`. This is not a design review: the design is settled in
`docs/autohost-design.md` and I am not reopening it. This is the shape your work
has to arrive in so it can be committed without a rewrite.

Read `CLAUDE.md` first. Everything below is either already in it or is being
added to it. Where the two disagree, `CLAUDE.md` wins and tell me.

## Step one is done — build on it, do not re-do it

`activate`, `resolve` and `mark-wrong` are now plain functions in
`src/server.js`: `runActivate(match, deps)`, `runResolve(match, {winnerToken},
deps, report)`, `runMarkWrong(match, t, deps)`. The socket handlers are three
thin lines that call them. `deps` is `{ pushAll, runBots, armTimeout,
clearBotTimers }` — whichever of those the function actually uses.

Two things about that shape are load-bearing:

- **`hostOnly` stays on the socket side.** It answers who is allowed to ask,
  which is a question about a connection, not about a match. Do not move it
  into the extracted functions and do not add a second copy for the autohost.
- **`report` is the only thing that ever knew about a socket.** It takes a
  refusal message. Pass your own; "tell the host" means something different
  when there is no host.

Drive a match through these three functions. If you find yourself writing a
second implementation of a rule, stop and tell me — that is exactly how
`tools/comeback-study.mjs` fell a release behind the engine and printed rows
labelled SHIPPED that described a rule nobody was playing.

## The checks you have to pass, and what each one is actually for

Run these before you hand anything over. They are not formalities; every one of
them exists because something shipped broken.

```bash
node src/server.js &            # give it ~25s in a slow sandbox
node test/pagerefs.mjs          # the one that will catch you
node test/guides.mjs
node test/workflows.mjs
node test/watch.mjs
node test/harness.js
```

**`pagerefs.mjs` is the one to run first and most often.** It parses every page,
checks that every id the script binds to exists, that every class it applies is
styled, that no import goes unused, and then executes the renderers against a
stub DOM. Any new page must be added to all four page lists inside it.

Specific traps it guards, all of which have shipped here before:

- **A toggle that renders but is never read back is invisible.** Five shipped
  that way. Every new setting must render in `setup.html` in *both* quick and
  expert mode and be read by `collect()`. Expert controls are hidden with CSS,
  never omitted from the DOM — `collect()` reads each one by id, so a genuinely
  absent card throws and takes the Save button with it.
- **A function called but never defined.** `lagHint()` was called from
  `renderMech` and defined nowhere for several releases; the whole mechanics
  panel was empty on the live site and nothing failed.
- **A transition is not reachable by re-rendering.** Entry and elimination are
  derived from the difference between two states, so a renderer test never
  reaches that code. `detectEvents` read an out-of-scope `e` and threw on every
  single entry for three weeks. If your work has state-transition logic, it
  needs a test that applies two states, not one.

## Overlays: this has cost four releases

The host's Correct / Wrong / Nobody buttons live bottom right, and three
different fixed-position overlays have covered them. The guard is now general:
**in `console.html` and `theme-player.js`, any `position:fixed` rule with a
`bottom:` must be `pointer-events:none`** unless it is a full-screen modal
(`inset:0`).

**The buzzer is not covered by that guard.** The award popup and the objection
banner are new overlays on a page nothing checks. Write the guard as part of the
same change, in the same shape, or the fourth instance of this bug will be
yours. A separate axis of the same family: a category card that grows to fit a
hint pushes its column down — cards are a fixed height, and `pagerefs` fails if
`.cat` goes back to a min/max range.

## The rules that are not negotiable

- **The buzzer must never receive the answer.** The watch payload is built
  field-by-field for this reason and `test/watch.mjs` asserts the answer is
  absent. The award popup shows what the transcript *heard each player say*, not
  the accepted answer. Add the same assertion for `award-vote` in the same
  change that adds it.
- **`cluesRevealed` is the clock** for entries, the ceiling and overtime.
  `voidClue` must not advance it. A voided clue that moved the entry clock is a
  rules change nobody decided.
- **`undo-clue` pops `undoStack`, `history` and `record.clues` together.** The
  walk-back does all three or the log and the engine disagree.
- **`activate-buzzers` is not volatile.** Volatile packets are dropped rather
  than queued, which is precisely wrong for the one signal that must reach
  everybody.
- **Warm-up buzzes stay out of the live record.** A spectator's objection or
  answer stream must never touch `stat()`.
- **The guards fail closed.** A missing key refuses and names the variable it
  wants. Never a silent no-op, never a default that is open — `ADMIN_KEY` once
  fell back to a literal string in a public repo.
- **Player-facing docs ship in the same commit as the rule.** `RULES.md`, both
  `docs/discord-*.md`, `docs/handbook.html`, `public/howto.html`, plus an
  assertion per rule in `test/guides.mjs`. A rules change that lands in the
  engine and not in these is half a change: the room is still playing the old
  game. Discord messages truncate silently at 2,000 characters and `guides.mjs`
  now checks every `RULES.md` block against that.

## House style, because I will otherwise rewrite it

- **Comments explain why, not what**, especially where a decision looks wrong.
  Every non-obvious constant says what was measured to land on it.
- **Test names read as sentences**: `check('a raised clue moves both players by
  the same amount', ...)`. The output is meant to read as a description of the
  rules.
- **Corrections are recorded, not deleted.** When a number changes, the old one
  stays with the new one after it.
- **American English**, in copy, comments and commit messages alike.
- **Call them casual players.** Never "low-skill", never "weak". The rejected
  buzz-boost mechanic is "kickout on 2", never "pity powerup".
- Never mint a P-label below P101; P1–P99 belong to the analysis chat.

## How to hand work over

Leave it in the working tree with the suite green and tell me what you touched.
Do not run `npm run ship` — it commits the whole tree with `git add -A`, and
this repo has had two other chats' unfinished work in it at the same time. I
review, commit selectively, and ship in the morning, because a restart ends
every match in memory.

Two things I will check first, every time, because they are where the last real
defects were: **anything that redirects or takes a URL**, and **any new failure
path that could be silent.** A recent sign-in accepted any `next` starting with
a slash, which let `//evil.example` through as a protocol-relative URL; the test
I wrote for it then passed on a 503 from an unconfigured service, which is a
check that never ran. If a failure can happen quietly, it needs a signal a human
can see and a test that proves the signal fires.

## What I owe you

Ask and you get it: the exact shape of any payload, what a guard does, whether
something has been measured before, and whether a number you are about to quote
is reproducible. Numbers in this project are only quoted when the tool that
produced them has been re-run — figures that arrived with a change but were
absent from the tool that supposedly made it have reached the handbook twice.
