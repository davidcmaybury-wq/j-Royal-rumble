#!/usr/bin/env python3
"""Generates the Rumble's sound cues.

These are synthesised here rather than sourced from a sample library. That
makes the licensing unambiguous — nothing is borrowed, so nothing can be
mistaken for the real Royal Rumble buzzer, which is WWE's and stays theirs.

    python3 tools/make-audio.py        writes public/audio/*.mp3
"""
import numpy as np
from scipy import signal
import subprocess, os, sys

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio')
os.makedirs(OUT, exist_ok=True)


def t(seconds):
    return np.linspace(0, seconds, int(SR * seconds), endpoint=False)


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.3):
    """Attack/decay/sustain/release over n samples."""
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    si = max(0, n - ai - di - ri)
    return np.concatenate([
        np.linspace(0, 1, ai),
        np.linspace(1, s, di),
        np.full(si, s),
        np.linspace(s, 0, ri),
    ])[:n]


def saw(freq, dur, detune=0.0):
    x = t(dur)
    out = np.zeros_like(x)
    for k in range(1, 22):
        f = freq * k * (1 + detune)
        if f > SR / 2.2:
            break
        out += np.sin(2 * np.pi * f * x) / k
    return out


def reverb(x, seconds=1.4, mix=0.34):
    """Convolution with decaying noise. Crude, but it puts the sound in a room
    instead of in a browser tab, which is the entire difference between this
    reading as 'arena' and reading as 'arcade'."""
    n = int(SR * seconds)
    ir = np.random.randn(n) * np.exp(-np.linspace(0, 7, n))
    ir[0] = 1.0
    wet = signal.fftconvolve(x, ir)[:len(x) + n]
    wet /= np.max(np.abs(wet)) + 1e-9
    dry = np.pad(x, (0, len(wet) - len(x)))
    return dry * (1 - mix) + wet * mix


def lowpass_sweep(x, f0, f1):
    """Opens a filter across the sound. Done in blocks — good enough here and
    far cheaper than a true time-varying filter."""
    out = np.zeros_like(x)
    blocks = 40
    edges = np.linspace(0, len(x), blocks + 1).astype(int)
    freqs = np.linspace(f0, f1, blocks)
    for i in range(blocks):
        a, b = edges[i], edges[i + 1]
        if b <= a:
            continue
        wn = min(0.99, freqs[i] / (SR / 2))
        sos = signal.butter(2, wn, btype='low', output='sos')
        out[a:b] = signal.sosfilt(sos, x[a:b])
    return out


def norm(x, peak=0.89):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def loudness(x):
    """RMS of the loudest third of a second. Peak is the wrong measure here: a
    square wave with a hard attack peaks far higher than it sounds, so
    normalising to peak left the power-up much louder than everything else."""
    b = int(0.3 * SR)
    if len(x) < b:
        return np.sqrt((x ** 2).mean())
    return max(np.sqrt((x[i:i + b] ** 2).mean()) for i in range(0, len(x) - b, b // 2))


def write(name, x, bitrate='112k', target=None):
    if target:
        x = x * (target / (loudness(x) + 1e-9))
        peak = np.max(np.abs(x))
        if peak > 0.95:
            x = x * (0.95 / peak)
    else:
        x = norm(x)
    # short fade at both ends so nothing clicks
    f = int(0.006 * SR)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    raw = (x * 32767).astype('<i2').tobytes()
    path = os.path.join(OUT, name + '.mp3')
    p = subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR),
         '-ac', '1', '-i', 'pipe:0', '-b:a', bitrate, path],
        input=raw, capture_output=True)
    if p.returncode:
        print(p.stderr.decode()[:400]); sys.exit(1)
    print(f'  {name}.mp3  {len(x)/SR:.2f}s  {os.path.getsize(path)//1024}KB')


