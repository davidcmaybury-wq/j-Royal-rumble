# CLAUDE.md

Context for picking this project up cold. Read this first, then `README.md` for
what the thing does and `docs/handbook.html` for why it does it
that way.

## What this is

A Jeopardy!-format battle royale played over video call. Thirty players, three
start, one survives. Built for David to host; players buzz on their phones, the
host drives a console, the room watches a public screen.

**Live at `https://j-royal-rumble.net`** — a Lightsail VM in Ohio behind
CloudFront, domain at Cloudflare. `infra/aws/HOSTING.md` is David's record of
how it was built and is the authority for anything about the hosting. Repo
`https://github.com/davidcmaybury-wq/j-Royal-rumble`.

The old Fly app (`j-royal-rumble.fly.dev`, region `ord`) is what everything
before August 2026 refers to. It is **still running as a spare**, with the match
logs already copied across. Because matches live in memory on one instance, two
reachable hosts means a split group is two separate broken games — set
`RUMBLE_MOVED_TO=https://j-royal-rumble.net` on the old box and it redirects
everything, path preserved. See `infra/aws/README.md`.

## Shipping

```bash
tar xzf rumble-code-vX.Y.Z.tar.gz && rm rumble-code-vX.Y.Z.tar.gz
npm run ship "what changed"
```

Tarballs handed to David are **full snapshots** — a later one carries
everything from earlier ones, so a skipped version is not a lost version.

`ship.sh` does **not** pull first. If the remote has moved (a phone deploy, an
edit in the Codespace) the push is rejected; `git pull --rebase` and ship again.
This has bitten twice.

**Phone deploys**: upload a tarball to `incoming/` on github.com and the
`unpack` workflow extracts, commits and deploys. It cannot modify
`.github/workflows` — those are skipped and listed in the run summary. The
download card strips `.gz`, so `.tar` is accepted too.

`npm run ship` pushes to GitHub; GitHub runs the full suite and, if green, tells
the Lightsail box to pull. So a push deploys, and a broken commit does not.

That needs the `AWS_HOST` and `AWS_SSH_KEY` secrets. **Without them the workflow
is plain CI and deploys nothing** — it prints the manual command instead, so if
a change seems not to have landed, check whether they are set.

By hand on the box:

```bash
bash /home/ubuntu/app/tools/deploy-remote.sh          # refuses mid-match
bash /home/ubuntu/app/tools/deploy-remote.sh --wait   # deploys when clear
bash /home/ubuntu/app/tools/deploy-remote.sh --force  # now, regardless
```

**A restart ends every match in progress** — they live in memory — so the script
asks `/api/health` for `matchesInPlay` first and holds rather than pulling the
rug. Never take that guard out.

I had designed a CloudFormation stack for this migration (EC2 + Caddy + ECR).
David built something simpler and better suited, so that design was deleted —
see `infra/aws/README.md`. Don't resurrect it.

## Layout

```
src/engine.js      rules, scoring, overtime, the fairness grid. No I/O.
src/server.js      express + socket.io, match lifecycle, bot driving, logs
src/bots.js        Matt Schiffler's real generator, ported
public/*.html      console, buzzer, setup, watch, admin — each self-contained
public/wrestlers.js  parametric 8-bit sprites: avatars AND animation figures
public/toss.js     the three animations, generated at runtime
public/estimate.js length estimation + setup warnings; imports the engine
test/              32 .mjs suites + harness.js, all wired into deploy.yml
tools/             handbook, audio, box scores, analysis charts, ship
```

`src/engine.js` is served to the browser at `/src/engine.js` so `estimate.js`
can `import '../src/engine.js'` and have it resolve **both** in node and in the
browser. Don't "fix" that path.

## Running the tests

```bash
node src/server.js &          # give it ~25s in a slow sandbox
for t in wrestlers mechanics2 latecomer lag watch logdetail warmup timeout \
         tokens botcal otvalue mechanics-ui overtime logstore retoss \
         entry-countdown pagerefs bots setup-bots setup e2e delay record \
         buzzer avatar mechanics-live perf escapes comeback; do node test/$t.mjs; done
for t in mechanics estimate boxparse boxfetch; do node test/$t.mjs; done
node test/harness.js          # preset sanity: length, back-half, skill
```

