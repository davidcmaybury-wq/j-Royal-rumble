# Autohost — objections, and the design is finished

*From the design chat, 2026-09-17, on top of the steps four and five work in the same tree. Left in the working tree per `docs/autohost-contract.md`; nothing committed, nothing shipped, `npm run ship` not run.*

## In one paragraph

The room can now overrule the computer host. Any player presses **O** — in the ring, in the queue, or already out — from the moment a ruling is spoken until the next one is, and the ruling is reversed on a majority of everybody in the match or two thirds of the ring, whichever lands first. The answering player's own O counts. Nothing stops while objections come in: the ruling takes effect at once and the board goes straight back out, because objections are rare by assumption and the common case must not pay for the rare one. When enough arrive, the reversal is a **walk-back** rather than a second ruling — the server restores the snapshot `undoStack` already keeps and re-runs the same `resolveClue` the other way round. Where the walk-back cannot express what the room wants, every buzzer gets fifteen seconds to vote on who should have had the clue, with what the room heard each of them say; a tie throws it out. A thrown-out clue pays nobody, charges nobody, and does not advance the clue counter. That was the last piece: `docs/autohost-design.md` is now entirely built.

## The four outcomes

**Lapsed.** Fewer than either threshold by the time the next ruling is spoken. Nothing is said — a host who announced every objection that went nowhere would be inviting them — and the count is recorded.

**Reversed, in place.** A *wrong* overruled while the reopened race is still running. The lockout is lifted, the race is closed and the clue is resolved to the objected player. No undo, which is deliberate: the buzz times are still in `match.race` and an undo-and-re-resolve would throw them away.

**Reversed, through the snapshot.** A *wrong* overruled after the clue ended as a stumper, with exactly one person having answered on it and nothing ruled since. Any clue in progress is abandoned back to the board — its card was never revealed, so it is simply picked again — then `runUndo` restores and `runReresolve` re-runs the rule with the objected player as winner and everyone else who was marked wrong still marked wrong.

**Awarded, or thrown out.** Everything else. Two players were each ruled wrong and the clue went to a stumper, so an objection says the host was wrong but not about whom; or somebody took the rebound. The award vote lists each answerer with their transcript plus "nobody — throw it out", plurality wins, and a tie or an empty vote voids. A reversed *right* skips the vote entirely: its only candidate is the player the room just overruled, and the race the rules say a miss reopens cannot be run minutes later with the answer already spoken to the room.

## Touched

**New.** `test/objection.mjs`, `docs/autohost-objections-report.md`.

**`src/engine.js`** — `voidClue(slot, row)`, and the three settings (`objections`, `ringSupermajority`, `awardSeconds`). Nothing else; the engine still knows nothing about hosts.

