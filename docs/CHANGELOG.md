# Version history

Newest first. `npm run ship` adds an entry automatically, so this stays current
without anybody remembering to update it.

## 0.87.0 — robot wrong answers come from Haiku, and stop failing silently

The robots were reading other answers off the board instead of inventing one,
which on a loose category is nonsense. The Claude path existed; it was not
running.

**The bug was that nobody could tell.** Every failure went through a bare
`catch {}` to the local fallback with nothing logged, so a missing key, a
rejected key, a wrong model name and a timeout were indistinguishable from
outside — all four look like robots talking nonsense. It ran that way in live
matches.

`GET /api/health` now reports `wrongAnswers`: the model, whether a key is
configured, how many answers were asked for, written and fallen back, and the
reason for the last fallback. `mode` is what the room is actually hearing —
`claude`, `local` or `mixed` — not what was configured. The server logs the
reason once per distinct cause rather than once per clue.

**Haiku, and the official SDK.** `claude-haiku-4-5` because this is a throwaway
sentence per clue rather than a reasoning task. The hand-rolled `fetch` is
replaced by `@anthropic-ai/sdk`, which brings typed errors — so the health
readout can say *which* failure it was — and a retry on the 429s and 503s that
used to fall straight through to the board. The latency ceiling is unchanged at
4s: one retry at 2s each, sized to finish inside the host's read.

`test/wrongs.mjs` pins the fallback path, which is what CI runs with no key.

## 0.86.2 — the rule sets are named for the mode they produce

Quick setup offers **Tournament, Arcade, Chaos**. "Standard" is now Arcade,
which is what it always was.

**The rename caught a real contradiction.** All three rule sets left the comeback
on, so all three produced a match whose screens read ARCADE MODE — including the
one called Tournament. Tournament now drops the comeback along with targeting,
which is what makes it a different mode rather than a different preference: no
player is ranked with time off their press, so buzz order is buzz speed and the
times are published.

Chaos is Arcade plus the advanced mechanics, and says so.

## 0.86.1 — handbook v3, merged rather than swapped

Part IV replaced with the version built from all eleven recorded matches:
sixteen figures, the estimator diagnosed rather than just humbled, the
host-relative clock finding, and the balance-lever simulation with the shipped
gated comeback's first night in it.

**Merged, not swapped.** The incoming file was built from an older Parts I–III
and would have dropped the gemstone stables section, the 10,500 small-field
ceiling, One foot on the floor, Arcade/Tournament and the comeback correction —
seven of the needles `guides.mjs` asserts, which is that guard doing exactly
what it exists for. Parts I–III are the current ones; Part IV is the new one.

**Two measurements of the comeback now sit in one document, so it says which is
which.** Figure 16 gives a single casual's match-win probability (1.9% ungated,
7.3% gated); `comeback-study` reports the three casuals' combined share (2.9%
against 11.0%). One is a player's own chance, the other the group's share of the
table. The threshold finding is restored alongside them.

**`docs/analysis/README.md` carries the analysis without the identities.** The
delivered note named eight identifiable broadcast contestants alongside a
per-player critique of how well each did. This repository is public and git
history is permanent, so the reasoning is kept and the real-name mapping is not;
the P-labels map to in-game handles, which were already committed in the CSVs.

## 0.86.0 — Arcade and Tournament

A match is now one shape or the other, named on the host console, the watch
screen and every player's buzzer for the whole match.

**Arcade** is the comeback switched on. Because a player on the way back is
ranked at a fraction of the time they pressed, buzz order stops being buzz speed
— so the room sees **1st, 2nd, 3rd** rather than times. A player still sees their
own reaction time on their own buzzer, to the tenth of a millisecond. Nobody
sees anybody else's.

**Tournament** is the comeback off. `buzzEdge` is always 1, the fastest press
wins every race, and the times stay public because they mean exactly what they
look like.

**The times are absent from the payload, not merely unrendered** — `watchView`
and `raceView` omit `ms` entirely in Arcade, the same discipline that keeps the
answer off the watch screen. `test/arcade.mjs` asserts both directions and that
a player's own number still reaches them.

This replaces the 0.85.1 fix, which sent the ranked time beside the real one so
the host could see why a slower press held the clock. Showing the order beats
explaining the arithmetic behind it, and the `edge` field is gone.

**A bug fixed with it:** `rerank` ranked on raw `ms` while `rankRace` ordered on
`ms * buzzEdge`, so the place a player was told could disagree with who actually
held the clock. It only ever showed up once the comeback existed, because every
edge was 1 before that — and it would have made the new place display wrong from
its first match.

