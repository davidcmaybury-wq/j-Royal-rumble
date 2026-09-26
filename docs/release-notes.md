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

## 0.96.1 — The handbook's Part IV, in David's voice

The measurements section of the handbook now reads like the person who runs
the game wrote it. Every figure is byte-identical; only the prose moved.

## 0.96.0 — Matches 14 to 20 reach the handbook

Seven more recorded matches are in the handbook's live-data section,
anonymized to P-labels as always, with the analysis chat's figures.

## 0.95.10 — Tournament was letting an aimed miss go free

In Tournament an aimed miss is supposed to pay half the focused pot. A match
set up any way other than the Tournament preset was charging nothing. Fixed,
and the default now comes from the mode rather than the preset.

## 0.95.9 — Hosts: the entrance-music box was covering the scoring buttons

When a player walked in to a YouTube theme, the video box sat over Correct
and Wrong on the console for up to ten seconds. It sits at the top now and
cannot take a click.

## 0.95.8 — Hosts: the quick-start presets sent entrants in too fast

A quick-start rule set was flooding the queue into the ring. Fixed, along
with the page checker that should have caught the setup page misbehaving.

## 0.95.7 — Finished matches now leave the server's memory

Every match played since a boot stayed in memory with its full record. They
are dropped an hour after they end — long enough to read the box score.

## 0.95.6 — Under the hood: the page checker was silent on three pages

The test that catches broken pages before they ship was swallowing errors on
the console, the buzzer and the admin page. It runs on all of them now.

## 0.95.5 — The setup page went down on a stray backtick

One character in a comment took the whole host setup page with it. Fixed
within the hour.

## 0.95.4 — The Aug 22 matches reach the handbook, anonymized

Two more recorded matches in the live-data section, P-labels only.

## 0.95.3 — Hosts: setup modes are Quick start and Advanced

The two setup modes are named for what they are.

## 0.95.2 — One length estimator, not two

The setup page and the server were estimating match length separately and
disagreeing. There is one now, and the handbook's P-labels were made properly
anonymous.

## 0.95.1 — Hosts: the quick-setup ruleset dropdown works again

It could only read Custom. Arcade, Tournament and Chaos apply again.

## 0.95.0 — Match records are behind a key now

The saved match logs and the control room were reachable without a key —
handles, every buzz time, every answer. Both refuse everyone without one now,
and the site fails closed rather than open.

## 0.94.2 — Under the hood: every study pins the arrival grace

One balance figure would not reproduce between two measurements. Both were
right, on different engine defaults; every study tool now pins the setting.

## 0.94.1 — "Kickout on 2," not "pity powerup"

The rejected buzz-boost-after-losses idea is renamed in the handbook. It is
the wrestling term, and it does not call anybody pitiable.

## 0.94.0 — Backfire is a dial: aimed misses are free in Arcade and Chaos

An aimed miss used to pay the whole focused pot, which made ganging up on the
leader — the room's only answer to a runaway — the worst thing you could do:
six ordinary players aiming at the richest shark took 5.4% of wins against
17.6% holding fire. Now an aimed miss pays nothing in Arcade and Chaos and
half in Tournament, and the host can set it. Focused fire still fires.

## 0.93.0 — The bone pile: every leveling idea we tried and buried

The handbook gains a section of the ideas measured and turned down, with the
number that killed each one, so nobody has to re-run the study to find out.

## 0.92.0 — Nobody's TV record goes in the handbook

A section comparing players' televised records with how they do here was
removed for good. Several of you are identifiable, and that read is not ours
to publish.

## 0.91.0 — The analysis charts are in the handbook

Nine figures from the balance studies are in the online handbook, where the
numbers behind every rule live.
