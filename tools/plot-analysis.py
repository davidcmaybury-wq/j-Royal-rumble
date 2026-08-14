# Regenerates the analysis charts from /tmp/stats.json, which tools/analysis-data.mjs
# writes by running the shipping rules engine. Two steps on purpose: the
# simulations take a few minutes and the plotting is iterated on far more often.
#
#   node tools/analysis-data.mjs && python3 tools/plot-analysis.py
#
import json, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec

d = json.load(open('/tmp/stats.json'))

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

fig = plt.figure(figsize=(15, 21))
gs = GridSpec(5, 2, figure=fig, hspace=0.78, wspace=0.24,
              top=0.930, bottom=0.035, left=0.065, right=0.975)

fig.text(0.065, 0.978, 'J! ROYAL RUMBLE — what the simulations measured',
         fontsize=17, weight='bold', color=CHALK)
fig.text(0.065, 0.963,
         'Every panel is simulated play against the shipping rules engine. '
         '"Spread" is the last third of the draw against the first; 1.00 is even.',
         fontsize=9, color=SLATE)

def tidy(ax, note=None):
    ax.grid(alpha=.28, lw=.6)
    ax.set_axisbelow(True)
    for s in ('top', 'right'):
        ax.spines[s].set_visible(False)
    if note:
        ax.text(0.0, -0.185, note, transform=ax.transAxes, ha='left',
                va='top', fontsize=8, color=SLATE, linespacing=1.5)

# --- 1. the biased shuffle -------------------------------------------------
ax = fig.add_subplot(gs[0, 0])
x = range(1, 11)
ax.bar([i - .2 for i in x], d['biased'], .4, color=ALARM, label='random comparator')
ax.bar([i + .2 for i in x], d['fixed'], .4, color=LIVE, label='Fisher-Yates')
ax.axhline(10, color=BRASS, ls='--', lw=1)
ax.set_title('The measurement bug that reversed an answer')
ax.set_xlabel('draw number'); ax.set_ylabel('win rate %')
ax.set_xticks(list(x)); ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'Draws 1–3 all start together, so they must win equally. sort(() => rng()-0.5)\n'
         'is not a shuffle: it left draw 1 winning 2.5x draw 3, and flipped the\n'
         'ceiling recommendation until it was found.')

# --- 2. ceiling decay ------------------------------------------------------
ax = fig.add_subplot(gs[0, 1])
for n, c in zip(['10', '20', '30'], [AZURE, BRASS, ALARM]):
    xs = [r[0] for r in d['decay'][n]]; ys = [r[1] for r in d['decay'][n]]
    ax.plot(xs, ys, 'o-', color=c, label=f'{n} players', lw=1.6, ms=4)
ax.axhline(1.0, color=CHALK, ls='--', lw=1, alpha=.5)
ax.set_title('Ceiling decay was the cause, not the cure')
ax.set_xlabel('ceiling decay per clue'); ax.set_ylabel('draw spread')
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'The falling ceiling clips whoever is ahead — nearly always an early entrant.\n'
         'Steeper decay made late draws stronger, the opposite of its purpose.\n'
         'Auto decay is now zero while overtime is on.')

# --- 3. longevity bonus ----------------------------------------------------
ax = fig.add_subplot(gs[1, 0])
for n, c in zip(['10', '20', '30'], [AZURE, BRASS, ALARM]):
    xs = [r[0] for r in d['lon'][n]]; ys = [r[1] for r in d['lon'][n]]
    ax.plot(xs, ys, 'o-', color=c, label=f'{n} players', lw=1.6, ms=4)
ax.axhline(1.0, color=CHALK, ls='--', lw=1, alpha=.5)
ax.axvline(500, color=LIVE, lw=8, alpha=.16)
ax.text(500, ax.get_ylim()[1] * .97, ' shipped', color=LIVE, fontsize=8, va='top')
ax.set_title('Longevity bonus: +500 every 10 clues')
ax.set_xlabel('bonus size'); ax.set_ylabel('draw spread')
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'Paying for survival rather than taking from leaders. 500 lands on even\n'
         'across every field size; 1000 overshoots and hands the game to early\n'
         'draws instead — the old problem mirrored.')

# --- 4. ceiling by field size ---------------------------------------------
ax = fig.add_subplot(gs[1, 1])
for n, c in zip(['10', '16', '20', '24', '30'],
                [AZURE, LIVE, BRASS, '#C4457E', ALARM]):
    xs = [r[0] for r in d['ceil'][n]]; ys = [r[1] for r in d['ceil'][n]]
    ax.plot(xs, ys, 'o-', color=c, label=f'{n}', lw=1.6, ms=4)
ax.axhline(1.0, color=CHALK, ls='--', lw=1, alpha=.5)
ax.set_title('The ceiling scales with the field')
ax.set_xlabel('ceiling'); ax.set_ylabel('draw spread')
ax.legend(fontsize=7.5, labelcolor=SLATE, ncol=3, title='players',
          title_fontproperties={'size': 7}, loc='upper right')