# ---------------------------------------------------------------- entry horn
# Two blasts of a big brass-and-air-horn hybrid. Low stack for weight, a fifth
# and octave above for brightness, a slow filter opening so it swells rather
# than simply starting.
def entry_horn():
    def blast(dur, root):
        x = t(dur)
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * x)
        body = (saw(root, dur) * 1.0
                + saw(root * 1.5, dur) * 0.55
                + saw(root * 2, dur) * 0.42
                + saw(root * 0.5, dur) * 0.7)
        body *= vib
        body += np.sin(2 * np.pi * root * 0.5 * x) * 0.8          # sub
        body = lowpass_sweep(body, 380, 5200)
        return body * adsr(len(body), a=0.045, d=0.16, s=0.72, r=0.35)

    a = blast(0.85, 138.6)          # C#3
    gap = np.zeros(int(0.10 * SR))
    b = blast(1.45, 138.6 * 1.335)  # up a fourth, held
    out = np.concatenate([a, gap, b])
    return reverb(out, seconds=1.25, mix=0.34)[:int(SR * 3.1)]


# ------------------------------------------------------------------ the chop
# An impact, not a note: a bright transient, a low body dropping away, and a
# short metallic ring so it lands like something struck rather than something
# played.
def chop():
    dur = 0.55
    x = t(dur)
    n = len(x)

    swish = np.random.randn(n) * np.exp(-np.linspace(0, 26, n))
    swish = lowpass_sweep(swish, 9000, 700) * 0.9

    thud = np.sin(2 * np.pi * np.cumsum(np.linspace(190, 42, n)) / SR)
    thud *= np.exp(-np.linspace(0, 11, n)) * 1.1

    ring = np.zeros(n)
    for f, g, dcy in ((1870, 0.30, 15), (2540, 0.20, 19), (3310, 0.13, 24)):
        ring += np.sin(2 * np.pi * f * x) * g * np.exp(-np.linspace(0, dcy, n))

    crack = np.random.randn(n) * np.exp(-np.linspace(0, 120, n)) * 0.8
    sos = signal.butter(2, 2600 / (SR / 2), btype='high', output='sos')
    crack = signal.sosfilt(sos, crack)

    return reverb(swish + thud + ring + crack, seconds=0.75, mix=0.26)[:int(SR * 1.05)]


# --------------------------------------------------------- countdown to entry
# Three rising tones, one per clue. Each is the same shape a step higher, so a
# player hears where they are in the sequence without being told.
def countdown(step):
    freqs = [392.0, 523.3, 659.3]          # G4, C5, E5
    f = freqs[step]
    dur = 0.42
    x = t(dur)
    body = (np.sin(2 * np.pi * f * x) * 1.0
            + np.sin(2 * np.pi * f * 2 * x) * 0.30
            + np.sin(2 * np.pi * f * 3 * x) * 0.12)
    body *= np.exp(-np.linspace(0, 5.5, len(x)))
    click = np.random.randn(len(x)) * np.exp(-np.linspace(0, 190, len(x))) * 0.25
    return reverb(body + click, seconds=0.5, mix=0.22)[:int(SR * 0.75)]


# ------------------------------------------------------------- missile lock
# Synthesised on purpose. The horn and the impact are physical events with
# textures worth sampling; an avionics warning is an electronic signal, so
# generating one produces the same kind of thing the real one is.
def lock_tone():
    beep_hz, gap, reps = 0.055, 0.055, 7
    out = []
    for i in range(reps):
        x = t(beep_hz)
        # square-ish, two tones a fifth apart, the way cockpit warnings sit
        tone_a = signal.square(2 * np.pi * 1180 * x, duty=0.42)
        tone_b = signal.square(2 * np.pi * 1770 * x, duty=0.35) * 0.45
        env = np.minimum(1, np.linspace(0, 14, len(x))) * np.exp(-np.linspace(0, 2.2, len(x)))
        out.append((tone_a + tone_b) * env * 0.5)
        out.append(np.zeros(int(gap * SR)))
    body = np.concatenate(out)
    sos = signal.butter(4, [700 / (SR / 2), 4800 / (SR / 2)], btype='band', output='sos')
    body = signal.sosfilt(sos, body)
    return reverb(body, seconds=0.35, mix=0.13)[:int(SR * 0.95)]


