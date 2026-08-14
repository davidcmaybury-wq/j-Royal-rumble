#!/usr/bin/env python3
"""Original 8-bit entrance themes.

    python3 tools/make-themes.py            writes public/audio/themes/*.mp3
    python3 tools/make-themes.py --one      just the first, for auditioning

Synthesised rather than sourced, for the same reason as the game's cues: the
licensing is unambiguous. Nothing is borrowed, so nothing can be mistaken for
somebody's actual entrance music — which is the one part of a wrestling
broadcast most aggressively owned.

Each theme is a real piece of music rather than a loop: a hook is stated,
varied, and resolved inside about five seconds. A player walking in gets a
beginning and an end, not a fragment fading out.

Five seconds is short for that shape, so the tempos run fast — 132-152 — which
keeps three parts rather than dropping to a hook and a stop. It also suits the
moment: an entrance is a door opening, not an interlude.

Three moods, because a field of thirty needs contrast: HORROR (minor, tritones,
slow menace), WRESTLING (major, brassy, triumphant), SPORTS (driving, syncopated,
arena organ).
"""
import numpy as np
import os
import subprocess
import sys

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio', 'themes')
os.makedirs(OUT, exist_ok=True)

# Equal temperament from A4. Written as note names because transposing a theme
# by ear is easier than transposing a list of frequencies.
def hz(note):
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6,
             'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * (2 ** ((names[name] + (octave - 4) * 12 - 9) / 12))


def square(freq, dur, duty=0.5):
    """The NES pulse channel. Duty cycle is what gives it its character."""
    n = int(SR * dur)
    if freq <= 0:
        return np.zeros(n)
    ph = (np.arange(n) * freq / SR) % 1.0
    return np.where(ph < duty, 1.0, -1.0)


def triangle(freq, dur):
    """The bass channel — softer, rounder, no harmonics to speak of."""
    n = int(SR * dur)
    if freq <= 0:
        return np.zeros(n)
    ph = (np.arange(n) * freq / SR) % 1.0
    return 2.0 * np.abs(2.0 * ph - 1.0) - 1.0


def noise(dur, decay=28.0):
    """The percussion channel."""
    n = int(SR * dur)
    rng = np.random.default_rng(7)
    return rng.uniform(-1, 1, n) * np.exp(-decay * np.linspace(0, dur, n))


def env(n, a=0.004, r=0.05, sustain=1.0):
    ai, ri = int(a * SR), int(r * SR)
    si = max(0, n - ai - ri)
    return np.concatenate([np.linspace(0, 1, ai),
                           np.full(si, sustain),
                           np.linspace(sustain, 0, ri)])[:n]


def seq(notes, bpm, wave='square', duty=0.5, gain=1.0, octave=0, gate=0.92):
    """A monophonic line. `notes` is [(note-or-None, beats), ...]."""
    beat = 60.0 / bpm
    out = []
    for note, beats in notes:
        dur = beat * beats
        n = int(SR * dur)
        if note is None:
            out.append(np.zeros(n))
            continue
        f = hz(note) * (2 ** octave)
        held = int(n * gate)
        if wave == 'square':
            v = square(f, held / SR, duty)
        elif wave == 'triangle':
            v = triangle(f, held / SR)
        else:
            v = noise(held / SR)
        v = v * env(len(v))
        out.append(np.concatenate([v * gain, np.zeros(n - len(v))]))
    return np.concatenate(out) if out else np.zeros(0)


def drums(pattern, bpm, gain=0.5):
    """`pattern` is a string of x (hit), . (rest), one character per eighth."""
    beat = 60.0 / bpm
    step = beat / 2
    out = []
    for ch in pattern:
        n = int(SR * step)
        if ch == 'x':
            v = noise(step, decay=40) * gain
        elif ch == 'o':
            v = noise(step, decay=14) * gain * 0.8
        else:
            v = np.zeros(n)
        out.append(np.concatenate([v, np.zeros(max(0, n - len(v)))])[:n])
    return np.concatenate(out) if out else np.zeros(0)


def mix(*layers):
    n = max(len(x) for x in layers)
    out = np.zeros(n)
    for x in layers:
        out[:len(x)] += x
    return out


