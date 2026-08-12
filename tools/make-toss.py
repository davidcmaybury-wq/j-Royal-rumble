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


def climb_frame(i):
    """Up on the top rope. Shorter than the toss — this plays between clues,
    and the host may pick the next one before it finishes, so the whole gesture
    has to land in the first half.

      0-1   crouches
      2-4   climbs the corner
      5-11  perched on the top rope, taunting
    """
    o = []
    post_x = W - 8
    if i < 2:
        o.append(wrestler(post_x - 10, 17, trunks=BRASS, arms='down', legs='wide'))
    elif i < 5:
        rise = (i - 2)                     # 0,1,2 — up the corner
        o.append(wrestler(post_x - 8 + rise * 2, 15 - rise * 3,
                          trunks=BRASS, arms='up', legs='tuck'))
    else:
        # Perched, arms out, bobbing a little so it does not look frozen.
        bob = (i - 5) % 4
        dy = 0 if bob in (0, 2) else (-1 if bob == 1 else 1)
        o.append(wrestler(post_x - 3, 6 + dy, trunks=BRASS,
                          arms='raise' if bob % 2 == 0 else 'up', legs='wide'))
        for k in range(3):                 # a little sparkle around him
            if (i + k) % 3 == 0:
                o.append(rect(post_x - 8 + k * 6, 4 + (k % 2) * 3, 2, 2, CHALK))
    # somebody in the ring to loom over
    o.append(wrestler(14, 17, trunks=BLOOD, skin=SKIN2,
                      arms='down', legs='stand', flip=True))
    return ''.join(o)


def entry_frame(i):
    """Sliding in under the bottom rope, up onto his feet, then flexing.

    Twenty-four frames rather than twelve. The first version was over before
    anyone had looked at it — it replaced the lower-third banner, which sits up
    for four seconds, so there was no reason for the animation to be the
    shortest thing on screen. The sound cue is unchanged and finishes early;
    that is fine, the flex is the part worth watching and it does not need
    scoring.

      0-7    slides in from the left, low, kicking up dust
      8-12   gathers himself and stands
      13-23  flexing, alternating poses
    """
    o = []
    if i < 8:
        # A slower slide with a longer run-up, so the entrance has some travel.
        x = -10 + i * 4
        o.append(rect(x, 27, 8, 4, BLOOD))                  # body, flat
        o.append(rect(x + 6, 26, 4, 4, SKIN2))              # head out front
        o.append(rect(x + 1, 31, 3, 1, SKIN2))              # trailing legs
        for k, c in ((2, SLATE), (5, LINE), (8, LINE)):     # dust behind
            if x - k > -4 and (i + k) % 2:
                o.append(rect(x - k, 29 + (k % 2), 2, 1, c))
    elif i < 13:
        # Up onto his feet over five frames rather than three.
        t = i - 8                                           # 0..4
        crouch = max(0, 4 - t)
        o.append(wrestler(22, 17 + crouch, trunks=BLOOD, skin=SKIN2,
                          arms='down' if t < 3 else 'up',
                          legs='tuck' if t < 3 else 'stand'))
    else:
        # Flexing: three poses on a slow cycle, so it reads as posing rather
        # than as a flicker.
        pose = ((i - 13) // 2) % 3
        arms = ('raise', 'up', 'throw')[pose]
        legs = ('wide', 'stand', 'wide')[pose]
        o.append(wrestler(22, 17, trunks=BLOOD, skin=SKIN2, arms=arms, legs=legs))
        if pose == 0:
            for (fx, fy) in ((17, 12), (35, 12)):
                o.append(rect(fx, fy, 2, 2, BRASS))
        elif pose == 2:
            for (fx, fy) in ((19, 9), (33, 9)):
                o.append(rect(fx, fy, 2, 2, CHALK))
    return ''.join(o)


SEQUENCES = {
    'toss': (frame, FRAMES),
    'climb': (climb_frame, 12),
    'entry': (entry_frame, 24),
}


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
    """All three animations as one ES module. Each instance gets its own
    keyframe names so two playing at once cannot fight over the same rules."""
    import json
    data = {name: [fn(i) for i in range(n)] for name, (fn, n) in SEQUENCES.items()}
    return (
        '// Generated by tools/make-toss.py — do not edit by hand.\n'
        '//\n'
        '// Three 8-bit sequences at %dfps: a toss over the top rope, a climb up\n'
        '// to it, and an entrance. Frames are CSS keyframes toggling opacity, so\n'
        '// there is no animation loop to run and nothing to clean up.\n'
        'const SEQ = %s;\n\n'
        'const RING = %s;\n\n'
        'const FPS = %d;\n'
        'let seq = 0;\n\n'
        'export const SECONDS = Object.fromEntries(\n'
        '  Object.entries(SEQ).map(([k, v]) => [k, v.length / FPS]));\n\n'
        'export function animation(name = "toss", size = 150) {\n'
        '  const frames = SEQ[name] || SEQ.toss;\n'
        '  const id = "a" + (++seq);\n'
        '  const dur = frames.length / FPS;\n'
        '  const css = frames.map((_, i) => {\n'
        '    const a = (i / frames.length * 100).toFixed(4);\n'
        '    const b = ((i + 1) / frames.length * 100).toFixed(4);\n'
        '    return `@keyframes ${id}k${i}{0%%,${a}%%{opacity:0}`\n'
        '      + `${a}%%,${(+b - 0.0001).toFixed(4)}%%{opacity:1}`\n'
        '      + `${b}%%,100%%{opacity:0}}`\n'
        '      + `#${id}f${i}{animation:${id}k${i} ${dur}s steps(1,end) 1 forwards}`;\n'
        '  }).join("");\n'
        '  return `<svg viewBox="0 0 %d %d" width="${size}" role="img"\n'
        '    aria-label="8-bit wrestling animation">\n'
        '    <style>${css}\n'
        '      @media (prefers-reduced-motion:reduce){\n'
        '        [id^="${id}f"]{animation:none;opacity:0}\n'
        '        #${id}f${frames.length - 1}{opacity:1}}\n'
        '    </style>\n'
        '    <rect width="100%%" height="100%%" fill="#0A0E1C" rx="2"/>\n'
        '    ${RING}\n'
        '    ${frames.map((f, i) => `<g id="${id}f${i}">${f}</g>`).join("")}\n'
        '  </svg>`;\n'
        '}\n\n'
        '// Kept for callers written before the other two existed.\n'
        'export const tossAnimation = (size) => animation("toss", size);\n'
        'export const TOSS_SECONDS = SEQ.toss.length / FPS;\n'
    ) % (FPS, json.dumps(data), json.dumps(ring()), FPS, W, H)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    svg = build()
    open(os.path.join(here, '..', 'public', 'toss.svg'), 'w').write(svg)
    mod = build_module()
    open(os.path.join(here, '..', 'public', 'toss.js'), 'w').write(mod)
    print(f'wrote public/toss.svg  {FRAMES} frames at {FPS}fps '
          f'= {FRAMES / FPS:.2f}s  {len(svg) // 1024}KB')
    print(f'wrote public/toss.js   {len(mod) // 1024}KB')
