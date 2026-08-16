#!/usr/bin/env python3
"""SUPERSEDED — do not run this expecting the current handbook.

docs/handbook.html is the handbook now, written and maintained by David and
served at /handbook. This script builds a PDF whose figures are typed in here by
hand rather than read from the code, so it drifted from the game, and then from
the HTML as well. Two handbooks that disagree are worse than one.

Kept only because the prose in it records why several decisions were made. If
you want a PDF, print /handbook.
"""

import os, subprocess
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether, PageBreak)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'docs', 'j-royal-rumble-handbook.pdf')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

INK    = colors.HexColor('#0A0E1C')
PANEL  = colors.HexColor('#141B33')
LINE   = colors.HexColor('#C9CEDD')
BRASS  = colors.HexColor('#9A6E1C')
BLOOD  = colors.HexColor('#A8201C')
SLATE  = colors.HexColor('#5A6480')
PAPER  = colors.HexColor('#FBFAF6')

# Anton and IBM Plex were fetched for the logo work; reuse them here so the
# document and the game look like the same thing.
FONTS = os.path.join(os.path.expanduser('~'), '.fonts')
def try_font(name, filename):
    path = os.path.join(FONTS, filename)
    if os.path.exists(path):
        pdfmetrics.registerFont(TTFont(name, path))
        return name
    return None

DISPLAY = try_font('Anton', 'Anton-Regular.ttf') or 'Helvetica-Bold'
SCRIPT  = try_font('Marker', 'PermanentMarker-Regular.ttf') or 'Helvetica-Bold'
BODY    = 'Helvetica'
BOLD    = 'Helvetica-Bold'
MONO    = 'Courier'

S = {}
S['title']   = ParagraphStyle('title', fontName=DISPLAY, fontSize=64, leading=60,
                              textColor=BRASS, spaceAfter=0)
S['sub']     = ParagraphStyle('sub', fontName=SCRIPT, fontSize=38, leading=44,
                              textColor=BLOOD, spaceAfter=6)
S['kicker']  = ParagraphStyle('kicker', fontName=BODY, fontSize=9.5, leading=13,
                              textColor=SLATE, spaceAfter=18)
S['h1']      = ParagraphStyle('h1', fontName=DISPLAY, fontSize=19, leading=23,
                              textColor=INK, spaceBefore=16, spaceAfter=7)
S['h2']      = ParagraphStyle('h2', fontName=BOLD, fontSize=11.5, leading=15,
                              textColor=BRASS, spaceBefore=12, spaceAfter=4)
S['body']    = ParagraphStyle('body', fontName=BODY, fontSize=10, leading=14.6,
                              textColor=INK, spaceAfter=7, alignment=TA_LEFT)
S['lede']    = ParagraphStyle('lede', fontName=BODY, fontSize=11.5, leading=16.5,
                              textColor=colors.HexColor('#2A3556'), spaceAfter=10)
S['small']   = ParagraphStyle('small', fontName=BODY, fontSize=8.6, leading=12,
                              textColor=SLATE, spaceAfter=6)
S['bullet']  = ParagraphStyle('bullet', parent=S['body'], leftIndent=13,
                              bulletIndent=3, spaceAfter=3.5)
S['pull']    = ParagraphStyle('pull', fontName=BODY, fontSize=10.5, leading=15.5,
                              textColor=INK, leftIndent=11, spaceBefore=5, spaceAfter=9,
                              borderPadding=(7, 0, 7, 9), borderColor=BRASS, borderWidth=0)
S['caption'] = ParagraphStyle('caption', fontName=BODY, fontSize=8.4, leading=11.4,
                              textColor=SLATE, spaceBefore=3, spaceAfter=12)

def P(t, s='body'): return Paragraph(t, S[s])
def H(title, *paras):
    """A heading glued to the start of its section, so no heading is ever
    stranded at the foot of a page."""
    return KeepTogether([Paragraph(title, S['h1'])] + list(paras))
def B(t): return Paragraph(t, S['bullet'], bulletText='\u2022')

def table(data, widths, align=None, head=True):
    t = Table(data, colWidths=widths, hAlign='LEFT')
    st = [
        ('FONT', (0, 0), (-1, -1), BODY, 9),
        ('TEXTCOLOR', (0, 0), (-1, -1), INK),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, colors.HexColor('#E2E0D8')),
    ]
    if head:
        st += [('FONT', (0, 0), (-1, 0), BOLD, 8.2),
               ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
               ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2A3556')),
               ('TOPPADDING', (0, 0), (-1, 0), 6),
               ('BOTTOMPADDING', (0, 0), (-1, 0), 6)]
    for col in (align or []):
        st.append(('ALIGN', (col, 0), (col, -1), 'RIGHT'))
    t.setStyle(TableStyle(st))
    return t