The Discord rules are now at capacity: 1,970 / 1,707 against a 2,000 cap, and no
other two-message split fits. The next rule added there needs a third message.

## 0.85.4 — the entry banner was sitting on the adjudication buttons

The console locking up on an entry, third and final piece. 0.85.2 stopped the
banner eating the host's keystrokes; it went on eating their mouse clicks.

The banner is anchored at `bottom:92px` against a dock whose height is
`min-height:92px` — a minimum, not a fixed size — and the buzz chips wrap. So as
soon as several people buzz the chip row runs to two lines, the dock grows past
92px, and the banner lands on top of **Correct / Wrong / Nobody got it**. At
`z-index:60` with its own click-to-dismiss, it swallowed the click and closed
itself: the host clicked Correct, the banner vanished, nothing happened.

That is why entries with robots were the worst of it. Every robot buzzes, so the
chip row wraps every time and the overlap is guaranteed — which is exactly the
"harder when it's a bot" report, and not a robot bug at all.

`pointer-events:none` makes the overlap harmless at any dock height: clicks reach
the control underneath. It still closes on any key and on its own timer. The
overtime splash keeps click-to-dismiss deliberately — it covers the screen and is
obviously in the way, where this one is a thin strip that looks harmless.

`pagerefs` now fails if the banner takes input by any route.

## 0.85.3 — the board's category cards can hold a whole title

Reported from the full buzzer: a player could not read his own board because
the title cards would not show a second row.

The board was six separate grids, one per column, so row one was sized per
column and a long category made its own card taller than the rest. The fix for
that had been a hard `max-height` with the title clamped to three lines — which
is what cut a title off. Beside a 420px buzzer on a narrow window each column is
about 93px, where the text wraps every 13 characters or so, so anything past
roughly 28 characters lost its tail with nothing on screen to say it had one.

It is one grid now: `display:contents` on the column lifts the cards and cells
into it, so row one is shared across all six and sized to the tallest card. The
cap is gone, the clamp goes from three lines to five, and the cells stay aligned
because they are literally in the same grid rows.

## 0.85.2 — the entry banner was eating the host's keystrokes

**This is the hang.** The entry banner stays up for 4.2 seconds after somebody
walks in, and the console's keyboard handler opened with
`if (document.querySelector('.entry')) return;`. So for four seconds after every
entry the host's keys did nothing: pick the next clue with the mouse, press
space to arm, and the game sits there. Press again and it works — which is both
the "it hung when it was the clue when someone was coming in" report and the
reason a host ends up sending two adjudications for one clue, which is what
threw the destructure error in 0.85.1.

The banner still dismisses on any key; it just no longer swallows it. Eating the
host's input to close a decoration was the wrong trade — a banner in the way is
a nuisance, a dead keyboard is a stopped game.

**And the comeback edge outlived its 40 races.** `racesRun` was incremented on
`entry.missed`, where the field is `entry.missedIds`, so it read as "clues
somebody won" and a clue everybody buzzed and nobody converted did not count.
The edge is measured in races, so it lasted longer than it should have — with
nothing on the console saying who held it, the effect from the outside was a
player who seemed to keep an unexplained advantage on the buzzer. Reported as
exactly that.

The expiry test only played clues with a winner, which is why it passed for
several releases. It now plays contested clues nobody converted as well, and
checks that a clue nobody buzzed still does *not* burn the edge.

## 0.85.1 — the hang, from a live match

**Adjudicating a clue twice took the game down.** The host pressed Y twice and
got "cannot destructure property 'slot' of 'match.clue' as it is null", with the
console apparently stuck. Y fires on keydown and the guard in front of it reads
the console's own copy of the state, which still shows the old clue until the
server's push lands — so a second press arrives after the clue is settled and
`match.clue` is null. `resolve` was the only handler of its kind with no null
check, so it destructured null and threw, and hostOnly handed the TypeError to
the host verbatim.

It is refused in words now ("that clue is already settled — pick the next one"),
the console will not send the second one, and `test/doubleresolve.mjs` plays the
sequence and checks the match is still playable afterwards.

**And the console now shows why a slower time is winning the race.** A player on
the way back from a near-elimination is ranked at a fraction of the time they
pressed, so first place can legitimately show a bigger number — reported from
the same match as "Zach actually was fastest but Dalton was highlighted as the
first person in". The chip shows both numbers, which the comment above
`rankRace` had claimed for a while without it being true.

## 0.85.0 — quick setup

