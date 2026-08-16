import json, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec

d = json.load(open('/tmp/entrypace.json'))

INK, PANEL, LINE = '#0A0E1C', '#131A30', '#2A3556'
CHALK, SLATE, BRASS = '#EEEBE1', '#7C88AB', '#D6A93F'
ALARM, LIVE, AZURE = '#E24A3C', '#3FA98C', '#4F7FD1'

plt.rcParams.update({
    'figure.facecolor': INK, 'axes.facecolor': PANEL,
    'axes.edgecolor': LINE, 'axes.labelcolor': SLATE,
    'text.color': CHALK, 'xtick.color': SLATE, 'ytick.color': SLATE,
    'grid.color': LINE, 'font.size': 8.5, 'axes.titlesize': 10,
    'axes.titleweight': 'bold', 'axes.titlecolor': CHALK,
    'legend.frameon': False, 'figure.dpi': 130,
})

FIELDS = [4, 6, 8, 12]
COLS = {4: AZURE, 6: LIVE, 8: BRASS, 12: ALARM}
IVS = d['ivs']

fig = plt.figure(figsize=(15, 10.5))
gs = GridSpec(2, 2, figure=fig, hspace=0.60, wspace=0.22,
              top=0.895, bottom=0.07, left=0.065, right=0.975)

fig.text(0.065, 0.955, 'HOW FAST SHOULD PEOPLE BE FED IN?',
         fontsize=17, weight='bold', color=CHALK)
fig.text(0.065, 0.928,
         'Entry interval against fairness, length and pacing. 2,500 simulated '
         'matches per point, playing the real bot model.',
         fontsize=9, color=SLATE)

def tidy(ax, note=None):
    ax.grid(alpha=.28, lw=.6); ax.set_axisbelow(True)
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    if note:
        ax.text(0.0, -0.19, note, transform=ax.transAxes, ha='left', va='top',
                fontsize=8, color=SLATE, linespacing=1.5)

# --- 1. fairness -----------------------------------------------------------
ax = fig.add_subplot(gs[0, 0])
for f in FIELDS:
    ys = [r['backHalf'] for r in d['rows'][str(f)]]
    ax.plot(IVS, ys, 'o-', color=COLS[f], lw=1.7, ms=4, label=f'{f} players')
ax.axhline(50, color=CHALK, ls='--', lw=1, alpha=.6)
ax.text(IVS[-1], 50.7, 'an even draw', color=CHALK, fontsize=7.5, ha='right')
ax.axvspan(3, 10, color=LIVE, alpha=.07)
ax.text(5.4, 44.0, 'what auto now picks', color=LIVE, fontsize=7.5, ha='center')
ax.set_title('Long gaps are only dangerous in a big field')
ax.set_xlabel('clues between entries')
ax.set_ylabel('back half of the draw, % of wins')
ax.legend(fontsize=7.5, labelcolor=SLATE, loc='upper left')
tidy(ax, 'Below 10 every field size sits within a few points of even. Above it, twelve\n'
         'players drift badly: at a 20-clue gap the back half takes 66% of the wins,\n'
         'because the last entrant arrives against people who have compounded all match.')

# --- 2. what it costs in length -------------------------------------------
ax = fig.add_subplot(gs[0, 1])
for f in FIELDS:
    ys = [r['clues'] for r in d['rows'][str(f)]]
    ax.plot(IVS, ys, 'o-', color=COLS[f], lw=1.7, ms=4, label=f'{f} players')
ax.axvspan(3, 10, color=LIVE, alpha=.07)
ax.set_title('The interval is really a length dial')
ax.set_xlabel('clues between entries')
ax.set_ylabel('median clues played')
ax.legend(fontsize=7.5, labelcolor=SLATE, loc='upper left')
tidy(ax, 'This is the real effect. Six players at a 5-clue gap play 40 clues; at 20 they\n'
         'play 80. Feeding people in faster does not make the match unfair — it makes\n'
         'it shorter, which is what a host asking for a fast game actually wants.')

# --- 3. when the queue finally empties -------------------------------------
ax = fig.add_subplot(gs[1, 0])
for f in FIELDS:
    ys = [r['lastInAt'] for r in d['rows'][str(f)]]
    ax.plot(IVS, ys, 'o-', color=COLS[f], lw=1.7, ms=4, label=f'{f} players')
ax.axhline(50, color=CHALK, ls='--', lw=1, alpha=.5)
ax.axvspan(3, 10, color=LIVE, alpha=.07)
ax.set_title('How much of the match is spent waiting to play')
ax.set_xlabel('clues between entries')
ax.set_ylabel('last entrant arrives, % through the match')
ax.legend(fontsize=7.5, labelcolor=SLATE, loc='upper left')
tidy(ax, 'The old 15-clue cap put the last twelve-player entrant 86% of the way in —\n'
         'most of the night spent watching. It is also why overtime never opened:\n'
         'it cannot start until the queue is empty.')

# --- 4. the old cap against the new ---------------------------------------
ax = fig.add_subplot(gs[1, 1])
w = 0.35
xs = range(len(FIELDS))
def at(f, iv):
    return next(r for r in d['rows'][str(f)] if r['iv'] == iv)
old = [at(f, 15)['backHalf'] for f in FIELDS]
new = [at(f, 10)['backHalf'] for f in FIELDS]
ax.bar([x - w/2 for x in xs], old, w, color=SLATE, label='every 15 (old cap)')
ax.bar([x + w/2 for x in xs], new, w, color=BRASS, label='every 10 (new cap)')
ax.axhline(50, color=CHALK, ls='--', lw=1, alpha=.6)
for i, f in enumerate(FIELDS):
    ax.annotate(f"{at(f,15)['clues']}", (i - w/2, old[i] + 0.6), ha='center',
                color=SLATE, fontsize=7.5)
    ax.annotate(f"{at(f,8)['clues']}", (i + w/2, new[i] + 0.6), ha='center',
                color=BRASS, fontsize=7.5)
ax.set_title('The change, and what it costs')
ax.set_xticks(list(xs)); ax.set_xticklabels([f'{f} players' for f in FIELDS])
ax.set_ylabel('back half of the draw, % of wins')
ax.set_ylim(40, 62)
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'Numbers above each bar are the median clues played. Fairness is unchanged or\n'
         'slightly better at every size; matches get materially shorter. The twelve-player\n'
         'case improves most, from 56.5% back-half wins to 51.7%.')

plt.savefig('/mnt/user-data/outputs/entry-pace.png',
            facecolor=INK, bbox_inches='tight', pad_inches=0.35)
print('saved')