def callout(title, body_text):
    inner = [[Paragraph(f'<b>{title}</b>', S['h2']), ],
             [Paragraph(body_text, S['body'])]]
    t = Table(inner, colWidths=[152 * mm], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F3F1E8')),
        ('LINEBEFORE', (0, 0), (0, -1), 2.2, BRASS),
        ('LEFTPADDING', (0, 0), (-1, -1), 11),
        ('RIGHTPADDING', (0, 0), (-1, -1), 11),
        ('TOPPADDING', (0, 0), (-1, 0), 7),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 8),
    ]))
    return KeepTogether([Spacer(1, 4), t, Spacer(1, 10)])

# ---------------------------------------------------------------- page frame
def decorate(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, w, h, stroke=0, fill=1)
    if doc.page > 1:
        canvas.setFillColor(BRASS)
        canvas.setFont(DISPLAY, 11)
        canvas.drawString(20 * mm, h - 13 * mm, 'J!')
        canvas.setFillColor(BLOOD)
        canvas.setFont(SCRIPT, 9.5)
        canvas.drawString(27 * mm, h - 13 * mm, 'Royal Rumble')
        canvas.setStrokeColor(colors.HexColor('#DDDACE'))
        canvas.setLineWidth(0.5)
        canvas.line(20 * mm, h - 15.5 * mm, w - 20 * mm, h - 15.5 * mm)
    canvas.setFillColor(SLATE)
    canvas.setFont(BODY, 8)
    canvas.drawRightString(w - 20 * mm, 12 * mm, str(doc.page))
    canvas.drawString(20 * mm, 12 * mm, 'Design and rules')
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=22 * mm, bottomMargin=20 * mm,
                      title='J! Royal Rumble — design and rules',
                      author='Built for TTG')
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=decorate)])

s = []
A = s.append

# ---------------------------------------------------------------- cover
A(Spacer(1, 24 * mm))
A(P('J!', 'title'))
A(P('Royal Rumble', 'sub'))
A(P('DESIGN AND RULES', 'kicker'))
A(P('A thirty-player elimination trivia format built on the Jeopardy! clue '
    'structure and the entry mechanic of the 1980s Royal Rumble. This document '
    'covers the rules in full, the optional mechanics, and the design work '
    'underneath &mdash; including the two problems that nearly broke the format '
    'and what the numbers said about fixing them.', 'lede'))
A(Spacer(1, 4))
A(P('Every figure here comes from the simulator or from a recorded match. '
    'None of it is illustrative.', 'small'))
A(Spacer(1, 8))

A(P('THE SHAPE OF IT', 'h1'))
A(P('Three players start. The rest wait in draw order and enter one at a time as '
    'the match runs. Answer a clue correctly and every other player in the ring '
    'pays you its value. Miss and you pay, and the clue goes back out to everyone '
    'else. Fall below zero and you are gone. The last player standing wins, and '
    'nothing else counts as a result.'))
A(P('A full field takes about half an hour. The board is six Jeopardy! '
    'categories at a time, drawn from an archive of 47,000 categories or from '
    'boards written in house, in whatever ratio the host sets.'))

A(callout('The one number that matters',
          'Under the obvious scoring rule &mdash; a correct answer is worth the '
          'clue value, the way it works on television &mdash; the player who drew '
          'the last entry number won <b>100%</b> of simulated matches. Not most. '
          'All of them. Everything in the section on scoring exists because of '
          'that number.'))

A(PageBreak())

# ---------------------------------------------------------------- core rules
A(H('THE RULES', P('The board', 'h2')))
A(P('Six categories are live at once, five clues each, $100 to $500 by row. Row '
    'position sets the value regardless of where the category came from &mdash; a '
    'category lifted from a Double Jeopardy round plays at the same values as any '
    'other, and is simply harder. When a category is used up it is replaced '
    'immediately, so the board never runs out.'))
A(P('The host can reroll any category before or during play. Three rerolls of the '
    'same category retires it permanently.'))

A(P('Entering', 'h2'))
A(P('Every player draws an entry number before the match. Numbers one to three '
    'open the match; the rest enter on a fixed clue interval, which the host sets '
    'or lets the app scale to the size of the field. Each entrant walks in with '
    'the same stake.'))

A(P('Scoring', 'h2'))
A(P('<b>Correct.</b> Every other player in the ring pays you the clue value. You '
    'collect all of it. With five in the ring a $500 clue is $2,000 to you and '
    '$500 from each of the other four; heads-up it is worth $500.'))