In this sandbox the server is killed periodically. **A suite that fails with
`fetch failed` or `ECONNREFUSED` is not a real failure** — restart the server
and re-run before believing it.

`test/pagerefs.mjs` is the most valuable one: it parses every page, checks that
every id the script binds to exists, that every class it applies is styled, and
that no import goes unused, then executes the renderers against a stub DOM. It
has caught several bugs mid-build, including CSS patches that silently missed
their anchor.

## The player-facing documentation ships with the code

`docs/discord-rules-v2.md` and `docs/discord-advanced-mechanics.md` are the copy
David posts before a match, and they are the **source** for `/rules-101` — the
page renders those files, so the message in the channel and the page on the site
cannot drift apart. `docs/handbook.html` and the PDF are the design write-up.

`docs/handbook.html` is the live handbook, served at `/handbook`. It used to
serve a PDF from `tools/make-handbook.py` and the two drifted badly — the PDF
was months behind while the HTML sat unlinked. **The HTML is now the document;
`docs/handbook.html` IS the handbook, served at `/handbook`.**

`docs/analysis/` holds the CSVs behind Part IV and an anonymization key mapping
the handbook's P-labels to real names. **Keep that key out of anything
player-facing** — the handbook anonymizes on purpose. Only `public/` is served,
so `docs/analysis/` is not reachable from the web; do not move it.

**I wrote it and it is mine to keep current** — I once told David it was his,
which was wrong and meant it sat un-updated for several releases while I assumed
somebody else had it. It went four versions describing an identical entry stake
after that stopped being true.

Update it in the same change as the rule, alongside `docs/discord-*.md`. The
handbook is the long form — it carries the reasoning and the measurements, and
keeps its overturned answers on the page marked as such, which is the point of
it.
The PDF that `tools/make-handbook.py` used to produce is gone: its figures were
typed in by hand, it drifted, and having two handbooks that disagreed was worse
than having one. `/handbook.pdf` redirects.

**Keep all of these current with every change to the rules, and keep them in the
package.** A rules change that lands in the engine and not in these files is
half a change: the room is still playing the old game.

`public/howto.html` is the illustrated guide for somebody who has never played.
It assumes nothing — what a video call is for, who reads the clues, that the
board can live in the buzzer window. `test/guides.mjs` checks these pages serve,
that the welcome screen links to them, and that the guide's markup balances,
because unclosed step divs once nested every step inside the first and stretched
the page to four times its height.

## Conventions that matter

**Update the player-facing docs in the same change as the rule.** The files in
`docs/` drifted four releases deep — the rules people read still described a
fixed entry stake long after it had changed, and nobody noticed until David
asked. The README is not enough: `discord-rules-v2.md` and
`discord-advanced-mechanics.md` are what the room actually reads, and
`/rules-101` renders them directly. `test/guides.mjs` now asserts that specific
rules appear by name; add to it whenever you add a rule, or the next one drifts
the same way.

**American English.** David is American and the game is American. Use it in
player-facing copy, comments, and commit messages alike — colour/color,
favours/favors, recognise/recognize, behaviour/behavior. Existing text will
still be British in places; fix it when you are already editing that line
rather than sweeping for it.

**Comments explain why, not what.** Especially where a decision looks wrong:
every non-obvious constant should say what was measured to land on it.

**Test names read as sentences** — `check('a raised clue moves both players by
the same amount', ...)`. The output is meant to be readable as a description of
the rules.

**Corrections are recorded, not deleted.** The handbook still contains the old
argument for a decaying ceiling, marked as overturned, with the new finding
after it. A design document that quietly deletes its wrong answers is less
useful than one that shows the correction.

## Hard-won findings — do not re-litigate without measuring

**`sort(() => rng() - 0.5)` is not a shuffle.** It leaves a heavy bias toward
the original order. It reported three players in identical starting positions
winning at 25.8%, 14.2% and 10.4%, and reversed a ceiling recommendation. Use
Fisher-Yates everywhere. If a simulation produces an asymmetry between draws
1–3, that is the bug, because they all start together.

**The ceiling is the dominant fairness lever**, not the entry interval. It used
to jump 7,500 → 11,000 at 25 players, which confounded every measurement before
it was found — it made 24 players look far less fair than 30. `autoCeiling(n)`
now scales it, and fairness holds across a far wider range of intervals than the
confounded data suggested.

