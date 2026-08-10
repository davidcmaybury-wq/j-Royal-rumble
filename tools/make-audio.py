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


def write(name, x, bitrate='112k'):
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


if __name__ == '__main__':
    print('writing sound cues:')
    np.random.seed(7)
    write('entry-horn', entry_horn())
    write('chop', chop())
    for i in range(3):
        write(f'countdown-{i + 1}', countdown(i), bitrate='96k')
    print('done')
