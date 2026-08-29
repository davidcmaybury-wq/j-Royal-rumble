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

Browsers block audio until a page has been interacted with, so every page arms
an unlock that retries on each interaction until one takes.

Both parts of that matter. An earlier version set its ready flag *before* the
play promise settled, so a single call made without a gesture marked the whole
thing done and it never tried again — a full match ran silently that way. The
same version cloned each audio element before playing it, and a clone starts
with `readyState` 0, so its `play()` was rejected and the rejection swallowed.
Cues are rewound and reused now rather than cloned.

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

The app runs on a Lightsail VM in **Ohio** (`us-east-2`) for a field spread
across the US, behind CloudFront. The measurements above were taken on the old
Fly box in `ord` (Chicago); the two are close enough that the delay setting has
not needed to move, but they have not been retaken since the migration.

Moving it means rebuilding the instance in another region — see
`infra/aws/HOSTING.md`. Do it between matches whatever the method: the process
holds all live state, so anything in progress ends.

`node test/perf.mjs` measures it with a field of 24: activation should reach
every player with a spread well under 60 ms. It exists because an earlier
attempt at this used `volatile` emits, which are dropped rather than queued —
the activation reached nobody at all, and nothing else in the suite noticed.

### Cues

| Cue | When | Loudness |
|---|---|---|
| entry horn | a player enters the ring | 0.155 |
| powerup | overtime, stakes doubling | 0.137 |
| elimination | somebody goes out | 0.131 |
| lock | you have been targeted | 0.123 |
| join | somebody signs up | 0.097 |
| countdown | your last three clues before entering | 0.095 |

Matched on loudness rather than peak. A square wave with a hard attack peaks far
higher than it sounds, so peak-normalising left the power-up towering over
everything else. The join chime and the countdown sit deliberately quieter: the
host hears the join cue thirty times while a room fills, and a sound you hear
thirty times should sit under the conversation.

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

Overtime opens as soon as **the queue is empty**, whatever the ring size —
waiting for heads-up meant a robot test ran thirty clues with three players
trading the same points and it never fired.

But the escalation clock counts only clues where **nobody was eliminated**.
Letting it run regardless made large fields a lottery: a 30-player match had the
stakes doubling with fourteen still in the ring and the strongest players' win
rate fell from 42% to 34%. A stall is precisely a run of clues with nobody going
out, so that is what the clock measures. While the field thins on its own, the
stakes hold.

Values double every six stalled clues, capped at eight times face, and the
multiplier **ratchets**: an elimination stops the stakes climbing, because the
field is thinning on its own again, but it does not put them back. Deriving the
level from the stall clock alone dropped a live match from four times face value
to one the moment somebody went out, which reads as the game forgetting what had
just happened. Three evenly
matched players with an empty queue ran past 300 clues without this and resolve
in 38 with it. On by default; `overtime: false` turns it off.

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

### The model

`src/bots.js` now uses Matt Schiffler's actual generator parameters rather than
my reconstruction of them from screenshots. Checked against 3,339 real
player-games from J!ometry's box data, his intuition holds up well:

| Standard | His attempt band | Share of real games in it | He draws it |
|---|---|---|---|
| rookie | 23–35% | 3.1% | 5% |
| normie | 37–61% | 55.8% | 60% |
| champ | 63–70% | 17.5% | 23% |
| superchamp | 72–88% | 12.8% | 11% |
| elite | 89–96% | 0.1% | 1% |

His population's mean attempt rate is 56% against a real median of 57%.

**The biggest thing the reconstruction had wrong was the population.** I drew
standards uniformly, so one robot in five was elite. Matt weights them, and the
real data agrees: elite is one in a hundred. A test field of 20% elites is not a
test of anything.

I had also thought his accuracy bands too narrow — his population spans 9 points
where raw per-game figures span 25. That was the wrong comparison. Per-game
numbers carry night-to-night noise; between *players* the spread really is about
9 points, measured on contestants with five or more games. His width was right.

### What this project adds

Three things his model does not have, each measured rather than assumed:

**Row-level difficulty.** Matt's formulation, which is better than the one I
first wrote. I had a per-level table of multipliers on the attempt rate; he
raises the rate to a power instead — `rate_row = rate ^ exponent_row`. The
power form grades itself, because a fraction raised to a power above 1 falls
away much faster when the fraction is small:

| Base rate | On the dearest row | Lost |
|---|---|---|
| 30% | 13% | 17 points |
| 60% | 42% | 18 points |
| 90% | 84% | 6 points |

A casual player loses far more to a hard clue than a strong one, and no per-level
table is needed to make it happen. In play, a rookie goes for the cheapest row
3.6x as often as the dearest; an elite 1.1x.

The exponents are his Monte Carlo set: `0.48, 0.67, 0.85, 1.10, 1.40` for
Single Jeopardy and `0.60, 0.87, 1.12, 1.40, 1.80` for Double.

**A correction of mine, now withdrawn.** I had measured 1,772 contestants
carrying only 77–88% of their aggression from the cheap round into the dear
one, against 89–96% in his model, and shifted his Double exponents by 0.22 to
close the gap.

The gap was mostly my measurement. Double Jeopardy boards are not always
finished — in 40% of games players rang in on at least three fewer clues in the
second round — and an unplayed clue looks exactly like reticence in this data.
Restricted to the 649 games where both boards were clearly worked through:

| Band | Observed | First set | Monte Carlo | My shift |
|---|---|---|---|---|
| weakest 20% | 85.7% | 89.2% | 81.6% | 73.4% |
| middle | 88.7% | 92.9% | 87.6% | 82.2% |
| strongest 20% | 91.8% | 95.4% | 92.0% | 88.6% |
| **rms error** | — | 3.61 | **2.82** | 8.31 |

The shift made things eight points worse, correcting for a bias that was in my
measurement rather than in his model.

Accuracy, by contrast, falls only 1.9 points between the rounds. A hard clue
does not make a player wrong, it makes them not buzz.

**Nightly form.** Both generators drew one accuracy per opponent and held it
forever. Across 199 players with four or more games, the same person swings 6.3
points of accuracy and 3.7 attempts game to game. Robots now draw a form for
each match, so they are not perfectly predictable.

