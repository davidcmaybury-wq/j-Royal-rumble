# Release notes, for the room

This file is the source for the version notes the bot posts to the Discord
server, the way `discord-rules-v2.md` is the source for `/rules-101`. One
section per version, newest first, headed `## x.y.z — title`. The server posts
the section for the version it is running once, at boot, when the bot is
configured; `tools/post-notes.mjs --catch-up` posts a digest of whatever was
never posted. `test/notes.mjs` refuses a release whose version has no section
here, and refuses a section Discord would cut off.

Written for the people who play, not for whoever ships. Say what changed for
them and why, in a few lines. No handles, no P-labels, American English.

## 0.103.0 — You will hear about changes here from now on

Each new version posts a short note like this one to this channel, once, when
it goes live. What changed and why, in a few lines; the long version stays at
/history.

## 0.102.0 — The last one in gets a breath, and the robots learned from you

Overtime now waits one entry interval after the last arrival before the stakes
start climbing. The final entrant is the one person in the room who has played
nothing, and the logs say everybody buzzes slower on entry — about ten clues to
settle in. Opening overtime on their heels was charging them double for it.

There is a second robot set, built from 46 of our own matches instead of
television: rhythm regulars, gamblers, reactors, metronomes and stragglers,
each with its own press pattern from recorded play. One finding travels with
it: accuracy is flat across all five. Speed and knowing the answer are separate
things. Hosts can deal them through the robots API for now.

## 0.101.0 — The comeback edge is a band, not a discount

One foot on the floor used to take 70% off your buzz for forty races. Replaying
249 real races, that let a returning player take four races in ten without
pressing fastest — once by a second and a half. Now a returning press rounds
down to the nearest 60 ms: a photo finish at most, never a runaway, and a tie
inside a band goes to whoever actually pressed first.

## 0.100.5 — Show, don't say

The computer host no longer reads the category and value before each clue —
they are on your screen. You get twenty seconds to call a clue, with a
countdown on your buzzer, before Mike picks one for you.

## 0.100.4 — Entrance music that cannot play is refused up front

The picker now catches a YouTube link to a video that does not exist, not only
one whose owner blocks embedding, so you find out while you are still looking
at the box you pasted into rather than at your entrance.

## 0.100.3 — Seven seconds to answer, and you will know it

The answer window is seven seconds, up from five. When it is your call or your
answer, your buzzer turns into a countdown you cannot miss — the seconds in
large type, a bar draining on the clock, red for the last three, and a buzz on
a phone. It shows even in a browser that cannot listen.

## 0.100.2 — Hosts: the console has a link again

With the computer hosting, Start sends you to a buzzer, and there was no way
back to the console. The setup page now links it, in a new tab — open it
before you press Start.

## 0.100.1 — A robot that wins a race is ruled on

The first two computer-hosted matches locked the moment a robot won a race:
the host read its answer and then waited for a ruling nobody was there to
give. Fixed.

## 0.100.0 — The room can overrule the computer host

Press O after a ruling you disagree with, from the moment it is spoken until
the next one. A majority of the match, or two thirds of the ring, reverses it.
Where a reversal cannot say who should have had the clue, everybody votes on
their buzzer for fifteen seconds; a tie throws the clue out.

## 0.99.0 — The computer host listens and rules

Win a buzz and just say your answer into your buzzer — Chrome or Edge, and say
yes to the microphone. Mike rules on it; "be more specific" earns a second try
instead of a miss. Still marked ALPHA: a person at a console can overrule it,
and ending the match there always works.

## 0.98.1 — Still standing pays, and it says so

+$500 every ten clues you survive. The rule was already in play; now the rules
say so, and the box score shows it.

## 0.98.0 — The computer host, step three

Mike reads the clues and runs the board, Gene calls the ring, and the buzzers
arm the moment the read ends. A person at a console still presses Correct or
Wrong. Turn your sound on — the voice comes out of your own buzzer.

## 0.97.0 — When can you play?

Sign in with Discord at /when and paint the half hours you are usually free,
or mark the odd evening that is different. Everybody's answers make a heat
map, and when enough people line up the bot proposes a game night — which
reaches you only when a host actually sends it.