A(P('<b>Wrong.</b> You lose the value and you are locked out of that clue. Nobody '
    'else is affected by your miss.'))
A(P('<b>The re-toss.</b> A missed clue goes back out as a genuinely fresh race: '
    'the buzzers reopen for everybody still eligible, including anyone who did '
    'not attempt it the first time. If somebody else converts it you pay them '
    'along with everyone else, so a miss followed by a conversion costs twice.'))
A(P('<b>Nobody gets it.</b> Every player in the ring loses half the value. Passing '
    'is not free.'))

A(P('Elimination', 'h2'))
A(P('Below zero and you are out; exactly zero survives. If one answer sinks '
    'several players they all go together, and the player whose answer did it is '
    'credited with a <b>toss out</b> for each. If a clue would wipe the entire '
    'ring, the highest score survives.'))

A(P('The ceiling', 'h2'))
A(P('There is a maximum score, and it falls across the match. Anything above it is '
    'clipped. It never drops below the amount a new entrant carries in, so nobody '
    'arrives already capped.'))

A(P('Clearing the field', 'h2'))
A(P('Eliminate everyone in the ring while players are still queued and you take a '
    'bonus equal to every clue left on the board. The board is replaced entirely '
    'and two fresh players enter rather than one.'))

A(P('Buzzing', 'h2'))
A(P('The host reads the clue, then arms the buzzers. Fastest reaction takes it, '
    'one buzz per player per race. Buzzing before the lights costs a 250 '
    'millisecond lockout, and the penalty runs even if the buzzers open while it '
    'is being served.'))
A(P('Players still in the queue, and players already eliminated, can buzz on every '
    'clue. It does not score and cannot affect the match, but it reports their '
    'time and where they would have placed against the live field. Arriving with '
    'your timing already calibrated is a real advantage.'))

A(callout('Times under 150 milliseconds are normal',
          'Strong players do not react to the lights. They learn the rhythm of the '
          "host's read and time the buzzer to land the instant it opens. A "
          'perfectly judged buzz reads 0.0. In the first recorded match, the two '
          'active players buzzed a median of 197 and 207 milliseconds with best '
          'times of 8 and 17 &mdash; and one of them jumped the lights on a third '
          'of his presses. That is the trade the lockout exists to price.'))

# ---------------------------------------------------------------- the maths
A(H('WHY THE SCORING WORKS THIS WAY', P('The draw-position problem', 'h2')))
A(P('The natural rule is the televised one: a correct answer is worth the clue '
    'value to the player who gets it, and the format supplies the drain by taking '
    'that value off everyone else. Simulated across four thousand thirty-player '
    'matches, that rule produced this:'))

A(table([
    ['Draw numbers', 'Share of wins', 'Fair share'],
    ['1 \u2013 10', '0.0%', '33.3%'],
    ['11 \u2013 20', '0.0%', '33.3%'],
    ['21 \u2013 25', '3.1%', '16.7%'],
    ['26 \u2013 30', '96.9%', '16.7%'],
    ['\u2014 of which draw 30 alone', '46.7%', '3.3%'],
], [58 * mm, 34 * mm, 30 * mm], align=[1, 2]))
A(P('Four thousand simulated matches. Draws 1 through 21 did not win once.', 'caption'))

A(P('The cause is arithmetic rather than luck. Under flat scoring a player\u2019s '
    'expected change per clue is V(2&nbsp;&minus;&nbsp;P)/P, where V is the clue '
    'value and P the number of players in the ring. For any P above two that is '
    'negative for everybody. Nobody can accumulate; the whole field drifts '
    'downward at roughly the same rate. Across an entire thirty-player match the '
    'highest score anyone reached was around 5,950 against a 5,000 starting '
    'stake &mdash; so the score ceiling never bound, the field-clear bonus almost '
    'never triggered, and a fresh entrant arriving on 5,000 simply outlasted '
    'incumbents who had been grinding down for half an hour.'))

A(P('The fix: collect from each opponent', 'h2'))
A(P('The loss side is left alone &mdash; it is what makes the format an '
    'elimination game. The gain side changes: the answerer collects the clue value '
    'from <i>every</i> opponent rather than once. Elimination pace is untouched, '
    'but a strong player can now build a wall, which is what allows an early '
    'entrant to survive long enough to face the last numbers.'))
A(P('It is also the more natural sentence to say out loud at the table: '
    '<i>everyone else pays you.</i>'))

