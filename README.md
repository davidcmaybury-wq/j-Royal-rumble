# J! Royal Rumble

A 30-player elimination trivia format built on the Jeopardy! clue structure and
the 1980s Royal Rumble entry mechanic. Played over Zoom or Discord with one
shared screen; players buzz from their own devices.

## Rules

Three players start. Every correct answer pays the answerer the clue value
**from each opponent**, and every opponent loses that value. A miss costs the
misser the value and locks them out of that clue; the clue is then re-tossed to
everyone still eligible. A clue nobody gets costs every live player half value.
Drop below zero and you're out — zero is alive. A new entrant joins on a fixed
clue interval. A score ceiling decays over the match and clips every live score.
Clear the field and you take a bonus equal to the value left on the board, the
board refreshes, and two more players enter.

The winner is the last one standing. Every other statistic is for fun.

## Layout

    public/setup.html host setup: room code, roster, material, rules
    src/engine.js     rules, headless and framework-free
    src/sources.js    adapters: TTG/LearningMan JSON, seven-column CSV, clue TSV
    src/server.js     Socket.IO v4 server, authoritative on scoring and timing
    public/           console (host + shared screen), buzzer (player), admin
    data/library.json seed clue library, tagged by source
    test/harness.js   Monte Carlo verification of the tuning presets
    test/e2e.mjs      a real match played over sockets
    test/setup.mjs    room codes, uploads, blend, start alert
    test/estimate.mjs match-length estimates and the setup warnings
    test/buzzer.mjs   buzz arbitration: early presses, lockouts, ordering
    test/record.mjs   undo, corrections, score history, match recording
    test/avatar.mjs   profile pictures: acceptance, rejection, where they surface

## Running it

    npm install
    npm start           # http://localhost:8080

    npm run sim         # verify rules changes against the tuning targets

Open `/` to set up a match. You get a four-letter room code to read out, a
lobby that fills as players join, controls for clue material and rules, and a
place to upload fresh boards in j-trivia.org JSON or jparty.tv CSV. Players go
to `/join` and enter the code.

## Tuning

Match length and draw fairness trade against each other. Presets that land near
the target runtimes, verified by `npm run sim`:

| Roster | Entry every | Start | Ceiling | Decay/clue | Length |
|--------|-------------|-------|---------|-----------|--------|
| 10     | 10          | 3,000 | 7,500   | −40       | 39 min |
| 16     | 7           | 3,000 | 7,500   | −25       | 51 min |
| 20     | 6           | 3,000 | 7,500   | −25       | 54 min |
| 30     | 5           | 3,000 | 11,000  | −40       | 65 min |

The ceiling **falls** through the match on purpose. A fixed or rising ceiling
hands the win to whoever draws last: without decay, draws in the back half win
roughly two thirds of matches, and under flat scoring they win essentially all
of them. Run `npm run sim` after any rules change and check the `back-half`
column before shipping.

## Clue sources

Categories are tagged `original` or `archive` so a match can draw from either or
blend them by weight. Archive material comes from a public dataset rather than
from j-archive directly, at the maintainer's request. Media-dependent clues are
filtered out; a category is only playable if all five rows survive.

## Sound

The entry horn is built from a recording in `sources/`; the chop and the
countdown tones are synthesised. See CREDITS.md for provenance.

    python3 tools/build-audio.py sources/   rebuilds cues from recordings
    python3 tools/make-audio.py             rebuilds the synthesised cues

Raw recordings don't drop straight in — `build-audio.py` trims to the onset,
shapes the tail, matches loudness across cues so one doesn't tower over
another, and adds a short room.

Browsers block audio until a page has been interacted with, so both the console
and the buzzer unlock on the first tap or key press.

## Latency

The Zoom delay setting assumes the socket path beats the call audio by 150–200
ms. If the sockets get slow, that assumption inverts: players hear the clue
before their buzzer arms and get penalised for being right. So the socket layer
is tuned for latency over throughput — websocket only, no compression, Nagle
off — and state pushes are coalesced over 25 ms so a burst of buzzes can't
crowd out the messages that matter.