# ------------------------------------------------------------- stakes rising
# A chiptune power-up: a short figure repeated up the scale, on a square wave.
#
# Synthesised rather than sampled, and deliberately not anybody else's jingle.
# The 8-bit power-up is a genre, not a recording, and a rapid ascending
# arpeggio on a square wave is what makes one — so this is built from the same
# ingredients without borrowing the tune.
def powerup():
    # A three-note figure, transposed up a fifth each time it repeats.
    figure = [0, 4, 7]              # a major triad, in semitones
    steps = [0, 7, 14, 21, 28]      # the figure climbs by fifths
    root = 261.6                    # middle C
    note = 0.042                    # seconds per note — fast enough to read as a run
    out = []
    for si, step in enumerate(steps):
        for fi, semis in enumerate(figure):
            f = root * (2 ** ((step + semis) / 12))
            x = t(note)
            # Duty narrows as it climbs, which brightens the top of the run.
            duty = 0.5 - 0.14 * (si / max(1, len(steps) - 1))
            tone_ = signal.square(2 * np.pi * f * x, duty=duty)
            # A hard attack and a short tail: the notes should click along.
            env = np.minimum(1, np.linspace(0, 22, len(x))) * np.exp(-np.linspace(0, 3.2, len(x)))
            # A quiet octave below keeps it from sounding thin on laptop speakers.
            sub = signal.square(2 * np.pi * f * 0.5 * x, duty=0.5) * 0.22
            out.append((tone_ + sub) * env * 0.42)

    # One last note on top, held a little longer, to land it.
    f = root * (2 ** ((steps[-1] + 12) / 12))
    x = t(0.16)
    env = np.minimum(1, np.linspace(0, 30, len(x))) * np.exp(-np.linspace(0, 5.5, len(x)))
    out.append((signal.square(2 * np.pi * f * x, duty=0.34)
                + signal.square(2 * np.pi * f * 0.5 * x, duty=0.5) * 0.3) * env * 0.5)

    body = np.concatenate(out)
    sos = signal.butter(2, 7000 / (SR / 2), btype='low', output='sos')
    body = signal.sosfilt(sos, body)
    return reverb(body, seconds=0.4, mix=0.12)[:int(SR * 0.95)]


# ------------------------------------------------------------ up on the ropes
# Short and taunting: two notes up, one insolent one back down, on a bright
# square wave. A dare rather than an achievement — the power-up climbs three
# octaves and takes a second, this is over in a third of that.
def top_rope():
    notes = [(587.3, 0.055), (784.0, 0.055), (1046.5, 0.075), (880.0, 0.11)]
    out = []
    for i, (f, dur) in enumerate(notes):
        x = t(dur)
        duty = 0.30 if i < 3 else 0.22
        body = signal.square(2 * np.pi * f * x, duty=duty)
        body += signal.square(2 * np.pi * f * 2 * x, duty=0.5) * 0.18
        body += signal.square(2 * np.pi * f * 0.5 * x, duty=0.5) * 0.20
        env = np.minimum(1, np.linspace(0, 26, len(x))) * np.exp(-np.linspace(0, 3.6, len(x)))
        out.append(body * env * 0.45)
        if i < 3:
            out.append(np.zeros(int(0.012 * SR)))
    body = np.concatenate(out)
    sos = signal.butter(2, 8000 / (SR / 2), btype='low', output='sos')
    return reverb(signal.sosfilt(sos, body), seconds=0.3, mix=0.11)[:int(SR * 0.55)]


if __name__ == '__main__':
    print('writing synthesised cues:')
    np.random.seed(7)
    # The horn and the chop ship as processed recordings — see build-audio.py.
    # Pass --all to regenerate the synthesised fallbacks over the top of them.
    if '--all' in sys.argv:
        write('entry-horn', entry_horn())
        write('chop', chop())
    for i in range(3):
        write(f'countdown-{i + 1}', countdown(i), bitrate='96k', target=0.105)
    write('lock', lock_tone(), bitrate='96k', target=0.130)
    # Matched to the sampled cues, which sit around 0.13-0.16.
    write('powerup', powerup(), bitrate='112k', target=0.145)
    write('toprope', top_rope(), bitrate='112k', target=0.132)
    print('done')