A(P('The ceiling, and why it falls', 'h2'))
A(P('Letting players accumulate reintroduces a different problem: a runaway leader. '
    'A fixed ceiling solves that but hands the advantage straight back to the late '
    'draws, because it clamps exactly the players who have been building. A '
    '<i>rising</i> ceiling is worse still &mdash; it is tight while the early '
    'entrants need room and generous by the time the last numbers arrive.'))

A(table([
    ['Ceiling', 'Match length', 'Back-half draws win'],
    ['Fixed 6,000', '67 min', '72%'],
    ['Fixed 10,000', '118 min', '55%'],
    ['Rising, 4,000 +40/clue', '100 min', '73%'],
    ['Falling, 15,000 \u221250/clue', '76 min', '53%'],
], [58 * mm, 32 * mm, 38 * mm], align=[1, 2]))
A(P('The tuning as it stood at the time. 50% is fair. This is the reasoning '
    'that was later overturned \u2014 see the next section.', 'caption'))

A(P('That was the case for a decaying ceiling, and it held for months. It is '
    'wrong, and the section that follows explains why. The floor is still the '
    'entry stake, so a late arrival is never capped on the way in.'))

A(P('What the tuning produced', 'h2'))
A(table([
    ['Field', 'Entry every', 'Start', 'Ceiling', 'Decay', 'Length', 'Back-half'],
    ['10', '10 clues', '3,000', '7,500', '\u221240', '35 min', '57%'],
    ['16', '7 clues', '3,000', '7,500', '\u221225', '46 min', '62%'],
    ['20', '6 clues', '3,000', '7,500', '\u221225', '48 min', '64%'],
    ['30', '5 clues', '3,000', '11,000', '\u221240', '60 min', '63%'],
], [16 * mm, 24 * mm, 20 * mm, 21 * mm, 19 * mm, 22 * mm, 24 * mm],
    align=[2, 3, 4, 5, 6]))
A(P('Back-half is the win rate of players drawing in the second half of the field. '
    'It started at 100%.', 'caption'))

A(P('A late number is still worth having, and that is deliberate &mdash; it is true '
    'to the source material, where entrants 27 through 30 genuinely do '
    'overperform. What it is no longer is a guarantee.'))

# ---------------------------------------------------------------- overtime
A(H('OVERTIME', P('Two evenly matched players trade the same points back and forth indefinitely. '
    'Heads-up, a correct answer is worth exactly what the opponent loses, so a '
    'field of two with similar ability is a random walk with no drift. It showed '
    'up in the first recorded match: the last fourteen clues oscillated without '
    'either player getting meaningfully closer to going out.')))
A(P('Once the queue is empty and the ring is down to two, clue values double every '
    'six clues, capped at eight times face. The board displays the raised values, '
    'and the room gets a full-screen announcement at each step.'))

A(table([
    ['Endgame', 'Result'],
    ['Perfectly alternating stall, no overtime', 'Still running at 400 clues'],
    ['Perfectly alternating stall, with overtime', 'Resolved in 22 clues'],
], [72 * mm, 62 * mm]))
A(P('The pathological case, since real players are never quite this symmetrical.', 'caption'))

# ---------------------------------------------------------------- advanced
A(H('THE CEILING, AND WHY IT STOPPED FALLING',
    P('The ceiling clips every score. It began falling across the whole match, '
      'to stop a late draw walking into a worn-down field and simply outlasting '
      'it. That reasoning was backwards.')))

A(P('The ceiling clips whoever is ahead, and whoever is ahead is nearly always '
    'an early entrant who has been accumulating. A latecomer arrives at a fixed '
    'stake, untouched. So the falling ceiling was destroying exactly the work it '
    'was meant to protect against.'))

A(table([
    ['Decay per clue', 'Last third vs first third'],
    ['\u2212180', '9.0\u00d7'],
    ['\u221240', '2.16\u00d7'],
    ['\u221225', '1.85\u00d7'],
    ['0', '1.40\u00d7'],
], [44 * mm, 52 * mm], align=[1]))
A(P('3,000 simulated twenty-player matches per row. 1.00 would be even.', 'caption'))

A(callout('A measurement that reversed the answer',
          'The first version of this simulation used a random comparator to '
          'shuffle the buzz order, which is not a shuffle at all \u2014 it leaves '
          'a heavy bias toward the original order. It reported that the first '
          'three draws, who all start together, won at 25.8%, 14.2% and 10.4%. '
          'Three players in identical positions cannot differ like that. With a '
          'proper shuffle they came out within noise of each other, and the '
          'recommendation flipped.'))

