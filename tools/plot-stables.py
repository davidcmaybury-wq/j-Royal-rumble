import json, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec

d = json.load(open('/tmp/stabdata.json'))

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

fig = plt.figure(figsize=(15, 11))
gs = GridSpec(2, 2, figure=fig, hspace=0.62, wspace=0.22,
              top=0.900, bottom=0.06, left=0.065, right=0.975)

fig.text(0.065, 0.960, 'STABLES — can a pack hold off a strong player?',
         fontsize=17, weight='bold', color=CHALK)
fig.text(0.065, 0.933,
         'One elite in a field of normies, playing the real bot model. '
         '2,500 simulated matches per point. A stable may hold at most half the ring.',
         fontsize=9, color=SLATE)

def tidy(ax, note=None):
    ax.grid(alpha=.28, lw=.6); ax.set_axisbelow(True)
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    if note:
        ax.text(0.0, -0.20, note, transform=ax.transAxes, ha='left', va='top',
                fontsize=8, color=SLATE, linespacing=1.5)

FIELDS = d['fields']
COLS = {6: AZURE, 8: LIVE, 10: BRASS, 12: ALARM}

# --- 1. the new rule, every field size ------------------------------------
ax = fig.add_subplot(gs[0, 0])
for f in FIELDS:
    ys = d['focus'][str(f)]
    xs = [i for i, y in enumerate(ys) if y is not None]
    vs = [ys[i] for i in xs]
    ax.plot(xs, vs, 'o-', color=COLS[f], lw=1.7, ms=4, label=f'{f} players')
    cap = d['cap'][str(f)]
    ax.plot([cap], [ys[cap]], 'o', color=COLS[f], ms=11, mfc='none', mew=2)
ax.set_title('A bigger pack helps — but never enough')
ax.set_xlabel('normies banded together in one stable')
ax.set_ylabel('elite win rate %')
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'Rings mark the largest pack the half-the-ring cap allows. Every extra\n'
         'member helps, steadily, and none of it closes the gap: the pack can only\n'
         'use its advantage on clues it wins, and there are not many of those.')

# --- 2. new rule against old ----------------------------------------------
ax = fig.add_subplot(gs[0, 1])
w = 0.36
xs = range(len(FIELDS))
none = [d['focus'][str(f)][0] for f in FIELDS]
oldc = [d['old'][str(f)][d['cap'][str(f)]] for f in FIELDS]
newc = [d['focus'][str(f)][d['cap'][str(f)]] for f in FIELDS]
ax.bar([x - w / 2 for x in xs], oldc, w, color=SLATE, label='pot shrinks (old)')
ax.bar([x + w / 2 for x in xs], newc, w, color=BRASS, label='loaded on outsiders (new)')
for i, f in enumerate(FIELDS):
    ax.plot([i - w, i + w], [none[i], none[i]], color=ALARM, lw=1.6, ls='--')
ax.text(len(FIELDS) - 1 + w, none[-1] + 1.4, 'no stable at all', color=ALARM, fontsize=7.5, ha='right')
ax.set_title('The old rule did almost nothing')
ax.set_xticks(list(xs)); ax.set_xticklabels([f'{f} players' for f in FIELDS])
ax.set_ylabel('elite win rate %'); ax.set_ylim(55, 100)
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'At the largest legal pack. Letting the pot shrink protected the stable and\n'
         'did nothing to anybody else; loading the teammates\u2019 share onto the\n'
         'outsiders is what turned it into a mechanic rather than a no-op.')

# --- 3. how much each extra member is worth -------------------------------
ax = fig.add_subplot(gs[1, 0])
for f in FIELDS:
    ys = d['focus'][str(f)]
    base = ys[0]
    xs2 = [i for i, y in enumerate(ys) if y is not None and i > 0]
    vs2 = [base - ys[i] for i in xs2]
    ax.plot(xs2, vs2, 'o-', color=COLS[f], lw=1.7, ms=4, label=f'{f} players')
    cap = d['cap'][str(f)]
    ax.plot([cap], [base - ys[cap]], 'o', color=COLS[f], ms=11, mfc='none', mew=2)
ax.set_title('Points taken off the elite, per extra ally')
ax.set_xlabel('normies banded together')
ax.set_ylabel('percentage points removed')
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'The same data read as a gain rather than a level. It is monotonic — every\n'
         'ally is worth something — which the old rule was not. Ten points is the\n'
         'most any legal pack achieves, against a starting 73 to 94.')

# --- 4. it depends who you are up against ---------------------------------
ax = fig.add_subplot(gs[1, 1])
lv = ['champ', 'superchamp', 'elite']
nice = ['champ', 'superchamp', 'elite']
nones = [d['levels'][k]['none'] for k in lv]
caps = [d['levels'][k]['cap'] for k in lv]
xs3 = range(len(lv))
ax.bar([x - w / 2 for x in xs3], nones, w, color=SLATE, label='alone against them')
ax.bar([x + w / 2 for x in xs3], caps, w, color=BRASS, label='pack of 5')
for i in xs3:
    ax.annotate(f'\u2212{nones[i] - caps[i]:.1f}', (i + w / 2, caps[i] + 1.2),
                ha='center', color=BRASS, fontsize=8.5)
ax.axhline(10, color=CHALK, ls='--', lw=1, alpha=.6)
ax.text(len(lv) - 1 + w, 11.5, 'a fair share of ten players', color=CHALK, fontsize=7.5, ha='right')
ax.set_title('Ten players: how strong is the one you are ganging up on?')
ax.set_xticks(list(xs3)); ax.set_xticklabels(nice)
ax.set_ylabel('their win rate %')
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'The pack removes roughly the same five points whoever it faces, so it\n'
         'matters most against somebody who was not running away with it anyway.\n'
         'Ganging up directly on one player is what targeting is for.')

plt.savefig('/mnt/user-data/outputs/stables-analysis.png',
            facecolor=INK, bbox_inches='tight', pad_inches=0.35)
print('saved')