The setup page opens on two dropdowns instead of forty controls: a rule set
(Tournament, Standard, Chaos) and a game speed (Blitz, Standard, Extended),
the roster, and a button that adds robots. **Expert** is the old full card, one
click away and remembered per browser.

Tournament is every standard rule except targeting — nobody can be ganged up
on, so it comes down to the buzzer. Chaos is everything, advanced mechanics
included. Blitz feeds a player in every 5 clues; Standard and Extended pace to
20 and 40 minutes and let the entries scale to whoever turns up.

**The presets write into the real controls rather than living beside them**, so
switching to Expert shows exactly what a preset did, and the dropdown reads
Custom the moment a hand-edit stops matching it. Expert renders in both modes
and is hidden with CSS: `collect()` reads every control by id when it saves, and
a card that is genuinely absent takes the Save button down with it.

## 0.84.0 — one foot on the floor

Somebody knocked out before they ever got going comes straight back on half a
stake, with 70% off their buzz for the next 40 races. Once each, and only for
players with fewer than three clues to their name.

**The gate is the design.** Ungated, the same mechanic is a subsidy for the
strong — they take their free life too and end up further ahead. In the study's
six-player field (one 95ms elite, one at 130, a mid, and three casuals at
210/240/270), gated at 40 races:

| | elite | second | mid | the three casuals |
|---|---|---|---|---|
| ungated, 70% | 48.7% | 35.9% | 12.5% | 2.9% |
| **gated, 70%** | **61.9%** | **17.1%** | **10.0%** | **11.0%** |

Ungated pulls the elite down further and does nothing for the people it was
built for. Gated, the casuals take ten times the share.

**The boost is a threshold, not a dial** — found the hard way. It shipped at 50%
and was corrected to 70% the same evening, because 50% measures as very nearly
nothing: casuals 2.1% against 11.0%, with the elite taking back 12.5 points. The
reason is that the discount only counts if it puts a slow player under a fast
one, and against a 95ms elite the three casuals need 54.8%, 60.4% and 64.8%
respectively. At 50% none of them get there. Below ~55% the mechanic is
decorative; the useful range starts around 65%.

**The figures first published with this entry were not reproducible** — "bottom
four 1.5% → 41.9%, elite 93.8% → 38.6%" matches no row the study produces, and
has been replaced above with its actual output. Retune against
`npm run comeback-study` and the threshold table in `engine.js`, not by feel.

**It costs draw fairness**, which is worth knowing. The back half of the draw
goes from 50% to 59% at sixteen players, because a late entrant is likelier to
still be under the gate when they hit trouble. Fairness by skill and fairness by
draw are pulling against each other here for the first time.

It also quietly preempts bounties and revival for anyone under the gate: they are
never eliminated, so nothing pays out and no second life is spent.

## 0.83.0 — the handbook, rewritten against nine matches

Part IV replaced with an analysis of all nine recorded human matches rather than
the two it was built on. Four new figures: the estimator against live play, pace
by match, race-win rate against reaction time, and the competitive picture.

The estimator comes out humbled — seven of nine within a handful of clues, with
two structural misses it cannot currently model: a four-player match that ran
2.3x its prediction because tiny fields trade points without eliminating, and
one that ran 180 clues against 75 predicted because of latecomers, revival and
a long overtime. It models none of those three.

It also puts a number on something David had only suspected: the winner was the
fastest buzzer in the field in half the decided matches, and race-win rate is
monotone against reaction time across every player with enough buzzes to judge.
Fairness by draw is measured and fine; fairness by skill has never been measured
at all. That is now written down as an open question with a definition of done.

## 0.81.0 — how fast people are fed in

Measured, and written up as Figure 12 in the handbook. The entry interval turns
out to be nearly free at small fields — every value from 3 to 20 lands within a
few points of an even draw — and dangerous at scale: twelve players on a
20-clue gap hand the back half 66% of the wins. What it really controls is
length. The cap drops from 15 to 10, which leaves fairness alone and takes a
third off a small match.

Eight measured just as well and was tried first, but it made a six-player
fifteen-minute game unreachable on auto, so the estimator warned every time.
That also turned up a long-standing flaw: the "set the target to N" button
suggested a number that clamped again and re-raised the same warning.

## 0.80.0 — five things from game night

**Two sounds on one entrance.** The horn played under the player's own music.
If somebody brought a theme, that is the entrance; the horn only fills in for
people who did not choose one.

**Two players called Dave were one player.** A duplicate name was accepted and
the room had nothing else to tell them apart. A second Dave is now turned away
with an explanation. Worse, the join screen never came back after a refusal —
`return sfx.preload();` sat in front of the `renderJoin()` meant to redraw it,
so anybody rejected was stuck looking at nothing.