A(P('What replaced it', 'h2'))
A(P('Taking the decay out removed the only guaranteed drain, and a symmetric '
    'exchange with nothing leaking never resolves \u2014 a field of evenly '
    'matched robots ran 400 clues without a single elimination. Raising the '
    'stakes does not help, because doubling both sides of an even trade leaves '
    'it even.'))
A(P('So the ceiling falls only once overtime has opened. The endgame gets '
    'teeth; the entry phase, where the bias came from, is left alone.'))

A(H('PAID FOR LASTING',
    P('Early draws spend the whole match being ground down. Rather than take '
      'from the leaders, the game now pays for survival.')))

A(table([
    ['Bonus', '10 players', '20 players', '30 players'],
    ['none', '1.31\u00d7', '1.40\u00d7', '1.14\u00d7'],
    ['every 10, +250', '1.18\u00d7', '1.28\u00d7', '1.07\u00d7'],
    ['every 10, +500', '1.05\u00d7', '1.07\u00d7', '0.97\u00d7'],
    ['every 10, +1000', '0.82\u00d7', '0.89\u00d7', '0.80\u00d7'],
], [34 * mm, 26 * mm, 26 * mm, 26 * mm], align=[1, 2, 3]))
A(P('Draw advantage of the last third over the first. +1000 overshoots and '
    'hands the game to early draws instead.', 'caption'))

A(P('It self-limits: a leader at the ceiling gets nothing from it, so it helps '
    'whoever is grinding rather than whoever is already winning. Taking every '
    'clue in a column pays another 500, scaled by the overtime multiplier, and '
    'is counted as the column is worked through so a board refresh cannot rob '
    'anybody of a run they have finished.'))

A(H('OPTIONAL MECHANICS', P('Four rules that change how the game is played rather than how it looks. All '
    'off by default, each toggled separately, and all of them lean on keyboard '
    'controls &mdash; worth leaving off if the field is mostly on phones.')))

A(P('Top rope', 'h2'))
A(P('Declared between clues, never once a clue is on the board &mdash; otherwise '
    'you would only ever climb up when you already knew the answer. That clue is '
    'worth double in both directions to the player who declared, and their '
    'winnings ignore the ceiling. That last part matters: without it the top rope '
    'is strictly bad for anyone near the cap, since the downside is uncapped and '
    'the upside is not.'))

A(P('Targeting', 'h2'))
A(P('Aim at one player, visible to the room, with an alert on their buzzer. Win '
    'the clue and the entire pot comes out of them alone and everyone else is '
    'spared. Lose the clue to them and you pay the whole pot yourself while the '
    'rest of the ring walks. A finishing move and a kamikaze on the same button.'))

A(P('Bounties', 'h2'))
A(P('A player waiting in the queue stakes part of their own entry on a head, up to '
    'half. Whoever eliminates the target collects. If the target survives to the '
    'end they keep it &mdash; and if the target eliminates the player who placed '
    'it, they keep that too. Placing a bounty is a declaration, not a free shot.'))

A(P('Revival', 'h2'))
A(P('An eliminated player returns to the queue at a fraction of the stake with a '
    'new entry number, once by default.'))

A(table([
    ['Setting', 'Length', 'Back-half draws win'],
    ['None (baseline)', '64 min', '53%'],
    ['Top rope', '62 min', '54%'],
    ['Targeting', '63 min', '63%'],
    ['Bounties', '64 min', '48%'],
    ['Revival', '95 min', '52%'],
    ['All four', '88 min', '63%'],
], [58 * mm, 32 * mm, 38 * mm], align=[1, 2]))
A(P('400 simulated thirty-player matches per row.', 'caption'))

A(P('Three of the four barely move the clock. Revival runs half again as long, '
    'because nearly every player spends their second life &mdash; the setup screen '
    'says so before the match starts. It is also the fairest setting on the list, '
    'which was not the expectation: a second chance is worth most to whoever went '
    'in first, so it works against the same late-draw advantage the longevity '
    'bonus exists to fight.'))

A(callout('A measurement trap worth recording',
          'Revival first showed a 94% back-half win rate, which looked alarming. It '
          'was an artefact: revived players receive a fresh entry number, so the '
          'winner is a late draw almost by definition. Measured against the number '
          'each player <i>actually drew</i>, it is 52%. Players now carry both '
          'numbers and the standings report the drawn one.'))

# ---------------------------------------------------------------- operations
A(H('RUNNING A MATCH', P('Before', 'h2')))
A(P('The setup screen mints a four-letter room code to read aloud, and fills a '
    'lobby as players join. Clue material is mixed by percentage across the '
    'archive, boards written in house, and anything uploaded for that match; the '
    'archive can be narrowed by season. Fresh boards can be dropped in as '
    'j-trivia.org JSON or jparty.tv CSV.'))
