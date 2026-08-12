#!/usr/bin/env python3
"""Builds the 8-bit "over the top rope" animation.

    python3 tools/make-toss.py

Emits public/toss.svg — one SVG holding every frame, with only one visible at a
time. No JavaScript, no sprite sheet, no external image: it scales cleanly and
drops into the page the same way the other marks do.

The sprites are drawn parametrically rather than hand-authored as pixel maps,
so a pose can be adjusted by moving a limb rather than by editing a grid.
"""
import os

W, H = 64, 40          # the pixel canvas
PX = 8                 # how big one pixel is drawn
FPS = 9
FRAMES = 18            # 18 / 9 = exactly two seconds

INK    = '#0A0E1C'
NAVY   = '#1B2444'
LINE   = '#2A3556'
ROPE   = '#B99340'
BRASS  = '#D6A93F'
CHALK  = '#EEEBE1'
SLATE  = '#5E6B95'
BLOOD  = '#C8564A'
SKIN   = '#E8B48A'
SKIN2  = '#C98D63'

# The floor of the ring, and where the ropes sit.
MAT_Y = 31
ROPES = (17, 22, 27)


def rect(px, py, w, h, fill):
    if w <= 0 or h <= 0:
        return ''
    return f'<rect x="{px}" y="{py}" width="{w}" height="{h}" fill="{fill}"/>'


def wrestler(x, y, *, trunks, skin=SKIN, arms='down', legs='stand',
             lean=0, head_dy=0, flip=False):
    """A chunky little figure, six pixels wide at the shoulders.

    `arms`: down | up | grab | throw | raise
    `legs`: stand | wide | run | tuck
    """
    s = -1 if flip else 1
    o = []
    hx = x + (2 if not flip else 1) + lean
    # head
    o.append(rect(hx, y + head_dy, 4, 4, skin))
    o.append(rect(hx + (3 if not flip else 0), y + 1 + head_dy, 1, 1, INK))  # eye
    # torso
    o.append(rect(x + 1, y + 4 + head_dy, 6, 5, trunks))
    o.append(rect(x + 1, y + 9 + head_dy, 6, 3, trunks))

    ty = y + 4 + head_dy
    if arms == 'down':
        o.append(rect(x, ty + 1, 1, 5, skin))
        o.append(rect(x + 7, ty + 1, 1, 5, skin))
    elif arms == 'up':
        o.append(rect(x - 1, ty - 3, 2, 5, skin))
        o.append(rect(x + 7, ty - 3, 2, 5, skin))
    elif arms == 'grab':
        o.append(rect(x + 7 * (1 if not flip else 0) - (0 if not flip else 1),
                      ty, 3 * s if s > 0 else 3, 2, skin))
    elif arms == 'throw':
        o.append(rect(x - 1, ty - 4, 2, 4, skin))
        o.append(rect(x + 7, ty - 4, 2, 4, skin))
    elif arms == 'raise':
        o.append(rect(x - 1, ty - 5, 2, 6, skin))
        o.append(rect(x + 7, ty - 5, 2, 6, skin))

    ly = y + 12 + head_dy
    if legs == 'stand':
        o.append(rect(x + 1, ly, 2, 4, skin))
        o.append(rect(x + 5, ly, 2, 4, skin))
    elif legs == 'wide':
        o.append(rect(x, ly, 2, 4, skin))
        o.append(rect(x + 6, ly, 2, 4, skin))
    elif legs == 'run':
        o.append(rect(x, ly, 2, 3, skin))
        o.append(rect(x + 5, ly, 3, 4, skin))
    elif legs == 'tuck':
        o.append(rect(x + 1, ly, 3, 3, skin))
        o.append(rect(x + 4, ly, 3, 2, skin))
    return ''.join(o)