**A falling ceiling favours late draws.** It clips whoever is ahead, and that is
nearly always an early entrant who has been accumulating; a latecomer arrives at
a fixed stake untouched. Decay is zero during the main match.

**But removing it entirely removed the only drain.** A symmetric exchange with
nothing leaking never resolves — evenly matched robots ran 400 clues with no
elimination. Escalating stakes does not help: doubling both sides of an even
trade leaves it even. So the ceiling falls **only once overtime opens**.

**Longer matches are less fair, shorter ones are less skilful.** No formula
predicted the spread well (best r = 0.71), so `FAIRNESS` in `src/engine.js` is
the measurement itself — 3,000 matches per field-size/interval pair. Prefer a
lookup you measured to a rule you guessed.

**Overtime took three attempts**, each failure recorded in the handbook. Current
shape: opens when the queue empties, or on a very long stall (8 escalation
windows ≈ 48 clues) even with people queued. At 3 windows it fired during the
entry phase and cost 11 minutes of length and 20 points of fairness. The
multiplier **ratchets** — an elimination stops the climb, doesn't reset it. The
winner of a raised clue **banks the full amount** and is clipped next clue; the
old behaviour paid 500 on a 2,000 clue while charging the loser 2,000.

**Warm-up buzzes must stay out of the live record.** A player eliminated at
clue 9 who kept buzzing finished a real match credited with 159 attempts against
a real 1.

**Bot calibration needs 16 buzzes, not 6.** Measured against two real matches,
the first six gave 302ms and 242ms where the settled figures were 85ms and 60ms.
People start slowly.

## Routes

```
/                 welcome: play / watch / host
/setup/:id        set a match up (host key in the URL fragment)
/host/:id         the host console
/j/:id            a player's buzzer
/watch/:id        the public read-only board
/api/match/:id/exists   does this room exist — used by the welcome screen
```

The host key travels in the **fragment**, which browsers do not send to the
server, keeping it out of logs and referrer headers. Don't move it to a query
string.

## Editing a workflow

Steps run under `bash -e`, so any command failing kills the step with no
explanation — a deploy once died in 60ms and reported only "exit code 1". Where
a step can fail for several reasons, turn `-e` off and check each one with a
message saying what to do about it.

Write secrets to files with `printf %s\n`, never `echo`: a private key pasted
into a GitHub secret without a trailing newline is rejected by OpenSSH instantly
as invalid format.


`secrets` is **not** available in an `if:`, at step or job level. GitHub rejects
the whole file — no jobs run, and the run reports as a failure with nothing in
it, which is confusing to debug. Compute the flag in job-level `env` and test
`env.X` in the step instead. A YAML parser will not catch this; `test/workflows.mjs`
will, and also checks that every suite a workflow names actually exists.

## Arcade and Tournament are one setting with two names

`comeback: true` makes a match Arcade, `false` makes it Tournament, and
`Match.arcade()` is the single place that decides. It is a property of the
match, not of the moment — a label that flipped as players picked up and lost
the edge would tell the room nothing it could act on.

In Arcade the public payloads carry `place` and **no `ms` at all**: with the
edge applied, order is not speed, and a published number that contradicts the
highlight is what produced the "Zach was fastest but Dalton was highlighted"
report. A player's own time still reaches them through `myBuzz`. Omit rather
than hide — `test/arcade.mjs` checks the field is absent, the same discipline as
the answer never reaching the watch screen.

`rerank` had to be fixed with it: it ranked on raw `ms` while `rankRace` ordered
on `ms * buzzEdge`, so the place a player was told disagreed with who held the
clock. That only showed up once the comeback existed, because every edge was 1
before it.

## Quick setup hides expert, it does not omit it

`setup.html` has two modes, quick (default) and expert, remembered per browser
in `localStorage` under `rumble:setupMode`. **Every expert control renders in
both modes and is hidden with CSS.** `collect()` reads each one by id on save,
so a card that is genuinely absent from the DOM throws and takes the Save button
with it — the dead-button failure this file is already full of. Hiding also
means switching modes cannot lose an edit.

The presets write into the real controls and then save, which is why the order
in `applyPreset` matters: paint, save, paint. Saving first collects the controls
the preset was meant to replace, and repainting with `render(true)` restores
them over the top, because `keepEdits` captures every control and puts it back.
Both mistakes silently undo the preset and neither throws.