def trim(x, floor=None):
    """Cut trailing near-silence.

    Layers are written independently and rarely end together — a drum pattern
    counted in steps and a melody counted in beats will disagree, and the
    mixer pads to the longest. That left three seconds of nothing at the end
    of two of these, which on an entrance reads as the music having failed
    rather than finished.
    """
    # Relative to the piece, not absolute: what is left at the end is usually
    # the last drum hit ringing out at a fortieth of the body's level —
    # inaudible, but enough to defeat a fixed threshold.
    body = np.sqrt(np.mean(x ** 2)) or 1.0
    cut = floor if floor is not None else body * 0.10
    loud = np.abs(x) > cut
    if not loud.any():
        return x
    return x[:np.nonzero(loud)[0][-1] + int(0.12 * SR)]


def loudness(x, target=0.13):
    # Remove DC first. A pulse wave at 25%% or 12.5%% duty is not centred on
    # zero, and several of these lean on those duties for their character —
    # left in, the offset eats headroom and can click on playback.
    x = x - np.mean(x)
    """Match themes to each other by RMS, not peak.

    Peak normalising left the sparse horror themes sounding half the volume of
    the busy sports ones, which matters when they play back to back all night.
    """
    rms = np.sqrt(np.mean(x ** 2)) or 1.0
    x = x * (target / rms)
    peak = np.max(np.abs(x))
    if peak > 0.97:
        x = x * (0.97 / peak)
    return x


def write(name, x):
    x = trim(x)
    x = loudness(x)
    # A short fade in and out, so nothing clicks when it starts or stops.
    f = int(0.008 * SR)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    path = os.path.join(OUT, name + '.mp3')
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR),
         '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '96k', path],
        input=pcm, check=True)
    return path


# --- the themes -----------------------------------------------------------
#
# Each states a hook, varies it, and resolves. Ten seconds is long enough for
# that shape and short enough that nobody is waiting for it to finish.

# --- the themes -----------------------------------------------------------
#
# Twelve, four per mood, so a field of thirty has real variety and no two
# neighbours in the draw sound alike.

def horror_bellringer():
    """Minor second into a tritone. The hook falls rather than lifts."""
    bpm = 132
    lead = seq([('D3', 1), ('D#3', 1), ('A3', 1), ('D#3', 1),
                ('D3', 1), ('D#3', 1), ('G#3', 1.5), ('G3', 0.5),
                ('D3', 1), ('A2', 1), ('D3', 2)], bpm, duty=0.5, gain=0.32)
    bass = seq([('D2', 2)] * 4 + [('A1', 2), ('D2', 2)],
               bpm, wave='triangle', gain=0.42)
    return mix(lead, bass, drums('x...x...' * 3, bpm, gain=0.16))


def horror_creeper():
    """Chromatic climb that never arrives."""
    bpm = 138
    lead = seq([('F3', 0.5), ('F#3', 0.5), ('G3', 0.5), ('G#3', 0.5),
                ('A3', 1), (None, 0.5), ('A3', 0.5),
                ('F3', 0.5), ('F#3', 0.5), ('G3', 0.5), ('G#3', 0.5),
                ('B3', 1.5), ('A#3', 0.5), ('F3', 2)],
               bpm, duty=0.25, gain=0.30)
    bass = seq([('F2', 4), ('F2', 3), ('E2', 1), ('F2', 2)],
               bpm, wave='triangle', gain=0.40)
    return mix(lead, bass, drums('x.x.x.x.' * 3, bpm, gain=0.12))


def horror_dirge():
    """Slow, wide intervals, a lot of space."""
    bpm = 132
    lead = seq([('C3', 2), ('G#2', 1), ('C3', 1),
                ('D#3', 2), ('D3', 2),
                ('C3', 1), ('G2', 1), ('C3', 2)], bpm, duty=0.5, gain=0.33)
    bass = seq([('C2', 4), ('G#1', 2), ('D#2', 2), ('C2', 4)],
               bpm, wave='triangle', gain=0.44)
    return mix(lead, bass, drums('x.......' * 3, bpm, gain=0.18))


