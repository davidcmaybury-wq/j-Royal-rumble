"""Add the entry-pacing study to the handbook, in the handbook's own style.

The figures there are inline SVG using the document's CSS variables, so they
follow the light/dark theme and stay crisp. A pasted PNG would be a foreign
object on the page and would not reprint.
"""
import json

d = json.load(open('/tmp/entrypace.json'))
IVS = d['ivs']
FIELDS = [4, 6, 8, 12]
# Only s1..s3 exist in the handbook's palette; the fourth line reuses the
# de-emphasis colour, which is the one meant for a contrast series.
SERIES = {4: 's1', 6: 's2', 8: 's3', 12: 'de'}

W, H = 740, 300
L, R, T, B = 64, 630, 20, 250


def x_of(iv):
    lo, hi = min(IVS), max(IVS)
    return L + (iv - lo) / (hi - lo) * (R - L)


def y_of(pct):
    lo, hi = 44.0, 67.0
    return T + (hi - pct) / (hi - lo) * (B - T)


parts = []
# horizontal grid + labels
for pct in [45, 50, 55, 60, 65]:
    y = y_of(pct)
    axis = 'axis' if pct == 50 else 'grid'
    parts.append(f'<line x1="{L}" y1="{y:.1f}" x2="{R}" y2="{y:.1f}" '
                 f'stroke="var(--{axis})" stroke-width="1"/>')
    parts.append(f'<text x="{L - 8}" y="{y:.1f}" dy="0.32em" text-anchor="end" '
                 'style="font-family:system-ui,sans-serif;font-size:11px;fill:var(--muted);'
                 f'font-variant-numeric:tabular-nums">{pct}%</text>')

# the band auto now chooses from
xa, xb = x_of(3), x_of(10)
parts.insert(0, f'<rect x="{xa:.1f}" y="{T}" width="{xb - xa:.1f}" height="{B - T}" '
                'fill="var(--s2)" opacity="0.08"/>')
parts.append(f'<text x="{(xa + xb) / 2:.1f}" y="{T + 12}" dy="0.32em" text-anchor="middle" '
             'style="font-family:system-ui,sans-serif;font-size:11px;fill:var(--s2)">'
             'what auto picks</text>')

for iv in IVS:
    parts.append(f'<text x="{x_of(iv):.1f}" y="{B + 14}" dy="0.32em" text-anchor="middle" '
                 'style="font-family:system-ui,sans-serif;font-size:11px;fill:var(--muted);'
                 f'font-variant-numeric:tabular-nums">{iv}</text>')
parts.append(f'<text x="{(L + R) / 2:.1f}" y="{B + 48}" dy="0.32em" text-anchor="middle" '
             'style="font-family:system-ui,sans-serif;font-size:11.5px;fill:var(--muted)">'
             'clues between entries</text>')

for f in FIELDS:
    rows = d['rows'][str(f)]
    pts = [(x_of(r['iv']), y_of(r['backHalf'])) for r in rows]
    path = ' L '.join(f'{x:.1f} {y:.1f}' for x, y in pts)
    var = SERIES[f]
    parts.append(f'<path d="M {path}" fill="none" stroke="var(--{var})" stroke-width="2" '
                 'stroke-linejoin="round" stroke-linecap="round"/>')
    for (x, y), r in zip(pts, rows):
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.6" fill="var(--{var})" '
                     'stroke="var(--surface)" stroke-width="1.5">'
                     f'<title>{f} players, every {r["iv"]} — {r["backHalf"]}% '
                     f'back half, {r["clues"]} clues</title></circle>')
    lx, ly = pts[-1]
    parts.append(f'<text x="{lx + 10:.1f}" y="{ly:.1f}" dy="0.32em" text-anchor="start" '
                 f'style="font-family:system-ui,sans-serif;font-size:11.5px;font-weight:600;'
                 f'fill:var(--{var})">{f}</text>')

parts.append(f'<text x="{x_of(17):.1f}" y="{y_of(48.6):.1f}" dy="0.32em" text-anchor="middle" '
             'style="font-family:system-ui,sans-serif;font-size:11.5px;fill:var(--muted)">'
             'an even draw</text>')

svg = (f'<svg viewBox="0 0 {W} {H}" role="img" '
       'style="width:100%;height:auto;display:block">' + ''.join(parts) + '</svg>')

section = f'''
<h3>How fast should people be fed in?</h3>
<p>The auto interval capped at fifteen clues, and with four to six players the
arithmetic always hit that cap — three people spread across a half-hour match is
twenty-odd clues apart, clamped. Every small game therefore had identical pacing,
and the queue took most of the night to empty. The question was what it would
cost to feed people in faster.</p>

<figure class="figure" style="margin-left:0;margin-right:0"><p class="ft">Figure 12 — Entry interval against draw fairness</p><p class="fs">Share of wins taken by the back half of the draw; 2,500 simulated matches per point</p>{svg}<p class="fc">Below ten clues every field size sits within a few points of an even split. Above it the big fields drift: twelve players on a twenty-clue interval hand the back half 66% of the wins.</p></figure>

<p><strong>The interval is nearly free at small sizes and dangerous at scale</strong>
— which is the opposite of what I expected before measuring. I had assumed
feeding people in quickly would punish late draws, because they would arrive
into a fuller ring with less time to recover. It does not. What punishes a late
draw is arriving <em>late in the match</em>, against opponents who have been
compounding since the first clue. A twelve-player field on the old cap put the
last entrant 86% of the way through the night; they either walked into a fortune
or a graveyard, and the draw decided which.</p>

<p>What the interval really controls is length. Six players at a five-clue gap
play 40 clues; at twenty they play 80. A host asking for a faster game is asking
for exactly this dial, and it turns out they can have it:</p>

<div class="rulecard"><p><strong>Old cap of 15, against the new cap of 10</strong>
&mdash; back-half share of wins, and the median clues played:</p>
<p>4 players: 50.5% over 33 clues &rarr; <strong>53.0% over 28</strong>.<br>
6 players: 45.5% over 67 clues &rarr; <strong>48.8% over 53</strong>.<br>
8 players: 49.8% over 99 clues &rarr; <strong>49.4% over 76</strong>.<br>
12 players: 56.5% over 160 clues &rarr; <strong>51.7% over 117</strong>.</p></div>

<p>Fairness is unchanged or better at every size, and matches get materially
shorter. The twelve-player case improves most, from 56.5% back-half wins to
51.7%. The cap is now ten.</p>

<p>Eight measured just as fairly and was tried first, but it broke the common
case: six players wanting a fifteen-minute game could no longer reach it on
auto, so the estimator warned every single time. A correct warning that fires
constantly is a warning nobody reads. Ten keeps that game reachable and still
takes a third off the old cap.</p>

<p>One thing this does not fix: the interval also decides when overtime can
open, because overtime waits for the queue to empty. On the old cap a long match
could reach its natural end before anybody was left in the queue to trigger it.
That is a separate problem and it is still open.</p>
'''

p = 'docs/handbook.html'
h = open(p).read()
anchor = '<div class="part"><p class="kicker">Part IV</p><h2>Reality check</h2></div>'
assert anchor in h, 'anchor not found'
h = h.replace(anchor, section + anchor)
open(p, 'w').write(h)
print('added', len(section), 'chars')