`pagerefs.mjs` checks every mechanic on the page is named by a rule set, so a
new mechanic cannot quietly inherit whatever the last preset left it at.

## A whole panel can vanish silently

`lagHint()` was called from `renderMech` and defined nowhere, for several
releases. It threw on every render, so the mechanics panel — top rope,
targeting, bounties, the lag control, the watch link — was simply empty on the
live site, and nothing failed. The edit that added the call landed; the edit
that added the function missed its anchor.

Two lessons. **Check that a patch applied**, not just that the file still
parses. And `pagerefs.mjs` now reads the source for functions that are called
but never defined, because executing renderers in a stub DOM did not catch it —
`renderMech` returns early there.

## Abandoned matches

A match lives in memory until somebody ends it; closing the tab does not. One
forgotten test match blocked a deploy for an hour, because `deploy-remote.sh`
waits rather than restarting under a live game — correct behaviour, no way to
clear it short of restarting the box by hand.

Now: `/control` lists and ends matches, and anything silent for ten minutes
(`RUMBLE_IDLE_MINUTES`) ends itself. A live match ended either way is recorded
first; an abandoned lobby is just dropped.

`broadcast(m)` at module level exists because the push helpers live inside the
socket connection closure and close over one socket's match, so the reaper
cannot use them.

## The open design question: fairness by skill

David, from the Aug 16 analysis: *"I'm concerned that the game is too friendly
to elite players, and everyone is just cannon fodder. I want everyone to have
SOME chance to win in this."*

Nine recorded human matches back the concern. The winner was the fastest buzzer
in the field in 4 of 8 decided matches and second-fastest in 2 more. Three
players entered 6 of those 8 and won 5. In QPAL two players took 125 of 165
races; the other five entrants split 23 over 48 minutes. Race-win percentage is
monotone against median reaction time across all 18 players with 20+ contested
buzzes. Upsets happen — one win from 5th of 7, one from 3rd of 4 — so it is not
deterministic, but a bottom-half buzzer is around 1-in-4 overall and close to
zero when a Luigi-class buzzer is in the room.

**Addressed in 0.84.0 — "one foot on the floor".** The original note follows,
because the reasoning is what picked the lever.

A player who would go out having taken fewer than three clues is not eliminated:
they stay up at half stake with their buzz time halved for 40 races. On by
default, `comeback: false` turns it off, and `tools/comeback-study.mjs` is the
measurement. **The gate is the whole mechanism** — ungated it is a subsidy for
the strong, who spend the free life too and finish further ahead.

Measured, 1,500 matches a row, six-player field: gated at 70% the three casuals
take **11.0%** of the wins and the elite 61.9%; ungated it is 2.9% and 48.7%,
which is the whole argument for the gate.

**The boost is a threshold, not a dial — do not "moderate" it.** It shipped at
50% for one release and measures as very nearly nothing: casuals 2.1%, elite
back up to 74.4%. The discount only counts if it puts a slow player under a fast
one, and against the study's 95ms elite the casuals need 54.8%, 60.4% and 64.8%.
At 50% none of them get there. Below ~55% it is decorative; the useful range
starts near 65%. The table is in `engine.js` above the setting — retune against
it, never by feel.

**The trigger is settled, measured against 89 real eliminations.** Do not
re-litigate without new data. Wins-since-entry is the axis and **tenure is not**
— the players who never got going mostly lasted 9–17 clues, so tenure separates
nobody (a tenure<12 gate scores casuals 1.9% against 11.0%, and a hybrid fires
for the identical 24 of 63 first eliminations as wins<3 alone). Three sits at an
empirical valley: first-elimination wins are bimodal at 0 and 1, then a gap at
2–3. Loosening to wins<5 adds almost nothing for casuals (11.0% → 11.7%) and
mostly feeds the mid tier. Ungated, elites take 1.8 free lives a match and casual
benefit collapses to 2.9% — the gate is the mechanic. Once per player stays.

**The return stake rides the overtime multiplier**, on the same
`scaleEntryStake` switch as entries and revivals: 41 of those 89 eliminations
happened during overtime, where a flat stake bought 1–6 clues of life. Measured
at the same fire rate — casuals 11.0% → 14.1%, top shark 61.9% → 56.1%.

