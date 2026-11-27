# Call sync: each player's light when they hear the host

*Added in 0.106.0, 2026-11-27. Matt Schiffler's design from j-trivia, rebuilt
here from his written notes on v722. His `callSync.js` was not available to
this repository, so nothing was copied; the code is `public/callsync.js`.*

## The problem

With a human host, the clue is read over a video call (Zoom, Discord, Meet,
Teams) and players buzz on their own `/j/` pages. Every player hears the host
late, by anything from under 0.1 s to a few seconds, and the amount differs per
player and moves during a game. The game's own messages come through our
server and usually beat the call's sound. So a player's light came on before
they heard the host finish, the board changed before they heard the host say
so, and the one host-wide **Delay** setting could only ever be right for one
person in the room. Players with longer delays lost every close race.

## How it works

The host's page and each player's page turn sound into the same loudness
pattern, each stamped with its own computer's clock, and the player's page
slides one along the other to find the offset where they line up:

    player clock = host clock + L

L carries both the call's delay and the difference between the two clocks, so
no clock is ever synced. Anything the host does at host time T happens on that
player's page at T + L.

| Side | What it does | Where |
|---|---|---|
| Host console | opens the host's mic on the first click or key press; sends 20 frames (100 ms) at a time as `sync-frames`; sends `host-at` with the page-clock time of every key press and click, in the capture phase, ahead of whatever the key does | `public/console.html`, `HostSync` |
| Server | relays `sync-frames` to the players' room, volatile, size-capped; stamps the activation, the clue going up and every player state with the latest `hostAt` (only if under 2 s old); stores each player's reported status; works out the fair-buzzing wait | `src/server.js` |
| Buzzer | captures the call (Headphones: the computer's sound via `getDisplayMedia`; Speakers: the mic); runs the matcher every 500 ms; arms at `hostAt + L` (+ the player's own lag, + 180 ms on Bluetooth); holds `state`, `clue-shown` and the board until `hostAt + L` | `public/buzzer.html`, `PlayerSync` |

A synced buzzer turns `hostAt + L` into a server instant and calls the same
`armAt` as before, so the reaction clock, early presses and the presses logger
in `public/rumble.js` are unchanged. An unsynced buzzer arms exactly as it did:
the server's activation plus the host's Delay setting.

**The autohost is left out.** With the computer hosting there is no voice on a
call, the console's mic never opens, and the buzzer shows no sync line.

## Fair buzzing

The Rumble already ranked a race on each player's reaction time measured from
their own light, so the order needed no change. What it lacked was waiting for
the players who hear the host later. Now every buzz gets a decision time: each
live person who has not buzzed is allowed 3.5 × their worst round trip (from
the latency reports the buzzer already sends) plus their *extra* — L minus the
message transit if synced, the Delay setting if not. With W the largest, B the
buzz's reaction time and R the time from the host's press reaching the server
to the buzz reaching it, the buzz waits max(W + B − R, 250 ms). When everybody
has buzzed it is decided at once. The console marks the leader **deciding**
until then; the host can still rule whenever they like, as before. Robots are
not waited for, since they buzz on the server.

The auto-stumper's lectern is extended by the latest synced player's extra
beyond the Delay setting (capped at 3.5 s), so a clue does not die with most of
a late-hearing player's window unused.

j-trivia also turns every player's light off a fixed time after their own light
came on. The Rumble keeps the race open until the host rules, so there is no
equivalent to port.

## The numbers

Matt's notes ended just before their table of constants, so every value below
is either stated in his prose ("notes") or chosen here ("here", with the
reason in `public/callsync.js`).

| Constant | Value | Source |
|---|---|---|
| frame hop / window | 5 ms / 32 ms, Hann, FFT | notes |
| bands | 32 mel, 100–4,000 Hz | notes |
| level byte | 0.5 dB steps from −110 dB | notes |
| frames per message | 20 (100 ms) | notes |
| history kept | 15 s each side | notes |
| sample-clock fallback | earliest arrival over 20 s | notes |
| tick | 500 ms | notes |
| transit | min of arrival − send over 10 s | notes |
| search range | transit − 0.5 s to transit + 3 s | notes |
| full window | 6 s, skipped under 2 s of speech | notes |
| speech | 15 dB over the quietest 3% | notes |
| onset floor | 10th percentile power | notes |
| edge reject / side lobe | 50 ms / 50 ms | notes |
| counts / strong | conf ≥ 1.3 / conf ≥ 2.0 and z ≥ 6 | notes |
| first value | 3 strong within 30 ms over ≥ 3 s of speech | notes |
| local search | latest 2.5 s, L − 300 to L + 150 ms | notes |
| local speech floor | 1 s | here |
| drift | ≤ 50 ms, median of last 3 | notes |
| step | ≤ 150 ms, 2 strong ≥ 0.5 s apart | notes |
| step agreement / "recent" | 30 ms / 10 s | here |
| unheard | 20 s of host speech with no match | notes |
| what resets unheard | a strong match, or a counting one within 150 ms of L | here — a bare conf 1.3 happens by chance on sound with no host in it |
| host silence warning | 60 s | notes |
| Bluetooth | +180 ms | notes |
| light guard | no matching until 50 ms after a light | notes |
| buzz wait | 3.5 × worst RTT + extra, min 250 ms | notes |

**If j-trivia's `callSync.js` becomes available, compare the "here" rows
against it first.**

## Measured

`test/callsync.mjs` puts synthetic speech through the real `FrameMaker` on both
sides, with the player's copy delayed, turned down, noisy and on a clock two
minutes out. With the computer's sound captured it finds 80, 650, 900 and
2,400 ms delays to within 2 ms, locks about 12 s in, follows a 30 ms drift,
takes a 120 ms step 7.5 s after it happens and re-finds a full-second jump. A
mic over speakers with another person talking over the host lands within
10 ms. Noise alone never produces a value.

The first version was 20 ms late on every delay. The synthetic host had no
noise floor while the player's capture did, so the player's onsets fired later
up each rise. A real host mic always has a floor, and the test now gives it
one; the lesson is that the onset step is sensitive to a floor mismatch between
the two sides, which is why both sides add their own.

A Chromium run with fake mics on both pages (`--use-file-for-fake-audio-capture`)
showed the whole browser path working: the player locked about 12 s after
choosing Speakers, the console showed `DELAY N ms` in their box, and their light
came on that long after the host pressed Space.

**Not yet tried in a real room with a real call.** Headphones capture
(`getDisplayMedia` with system audio) cannot be exercised headlessly, and
j-trivia's own pause and mic checks were the newest part of its build and
untried in a real game when the notes were written.

## Practical lessons, from Matt's notes

- The host wears wired headphones, so only the host's voice is in their pattern.
- The computer's sound gives much stronger matches than a mic.
- Bluetooth adds delay after the capture; 180 ms is a typical figure.
- Turn off echo cancellation, noise suppression and automatic gain on both sides.
- Map the audio clock to the page clock with `getOutputTimestamp()`.
- Audio needs a click: resume on the first one.
- Keep the page free when a light is due.
- Search relative to the transit, never from zero.
- The server only relays; the host's pattern costs each player about 8.5 KB a second.
