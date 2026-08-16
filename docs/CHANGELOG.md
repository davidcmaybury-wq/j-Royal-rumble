# Version history

Newest first. `npm run ship` adds an entry automatically, so this stays current
without anybody remembering to update it.

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