def horror_stalker():
    """A repeated figure that speeds up under itself."""
    bpm = 144
    fig = [('A3', 0.5), ('E3', 0.5), ('A3', 0.5), ('C4', 0.5)]
    lead = seq(fig + fig + [('A#3', 1), ('A3', 1),
                            ('F3', 0.5), ('E3', 0.5), ('A3', 2)],
               bpm, duty=0.125, gain=0.30)
    bass = seq([('A1', 2), ('A1', 2), ('F1', 2), ('E1', 2), ('A1', 2)],
               bpm, wave='triangle', gain=0.42)
    return mix(lead, bass, drums('x..x..x.' * 3, bpm, gain=0.15))


def wrestling_champion():
    """Major, brassy, arrives on the tonic."""
    bpm = 146
    lead = seq([('G3', 0.5), ('C4', 1), ('E4', 0.5), ('G4', 1.5), ('E4', 0.5),
                ('F4', 1), ('E4', 1), ('D4', 1), ('C4', 1),
                ('G3', 0.5), ('C4', 2.5)], bpm, duty=0.5, gain=0.30)
    harm = seq([(None, 2), ('C4', 1.5), ('C4', 0.5),
                ('A3', 1), ('G3', 1), ('B3', 1), ('G3', 1),
                (None, 0.5), ('E4', 2.5)], bpm, duty=0.25, gain=0.16)
    bass = seq([('C2', 2), ('C2', 2), ('F2', 2), ('G2', 2), ('C2', 3)],
               bpm, wave='triangle', gain=0.42)
    return mix(lead, harm, bass, drums('x.o.x.o.' * 3, bpm, gain=0.20))


def wrestling_heel():
    """Same swagger, minor third — for somebody the room should boo."""
    bpm = 142
    lead = seq([('E3', 0.5), ('G3', 1), ('B3', 0.5), ('E4', 1.5), ('D4', 0.5),
                ('C4', 1), ('B3', 1), ('G3', 1), ('A3', 1),
                ('E3', 0.5), ('E4', 2.5)], bpm, duty=0.5, gain=0.30)
    bass = seq([('E2', 2), ('E2', 2), ('C2', 2), ('D2', 2), ('E2', 3)],
               bpm, wave='triangle', gain=0.42)
    return mix(lead, bass, drums('x.o.xxo.' * 3, bpm, gain=0.20))


def wrestling_fanfare():
    """A herald: rising fourths, then a held note."""
    bpm = 152
    lead = seq([('C4', 0.5), ('F4', 0.5), ('A#4', 1), (None, 0.5),
                ('C4', 0.5), ('F4', 0.5), ('C5', 1.5),
                ('A#4', 0.5), ('A4', 0.5), ('G4', 0.5), ('F4', 3)],
               bpm, duty=0.5, gain=0.30)
    harm = seq([(None, 2.5), ('F4', 1.5), (None, 1), ('A4', 1.5),
                (None, 1.5), ('C5', 3)], bpm, duty=0.25, gain=0.15)
    bass = seq([('F2', 2), ('F2', 2), ('A#1', 2), ('C2', 2), ('F2', 3)],
               bpm, wave='triangle', gain=0.42)
    return mix(lead, harm, bass, drums('xxo.xxo.' * 3, bpm, gain=0.19))


def wrestling_powerhouse():
    """Low, slow-feeling, heavy — for somebody large."""
    bpm = 132
    lead = seq([('G2', 1), ('G2', 0.5), ('A#2', 0.5), ('C3', 2),
                ('G2', 1), ('G2', 0.5), ('D3', 0.5), ('C3', 2),
                ('A#2', 1), ('C3', 3)], bpm, duty=0.5, gain=0.34)
    bass = seq([('G1', 2), ('G1', 2), ('A#1', 2), ('C2', 2), ('G1', 3)],
               bpm, wave='triangle', gain=0.46)
    return mix(lead, bass, drums('x..ox..o' * 3, bpm, gain=0.22))


def sports_leadoff():
    """Arena organ: the six-note charge, answered."""
    bpm = 150
    lead = seq([('G3', 0.5), ('C4', 0.5), ('E4', 0.5), ('G4', 1),
                ('E4', 0.5), ('G4', 2),
                ('G3', 0.5), ('C4', 0.5), ('E4', 0.5), ('G4', 1),
                ('A4', 0.5), ('G4', 2.5)], bpm, duty=0.5, gain=0.29)
    bass = seq([('C2', 1), ('G1', 1)] * 5, bpm, wave='triangle', gain=0.40)
    return mix(lead, bass, drums('x.oxx.o.' * 3, bpm, gain=0.21))