Measured on the socket path in a real match from `ord`: 7 ms, 13 ms and 29 ms
one way for four players spread across the country, and steady — min, median
and p90 within a few ms of each other for everyone. Zoom audio runs 150–300 ms,
so the socket beats the voice by roughly 120–290 ms. That gap is what the delay
setting exists to close.

The delay is adjustable **during** a match from the console, because nobody can
tell you it's wrong until they've tried to buzz on a real clue. Players also get
their own ±10 ms trim on the buzzer, since audio paths differ by client, buffer
and whether they're on headphones.

Each player's measured one-way latency shows beside their name in the ring, and
the console warns when anyone is over 120 ms. Every sample is kept in the match
record, per player, so a slow evening can be told apart from a slow field.

The app runs in `ord` (Chicago) for a field spread across the US. Moving it,
between matches — the machine holds all live state, so this ends anything in
progress:

    fly scale count 0
    fly scale count 1 --region ord
    fly status

`node test/perf.mjs` measures it with a field of 24: activation should reach
every player with a spread well under 60 ms. It exists because an earlier
attempt at this used `volatile` emits, which are dropped rather than queued —
the activation reached nobody at all, and nothing else in the suite noticed.

## A note on buzz times

Times under 150ms are expected, not suspect. Players time the buzzer to the
rhythm of the host's read rather than reacting to the lights, so a well-judged
buzz lands at or near zero and an over-eager one takes the lockout. The server
accepts `ms >= 0` for that reason; only negative and non-finite values are
rejected. The match record reports how many buzzes came in under 150ms, which is
a decent measure of how hard a field is anticipating.

## Overtime

Two evenly matched players will trade the same points back and forth
indefinitely — seen in the first real match, where the last fourteen clues
oscillated without either player getting closer to going out.

Once the queue is empty and the ring is down to two, clue values double every
six clues, capped at eight times face. The console announces the start and each
rise. On by default; `overtime: false` turns it off.

A perfectly alternating two-player stall runs forever without it, and ends in
about 22 clues with it — see `test/overtime.mjs`.

## Robot players

For testing, or for filling a thin roster. Added from the setup page, mixed
across five standards or all forced to one.

The model follows the one Dave Maybury's friend built for his own game: an
aggression level (rookie through elite) sets how often a player attempts a clue,
and a separate buzzing skill (bad, mid, good, jedi) sets how fast they are.
Higher levels draw better hands but not deterministically — elite is 80% jedi,
a rookie can still have quick fingers.

Buzz times are drawn per clue from a gaussian. A negative draw means they jumped
the lights, which is where early-buzz behaviour comes from rather than being
bolted on. Bots buzz on a real clock, scheduled at the moment their drawn time
lands, so the race fills in on the console the way it does with people.

Since the host cannot adjudicate a robot, each bot buzz carries whether it is
about to be right, shown on the console chip.

Only the jedi buzz profile and the attempts-per-game bands came from the
original. Everything marked  in  is a placeholder.

## Robot players

For testing, or for filling a thin roster. Added from the setup page, mixed
across five standards or all forced to one.

The model follows the one built for another game: an aggression level (rookie
through elite) sets how often a player attempts a clue, and a separate buzzing
skill (bad, mid, good, jedi) sets how fast they are when they do. Higher levels
draw better hands but not deterministically -- elite is 80% jedi, and a rookie
can still have quick fingers.

Buzz times are drawn per clue from a gaussian. A negative draw means they jumped
the lights, which is where the early-buzz behaviour comes from rather than being
bolted on separately. Bots buzz on a real clock, scheduled at the moment their
drawn time lands, so the race fills in on the console the way it does with
people.

Since the host cannot adjudicate a robot, each bot buzz carries whether it is
about to be right, shown on the console chip.

### Recorded buzz distributions

