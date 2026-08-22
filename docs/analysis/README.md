> **Naming:** every player in this folder is a handbook P-label (P1, P2, …).
> In-game handles were used here until 2026-08-22 and were removed: this repository
> is public, and the handbook's own anonymization is defeated the moment the same
> per-player numbers appear under both schemes. The handle ↔ P-label key lives with
> David and is deliberately not in this repository. Robots keep their names.

# For the dev chat — handbook update + competitive-balance analysis (Aug 16)

`handbook.html` in this package has a rewritten Part IV ("Reality check") built from all nine
recorded human matches in the Aug 16 bulk download. It replaces the two-match version. Figures
11–14 are new; the underlying numbers are in `analysis/` (CSVs) so nothing has to be re-derived
from the logs by hand. This should replace `docs/handbook.html` (and the figures belong in
`tools/make-handbook.py` if the PDF is regenerated — noting the standing item that its figures
are hand-typed).

## `elims.json` — the 89 eliminations, pre-parsed

Added 2026-08-17 with the v4 notes. Every elimination across the eleven recorded
matches, one record each: `match` (room code), `player` (handbook P-label), `clue`,
`wins` (race wins since entry), `tenure` (clues in the ring), `ot` (was overtime
open), `life` (first or second). It is what `tools/trigger-study.mjs` reads, and
it exists so the wins-vs-tenure question never has to be re-derived from raw logs.

Same rule as the CSVs: **handbook P-labels only, never in-game handles.** Robots
keep their own names (Bront, Dell, Juno, Kip, Marlo, Tibbs) because they are
software, not people.

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
- P1 / P2 / P3 entered 6 of the 8 decided matches and won 5 (P2 3-for-4 overall).
- QPAL: P2+P1 took 125 of 165 races; +P4 = 86%. The other five entrants split 23 races
  over 48 minutes. P9: eliminated at clue 10, revived, out at 66, two races won all night.
- Race win % vs median reaction is monotone across all 18 players with 20+ contested buzzes
  (see `analysis/player-stats.csv` and handbook Figure 13).

Upsets exist (P8 won TQUV from 5th of 7; P7 won FTGL from 3rd of 4), so the format
isn't deterministic — but a bottom-half buzzer's chance is ~1-in-4 overall and ~zero when a
P1-class buzzer is present.

## Candidate levers — measure in the harness first, per house rules

1. **Scale entry and revival stakes with the overtime multiplier.** Also fixes the P26
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


## On the J!ometry population (aggregate only)

The robot model is calibrated on the J!ometry dataset — 3,339 player-games across
1,772 contestants. That is provenance for a model, and nobody in it is identifiable
as one of our players.

**Anything correlating an individual player's broadcast record with their Rumble
results is out**, here and everywhere else, by David's permanent rule of
2026-08-17. A section doing exactly that used to sit here and has been removed;
`charts/tv-vs-rumble.html` is excluded from the handbook for the same reason, and
`test/guides.mjs` asserts the handbook carries none of its phrases.

## Handbook v3 (in this package)

`handbook.html` now covers all eleven matches: estimator diagnosis (accurate except when
returns/latecomers fire), the host-relative clock finding (Fig 13), the balance-lever
simulation results (Fig 16), and the shipped gated comeback with its first-night returns —
including the wrong-stake-in-overtime bug. Labels P11, P12 and P13 were added at
this point; the mapping behind them is not recorded here.

## Also in this package

- `analysis/match-summary.csv` — per-match: predicted vs actual, pace, winner + speed rank.
- `analysis/player-stats.csv` — per-player aggregates across all nine matches.
- The raw logs are in the previously delivered `rumble-feedback-2026-08-16.tar.gz` (with
  FEEDBACK.md covering the UI notes, the P26 write-up, the entrance-music report, and the
  CI #92 e2e-guard flake).