def ring():
    """The mat, the posts and three ropes. Drawn once, behind every frame."""
    o = [rect(0, MAT_Y, W, H - MAT_Y, NAVY),
         rect(0, MAT_Y, W, 1, LINE)]
    for ry in ROPES:
        o.append(rect(2, ry, W - 4, 1, ROPE))
    # corner posts
    o.append(rect(1, 17, 2, MAT_Y - 17, SLATE))
    o.append(rect(W - 3, 17, 2, MAT_Y - 17, SLATE))
    return ''.join(o)


def spin(inner, cx, cy, deg):
    """Rotate a sprite about its middle. Flipping the figure back and forth
    reads as indecision; an actual rotation reads as a tumble."""
    return f'<g transform="rotate({deg} {cx} {cy})">{inner}</g>'


def frame(i):
    """One frame. Timing is tight on purpose — two seconds is not long, and the
    first version spent six of them with both men standing still.

      0-1   squaring up
      2-3   the grab
      4-6   the lift
      7-8   the hurl, with a flash
      9-14  the flight, tumbling out over the top rope
      15-17 the winner alone
    """
    o = []

    # --- the thrower, on the left ---
    if i < 2:
        o.append(wrestler(14, 17, trunks=BRASS, arms='down', legs='stand'))
    elif i < 4:
        o.append(wrestler(15, 17, trunks=BRASS, arms='grab', legs='wide'))
    elif i < 7:
        o.append(wrestler(15, 16, trunks=BRASS, arms='up', legs='wide'))
    elif i < 9:
        o.append(wrestler(14, 17, trunks=BRASS, arms='throw', legs='wide', lean=1))
    elif i < 15:
        o.append(wrestler(14, 18, trunks=BRASS, arms='down', legs='wide'))
    else:
        o.append(wrestler(14, 16, trunks=BRASS, arms='raise', legs='stand'))

    # --- the one going out ---
    if i < 2:                       # facing off
        o.append(wrestler(28, 17, trunks=BLOOD, skin=SKIN2,
                          arms='down', legs='stand', flip=True))
    elif i < 4:                     # caught, pulled in
        o.append(wrestler(25, 17, trunks=BLOOD, skin=SKIN2,
                          arms='down', legs='wide', flip=True))
    elif i < 7:                     # hoisted overhead, held sideways
        lift = (7 - i)              # 3, 2, 1 — rises as it goes
        body = wrestler(20, 10 + lift, trunks=BLOOD, skin=SKIN2,
                        arms='up', legs='tuck', flip=True)
        o.append(spin(body, 24, 16 + lift, -70))
    else:
        # Up and out to the right, tumbling, clearing the top rope on the way.
        t = i - 7                                   # 0..10
        x = 22 + t * 5.6
        y = 8 - 3.2 * t + 0.55 * t * t
        if x < W + 12:
            body = wrestler(int(x), int(y), trunks=BLOOD, skin=SKIN2,
                            arms='up', legs='tuck', flip=True)
            o.append(spin(body, x + 4, y + 8, -70 - t * 46))
            for k in (1, 2, 3):     # a short trail behind
                o.append(rect(int(x) - k * 4, int(y) + 7, 2, 1,
                              LINE if k > 1 else SLATE))

    # --- the moment of the throw ---
    if 7 <= i <= 8:
        for (fx, fy) in ((19, 11), (27, 7), (31, 13), (23, 5), (16, 8)):
            o.append(rect(fx, fy, 2, 2, CHALK if i == 7 else BRASS))

    return ''.join(o)


def build():
    dur = FRAMES / FPS
    css = []
    groups = []
    for i in range(FRAMES):
        start = i / FRAMES * 100
        end = (i + 1) / FRAMES * 100
        # Visible for exactly its own slice, hidden either side. `steps` would
        # do this too, but explicit slices keep each frame independent.
        css.append(
            f'@keyframes f{i}{{0%,{start:.4f}%{{opacity:0}}'
            f'{start:.4f}%,{end - 0.0001:.4f}%{{opacity:1}}'
            f'{end:.4f}%,100%{{opacity:0}}}}'
            f'#f{i}{{animation:f{i} {dur}s steps(1,end) infinite}}')
        groups.append(f'<g id="f{i}">{frame(i)}</g>')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W * PX} {H * PX}"
  width="{W * PX}" height="{H * PX}" role="img"
  aria-label="A wrestler throwing another over the top rope">