`data/buzz-distributions.json` holds real buzz histograms from play of the
original model — 2,493 buzzes across four standards plus a strong human. Robots
sample those histograms directly rather than drawing from a fitted curve,
because no gaussian reproduces their shape: they are strongly right-skewed with
a tail of whiffs, and the thing separating a superchamp from a rookie is as much
consistency as speed. Their middle 50% spans 37-87 ms against the rookie's
-13 to 362.

Sampled medians land within a few ms of the recorded ones, and early-buzz rates
within a point.

Two adjustments sit on top:

**Read jitter** — one shared offset per clue, because the host activates by hand
at the end of a spoken read and players are timing that read rather than
reacting to a light. When a read runs long, everybody anticipating it is early
together. Independent errors are not how a room behaves.

**Field matching** — robots were recorded against one particular field on one
particular setup. Rather than assume that scale transfers, they shift by the
difference between the humans actually playing and the human they were recorded
against, so they stay competitive with whoever turned up. Off with
`botMatchField: false`.

### Buzzer scales

Robot timing is expressed three ways, selectable when adding them. The unit
that matters is J!ometry's **Time%** — the chance of winning a buzz when all
three players attempt, where 33.3 is average and roughly 46 is a strong
champion across a career.

| Scale | jedi | good | mid | bad |
|---|---|---|---|---|
| observed | 85% | 66% | 33% | 10% |
| broadcast | 47% | 39% | 33% | 23% |
| **measured** (default) | 51% | 43% | 33% | 21% |

`observed` reproduces the original model. Its spread is far wider than real
contestants occupy — a jedi at 85% would be twice the best champion on record.
That is invisible in the original game because the human it is measured against
is equally superhuman, at 88%.

`measured` is anchored on buzz times actually recorded here: two strong players
over 63 buzzes, median 198 ms, sd 97. Against a player at that speed, the
original scale leaves a human winning **24%** of contested clues in a three-way
and **4%** in a ring of eight — the robots are unbeatable, not harmless. The
measured scale gives 46% and 21%.

### Against the official box scores

