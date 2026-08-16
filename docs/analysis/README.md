# For the dev chat — handbook update + competitive-balance analysis (Aug 16)

`handbook.html` in this package has a rewritten Part IV ("Reality check") built from all nine
recorded human matches in the Aug 16 bulk download. It replaces the two-match version. Figures
11–14 are new; the underlying numbers are in `analysis/` (CSVs) so nothing has to be re-derived
from the logs by hand. This should replace `docs/handbook.html` (and the figures belong in
`tools/make-handbook.py` if the PDF is regenerated — noting the standing item that its figures
are hand-typed).

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


## Anonymization key (handbook P-labels -> real names)

The handbook anonymizes players; the CSVs in `analysis/` keep real names. Mapping:
P1 = Luigi · P2 = rowan · P3 = matt · P4 = Jeop · P5 = BriggySmalls · P6 = Taotao ·
P7 = CASCADIA · P8 = Colin · P9 = Nick · P10 = rae. The "final latecomer" in the QPAL
paragraph is Randall. Keep this key out of anything player-facing.

## Also in this package

- `analysis/match-summary.csv` — per-match: predicted vs actual, pace, winner + speed rank.
- `analysis/player-stats.csv` — per-player aggregates across all nine matches.
- The raw logs are in the previously delivered `rumble-feedback-2026-08-16.tar.gz` (with
  FEEDBACK.md covering the UI notes, the Randall write-up, the entrance-music report, and the
  CI #92 e2e-guard flake).