A(P('The screen estimates the length from the roster and warns when the numbers do '
    'not work &mdash; a six-player field cannot be stretched much past its '
    'natural length by entry pacing alone, and it says so, with a button that '
    'sets a target it can actually reach.'))

A(P('During', 'h2'))
A(B('The clue takes over the shared screen. Correct responses appear only in a '
    'separate admin window, kept on an unshared display.'))
A(B('Three keys resolve everything: correct, wrong with automatic re-toss, and '
    'nobody got it.'))
A(B('A five-second lectern countdown runs after the buzzers arm.'))
A(B('Undo takes back an entire clue &mdash; scores, eliminations, entries, the '
    'board. Clicking any player adjusts their score directly. Both are logged.'))
A(B('The audio delay is adjustable mid-match, because nobody can tell you it is '
    'wrong until they have tried to buzz on a real clue.'))

A(P('Robots and testing', 'h2'))
A(B('Add robots from the setup screen, mixed across the five standards or all of one.'))
A(B('Click any robot to change its standard, or remove it, before the match starts.'))
A(B('Their buzz distributions come from real recorded play rather than a fitted curve.'))

A(P('Timing', 'h2'))
A(P('The sockets are much faster than the call audio, so buzzers are deliberately '
    'held back to arm when the host\u2019s voice actually arrives. Measured on a '
    'real match with players spread across the country:'))

A(table([
    ['Path', 'One way'],
    ['Socket, fastest player', '7 ms'],
    ['Socket, median player', '14 ms'],
    ['Socket, slowest player', '29 ms'],
    ['Zoom audio, typical', '150 \u2013 300 ms'],
], [72 * mm, 36 * mm], align=[1]))
A(P('Socket figures from a recorded match; the spread within each player was only '
    'a few milliseconds. Zoom is the industry-typical range.', 'caption'))

A(P('So the socket beats the voice by roughly 120 to 290 milliseconds, and that gap '
    'is what the delay setting closes. Players also get their own trim in ten '
    'millisecond steps, since audio paths differ by client, buffer, and whether '
    'somebody is on headphones.'))

A(P('After', 'h2'))
A(P('The winner gets the screen. Everything else &mdash; clues survived, toss outs, '
    'points drained, peak score, buzzer attempts, win rate, average and best '
    'times, the single fastest buzz of the match &mdash; goes into sortable '
    'standings and a score graph, shareable as a summary card, a full stats sheet, '
    'or one wide CSV.'))
A(P('With recording switched on, the match also produces a detailed log: every '
    'clue, every buzz time and the connection it arrived over, scores before and '
    'after, entries, eliminations, corrections, and a comparison of the predicted '
    'length against the real one. That file is how the model gets better.'))

A(callout('What a recording changed',
          'The first recorded match produced a median pace of 15.0 seconds per clue '
          'against a mean of 21.2 &mdash; six discussion breaks between 30 and 57 '
          'seconds dragged the average. It also exposed two broken statistics and '
          'an endgame that could not end. Three rules and four bugs came out of one '
          'file.'))

A(H('ROBOT PLAYERS', P('Thirty humans are hard to assemble for a test. Robots fill a roster and '
    'play the match themselves \u2014 buzzing on a real clock, with reaction times '
    'drawn per clue, so the race fills in the way it does with people. The host '
    'sees whether each one is about to be right, since there is no way to '
    'adjudicate a machine.')))
A(P('Five standards, drawn at random or forced, and any of them can be changed '
    'by clicking the robot before the match starts.'))

A(table([
    ['Standard', 'Attempts', 'Accuracy', 'How often drawn'],
    ['rookie', '23 \u2013 35%', '70 \u2013 80%', '5%'],
    ['normie', '37 \u2013 61%', '77 \u2013 87%', '60%'],
    ['champ', '63 \u2013 70%', '79 \u2013 89%', '23%'],
    ['superchamp', '72 \u2013 88%', '83 \u2013 90%', '11%'],
    ['elite', '89 \u2013 96%', '87 \u2013 95%', '1%'],
], [30 * mm, 28 * mm, 28 * mm, 34 * mm], align=[1, 2, 3]))
A(P('Attempts as a share of the clues played. These are Matt Schiffler\u2019s '
    'figures from the generator he wrote for his own game, not a reconstruction '
    'of them.', 'caption'))