`data/box-scores.json` holds published game statistics from
[Jeopardata](https://www.jeopardy.com/track/jeopardata) — ATT, BUZ and COR/INC
per player per game. `node tools/fetch-box-scores.mjs` collects more, one page
every two seconds; `--all` walks the whole 184-page archive.

The career lines settle the question the model kept circling:

| Wins | BUZ% | Correct% |
|---|---|---|
| 12 | 67% | 91% |
| 5 | 57% | 89% |
| 2 | 56% | 90% |
| 1 | 47–55% | 86–92% |

**Accuracy is flat. Everything separating a twelve-day champion from a one-day
champion is winning the buzz.** The robot standards now line up against it:
normie 51% BUZ, champ 60%, superchamp 65%, elite 68%, against a real median of
50% and a real ceiling of 67%.

Attempt bands are bounded by the same data — 22 to 51 per game, median 38.
The previous elite band topped out at 58, above anything anyone has done.

### Calibration

The parameters are fitted against real recorded play — 22 solo games of one
strong human against two robots — rather than guessed.
`node tools/calibrate-bots.mjs` reproduces that table and fails if any standard
drifts more than 35%.

Two things the data corrected. Accuracy was far too low in the first pass:
observed accuracy once a player wins the buzz runs 79-88% and barely moves with
standard, because someone who doesn't know a clue mostly doesn't press.
Aggression separates the standards; accuracy hardly does.

And a superchamp differs from a strong human by 83% against 90% accuracy, but by
50% against 74% on share of presses that win the race. **Robots are beaten on
the buzzer, not on knowledge** — so making the good ones harder means faster
hands, not a bigger brain, which is also what happens at the top of the real
game.

The middle standards still come in 15-25% light on races won. Closing that
properly needs the original module.

## Advanced mechanics

Four optional rules, off by default, toggled per match on the setup page. They
change scoring rather than presentation, so each has arithmetic tests in
`test/mechanics.mjs` and a length study in `tools/sim-mechanics.mjs`.

**Top rope** — declared between clues, never on one. That clue is worth double
to the declarer in both directions, and their winnings ignore the ceiling, so a
leader has a reason to take the risk rather than sit on a capped score.

**Targeting** — aim at one player, visible to the room, with an alert on their
buzzer. Win and the whole pot comes from them alone; everyone else is spared.
Lose the clue *to them* and you pay the whole pot yourself.

**Bounties** — a queued player stakes part of their own entry on somebody's
head, up to half. Whoever eliminates the target collects. Survive to the end and
you keep it. Eliminate the person who placed it and you keep theirs.

**Revival** — eliminated players return to the queue with a fresh entry number
at a fraction of the stake, once by default.

### What they do to a match

Measured over 400 simulated 30-player matches each:

| Setting | Length | Back-half win rate |
|---|---|---|
| none | 64 min | 53% |
| top rope | 62 min | 54% |
| targeting | 63 min | 63% |
| bounties | 64 min | 48% |
| revival | **95 min** | 52% |
| everything | 88 min | 63% |

Three of the four barely move the clock. Revival runs half again as long,
because nearly every player uses their second life — the setup page says so
before you start. It is also the *fairest* setting on the list: a second chance
is worth most to whoever went in first, which counteracts the late-draw
advantage the ceiling decay exists to fight.

## Fixing a scoring mistake

**Undo clue** in the console takes back the whole last clue — scores,
eliminations, entries, the board, all of it — and puts the clue back on the
board to be replayed. Use it when the wrong player was credited.

**Click any player in the ring** to adjust their score directly. Use it when
the value was wrong, or for anything undo can't reach. Both are logged, and the
count shows next to the version in the top bar.

## Recording a match

Tick **record detailed match data** on the setup page. When the match ends the
console offers a JSON download containing every clue, every buzz time, the
score of everyone in the ring before and after, entries, eliminations,
corrections, and a comparison of the predicted length against the real one.
Off by default.

## Documentation

    RULES-SHORT.md                     one paste for Discord, 1,507 characters
    RULES.md                           the full rules in postable sections
    docs/j-royal-rumble-handbook.pdf   design and rules, with the numbers

    python3 tools/make-handbook.py     rebuilds the PDF

The handbook is generated, not hand-written, so the figures in it stay tied to
the simulator and the recorded matches they came from.

## Escaped text

Boards that have been through a converter arrive with their escapes intact, and
some have been through two — `\\"` as well as `\"`. Left alone these render
literally on screen. The importer unescapes repeatedly until the text stops
changing, and the server repairs anything already in the library at boot, so no
rebuild is needed.

The scale is worth knowing: of 47,473 categories, **3,215 titles and 45,170
clues** needed repair. `test/escapes.mjs` samples what the server actually
serves and fails if anything escaped reaches the screen.

## Adding your own boards

Drop a folder of boards into the repo and merge them into the library:

    node tools/build-library.mjs add ./my-boards     # j-trivia JSON or jparty CSV, subfolders walked
    node tools/build-library.mjs list                # what's in the library now

Categories already present are skipped, so re-running is safe. Commit the
changed `data/library.ndjson.gz` and push.

Archive material refreshes itself. A scheduled workflow runs on the 1st of each
month, pulls any new seasons from the public clue dataset, and commits the
result — which then goes through the usual test gates before deploying. Run it
by hand from the Actions tab, or locally:

    node tools/refresh-library.mjs --dry-run   # what would change
    node tools/refresh-library.mjs            # merge it

The source is the public dataset on GitHub, not j-archive. The archive's
maintainer asked not to be crawled, and this keeps us off their server
entirely.

## Deploying

**This app must run exactly one machine.** Matches live in memory, so a second
machine means a host can create a match on one and have players land on the
other — which surfaces as "bad host key" and "no such game". After any
`fly launch`, check and fix with:

    fly status
    fly scale count 1

`GET /api/health` reports the version, machine id, uptime and live match count.
Hit it twice: if the machine id changes, you are running more than one.


Pushes to `main` run the simulation harness, then deploy to fly.io. Requires a
`FLY_API_TOKEN` repository secret.