**Recorded buzz histograms.** `data/buzz-distributions.json` holds real timing
data from play of his model — 2,493 buzzes. Sampling those directly reproduces
the shape a gaussian cannot: strongly right-skewed with a tail of whiffs, and a
consistency gap between standards (a superchamp's middle 50% spans 60ms, a
rookie's spans 406).

### Buzzer scales### Buzzer scales

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

Collect with `node tools/fetch-box-scores.mjs --all` — 184 pages, one every two
seconds. Rows are read by CSS class (`game-totals`, `cumulative-totals`) rather
than by pattern-matching the markup, and the collector exits non-zero if it
parses nothing.

`test/boxparse.mjs` runs the parser against real markup; `test/boxfetch.mjs`
runs the collector itself against a local server serving that markup. The second
exists because the first passed while the collector still crashed on a renamed
variable — a test that never calls `main()` cannot catch that.

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

## Animations

Three 8-bit sequences at 9fps, generated by `tools/make-toss.py` and served
as one module:

| Sequence | Length | Where |
|---|---|---|
| toss | 2.0s | corner of the rail, when somebody is eliminated |
| climb | 1.3s | same corner, when somebody goes to the top rope |
| entry | 2.7s | inside the lower-third banner, beside the entrant's name |

The corner holds one at a time and the latest wins — if somebody climbs and
somebody else goes out on the same clue, the elimination is the bigger moment.
The climb is deliberately short: it is declared *between* clues, so the host may
pick the next one before it finishes and the whole gesture has to land early.

## The toss

An 8-bit animation of a wrestler going over the top rope: 18 frames at 9fps,
exactly two seconds, generated by `tools/make-toss.py`.

It plays in the corner of the console rail when somebody is eliminated, sized
at 150px. An elimination happens twenty-nine times in a full match, so it does
not overlay, pause or interrupt anything — the game carries on around it and it
takes itself away when it finishes.

Frames are CSS keyframes toggling opacity inside inline SVG: no JavaScript
loop, no sprite sheet, no bitmap, and it scales without softening. Each instance
generates its own keyframe names, so two eliminations close together do not
fight over the same CSS rules. It freezes on the last frame under
`prefers-reduced-motion`.

The sprites are drawn parametrically rather than as pixel maps, so a pose is a
function call — `arms='throw'`, `legs='wide'` — which is what lets the
flight use real rotation for the tumble instead of flipping back and forth.

## Wrestler avatars

Every player gets an 8-bit wrestler: singlet style and colour, hair style and
colour, skin tone. Assigned on arrival and picked to be distinguishable from
everyone already in the room — thirty players get thirty tellable-apart
wrestlers with no clashes.

`public/wrestlers.js` is the single source. It draws both the portrait on a
score tile and the figures in the animations, so **a player is recognisably
themselves being thrown out of the ring**. The Python generator that used to
bake animation frames is gone: it could only produce fixed colours, and two
copies of the same sprite code would have drifted apart within a week.

The portrait is drawn for the job rather than cropped from the body sprite.
Cropping was the obvious approach and it was wrong — the body's head is four
pixels across, so at 24px every player was an identical skin-coloured blob. A
portrait on its own 16x16 grid has room for hair, a face and the singlet, which
are the three things that survive at tile size.

**The toss shows who actually did it.** Whoever took the clue is the thrower;
on a stumper nobody did, so a referee in black and white stripes does the
honours, which is the honest picture of what happened.

## Player tokens

Twenty-four line-art weapons — crowbar, morningstar, dinosaur bone, folding
chair, brick — in the app's palette, drawn as bold single-weight outlines
because they render at 24px in the ring, where detail vanishes and only the
silhouette survives.

Everyone is given one on arrival. They can pick a different one, or upload a
photograph instead, which overrides it.

**Collisions are settled by colour, not refusal.** Only the server sees the
whole roster, so assignment happens there: every shape is used once before any
shape repeats, and a player asking for a taken shape gets that shape in another
colourway. Twenty-four shapes across six colourways is 144 combinations, so a
field of thirty never repeats.

Four of the first drawings did not survive review at thumbnail size — the axe
read as a magnifying glass, the boot as a chess pawn, the morningstar as a
blob, and the bone as a dumbbell. `tools/` has no generator for these; they are
hand-drawn paths in `public/tokens.js`.

## Quick start and advanced setup

The setup page opens in **Quick start**: the room code, who has signed up, two
dropdowns and a button that adds robots. **Advanced** is the full card — every
mechanic, the clue mix, uploads, timing. The choice is remembered per browser in
`localStorage` under `rumble:setupMode`, because it is a preference about how
somebody likes to set a game up rather than a property of the match.

The two buttons read Quick start and Advanced; the mode values, CSS classes and
stored preference still say `quick` and `expert`. That split is deliberate —
renaming the saved value would reset every host who had already chosen.

**Rule set**

| | what it does |
|---|---|
| Tournament | no targeting and no comeback — fastest press wins, times public |
| Arcade | the normal game, targeting and one foot on the floor included |
| Chaos | Arcade plus every advanced mechanic |

**The first two are named for the mode they produce**, and that has to stay
true. A rule set called Tournament that left the comeback on would put ARCADE
MODE on every screen in the room — which is how it was first written, and what
the rename caught. Tournament drops targeting *and* the comeback; the comeback
is what makes the difference a mode rather than a preference.

**Game speed**

| | what it does |
|---|---|
| Blitz | a new player every 5 clues, whatever the roster |
| Standard | paced to about 20 minutes, entries scale to the field |
| Extended | paced to about 40 minutes |

**A preset writes into the real controls rather than living beside them.** Pick
Tournament and switch to Advanced and you see targeting switched off, because that
is literally what happened — there is no second set of quick-mode settings and
no separate path through `collect()`. It also means the dropdown reads **Custom**
the moment the settings stop matching, so a host who turns targeting back on by
hand is never left looking at a box that still claims Tournament.

**Every advanced control renders in both modes and is hidden with CSS**, never left out of the
markup. `collect()` reads every control by id when it saves, so a card that is
genuinely absent takes the Save button down with it — and the host sees a dead
button, which is the failure this project keeps rediscovering. Hiding rather
than omitting also means switching modes cannot lose an edit.

`test/pagerefs.mjs` checks that every mechanic on the page is named by one of
the rule sets. A mechanic added to the page but left out of the presets would
keep whatever the last preset happened to leave it at, so choosing Tournament
could silently carry somebody's experiment into a match.

## Pacing, and what the setup card warns about

**The ceiling scales with the field**, and this turned out to matter more than
anything else. It had been jumping from 7,500 to 11,000 at 25 players, which
made a 24-player field look far less fair than a 30-player one — it was the
ceiling doing that, not the field size. Every earlier fairness measurement was
confounded by it.

**Targeting is standard**, not an advanced toggle: it is the only mechanic that
reliably catches somebody running away with a match. Measured against one champ
in a normie field, a room ganging up takes their win rate from 52.5% to 50.6% at
six players and 31.9% to 30.7% at sixteen. The cost is a draw that leans late in
a big field — 48.4% to 66.3% back-half wins at sixteen — because the leader is
nearly always an early entrant, so late draws are never the ones being hunted.
Small fields barely move. Switch it off for a big room.

Two players cannot share a name: the room has nothing else to tell them apart,
and the host calls people by name. A second Dave is turned away and asked for
another.

| Field | Ceiling |
|---|---|
| up to 8 | 10,500 |
| 9–20 | 9,000 |
| 21+ | 10,500 |

**Not monotonic, deliberately.** A small field needs the *most* headroom, which
the first ladder had backwards. A lone strong player in a six-hander faces the
fewest opponents per clue, so they climb slowly — and the match runs long enough
for that slow climb to reach the cap and stay there. A real 53-clue match had
the winner pinned at 6,000 for 20 clues while the ceiling swallowed 11,930
points: half the match, they answered correctly and gained nothing.

Measured over 2,000 six-player matches:

| Ceiling | Clues pinned | Points swallowed |
|---|---|---|
| 6,000 | 22% | 5,361 |
| 9,000 | 11% | 2,884 |
| **10,500** | **8%** | **2,061** |
| 12,000 | 6% | 1,440 |

**Ceiling decay was tried again and rejected again.** It makes both problems
worse — 29% pinned at −40 and 36% at −80, swallowing more rather than less,
because a falling cap is one the leader meets sooner. It also brings back the
late-draw bias it was found to cause the first time: the back half of the draw
wins 52% with no decay and 59% at −80.

With that fixed, draw fairness holds across a much wider range of entry
intervals than it appeared to — twenty players are fine out to every 8 clues,
where the confounded measurement said 3.

**Longer matches are less fair, not more.** The last players in walk into a
worn-down field, so at extreme pacing they win several times their share. But
short matches are random — the strongest player never gets the clues to prove
it, and skill only settles around the fifteen-minute mark. So there is a window,
and the setup card knows where it is.

`FAIRNESS` in `src/engine.js` is the measurement itself: 3,000 simulated matches
for every field-size and interval pair. Several formulas were tried first — the
share of the match left after the field fills, clues after the fill, clues per
player — and the best correlated at only r = 0.71. A rule that
confident-sounding and that wrong is worse than a lookup.

The setup card shows a red warning outside the window, with a button that sets
the recommended interval. **It never refuses anything.** A host who wants a
two-hour thirty-player match can have one; they should just know late draws will
run away with it.

## Entrance music

Every player can pick something to walk in to. It plays on **the one screen with
sound turned on**, the same rule as the game's cues — thirty browsers starting
the same clip a fraction apart would be a mess.

Three sources: the built-in library, a YouTube link with a start time, or an
https link to a file. The library themes run five seconds; a YouTube clip can
run **up to ten**, chosen by the player. Capped there deliberately — an
entrance, not an interlude, and the room should not be waiting on somebody's
music before the next clue.

A YouTube clip plays through a **covered** player rather than a hidden one:
browsers refuse autoplay to an iframe with no size, which is how the first
version failed silently. It is rendered at full size and then covered, so the
sound comes through and the video does not — the room sees a card naming who is
walking in rather than somebody's chosen music video. The **Test it** button in
the picker does exactly the same thing, so what you hear there is what the room
will hear.

### The library

Twelve original 8-bit themes, four each in three moods — horror, wrestling,
sports — about five seconds apiece and matched to each other by RMS rather than
peak, because the sparse ones would otherwise sound half the volume of the busy
ones. `python3 tools/make-themes.py` regenerates them.

Synthesised rather than sourced, for the same reason as the game's cues: the
licensing is unambiguous. Nothing is borrowed, so nothing can be mistaken for
somebody's actual entrance music, which is the most aggressively owned part of a
wrestling broadcast.

Each is a real piece rather than a loop — a hook stated, varied and resolved —
so a player gets a beginning and an end instead of a fragment fading out. Five
seconds is short for that shape, so the tempos run fast, which suits the moment:
an entrance is a door opening, not an interlude.

**The folder is the library.** `/api/themes` reads whatever mp3s are in
`public/audio/themes`, taking mood and title from the filename, so dropping a
file in adds it without a deploy and there is no manifest to fall out of step.
Anything you add yourself is your own call on licensing.

## What the robots say

**The robot on the clock answers before the host adjudicates**, so there is
something to rule on. Only that one: everybody else's answer is noise, and in
the room only the player on the clock ever speaks. A robot that is simply marked
wrong is a scoring event; one that says "Millard Fillmore" is a player.

**Whoever holds the board calls the next clue**, after the host says yes or no.
Control passes on a correct answer and stays put on a stumper, the way it does
on the show — so a robot that is leading the board keeps calling clues until
somebody takes it off them.

**Wrong answers are written by Claude Haiku** when `ANTHROPIC_API_KEY` is set on
the server, because a wrong answer has to be wrong the way a person is wrong:
the right kind of thing, a near miss rather than nonsense. It is generated while
the host is still reading, so no network call sits inside the race, and it is
checked against the real answer before use — a "wrong" answer that happens to be
right is worse than none.

Haiku because it is a throwaway sentence per clue, not a reasoning task, and the
latency budget is tight: one retry at 2s each, a 4s ceiling, chosen so the whole
exchange finishes inside the read.

Without a key there is a local fallback that borrows another answer from the
same board. Cruder, but the categories are themed so it is usually the right
sort of thing and reliably the wrong one. Nothing fails and no match waits.

**The fallback used to be silent, and that was the bug.** Every failure went
through a bare `catch {}` to the local answer with nothing logged, so a missing
key, a rejected key, a wrong model name and a timeout were indistinguishable
from outside — all four looked like robots talking nonsense, which is how it ran
in live matches. `GET /api/health` now reports which source is actually in use:

```json
"wrongAnswers": {"model": "claude-haiku-4-5", "mode": "local", "configured": false,
                 "asked": 12, "written": 0, "fellBack": 12,
                 "lastError": "no ANTHROPIC_API_KEY set"}
```

`mode` is what the room is hearing — `claude`, `local`, or `mixed` — not what was
configured, and `lastError` says which fix it needs. The server also logs the
reason once per distinct cause rather than per clue.

## Robots in the draw

Robots are spread evenly through the entry order rather than shuffled in with
everybody else. A straight shuffle of a half-robot roster regularly deals three
or four in a row, and a stretch of the match where nobody real walks in is the
part a room notices — the entrances are the event.

Humans and robots are each shuffled first and then interleaved, so no
individual number is predictable. What is fixed is only the human-and-robot
pattern, which gives nothing away about who is where. With one kind only it is
exactly a shuffle.

## Stables

Teams, off unless the host turns them on. **The damage you do lands only on
people outside your stable** — your side pays nothing. That is the whole
benefit and the whole cost: a big stable takes from very few.

**Stables are named for you, from gemstones** — Diamond, Ruby, Emerald,
Sapphire, Onyx, Topaz, handed out in that order. Each carries a colour and a
line-art badge that appears beside every member's name and tints their row on
all three scoreboards, so a glance tells you who is with whom without reading.
Six because that is the most a room can tell apart at once; typed names collide,
run long, and cannot be turned into a colour. Onyx is drawn in the lightest grey
that still reads as black, because black on a near-black screen is nothing.

**When a stable member wins, the pot is split evenly across the stable.** A
stable is a shared purse, not just a non-aggression pact — which taxes a strong
member and is what makes joining one a real decision rather than free. See the
measurements below; `stableShare: 'winner'` restores the older behaviour where
the winner kept the lot.

Founded before the match or during it. **J** to join one, **B** to
betray. Both are declared between clues, never while one is on the board:
switching sides mid-race would let you see who had buzzed and pick a side
accordingly.

`betrayalKeepFraction` is the same toll as a share of the stack, which is the
version that scales. Fifteen players, two stables of five, five stags, one
member of stable A deciding eighteen clues in — each choice played forward to
the end from the same position:

| Keep | Stay | Go stag | Cross to B |
|---|---|---|---|
| 0% | **25.1%** | 14.8% | 16.6% |
| 50% | **25.1%** | 16.9% | 20.5% |
| 100% | **25.1%** | 20.5% | 24.5% |

### The loyalty penalty shrinks with the field

A stable of five, an elite deciding whether to walk out, measured as the ring
empties. The cost of going stag, in percentage points of win rate:

| Outsiders left | Ring | `winner` | `even` | `surplus` |
|---|---|---|---|---|
| 10 | 15 | −13.7 | −30.9 | −28.4 |
| 7 | 12 | −9.9 | −20.5 | −19.6 |
| 5 | 10 | −5.1 | −10.0 | −9.3 |
| 3 | 8 | −1.7 | −1.5 | −1.8 |
| 2 | 7 | −0.1 | −0.3 | −0.4 |
| 1 | 6 | −0.1 | 0.0 | 0.0 |

**Loyalty is expensive early and nearly free late.** A stable protects you from
the people in the ring, so as they leave there is less to be protected from —
and the toll on your stack is a one-off while the protection is a stream that
dries up. By three outsiders it costs almost nothing to walk out under any of
the three rules, and the sharing rules converge with `winner` exactly where they
stop mattering.

The same shape holds for an ordinary player (−13.4 at ten outsiders, −1.6 at
three), so this is a property of the mechanic rather than of being strong.

It never turns positive, though. Walking out is never actively **better**, only
cheaper — so a defection late in a match is a read on the room rather than an
edge the numbers hand you. `npm run shrink-study` reruns it.

### How winnings are divided: `stableShare`

Three rules, measured at the shipped 50% toll, fifteen players in two stables of
five with five stags:

| Rule | Elite: stay | go stag | cross | Normie: stay | go stag | cross |
|---|---|---|---|---|---|---|
| `winner` | 88.9% | 83.9% | 87.5% | 25.1% | 16.9% | 20.5% |
| `even` (shipped) | 78.6% | 64.3% | 70.0% | 18.1% | 10.7% | 12.9% |
| `surplus` | 80.8% | 65.6% | 71.1% | 17.2% | 10.3% | 12.2% |

`winner` keeps the lot — a stable is a non-aggression pact and nothing more.
`even` splits the pot across the stable, so it acts as one entity. `surplus`
lets the winner bank the clue's face value and shares only what the stable's
protection added on top.

**Sharing does slow a strong player**: an elite drops from 88.9% to 78.6%. But
it makes them *less* likely to walk out, not more — the gap between staying and
crossing widens from 1.4 points to 8.6. Protection turns out to be worth more
than the tax, because an outsider under `stableFocus` pays two stables at double
rate. Wanting a strong player tempted out means loosening the protection, not
taxing the earnings:

| | elite stays | crossing |
|---|---|---|
| `even` + outsider loading | 78.6% | 70.0% |
| `even`, no outsider loading | 65.2% | 55.5% |

Which is a different trade: it makes the elite much easier to beat overall, and
still does not tempt them out.

**The toll is 50% by default**, which puts defection where it should be: a bad
move for an ordinary player and a live question for anybody who thinks they are
better than the room. What crossing costs at that setting:

| Decider | Stay | Cross | Cost | Share of what they had |
|---|---|---|---|---|
| normie | 25.1% | 20.5% | 4.6 pts | 18% |
| champ | 46.6% | 40.3% | 6.3 pts | 14% |
| superchamp | 66.8% | 63.9% | 2.9 pts | 4% |
| elite | 88.9% | 87.5% | 1.4 pts | **2%** |

A normie gives up a fifth of their chances to switch sides. An elite gives up
one fiftieth — near enough free to be worth doing on a read, which is the
decision worth having at the table. Above 75% an elite is actively better off
crossing, which is why the toll is not higher.

Loyalty wins at every setting. Even a free exit only draws level, because the
stack you hand over goes to the people you are leaving — you pay twice, once in
what you lose and once in what they gain. Crossing beats going stag throughout,
so if somebody does defect they should take a side rather than go it alone.

`betrayalKeep` lets a traitor walk away with a fixed amount, capped at what they
had — never a top-up. Worth measuring before setting: as a share of the stack a
flat keep is nearly nothing to a leader and everything to a straggler, so it is
an escape hatch for whoever is losing rather than an option for whoever is
winning. At 1,000 it wipes the toll entirely below 1,000 and still takes 88% off
a stack of 8,000.

**Betrayal moves your whole stack**, not just your winnings, split evenly among
the people you walk out on. Leaving with nothing is the price of switching
sides, and it is what stops a stable being a coat you put on and take off.
Walking out of a stable nobody else is left in costs nothing — there was nobody
to betray.

A stable can hold **at most half the ring**. Without that cap everybody joins
the first one founded: simulated at twenty players the biggest stable reached
fifteen, and the ring dissolved five to thirteen times a match, so the ending
below became routine rather than an event.

If the last players standing are all in one stable — through eliminations, not
recruitment — nobody can take anything from anybody and the match cannot end.
The stable has won: it dissolves and they settle it between themselves.

**When a stable member wins, the pot stays full size and lands entirely on the
outsiders.** The damage the teammates would have taken is loaded onto whoever is
left outside, so a stable of five facing two outsiders makes each of them pay
for three and a half people. The bigger the stable, the harder it hits.

The first version simply let the pot shrink — teammates paid nothing and the
winner collected less. That protected the stable and did nothing to anybody
else, which made banding together useless against a strong player and mildly
counterproductive: `stableFocus: false` restores it if you want to see the
difference.

**Even so, a stable is only a partial answer to a strong player.** One elite in a
field of normies wins 73% of twelve-player matches and 94% of six-player ones.
A pack helps, monotonically, but does not level it:

| Field | No stable | Biggest legal pack | Old rule, same pack |
|---|---|---|---|
| 6 | 94.1% | 90.5% | 92.0% |
| 8 | 86.9% | 84.2% | 85.0% |
| 10 | 80.5% | 77.1% | 79.4% |
| 12 | 73.1% | 68.2% | 71.7% |

The pack can only use its advantage on clues it wins, and against somebody
taking most of them there are not many. Ganging up directly on one player is
what targeting is for.

**Stables shift the draw advantage to early entrants**, and the host should know
that before turning them on. A stable is formed by whoever is in the ring first,
so a late arrival walks in as an outsider paying people who are protected from
them. Measured across 1,500 matches per setting:

| Field | No stables | Several factions | One dominant stable |
|---|---|---|---|
| 10 | 0.96x | 0.77x | 0.90x |
| 20 | 1.12x | 0.85x | 0.44x |
| 30 | 1.07x | 0.84x | 0.31x |

Below 1.00 favours early draws. A room that splits into factions plays close to
fair; a room that forms one bloc hands the match to whoever entered first. Skill
also matters less with stables on — at twenty players the three strongest win
41% of the time without them and 37% with.

## Walking into overtime

A new entrant's stake is multiplied by the overtime level they arrive into, and
so is a revival. A fixed 3,000 walked into a ring where single clues were worth
2,000: in a real match P26 entered at clue 150 into x2, lasted six clues
without winning a race, was revived at 1,500 into x4 where the top row paid
2,000, and was gone after one. He never had a hand to play.

Measured over 3,000 matches, for everybody arriving at x2 or above:

| Stake | Median clues survived | Died within 3 | Survived |
|---|---|---|---|
| Fixed 3,000 | 3 | 58% | 21% |
| **Scaled to the multiplier** | **7** | **9%** | **32%** |

`scaleEntryStake: false` restores the old behaviour.

## Latecomers

Somebody arriving after the bell goes to the back of the queue and enters at the
standard stake like anyone else — a Rumble is built around people arriving
throughout, so this is the format working rather than an edge case.

When the entry interval is on auto it recomputes against the clues actually
left, so entries compress as the roster grows. Four latecomers still fit at
every 15 clues; fourteen do not, and the interval falls to 6.

Refused once overtime has opened. Overtime means the queue is empty and the
match is winding up, so letting somebody in then would reopen it while the
stakes stayed elevated by the ratchet — a strange thing to do to the people who
turned up on time.

## Who is next

Hidden from the room by default. The countdown stays, because knowing *when*
somebody arrives is tactical; it is only the name that goes, so the horn means
something again.

Hidden on the console as well as the watch screen, since the console is the
surface most likely to end up on a shared screen. The host sees the name in the
answers window, which they are already keeping to themselves. The entrant always
sees their own countdown — anonymity to the room cannot mean anonymity to the
person who has to get ready.

## Scoring bonuses

**Longevity** — every 10 clues you survive, +500. On by default. Early draws
spend the whole match being ground down by pot scoring; this pays them for the
thing they actually do more of. Across 3,000 simulated matches per field size it
brings the draw advantage from 1.31x / 1.40x / 1.14x (10 / 20 / 30 players) to
1.05x / 1.07x / 0.97x. **+1000 overshoots** and hands the advantage to early
draws instead. It self-limits: a leader at the ceiling gets nothing, so it helps
whoever is grinding rather than whoever is already winning.

**Category sweep** — take every clue in a column and it washes brass: +500,
scaled by the overtime multiplier. Counted as the column is worked through, so a
board refresh cannot rob somebody of a run they already finished.

**Save a player** — anyone still in can put money up to buy an eliminated player
back. Declared with `S`, settled at the next clue boundary so play never pauses,
and several people can chip in for the same player. Partial amounts are allowed:
a cheap save is a weak save.

**Gift from the queue** — waiting to come in, you can hand part of your entry to
anybody in the ring. You walk in lighter by whatever you gave.

### The ceiling falls during overtime

Taking the decay out of the main match fixed the draw bias, but it removed the
only guaranteed drain — and a symmetric exchange with nothing leaking never
resolves. Raising the stakes does not help: doubling both sides of an even trade
leaves it even. A field of evenly matched robots ran 400 clues without a single
elimination.

So the ceiling now falls 120 a clue **once overtime opens, and only then**. That
gives the endgame teeth without touching the entry phase, which is where the
bias came from.

**Nobody is clipped to a roof they never touched.** Arrivals were clamped to the
*current* ceiling, which was written when stakes were flat. Once the stake began
riding the overtime multiplier the two moved in opposite directions and crossed,
so a fresh entrant stopped getting the full multiple from about ×4 and a comeback
from about ×8 — the P26 fix, undone in the phase it was written for. An
arrival now lands capped by the roof **as it stood when overtime opened**, and is
not clipped down to the falling roof until its score first touches it.
`arrivalGrace`, on by default; `admit()`, revival and the comeback all land
through `arrivalLand`.

The repair deliberately does **not** go through the roof. Scaling the ceiling
floor by the multiplier was measured and is worse than the defect it fixes:
lifting the roof hands the elite the clipping they currently absorb, and casuals
go 14.3% to 10.0% while the top shark goes 56.9% to 63.1%. The ceiling clamp is
an accidental leveller, because whoever has accumulated most deep in overtime is
nearly always the strongest player. The arrival-only carve-out takes casuals to
15.2% instead, costs about a point of back-half at twenty players and nothing at
thirty, and leaves the drain alone.

**The flag covers the arrival, not what the arrival then wins.** `capExempt` is
set only when the landing is itself above the roof. The variant this was measured
from flagged every arrival and cleared on the first dip, which also exempts
somebody who landed under the roof and climbed above it by winning pots — an
open-ended ceiling exemption on accumulated score, which is precisely what the
floor repair was rejected for. It scores better on paper (casuals 16.2%) because
it is a bigger rule: 7,777 skipped clips against 1,882 off an identical count of
above-roof arrivals, and three to four points of back-half instead of one. The
point left on the table is deliberate.

**The winner of a raised clue banks the whole amount.** Clipping it on the spot
was the thing that made escalation look broken in a live match: a clue worth
2,000 paid the winner 500 while charging the loser the full 2,000, so the stakes
only ever moved one way and did it invisibly. They are clipped on the *next*
clue instead, so the falling roof takes it back unless they keep winning.

Overtime also opens on a very long stall — eight escalation windows, about 48
clues with nobody eliminated — even if people are still queued. The threshold
has to be that high: at three windows it fired during the entry phase and cost
eleven minutes of match length and twenty points of draw fairness.

## Arcade and Tournament

A match is one shape or the other, named on every screen for the whole match:
the host console, the watch screen and each player's buzzer.

**Arcade** is the comeback switched on. Because a player on the way back is
ranked at a fraction of the time they pressed, buzz order stops being buzz
speed — so the public surfaces carry **places rather than times**. A player
still sees their own reaction time on their own buzzer; nobody sees anybody
else's.

**Tournament** is the comeback off. `buzzEdge` is always 1, the fastest press
wins every race, and the times are published because they mean exactly what they
look like.

**The times are absent from the payload, not merely unrendered.** `watchView`
and `raceView` omit `ms` entirely in Arcade, the same discipline as the answer
never reaching the watch screen — a page handed a number it is trusted not to
draw is one refactor from drawing it. `test/arcade.mjs` asserts both directions.

This replaces the fix in 0.85.1, which sent the ranked time beside the real one
so the host could see why a slower press held the clock. Showing the order beats
explaining the arithmetic, and the `edge` field is gone.

**The console loses the times too**, not just the room. It is the surface most
likely to be on a shared screen — the same reason the next entrant's name is
hidden there — and a host adjudicates on who is on the clock, which is the
place.

The match record keeps every real time in both modes. Nothing about scoring,
standings or the log changes; only what the screens publish while a race is
open.

## One foot on the floor

A player who would be eliminated having taken **fewer than three clues** is not
eliminated at all. They stay in the ring on half a starting stake, and for the
next 40 races their buzz is ranked at half the time they actually pressed. Once
each, automatic — nothing to declare, nothing to press. On by default;
`comeback: false` turns it off.

This is the answer to the shark problem, and it is the buzz-timing lever from
that list seen from the other end: instead of taxing the leader's milliseconds
it hands them to whoever never got going.

**The gate is the entire design.** Ungated, the same mechanic is a subsidy for
the strong — they spend their free life too and finish further ahead, and it
does nothing for the people it was built for. Measured over 1,500 matches per
row in a six-player field (a 95ms elite, a 130ms second, a mid at 160, and three
casuals at 210/240/270), the comeback lasting 40 races:

| | elite | second | mid | the three casuals |
|---|---|---|---|---|
| ungated, 70% | 48.7% | 35.9% | 12.5% | 2.9% |
| **gated, 70%** | **61.9%** | **17.1%** | **10.0%** | **11.0%** |
| gated, 50% | 74.4% | 19.0% | 4.5% | 2.1% |

Gating costs the elite less and pays the casuals ten times more, which is the
whole trade. It is close to sandbag-proof, too: staying under the gate means not
scoring.

### The boost is a threshold, not a dial

**Found by shipping the wrong value.** 0.5 looked like the moderate choice and
measures as very nearly nothing — the bottom row above. The discount only counts
if it puts a slow player under a fast one, and against a 95ms elite:

| | median | at 50% off | at 70% off | needed to beat the elite |
|---|---|---|---|---|
| CasualA | 210ms | 105ms | 63ms | 54.8% |
| CasualB | 240ms | 120ms | 72ms | 60.4% |
| CasualC | 270ms | 135ms | 81ms | 64.8% |

At 50% not one of them reaches him. At 70% all three clear him. **Below about
55% the mechanic is decorative and above about 65% it works**, so retune it
against that table rather than by feel — feel is what produced 0.5.

**It costs draw fairness.** The back half of the draw goes from 50% to 59% at
sixteen players, because a late entrant is likelier to still be under the gate
when trouble finds them. Fairness by skill and fairness by draw pull against
each other here for the first time; the trade was made deliberately.

**The return stake rides the overtime multiplier**, like an entry or a revival,
and on the same `scaleEntryStake` switch. Flat, it did not: 41 of the 89
recorded eliminations happen during overtime, and a flat 1,500 walking into ×4
values bought one to six clues of life. Measured at the shipped gate and boost,
scaling the stake takes the three casuals from 11.0% of wins to 14.1% and the
strongest player from 61.9% to 56.1%, at the same fire rate — strictly better,
so there is no trade to weigh. It lands through `arrivalLand` like every other
arrival, so it is capped by the overtime-open roof rather than the decayed one.

**Nothing keyed to elimination fires**, because no elimination is recorded — a
bounty on that player does not pay out and a revival life is not spent.

The edge is counted in races rather than clues so a run of stumpers cannot burn
it, and the **recorded** reaction time is always the real one. The discount is a
ranking rule for who takes the clue, not a rewrite of the log.

`npm run comeback-study` reproduces every row above; the shipped configuration
is marked in the output.

## Advanced mechanics

Four optional rules, off by default, toggled per match on the setup page. They
change scoring rather than presentation, so each has arithmetic tests in
`test/mechanics.mjs` and a length study in `tools/sim-mechanics.mjs`.

**Top rope** — declared between clues, never on one. That clue is worth double
to the declarer in both directions, and their winnings ignore the ceiling, so a
leader has a reason to take the risk rather than sit on a capped score. Then
five clues before climbing again, or it stops being a decision and becomes a
permanent stake setting. A declaration withdrawn before the clue is read serves
no cooldown: the wait prices riding a clue at double, not declaring, and
`setTopRope` clears the stamp when `cluesRevealed` has not moved since it was
set — which is exactly "no clue came and went while they were up there".

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

## The watch screen

`/watch/CODE` — a public, read-only view of a match. No host key, nothing to
log in to. Board, live clue, buzz race with reaction times, the ring with
scores and markers, the queue, the eliminated, overtime, and the champion with
the score graph at the end.

The ring is sorted **by score**, highest first — the console sorts by draw
because the host is looking for a particular person, but a room watching wants
to know who is winning.

Animations play in the bottom-left corner: a toss when somebody goes out, an
entrance when somebody arrives, a climb when somebody goes up top. This is where
they earn their keep — thirty people seeing a wrestler thrown over the ropes
beats one person glimpsing it in a console corner.

### Sound on one screen

A **Play sound here** toggle in the top bar, off by default. Thirty browsers
playing the same cue a fraction apart would be a mess, so exactly one screen in
the room turns it on — normally whichever machine is plugged into the speakers.
That also takes the game's audio off the host's microphone and out of the call's
audio path, so it arrives at full quality rather than through voice compression.

Deliberately a click and nothing else: no URL parameter, no remembered setting.
Browsers refuse audio until a page has been interacted with, and a toggle that
restored itself on load would silently fail — which has already happened once in
this project.

Meant to replace sharing a screen over the call. A state push per event against
a continuous video stream is a rounding error by comparison, and everyone gets
a crisp local render at their own resolution instead of a compressed copy of
the host's monitor.

**It is built field by field rather than by copying the host view and deleting
things.** The host view carries the correct answer, and a spectator page that
leaks it ruins the game — so anything added to the host view in future is absent
from the watch view until somebody adds it deliberately. `test/watch.mjs`
asserts the answer appears nowhere in the payload, along with the host key, the
settings block and player tokens.

## Match logs

Every match is recorded and saved on the server. There is no setting to turn it
off during testing — a log that was not kept is a test that has to be run again.
Set `RUMBLE_RECORD_ALL=0` if that ever needs to change.

Three copies get made, deliberately overlapping:

**On the server.** Written when the match ends, every three minutes while one is
running, and on shutdown — so a host who closes the tab, or a deploy that lands
mid-match, still leaves something behind. Browse them at `/logs`.

**In the host's downloads.** The console saves a copy automatically when the
match finishes. Needs no volume, no account and no remembering.

**By hand.** `Download match data` on the champion screen, any time.

### Who was hosting

The setup page asks for the host's name, under the room code, and it is saved
with the record as `host` and shown as a column at `/history`.

It is there because **the read is a large part of how a match plays** and
nothing measured so far can see it. Every recorded match has had the same host,
so the pace figures in this README — 19.3s then 16.8s median per clue, a human
buzz median around 150ms — are one person's delivery as much as they are the
game's. A second host would separate the two for the first time.

The box is remembered per browser, because the same person runs nearly every
match and a field that has to be retyped is a field that ends up empty. It is
metadata, not a rule: it travels beside the settings rather than inside them and
never reaches the engine, exactly as `blend` does, and `test/setup.mjs` asserts
it stays out of `settings`. Logs written before this shipped have no `host` and
read as unknown rather than being backfilled to David.

**A second host is already in the data.** David has identified which matches
somebody else ran, and the effect is measured in the handbook's Figure 13: the
three players who played both Aug 16 matches all shifted slower together under
the other host at an identical delay setting — +45ms, +90ms and +170ms. That is a
calibration offset rather than a skill change, so absolute times compare within a
match, or across matches with the same host, and not otherwise.

The set is small, which is why the field is being captured going forward rather
than a reason to discount it. Grouping results by host in the UI is not built,
and neither is the real fix — pointing the same calibrate-and-freeze machinery
the robots use at the host instead.

### Logs live outside the app directory

A deploy replaces the app directory, so anything written inside it is **gone by
the next release** — and this project deploys several times a day. Logs go to
`/data`, which a deploy never touches. Make it once on the box:

    sudo mkdir -p /data/logs && sudo chown -R ubuntu:ubuntu /data

Until it exists, logs are still written — beside the app, where they will not
survive. `/api/health` and the `/logs` page both say which of the two is
currently true, in those words.

On the old Fly box this was a sharper problem and had a different fix: the
machine filesystem was wiped by every deploy and `/data` was where a volume
mounted (`fly volumes create rumble_data --size 1 --region ord`, plus the
`[mounts]` block in `fly.toml`). The spare still runs that way. The rule the
code enforces is the same on both, which is why it checks the path rather than
the host.

`/logs` is open unless `RUMBLE_LOG_KEY` is set, in which case it wants
`?key=…`. Fine for a test deployment; worth setting before anything public.

## Recording a match

Tick **record detailed match data** on the setup page. When the match ends the
console offers a JSON download containing every clue, every buzz time, the
score of everyone in the ring before and after, entries, eliminations,
corrections, and a comparison of the predicted length against the real one.
Off by default.

## Documentation

    RULES-SHORT.md                     one paste for Discord, 1,993 of 2,000
    RULES.md                           the full rules in postable sections
    docs/handbook.html                 design and rules, with the numbers

**`RULES-SHORT.md` is nearly full.** It is one Discord paste and Discord cuts
off at 2,000 characters, silently. It was at 1,974 when "one foot on the floor"
had to go in, so four sentences elsewhere were tightened to make room — check
the count before adding anything, and expect to cut something to fit it.

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

## The welcome screen

`/` offers **play**, **watch** or **host a match**. It used to serve the host
setup page, so anybody who typed the domain landed on the controls for running
a match.

Play and watch ask for the four-letter room code and **check it exists before
sending anybody anywhere** — a mistyped code used to mean landing on a buzzer
that simply never connected, which reads as the site being broken rather than
as a typo. Hosting mints a match over the API and lands on `/setup/CODE` with
the host key in the URL fragment, which browsers do not send to the server.

A code in the address fragment (`/#ABCD`) skips straight through to the buzzer,
so a shared link still works in one tap.

## Bug reports and feature requests

A **Report a problem** button on the buzzer, the host console and the watch
screen — the three places somebody actually is when something goes wrong. No
account, no third-party form: it posts to the server and lands as a file beside
the match logs, under `/data` so it survives a deploy.

**The context is attached rather than asked for**: room code, version, which
screen, who they are, which clue was up. A report written five minutes later has
lost all of that, and it is what turns "the buzzer did something weird" into
something anybody can chase.

**Entrance music plays from the buzzers and the host console.** It used to play
only on a watch screen with sound turned on, which was the wrong bet: a watch
screen is optional. In a live match nobody had one open with sound, so every
entrance passed in silence — and the bug report came from the host console, the
one screen that could not have played it.

Now every player hears the walk-in on their own device, and the host's speakers
carry it to the call. The music stops when the buzzers arm: a clip still running
while people are racing is worse than one that ends early. The console warns if
the host has muted themselves while somebody has a theme chosen, since the
host's sound is what the room hears.

Read them in the control room. **Take a copy** bundles the logs and reports
added since the last download; the marker lives on the server, not the browser,
so opening the page from a different machine does not silently skip a batch, and
it only moves once the download has been served. "Or everything" takes a full
archive and deliberately leaves the marker alone — that is a copy, not a
handover.

## The control room

`/control` lists every match on the server with how long each has been quiet,
and ends any of them. Ending a live match records it properly and tells the
host, rather than dropping it on the floor. Saved logs are on the same page.

**Matches with no activity for ten minutes end themselves.** A match lives in
memory until somebody ends it, and closing the tab is not ending it — a
forgotten test match sat live for an hour and blocked a deploy, because the
deploy guard quite correctly refuses to restart under a game in progress. Set
`RUMBLE_IDLE_MINUTES` to change the window.

It asks for a password, `daymay` unless `RUMBLE_ADMIN_KEY` says otherwise. That
is a doorlatch rather than a lock — it stops a stranger who finds the address
from ending a live match. The password is kept for the tab and sent in a
request header, never the URL, so it stays out of server logs. The version
number in the corner of the setup and host screens links here.

**Every match is recorded**, and read from this page. Recording used to be a
setting that defaulted off, which meant the interesting matches — the ones
nobody expected to be interesting — were the ones without a record. The host
console can still download a copy, but no longer does so unasked.

## Two keys, and both guards fail closed

`RUMBLE_ADMIN_KEY` and `RUMBLE_LOG_KEY` must exist in the service environment.
Without them `/control` and `/api/logs` refuse everybody, and the server says so
loudly at boot.

Both used to default to open. `/api/logs` served every saved match log — handles,
buzz times, answers — to anyone who asked, and the admin key fell back to a
literal string committed to this public repo, so the host console was reachable by
anyone who read the source. Neither looked broken: unauthenticated requests to
`/api/control` returned a correct 403, which is exactly why it went unnoticed.

The admin key opens the log routes too, because the control room downloads logs
with it. `/api/health` answers `status` and `version` to the public and the full
body only to 127.0.0.1 and the admin key — `deploy-remote.sh` reads
`matchesInPlay` there before it restarts and ends anybody's game.

    RUMBLE_ADMIN_KEY=...   host console, /control and /api/control
    RUMBLE_LOG_KEY=...     /api/logs and /api/logs/<file>

`node test/security.mjs` against a keyless server asserts the refusals.

## Deploying

Live at <https://j-royal-rumble.net>: a Lightsail VM in Ohio running the server
under systemd, behind CloudFront for HTTPS, domain at Cloudflare. About $7 a
month. `infra/aws/HOSTING.md` has the full picture — instance, DNS records,
certificate, and the gotchas found while building it.

`npm run ship "what changed"` pushes to GitHub. GitHub runs the full test suite
and, if it is green, tells the box to pull — so a push deploys, and a broken
commit does not. That needs the `AWS_HOST` and `AWS_SSH_KEY` repository secrets;
**without them the workflow is plain CI and deploys nothing**, printing the
manual command instead. If a change seems not to have landed, check those first.

By hand on the box, when you need it:

```bash
bash /home/ubuntu/app/tools/deploy-remote.sh          # refuses mid-match
bash /home/ubuntu/app/tools/deploy-remote.sh --wait   # deploys when clear
bash /home/ubuntu/app/tools/deploy-remote.sh --force  # now, regardless
```

Prefer the script over a bare `git pull && systemctl restart`. **A restart ends
every match in progress** — they live in memory — so it asks `/api/health` for
`matchesInPlay` and holds rather than pulling the rug out from under a live
game.

**This app must run exactly one server.** Matches live in memory, so a second
one means a host can create a match on one and have players land on the other —
which surfaces as "bad host key" and "no such game".

`GET /api/health` answers `status` and `version` to the public. The full body —
machine id, uptime, live match count — goes to 127.0.0.1 and to the admin key.
Ask it twice from the box: if the machine id changes, you are running more than
one. The id is the pid plus a boot nonce, so it also names the process to go and
stop — deliberately not the hostname, which is an internal address.

That check was broken for the whole of the Lightsail era and is worth knowing
about: the id used to be `FLY_MACHINE_ID || 'local'`, and since Lightsail sets
no such variable it was the constant `local` on every response — two instances
would have answered identically and the tell would never have fired.