It also **costs draw fairness** (back half 50% → 59% at sixteen), the first time
the two axes have pulled against each other here.

**And the figures it first shipped with were not reproducible** — "bottom four
1.5% → 41.9%, elite 93.8% → 38.6%" matches no row `comeback-study` produces.
They are corrected now. Treat any number arriving with a change but absent from
the tool that supposedly made it as unverified until you have run the tool.

Old note follows.

**This is a second axis and the harness does not measure it.** Fairness by draw
— the back-half win rate — has been measured to death and is fine. Fairness by
skill has never been measured at all. Proposed definition of done, so a harness
run can answer it: **P(a bottom-half-median buzzer wins), with an elite in the
field.** Report it alongside back-half and skill%.

Candidate levers, from the analysis, in the order they look worth trying:

1. ~~Scale entry and revival stakes with the overtime multiplier.~~ **Done in
   0.78** — this was the Randall case, and it moved death-within-three-clues
   from 58% to 9%.
2. ~~A buzz-timing handicap priced in score.~~ **Done in 0.84.0**, inverted: the
   discount goes to whoever never got going rather than the leader giving up
   milliseconds. Same trade seen from the other end, and far easier to explain
   at the table.
3. **A progressive pot.** Leaders pay more into pots they lose. Redistributive
   without touching the buzzer, which makes it easier to explain to a room.
4. **Lean on the existing skill dial.** The harness already reports skill% per
   configuration and shorter, swingier configs are measurably less
   skill-determined.

Measure before shipping any of them, per the house rule. Note that 2 is the only
one that addresses the stated problem: 1, 3 and 4 all move money around, and a
player who wins every race will still win the match.

## Deploy during downtime

People play on this now. Restarting ends every match in progress, so a deploy
in the evening can end somebody else's game — the guard in
`tools/deploy-remote.sh` waits rather than doing that, but a deploy that waits
twenty minutes and then fails is its own nuisance. Ship in the morning.

## Silent failures found in live use

Three in one sitting, all the same shape — the code was correct and said
nothing, so the host could not tell what had happened.

- `unlock()` primed all nine audio cues **at full volume** on the first click.
  Priming only needs a play() during a gesture; it does not need to be heard.
- The setup estimate read `S.settings` (last saved) rather than the form, so
  typing 10 into the target produced a warning about 30.
- `hostOnly` returned silently when it refused, and the start button saved
  quietly and navigated on a timer. A refused start looked like a dead button.
  Refusals now answer the acknowledgement with a reason.

## Known-flaky patterns, all fixed but worth recognising

- **Double evaluation in a `check()`** — calling the same clock-reading function
  in both the condition and the message means they measure different moments.
  Failed CI while printing the value that would have passed.
- **Betting a suite on one dice roll** — `bots.mjs` asserted that one of three
  robots would take a given clue. All three decline about 0.4% of the time. It
  now plays up to six clues. I dismissed this as flakiness twice before
  measuring it; don't.

## Queued, not started

**Show the year on an archive category card.** A J! category should say when it
was written — "STATE OF THE UNION ADDRESSES · 2005" — so the room knows whether
a clue is of its time. No data work needed: archive categories already carry
`provenance.airDate` (e.g. `2005-09-12`) and `provenance.season`. Original
boards have `provenance.title` and `author` instead and should show nothing, so
key off `source === 'archive'`.

The card is drawn in three places and they must agree: `.cat` in console.html
and watch.html, and `.bcat` in buzzer.html for the full board. Note the card is
a fixed height with the title clamped — see the note about a long category
pushing its column out of line — so the year needs to fit inside that, probably
as a small dim line under the title rather than appended to it.

**Point every version number at the history, not the control room.** The
welcome screen already does it; these do not:

| Where | Now | Wanted |
|---|---|---|
| `setup.html:562` | links to `/control` | link to `/history`, plus a separate Control link |
| `console.html:675` | links to `/control` | same |
| `watch.html:423` | plain text, no link | link to `/history` |

The rule: **the version number means "what is this?" and belongs to `/history`;
the control room is a separate errand and gets its own link.** Check the whole
set when doing it — the buzzer shows no version at all, which is probably right
for a player's phone but worth a glance.