def sports_fastbreak():
    """Syncopated, restless, never lands on the beat."""
    bpm = 152
    lead = seq([(None, 0.5), ('D4', 0.5), ('F4', 0.5), ('G4', 0.5),
                ('A4', 1), (None, 0.5), ('G4', 0.5),
                (None, 0.5), ('D4', 0.5), ('F4', 0.5), ('A4', 0.5),
                ('C5', 1.5), ('A4', 0.5), ('D4', 2)],
               bpm, duty=0.25, gain=0.29)
    bass = seq([('D2', 1.5), ('D2', 0.5), ('F2', 1), ('G2', 1),
                ('D2', 1.5), ('D2', 0.5), ('A1', 1), ('D2', 3)],
               bpm, wave='triangle', gain=0.41)
    return mix(lead, bass, drums('x.xox.xo' * 3, bpm, gain=0.22))


def sports_anthem():
    """Broad, singable, the one a crowd would join in with."""
    bpm = 138
    lead = seq([('D4', 1), ('D4', 0.5), ('E4', 0.5), ('F#4', 1), ('E4', 1),
                ('D4', 1), ('B3', 1), ('A3', 2),
                ('D4', 0.5), ('E4', 0.5), ('D4', 2)],
               bpm, duty=0.5, gain=0.30)
    harm = seq([('A3', 1), ('A3', 1), ('D4', 1), ('B3', 1),
                ('A3', 1), ('G3', 1), ('F#3', 2), (None, 1), ('A3', 2)],
               bpm, duty=0.25, gain=0.15)
    bass = seq([('D2', 2), ('D2', 2), ('G2', 2), ('A2', 2), ('D2', 3)],
               bpm, wave='triangle', gain=0.42)
    return mix(lead, harm, bass, drums('x.o.x.o.' * 3, bpm, gain=0.20))


def sports_hustle():
    """Quick, light, all eighth notes — for somebody fast."""
    bpm = 152
    lead = seq([('E4', 0.5), ('D4', 0.5), ('E4', 0.5), ('G4', 0.5),
                ('E4', 0.5), ('D4', 0.5), ('B3', 1),
                ('E4', 0.5), ('D4', 0.5), ('E4', 0.5), ('A4', 0.5),
                ('G4', 0.5), ('E4', 0.5), ('D4', 0.5), ('E4', 2)],
               bpm, duty=0.125, gain=0.29)
    bass = seq([('E2', 1), ('E2', 1), ('C2', 1), ('D2', 1),
                ('E2', 1), ('E2', 1), ('B1', 1), ('E2', 2)],
               bpm, wave='triangle', gain=0.41)
    return mix(lead, bass, drums('xxoxxxo.' * 3, bpm, gain=0.21))


THEMES = {
    'horror-bellringer':     (horror_bellringer,     'Horror',     'Bell-Ringer'),
    'horror-creeper':        (horror_creeper,        'Horror',     'Creeper'),
    'horror-dirge':          (horror_dirge,          'Horror',     'Dirge'),
    'horror-stalker':        (horror_stalker,        'Horror',     'Stalker'),
    'wrestling-champion':    (wrestling_champion,    'Wrestling',  'Champion'),
    'wrestling-heel':        (wrestling_heel,        'Wrestling',  'Heel'),
    'wrestling-fanfare':     (wrestling_fanfare,     'Wrestling',  'Fanfare'),
    'wrestling-powerhouse':  (wrestling_powerhouse,  'Wrestling',  'Powerhouse'),
    'sports-leadoff':        (sports_leadoff,        'Sports',     'Lead-Off'),
    'sports-fastbreak':      (sports_fastbreak,      'Sports',     'Fast Break'),
    'sports-anthem':         (sports_anthem,         'Sports',     'Anthem'),
    'sports-hustle':         (sports_hustle,         'Sports',     'Hustle'),
}


if __name__ == '__main__':
    only = '--one' in sys.argv
    for key, (fn, mood, title) in THEMES.items():
        p = write(key, fn())
        secs = os.path.getsize(p)
        print(f'  {key:<26} {mood:<10} {title:<18} {secs / 1024:.0f}KB')
        if only:
            break
    print(f'\nwrote to {os.path.normpath(OUT)}')