<style>
  svg{{image-rendering:pixelated}}
  g rect{{transform:scale({PX});transform-origin:0 0;shape-rendering:crispEdges}}
  {''.join(css)}
  @media (prefers-reduced-motion:reduce){{
    g{{animation:none!important;opacity:0}}
    #f{FRAMES - 1}{{opacity:1}}
  }}
</style>
<rect width="100%" height="100%" fill="{INK}"/>
<g>{ring()}</g>
{''.join(groups)}
</svg>'''


def build_module():
    """The same animation as an ES module, so the console can drop one in
    without a network round trip. Each instance needs its own keyframe names —
    two playing at once would otherwise fight over the same CSS rules."""
    frames = [frame(i) for i in range(FRAMES)]
    ring_svg = ring()
    return (
        '// Generated by tools/make-toss.py — do not edit by hand.\n'
        '//\n'
        '// An 8-bit toss over the top rope: %d frames at %dfps, exactly %.1f\n'
        '// seconds. Plays once and removes itself. Small on purpose — an\n'
        '// elimination happens twenty-nine times in a full match, so this has to\n'
        '// sit in a corner and let the game carry on around it.\n'
        "const FRAMES = %s;\n\n"
        "const RING = %s;\n\n"
        'let seq = 0;\n\n'
        'export const TOSS_SECONDS = %.2f;\n\n'
        'export function tossAnimation(size = 132) {\n'
        '  const id = "t" + (++seq);\n'
        '  const dur = %.2f;\n'
        '  const css = FRAMES.map((_, i) => {\n'
        '    const a = (i / FRAMES.length * 100).toFixed(4);\n'
        '    const b = ((i + 1) / FRAMES.length * 100).toFixed(4);\n'
        '    return `@keyframes ${id}k${i}{0%%,${a}%%{opacity:0}`\n'
        '      + `${a}%%,${(+b - 0.0001).toFixed(4)}%%{opacity:1}`\n'
        '      + `${b}%%,100%%{opacity:0}}`\n'
        '      + `#${id}f${i}{animation:${id}k${i} ${dur}s steps(1,end) 1 forwards}`;\n'
        '  }).join("");\n'
        '  return `<svg viewBox="0 0 %d %d" width="${size}" role="img"\n'
        '    aria-label="A wrestler thrown over the top rope">\n'
        '    <style>${css}\n'
        '      @media (prefers-reduced-motion:reduce){\n'
        '        [id^="${id}f"]{animation:none;opacity:0}\n'
        '        #${id}f${FRAMES.length - 1}{opacity:1}}\n'
        '    </style>\n'
        '    <rect width="100%%" height="100%%" fill="#0A0E1C" rx="2"/>\n'
        '    ${RING}\n'
        '    ${FRAMES.map((f, i) => `<g id="${id}f${i}">${f}</g>`).join("")}\n'
        '  </svg>`;\n'
        '}\n'
    ) % (FRAMES, FPS, FRAMES / FPS,
         __import__('json').dumps(frames),
         __import__('json').dumps(ring_svg),
         FRAMES / FPS, FRAMES / FPS, W, H)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    svg = build()
    open(os.path.join(here, '..', 'public', 'toss.svg'), 'w').write(svg)
    mod = build_module()
    open(os.path.join(here, '..', 'public', 'toss.js'), 'w').write(mod)
    print(f'wrote public/toss.svg  {FRAMES} frames at {FPS}fps '
          f'= {FRAMES / FPS:.2f}s  {len(svg) // 1024}KB')
    print(f'wrote public/toss.js   {len(mod) // 1024}KB')