tidy(ax, 'A low ceiling favours late draws by clipping the leaders an early entrant\n'
         'worked to become. This was jumping at 25 players and confounding every\n'
         'earlier measurement — it made 24 look far worse than 30.')

# --- 5. entry interval: the trade-off -------------------------------------
ax = fig.add_subplot(gs[2, 0])
for n, c in zip(['10', '16', '20', '30'], [AZURE, LIVE, BRASS, ALARM]):
    xs = [r[0] for r in d['iv'][n]]; ys = [r[1] for r in d['iv'][n]]
    ax.plot(xs, ys, 'o-', color=c, label=f'{n} players', lw=1.6, ms=4)
ax.axhline(1.15, color=ALARM, ls=':', lw=1.2)
ax.text(1.2, 1.20, 'warning threshold', color=ALARM, fontsize=7.5)
ax.set_title('Longer matches are less fair, not more')
ax.set_xlabel('entry interval (clues between entrants)'); ax.set_ylabel('draw spread')
ax.set_yscale('log'); ax.set_yticks([1, 1.5, 2, 3, 4])
ax.set_yticklabels(['1.0', '1.5', '2.0', '3.0', '4.0'])
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'Slow entries mean the last players walk into a worn-down field. Log scale:\n'
         'at the extreme a late draw wins four times its share. The setup page now\n'
         'warns in red past 1.15 without blocking.')

# --- 6. skill needs length -------------------------------------------------
ax = fig.add_subplot(gs[2, 1])
for n, c in zip(['10', '16', '20', '30'], [AZURE, LIVE, BRASS, ALARM]):
    xs = [r[2] for r in d['iv'][n]]; ys = [r[3] for r in d['iv'][n]]
    o = sorted(zip(xs, ys))
    ax.plot([p[0] for p in o], [p[1] for p in o], 'o-', color=c,
            label=f'{n} players', lw=1.6, ms=4)
ax.axvline(15, color=BRASS, ls=':', lw=1.2)
ax.text(16, ax.get_ylim()[0] + 3, 'skill settles', color=BRASS, fontsize=7.5)
ax.set_title('...but short matches are random')
ax.set_xlabel('match length (minutes)')
ax.set_ylabel('one of the 3 strongest wins, %')
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'The other half of the trade-off. Below about fifteen minutes the strongest\n'
         'players stop showing; past twenty-five the gain flattens while fairness\n'
         'keeps degrading. The window between is what the setup page recommends.')

# --- 7-9. win distribution -------------------------------------------------
for i, n in enumerate(['10', '20', '30']):
    ax = fig.add_subplot(gs[3, 0] if i == 0 else (gs[3, 1] if i == 1 else gs[4, 0]))
    pct = d['dist'][n]['pct']; fair = d['dist'][n]['fair']
    cols = [ALARM if p > fair * 1.25 else (AZURE if p < fair * 0.75 else BRASS)
            for p in pct]
    ax.bar(range(1, int(n) + 1), pct, color=cols, width=.75)
    ax.axhline(fair, color=CHALK, ls='--', lw=1)
    ax.text(int(n) * .99, fair * 1.06, 'fair share', color=CHALK,
            fontsize=7.5, ha='right')
    ax.set_title(f'Where winners enter — {n} players')
    ax.set_xlabel('draw number'); ax.set_ylabel('win rate %')
    step = 1 if int(n) <= 10 else (2 if int(n) <= 20 else 3)
    ax.set_xticks(range(step, int(n) + 1, step))
    tidy(ax, f'{6000} matches, all players equal, shipping rules. '
             f'Spread {d["dist"][n]["spread"]:.2f}x.')

# --- 10. elite player ------------------------------------------------------
ax = fig.add_subplot(gs[4, 1])
for n, c in zip(['20', '30'], [BRASS, ALARM]):
    xs = [r[0] for r in d['elite'][n]]; ys = [r[1] for r in d['elite'][n]]
    ax.plot(xs, ys, 'o-', color=c, label=f'{n} players', lw=1.8, ms=5)
    avg = 100 / int(n)
    ax.axhline(avg, color=c, ls=':', lw=1.2, alpha=.75)
    ax.text(int(n) * 0.99, avg + 0.35, f'average player in a {n} field',
            color=c, fontsize=7.2, ha='right')
ax.set_ylim(0, 20)
ax.set_title('A strong player wins from anywhere')
ax.set_xlabel('their draw number'); ax.set_ylabel('their win rate %')
ax.legend(fontsize=7.5, labelcolor=SLATE)
tidy(ax, 'One player at +15 accuracy, everybody else average. Dotted lines are what\n'
         'an average player wins. Roughly 3.5x their share wherever they start —\n'
         'what changes is tenure, not the result.')

plt.savefig('/mnt/user-data/outputs/rumble-analysis.png',
            facecolor=INK, bbox_inches='tight', pad_inches=0.35)
print('saved')