A(P('Checked against 3,339 real player-games from J!ometry\u2019s published box '
    'data, his intuition holds up unusually well. The share of real games falling '
    'in each of his bands runs 3.1%, 55.8%, 17.5%, 12.8% and 0.1% \u2014 against '
    'the 5, 60, 23, 11 and 1 per cent at which he draws them. His population\u2019s '
    'mean attempt rate is 56% against a real median of 57%.'))

A(callout('Most players are ordinary',
          'The weighting matters more than the bands do. An earlier version of '
          'this drew the five standards uniformly, so one robot in five was '
          'elite. On the show it is one in a hundred. A test field of twenty per '
          'cent elites is not a test of anything.'))

A(P('Difficulty by row', 'h2'))
A(P('A player\u2019s attempt rate is raised to a power per row rather than '
    'multiplied by one: <font face="Courier">rate ^ exponent</font>, with '
    'exponents of 0.48, 0.67, 0.85, 1.10 and 1.40 from the cheapest row to the '
    'dearest. The power form grades itself, because a fraction raised to a power '
    'above one falls away much faster when the fraction is small.'))

A(table([
    ['Base attempt rate', 'On the dearest row', 'Lost'],
    ['30%', '13%', '17 points'],
    ['60%', '42%', '18 points'],
    ['90%', '84%', '6 points'],
], [42 * mm, 40 * mm, 28 * mm], align=[1, 2]))
A(P('A weak player loses far more to a hard clue than a strong one, and no '
    'per-standard table is needed to produce that. In play a rookie goes for the '
    'cheapest row 3.6 times as often as the dearest; an elite 1.1 times.', 'caption'))

A(P('What the real data changed', 'h2'))
A(P('The same file splits each game into its two rounds, and Double Jeopardy '
    'clues average four times the value of Single Jeopardy ones. Between the '
    'rounds, accuracy falls 1.9 points while attempts fall 15 per cent.'))

A(callout('Difficulty lives in the attempt, not the answer',
          'A hard clue does not make a player wrong. It makes them not buzz at '
          'all. Earlier versions of this model spread accuracy eighteen points '
          'across the five rows; the real figure is about two. Weak players are '
          'quiet rather than mistaken, which is a different thing to play '
          'against and a more accurate one.'))

A(P('Grouped by contestant across 1,772 people, the ladder from one appearance '
    'to ten or more runs 46.3% to 56.3% on winning the buzz, and 81.8% to 89.3% '
    'on accuracy. Both matter. The buzzer matters more.'))

A(P('Levelling robots to the room', 'h2'))
A(P('The recorded robots were measured against a player whose median buzz was 43 '
    'milliseconds. Dropped in front of somebody buzzing at 400 they would be '
    'unbeatable, so they are shifted to sit alongside whoever actually turned up '
    '\u2014 measured once, after six human buzzes, and then frozen.'))

A(callout('Two ways to get this wrong, both of them found in play',
          'Recomputing the shift every clue made the robots chase the human: slow '
          'buzzes early dragged the field down permanently, and by the end of one '
          'match the player had sped up to 294ms while the robots sat at 612. '
          'Freezing it instead introduced the opposite fault \u2014 the human was '
          'eliminated at clue 12 having buzzed seven times, so the calibration '
          'never fired and he lost every race to robots that had never been '
          'levelled to him. It now settles after six buzzes and starts from a '
          '190ms default rather than from nothing.'))

A(H('OVERTIME, AS IT ENDED UP',
    P('The rule that forces a resolution took three attempts, and each failure '
      'is worth recording because each looked reasonable at the time.')))

A(P('It began by waiting for heads-up. A robot test then ran thirty clues with '
    'three players trading the same points and it never fired \u2014 so it now '
    'opens as soon as the queue is empty.'))
A(P('Opening it there and letting it run regardless made large fields a '
    'lottery: a thirty-player match had the stakes doubling with fourteen still '
    'in the ring, and the strongest players\u2019 win rate fell from 42% to 34%. '
    'So the escalation clock counts only clues where nobody was eliminated. A '
    'stall is precisely a run of clues with nobody going out; while the field '
    'thins on its own, the stakes hold.'))
A(P('Deriving the level from that clock then meant an elimination reset the '
    'multiplier from four times face to one, which reads as the game forgetting '
    'what had just happened. It ratchets now: an elimination stops the climb '
    'without putting it back.'))

A(callout('Escalation has to move both sides',
          'In a live match a clue worth 2,000 paid the winner 500 and charged '
          'the loser the full 2,000 \u2014 the ceiling clipped the winnings while '
          'the loss went through untouched. The stakes only ever moved one way, '
          'and did it invisibly, which read as overtime not working at all. The '
          'winner of a raised clue now banks the whole amount and is clipped on '
          'the next clue instead, so the falling roof takes it back unless they '
          'keep winning.'))

