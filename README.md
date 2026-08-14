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

A weak player loses far more to a hard clue than a strong one, and no per-level
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

## Pacing, and what the setup card warns about

**The ceiling scales with the field**, and this turned out to matter more than
anything else. It had been jumping from 7,500 to 11,000 at 25 players, which
made a 24-player field look far less fair than a 30-player one — it was the
ceiling doing that, not the field size. Every earlier fairness measurement was
confounded by it.

| Field | Ceiling |
|---|---|
| up to 8 | 6,000 |
| 9–16 | 7,500 |
| 17–20 | 9,000 |
| 21+ | 10,500 |

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
https link to a file. Everything is cut off after twelve seconds so a long clip
cannot run over the next clue.

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

**The winner of a raised clue banks the whole amount.** Clipping it on the spot
was the thing that made escalation look broken in a live match: a clue worth
2,000 paid the winner 500 while charging the loser the full 2,000, so the stakes
only ever moved one way and did it invisibly. They are clipped on the *next*
clue instead, so the falling roof takes it back unless they keep winning.

Overtime also opens on a very long stall — eight escalation windows, about 48
clues with nobody eliminated — even if people are still queued. The threshold
has to be that high: at three windows it fired during the entry phase and cost
eleven minutes of match length and twenty points of draw fairness.

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

### The disk is ephemeral

A fly machine's own filesystem survives a restart but is **wiped by the next
deploy**, and this project deploys several times a day. Logs go to `/data`,
which is where a volume mounts. Create it once:

    fly volumes create rumble_data --size 1 --region ord

The `[mounts]` block is already in `fly.toml`. Until the volume exists, logs are
still written — they just will not survive. `/api/health` and the `/logs` page
both say which of the two is currently true, in those words.

`/logs` is open unless `RUMBLE_LOG_KEY` is set, in which case it wants
`?key=…`. Fine for a test deployment; worth setting before anything public.

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

## The control room

`/control` lists every match on the server with how long each has been quiet,
and ends any of them. Ending a live match records it properly and tells the
host, rather than dropping it on the floor. Saved logs are on the same page.

**Matches with no activity for ten minutes end themselves.** A match lives in
memory until somebody ends it, and closing the tab is not ending it — a
forgotten test match sat live for an hour and blocked a deploy, because the
deploy guard quite correctly refuses to restart under a game in progress. Set
`RUMBLE_IDLE_MINUTES` to change the window.

The page is open unless `RUMBLE_ADMIN_KEY` is set, and says so plainly when it
is not. With a key, open it as `/control#your-key` — the fragment is not sent
to the server, so it stays out of logs.

## Deploying

Live at <https://j-royal-rumble.net>: a Lightsail VM in Ohio running the server
under systemd, behind CloudFront for HTTPS, domain at Cloudflare. About $7 a
month. `infra/aws/HOSTING.md` has the full picture — instance, DNS records,
certificate, and the gotchas found while building it.

Deploying is a pull on the box:

```bash
cd /home/ubuntu/app && git pull && npm install --omit=dev && sudo systemctl restart rumble
```

Note that this does **not** run the test suite the way the old Fly deploy did,
and that restarting ends any match in progress.


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
