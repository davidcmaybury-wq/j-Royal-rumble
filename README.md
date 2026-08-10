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

## Deploying

Pushes to `main` run the simulation harness, then deploy to fly.io. Requires a
`FLY_API_TOKEN` repository secret.