A(P('A very long stall \u2014 eight escalation windows, about 48 clues with '
    'nobody eliminated \u2014 opens overtime even with people still queued, '
    'because a slow entry interval means the queue may never empty. That '
    'threshold has to be high: at three windows it fired during the entry phase '
    'and cost eleven minutes of match length and twenty points of draw '
    'fairness.'))

A(H('WHAT ELSE IS IN THERE', P('Details that matter in the room rather than on paper.')))

A(P('Wrestlers', 'h2'))
A(P('Every player gets an 8-bit wrestler: singlet style and colour, hair style '
    'and colour, skin tone, chosen on arrival to be distinguishable from '
    'everybody already in the room. Thirty players get thirty tellable-apart '
    'wrestlers. One module draws both the portrait on a score tile and the '
    'figures in the animations, so a player is recognisably themselves being '
    'thrown out of the ring \u2014 and when nobody wins the clue, a referee in '
    'stripes does the throwing.'))
A(P('The portrait is drawn for the job rather than cropped from the body '
    'sprite. Cropping was the obvious approach and it was wrong: the body\u2019s '
    'head is four pixels across, so at tile size every player was an identical '
    'skin-coloured blob.', 'caption'))

A(P('Turning up late, and who is next', 'h2'))
A(P('A latecomer joins at any point, goes to the back of the queue and enters '
    'on the standard stake. With the interval on auto it recomputes against the '
    'clues actually left, so entries compress as the roster grows. It is refused '
    'once overtime has opened \u2014 letting somebody in then would reopen it '
    'while the ratchet held the stakes high.'))
A(P('Who is coming next is hidden from the room by default. The countdown '
    'stays, because knowing when somebody arrives is tactical; only the name '
    'goes, so the horn means something. The host sees it in the answers window, '
    'and the entrant always sees their own countdown.'))

A(P('Saves and gifts', 'h2'))
A(P('Anyone still in the ring can put money up to buy an eliminated player '
    'back, declared with S and settled at the next clue so nothing pauses. '
    'Several people can chip in for one player, and partial amounts are allowed '
    '\u2014 a cheap save is a weak save. From the queue, a player waiting to come '
    'in can hand part of their entry to anybody in the ring and walks in lighter '
    'by exactly that much.'))

A(P('The watch screen', 'h2'))
A(P('A public, read-only view of the board at /watch/CODE \u2014 no key, no '
    'login, and the answers are never sent to it. Meant to replace sharing a '
    'screen: a state push per event against a continuous video stream is a '
    'rounding error, and every viewer gets a crisp local render at their own '
    'resolution rather than a compressed copy of the host\u2019s monitor. One '
    'screen in the room can turn on the sound.'))

A(P('The entry countdown', 'h2'))
A(P('Each waiting player sees their own entry, not the next entry in the match, '
    'with their place in the queue beside it. Three rising tones over their last '
    'three clues, and the page washes amber as they come up.'))

A(P('Match logs', 'h2'))
A(P('Every match is recorded and saved three ways: on the server, in the '
    'host\u2019s downloads automatically, and on demand from the champion screen. '
    'Every clue, every buzz time, the connection it arrived over, scores before '
    'and after, entries, eliminations, corrections, and the predicted length '
    'against the real one. Nearly everything in this document that is a number '
    'rather than an opinion came out of one of those files.'))

A(H('METHOD', P('The rules engine is a plain module with no framework and no network, driven '
    'by a Monte Carlo harness that plays hundreds of matches per configuration '
    'using a simple model of player ability. Every figure in this document comes '
    'from that harness or from a recorded match.')))
A(P('The harness runs before every deployment. It has already caught a scoring '
    'change that pushed non-pot matches from 57 minutes to 746 &mdash; a '
    'regression that was invisible in ordinary play and would have been found '
    'on a Saturday night otherwise.'))
A(P('Clue material comes from a public dataset rather than from j-archive directly. '
    'The archive\u2019s maintainer asked not to be crawled, and a slow crawler is '
    'still a crawler.', 'small'))

doc.build(s)
print('wrote', os.path.relpath(OUT, os.path.join(HERE, '..')))
try:
    pages = subprocess.run(['pdfinfo', OUT], capture_output=True, text=True).stdout
    for line in pages.splitlines():
        if line.startswith(('Pages', 'Page size', 'File size')):
            print(' ', line)
except FileNotFoundError:
    pass