**Back to home and Start a new game** on the finished-match screen. The console
was a dead end and the host had to know the URLs.

**Entries come faster in a small field.** The cap was 15 clues and four-to-six
player games always hit it, so every small match had identical pacing. Ten now.

**Reports can be marked resolved or deleted** from the control room. Settled
ones sort below the rest rather than scrolling the live ones away.

## 0.79.0 — entrance music moves to the buzzers and the console

A live bug report said "entrance music didn't play", filed from the host console
— which never played it. The mechanism was working; it was pointed at the wrong
screen. Music played only on a watch screen with sound enabled, and a watch
screen is optional; nobody had one open that night.

It now comes out of every player's buzzer and the host console, which always
exist. The player code is one shared module rather than a copy per page, and the
music stops when the buzzers arm.

## 0.78.0 — walking into overtime

A new entrant's stake now rides the overtime multiplier, and so does a revival.
A fixed 3,000 walked into a ring where single clues paid 2,000: in a real match
Randall entered at clue 150 into x2, lasted six clues without winning a race,
was revived at 1,500 into x4 where the top row paid 2,000, and was gone after
one. Measured over 3,000 matches, entrants at x2 or above who died within three
clues fell from 58% to 9%.

Also: board control lights the whole score row rather than a 7px dot; the watch
screen now draws the category hint at all, which is why a live room could not
play a category that depended on it; and the report button moved off Arm
buzzers on the host console.

## 0.75.0 — the ceiling for small fields

A real 53-clue six-player match had the winner pinned at the 6,000 ceiling for
20 clues, with 11,930 points swallowed: half the match, they answered correctly
and gained nothing. Small fields now get 10,500. The ladder is deliberately no
longer monotonic — a small field needs the most headroom, not the least.
Ceiling decay was tried again and rejected again: a falling cap is one the
leader meets sooner, so it made pinning worse and brought back the late-draw
bias.

## 0.74.0 — warm-up presses stay out of the record

Jumping the lights while waiting in the queue counted as a live attempt. One
player finished a real match credited with 28 attempts across a tenure of one
clue. The buzz path checked for this; the early-buzz path did not.

## 0.73.0 — entrance music, audio only

YouTube clips play through a covered player rather than a hidden one, because
browsers refuse autoplay to an iframe with no size. Everything stops after five
seconds, the test button included.

## 0.72.0 — how to play, and rules 101

An illustrated guide that assumes nothing, and the Discord explainers rendered
as a page. The guide warns that the space bar only works when the buzzer window
is in front, which caught people out in testing.

## 0.71.0 — gemstone stables

Stables are named from a list — Diamond, Ruby, Emerald, Sapphire, Onyx, Topaz —
each with a colour and a line-art badge that tints its members' rows on every
scoreboard. The pot is now split evenly across the stable.

## 0.66.0 — stable damage lands on the outsiders

When a stable member wins, the pot stays full size and the teammates' share is
loaded onto whoever is outside. The first version let the pot shrink, which
protected the stable and did nothing to anybody else.

## 0.61.0 — stables

Teams, with betrayal costing half your stack. Off by default.

## 0.58.0 — robots spread through the draw

A straight shuffle regularly dealt three or four robots in a row, and a stretch
of match where nobody real walks in is the part a room notices.

## 0.52.0 — the control room

Every match on the server, with a way to end one, and the saved logs. Matches
with no activity for ten minutes end themselves: a forgotten test match blocked
a deploy for an hour.

## 0.50.0 — entrance music

Twelve original 8-bit themes in three moods, synthesised rather than sourced so
the licensing is unambiguous.

## 0.48.0 — the welcome screen

`/` used to serve the host setup page, so anybody who typed the domain landed on
the controls for running a match.

## 0.44.0 — the ceiling scales with the field

The ceiling turned out to be a stronger fairness lever than the entry interval,
and it had been confounding every earlier measurement by jumping at 25 players.

## 0.40.0 — the watch screen

A public, read-only board at `/watch/CODE`, with the answers never sent to it.

## 0.30.0 — the bot model

Robots that buzz on a real clock, with reaction times and accuracy drawn from
3,339 real player-games rather than a fitted curve.

## 0.20.0 — overtime

Stakes double every six clues with nobody eliminated, up to eight times face
value. Took three attempts; the failures are recorded in the handbook.

## 0.10.0 — the first playable match

Buzzers, a board, scoring where every other player pays the winner, and
elimination below zero.
