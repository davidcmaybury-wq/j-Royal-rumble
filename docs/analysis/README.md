# For the dev chat — handbook update + competitive-balance analysis (Aug 16)

`handbook.html` in this package has a rewritten Part IV ("Reality check") built from all nine
recorded human matches in the Aug 16 bulk download. It replaces the two-match version. Figures
11–14 are new; the underlying numbers are in `analysis/` (CSVs) so nothing has to be re-derived
from the logs by hand. This should replace `docs/handbook.html` (and the figures belong in
`tools/make-handbook.py` if the PDF is regenerated — noting the standing item that its figures
are hand-typed).

## `elims.json` — the 89 eliminations, pre-parsed

Added 2026-08-17 with the v4 notes. Every elimination across the eleven recorded
matches, one record each: `match` (room code), `player` (in-game handle), `clue`,
`wins` (race wins since entry), `tenure` (clues in the ring), `ot` (was overtime
open), `life` (first or second). It is what `tools/trigger-study.mjs` reads, and
it exists so the wins-vs-tenure question never has to be re-derived from raw logs.

Same rule as the CSVs: **in-game handles only**, and the same 34 handles already
appearing in `player-stats.csv` and this key. See the anonymization note below.

## What the nine matches say

**Estimator.** 7 of 9 within a handful of clues. Two real misses, both structural: FTGL
(4 players, ran 2.3× prediction — small fields don't eliminate) and QPAL (75 predicted, 180
actual — two latecomers, revival used by everyone, long overtime). The estimator models none of
latecomers / revival / overtime. It should. Pace: model assumes 17.5s/clue; experienced rooms
now run 14.1 and 12.9 medians. A per-room pace prior would fix most of the remaining error.

**Balance (David's design goal — read this part).** David, verbatim: *"I'm concerned that the
game is too friendly to elite players, and everyone is just cannon fodder. I want everyone to
have SOME chance to win in this."*

The data backs the concern:

- Winner's within-field speed rank across the 8 decided matches: fastest won 4, second-fastest
  won 2, everyone slower won 2.
- Luigi / rowan / matt entered 6 of the 8 decided matches and won 5 (rowan 3-for-4 overall).
- QPAL: rowan+Luigi took 125 of 165 races; +Jeop = 86%. The other five entrants split 23 races
  over 48 minutes. Nick: eliminated at clue 10, revived, out at 66, two races won all night.
- Race win % vs median reaction is monotone across all 18 players with 20+ contested buzzes
  (see `analysis/player-stats.csv` and handbook Figure 13).

Upsets exist (Colin won TQUV from 5th of 7; CASCADIA won FTGL from 3rd of 4), so the format
isn't deterministic — but a bottom-half buzzer's chance is ~1-in-4 overall and ~zero when a
Luigi-class buzzer is present.

## Candidate levers — measure in the harness first, per house rules

1. **Scale entry and revival stakes with the overtime multiplier.** Also fixes the Randall
   case from FEEDBACK.md (fed into ×2 OT with a flat stake, dead in 6 clues; revived at half
   stake into ×4, dead in 1). Cheapest win; do this one regardless.
2. **Buzz-timing handicap priced in score** — the leader gives up milliseconds (the lockout
   mechanic already prices time, so the plumbing exists). This is the only lever that touches
   the *skill* gap directly rather than draw position.
3. **Progressive pot** — leaders pay more into pots they lose. Redistributive without touching
   the buzzer.
4. **Lean on the existing skill dial** — the harness already reports skill% per configuration,
   and shorter/swingier configs are measurably less skill-determined.

Proposed target metric, so the harness run has a definition of done: P(bottom-half-median
buzzer wins the match), currently ~25% live; David wants it meaningfully above zero even with
an elite in the field. Fairness-by-draw (back-half win rate) is already measured — this is a
second, orthogonal axis, fairness-by-skill.


## Anonymization key (handbook P-labels -> in-game handles)

The handbook anonymizes players; the CSVs in `analysis/` keep the in-game handles. Mapping:
P1 = Luigi · P2 = rowan · P3 = matt · P4 = Jeop · P5 = BriggySmalls · P6 = Taotao ·
P7 = CASCADIA · P8 = Colin · P9 = Nick · P10 = rae · P11 = Zach · P12 = Dalton · P13 = Vee.
The "final latecomer" in the QPAL paragraph is Randall.

**In-game handles only, deliberately.** Several of these players are identifiable broadcast
contestants, and their legal names, together with a per-player analysis of how well they did,
are not something this repository should publish — it is public, and git history is permanent.
The identities live with David. Keep this key out of anything player-facing regardless.


## Further study: some of these players are in our own J!ometry data

Several of the strongest players here are broadcast contestants whose televised box stats sit in
`data/jometry-box.csv`. Their identities are deliberately not recorded in this repository — see
the note on anonymization below — but the comparison is worth keeping, because it is an external
check nothing else in this project provides:

1. **Bot-model validation against known individuals.** The two fastest players profile as
   Superchamp/Elite on the robot standards (attempt 72–96%, accuracy 83–95%), and their rumble
   race-win rates (~50%) sit right at the top of the real cross-contestant range (46.3–56.3%).
   The buzzer dynamics are reproducing broadcast-grade numbers for broadcast-grade players.
2. **The shark analysis has a calibrated ceiling.** QPAL contained two broadcast-verified elites
   racing each other; that they still took only ~50% of races each — mostly trading with one
   another — while the rest of the field took 14% is the clearest picture yet of what a
   P1-class player in the room does to everyone else's chances.
3. **Handicap experiments can be seeded with real profiles.** When the harness runs the balance
   levers, robots can be set to these measured profiles rather than generic standards, so "does
   a handicap give a normie a chance against a P1" can be answered literally.

One cautionary sample worth carrying: a broadcast superchamp in this set has a fast median
(139ms) and the lowest race-win rate in the dataset (23.8% on 21 contested buzzes). In a stacked
field, small timing gaps at the top compound brutally — the same dynamic the casual players face
everywhere. The Aug 12 matches were a broadcast-caliber field nearly top to bottom, which makes
the two upsets weaker evidence than they looked: both were sharks beating sharks, or a uniformly
slow field. Within-field speed rank still ruled every mixed field.

## Handbook v3 (in this package)

`handbook.html` now covers all eleven matches: estimator diagnosis (accurate except when
returns/latecomers fire), the host-relative clock finding (Fig 13), the balance-lever
simulation results (Fig 16), and the shipped gated comeback with its first-night returns —
including the wrong-stake-in-overtime bug. New anonymization entries: P11 = Zach,
P12 = Dalton, P13 = Vee.

## Also in this package

- `analysis/match-summary.csv` — per-match: predicted vs actual, pace, winner + speed rank.
- `analysis/player-stats.csv` — per-player aggregates across all nine matches.
- The raw logs are in the previously delivered `rumble-feedback-2026-08-16.tar.gz` (with
  FEEDBACK.md covering the UI notes, the Randall write-up, the entrance-music report, and the
  CI #92 e2e-guard flake).