**Move the match-length box.** It currently sits in the Room code card beside
the join link, where it gets lost against the four-letter code. Move it into the
Signed up card with the incoming players, and retitle it "How long should the
match last?" — the two boxes must stay in step with the one in Game setup, which
is what `syncLength` in setup.html is for.

**1. ~~Two buzzer modes~~ — built in 0.49.0, layout unverified.** Desktop-only
board beside the buzzer, opt-in, remembered per device. Reuses `watchView()` on
its own socket room (`:board`) so it cannot corrupt the player's own `state`
feed or carry an answer. `test/fullbuzzer.mjs` covers both. **Two headless
screenshots came out blank despite correct DOM and bounding boxes** — probably a
headless artefact, but it needs a real pair of eyes before anyone relies on it.
`?light` on the buzzer URL forces light mode and forgets the preference, which
is the way out if it renders badly.

Old note follows.

**1. Two buzzer modes.** The current buzzer is the *light* one and assumes the
board is on a shared screen. A *full* mode folds the watch view in — board,
scores, the live clue — for a player who is not screen-sharing.

**Full mode is desktop only**, by David's decision. Do not try to make the board
work at phone width; offer light mode there instead and say why.

The buzzer must **never** receive answers: the watch payload is built
field-by-field for exactly this reason and `test/watch.mjs` asserts the answer
is absent, so full mode must reuse `watchView()` rather than the host view.
Copying the host view and deleting fields is the mistake that guard exists to
catch.

**2. ~~Countdown lights on the watch screen~~ — already done.** The watch screen
has had them since the trio in 0.40.0; this note was stale. Verified live.

Old note follows.

**2. Countdown lights on the watch screen.** The console has a five-light
lectern (`.lectern`, driven by `startLectern`/`stopLectern` on the race
opening). The watch screen has the animations but no lights, so a room watching
it cannot see how long is left. Mirror it. Note the re-toss reopens the race and
restarts the lights — that already confused a host once, so the watch screen
should make a second run read as a second race rather than a glitch.

## Outstanding

**Entrance music** — built in 0.50.0. Twelve original 8-bit themes
(`tools/make-themes.py`), a folder-is-the-library endpoint at `/api/themes`, a
picker on the buzzer, and playback on whichever watch screen has sound on.
YouTube links and https file links are supported too; **do not commit
copyrighted clips** — the folder is David's to fill and his call on licensing.

Old note follows.

**Entrance music** was the one queue item never started: per-player uploaded clip
or YouTube link with a start time, plus a library folder seeded with original
synthesised 8-bit themes in three moods (horror, wrestling, sports), ~10s each,
loudness-matched. Plays through the watch screen with sound enabled. David
accepts the IP risk on user uploads; **do not commit copyrighted clips to the
repo** — the library folder is his to fill.

**Handbook figures are hand-typed** in `tools/make-handbook.py` rather than read
from the code, so they drift. Offered to wire them up twice; no answer.

**Check both directions between renders and reads.** The 0.46.0 "fix" below was
itself wrong: it claimed four toggles rendered but were not read, when in truth
they were never rendered at all — and the reads it added crashed every "Save
settings" click on the live site for several releases, which also made every
settings change silently not take. `pagerefs.mjs` now checks both ways: every
rendered toggle is read, and everything `g()` reads is rendered. Do not assert
what a page contains from memory; grep it.

**A toggle that renders but is never read back is invisible.** Five shipped that
way — the render landed, the read did not, and the defaults were sensible enough
that nobody noticed. `pagerefs.mjs` now checks every toggle in setup.html is
read back and is a real engine setting.

**Bounties are still untested in live play** — the mechanic has never fired in a
real match. Worth checking whether the `B` key is discoverable.

**Softening the double-dip at high overtime multipliers** was raised and left
open: at ×8 a missed clue costs the value twice, which can eliminate a player
from 8,000 points in one press.

## Live data

Two human matches recorded. Pace 19.3s → 16.8s median per clue (the model
assumes 17.5). The length estimator is 2-for-2: predicted 100 clues/29 min
against 84/31, and 75/22 against 69/21. Human buzz median ~150ms, with 49%
under 150ms.

`data/box-scores.json` (2,784 player-games) and `data/jometry-box.csv` (3,339
with per-round splits) back the bot model. j-ometry blocks bots, so David
downloaded that one by hand — don't try to re-fetch it.