**`src/autohost.js`** — the objections section: `stand` / `isStanding` (a ruling becomes the standing one when it is spoken, and a walk-back's own re-resolve is deliberately not a ruling), `objectionCounts`, `onObject`, `objectionView`, `lapse`, `answerersOf`, `shapeOf`, `reverse`, `settle`, `handBack`, `tooLate`, the award vote (`openAward`, `onAwardVote`, `awardView`, `closeAward`) and `writeObjection`. `onResolved` records where the clue's snapshot sits, what it did and who it charged — none of which is knowable until the rule has run.

**`src/server.js`** — `runUndo` lifted out of the `undo-clue` handler to module level (a no-behavior-change hoist, run green on its own before anything was built on it), with a `quiet` flag for the objection path; `clueAt` factored out of `runPick` so the walk-back rebuilds the clue with the same function rather than a second copy of the overtime arithmetic; `runReresolve`; the `object` and `award-vote` sockets; three new actions on the autohost; the objection and the award vote on `playerView`, per viewer, so a player can see whether their own O is in and a reload mid-vote gets the popup back.

**`public/buzzer.html`** — the O key and a tappable Object button, the live count against both thresholds, and the award popup as a full-screen modal (which is also what satisfies the overlay rule). **`public/setup.html`** — the three settings in the hosting card as plain controls, read back in `collect()`.

**Docs, all in this change.** `RULES.md` §13 — which now also carries the microphone and the judge, which steps four and five had left it describing wrongly ("a person at a console still presses Correct or Wrong"). `docs/discord-rules-v2.md` — the computer host gets its own message; the block went past Discord's cap and the split note is updated to four messages with the counts. `docs/handbook.html` Part I §11 — the ears, the judge and the objection, with the reasoning. `public/howto.html`. `CLAUDE.md`, `docs/autohost-design.md` (*Built*), `package.json`, `deploy.yml`.

## What passed

`test/objection.mjs`, over real sockets: a player can object to a ruling against themselves and a second press is not a second vote; the host announces the opening once and every buzzer shows the count and both thresholds; an objection below both lapses at the next ruling and the miss stays on the player's record; two of a ring of three reverses a *wrong* while the clue is still open, paying the clue's own value and passing control; the same after a stumper walks back through the snapshot and the clue still counts exactly once; two answerers open the award vote with both transcripts, a vote for a non-answerer is refused, the plurality winner is paid and the other answerer stays charged; a tied vote throws the clue out, nobody's score moves from where it was *before the clue was read*, the clue clock does not move and the board goes back to whoever called it; a reversed *right* takes the payment back and voids; the record carries all four shapes as corrections and on the clue.

`test/mechanics.mjs` pins `voidClue` directly — the card dies, no score moves, `cluesRevealed` does not move, nobody is brought in by it, and a card cannot be thrown out twice. The whole socket suite and every standalone suite ran green, plus `security.mjs` against a keyless server on 8097. The one exception is unchanged and unrelated: `themes.mjs` fails its YouTube assertions in this sandbox because `youtube.com` is unreachable from it, the same reason `entrance.mjs` skips its own.

The contract asked for two lines in `test/security.mjs`. They exist, but in the suites that already have sockets: a `player-pick` from a token that does not hold the board is refused in `test/autohost.mjs`, and an `object` with no ruling in its window is refused in `test/objection.mjs`. `security.mjs` is HTTP-only against a keyless server, and giving it a socket harness for two assertions that already have one seemed the worse trade — say the word if you would rather have them there.

## Three things found while building

**A whole-percent setting broke a settled rule.** The setup page stores the ring share as a percentage, because "67" is something a host can type and 0.6666666666666666 is not. Three times 0.67 is 2.01, and `Math.ceil` of that is 3 — so a ring of three would have needed to be unanimous when the rule David settled says two. The threshold now allows the half percent the value is stored at, which over a ring of n is half a percent of n: negligible for a big ring, exactly what rescues a small one. The resulting table is in the comment beside it.

**Robots would have made a threshold unreachable by arithmetic.** A robot cannot press O, so counting robots in the denominators counts votes that can never be cast — in a field half full of them, a majority of the match is impossible however much the room disagrees. Both denominators count people. This is a divergence from the design, which did not contemplate robots in the room, and it is commented as one.

**The award timer had to be a bare `setTimeout`.** The game keeps playing under an award vote on purpose, so the next pick's `clearTimers()` would have cancelled the count and left the popup sitting on thirty screens forever. Exactly the shape of the step-three clip-wait bug, caught before it shipped because that one is written down.

## Two things to check first

**Anything that redirects or takes a URL.** Nothing new here does either. No new routes; the two new sockets take `{}` and `{to}`, and `to` is checked against the candidate list before it can reach a rule.

**Any new failure path that could be silent.** An O that cannot be counted is refused by reason and the buzzer says the reason out loud rather than swallowing it — a key that does nothing and explains nothing is indistinguishable from a key that is broken. A walk-back that can no longer reach its clue (the next clue was ruled on while the vote ran) does not guess: the ruling stands, the host says so, and it is recorded as `late`. `settle` catches its own throw, logs it with the match id and returns false rather than leaving the game half-restored. Every objection, met or lapsed, is in `corrections` with its count and both thresholds, so the rate at which a room disagrees with the judge is measurable after one match rather than after ten — which is the number that decides when the judge is good enough.

## What is still owed, unchanged

The Edge voice is still unmeasured and unreachable from here (`RUMBLE_TTS=edge node tools/tts-bench.mjs` on the box). The judge has still never ruled with a key: everything above runs `RUMBLE_JUDGE=local`, which never returns `wrong`. And the calibration night step four asked for is now worth more than it was, because the reversal rate is exactly what it would measure — one real match with the host reading, listening and ruling, a console open, and the transcripts, verdicts and objections all landing in the record for the comparison.
