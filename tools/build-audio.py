#!/usr/bin/env python3
"""Turns supplied recordings into the game's cues.

    python3 tools/build-audio.py sources/

Raw samples rarely drop straight into a game. They start with silence, decay
at whatever point the recordist stopped, sit at inconsistent loudness against
each other, and are usually drier than the moment they're scoring. This trims
to the onset, shapes the tail, matches levels across cues, and puts everything
in the same room.

Sources are documented in CREDITS.md. Anything not supplied falls back to the
synthesised version in make-audio.py — see that file for why those exist.
"""
import numpy as np
from scipy import signal
import subprocess, os, sys, glob

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'audio')


def decode(path, start=0.0, dur=None):
    cmd = ['ffmpeg', '-v', 'error', '-y']
    if start: cmd += ['-ss', str(start)]
    if dur: cmd += ['-t', str(dur)]
    cmd += ['-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', 'pipe:1']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0


def onset(x, thresh=0.02, block=0.02):
    b = int(block * SR)
    for i in range(0, len(x) - b, b):
        if np.sqrt((x[i:i + b] ** 2).mean()) > thresh:
            return max(0, i - b)          # keep a hair of the attack
    return 0


def tail(x, seconds=0.9, mix=0.22):
    """A short room. Enough to stop the cue sounding like it was recorded in a
    cupboard, not so much that it smears into the next clue."""
    n = int(SR * seconds)
    rng = np.random.default_rng(11)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 6.5, n))
    ir[0] = 1.0
    wet = signal.fftconvolve(x, ir)[:len(x) + n]
    wet /= np.max(np.abs(wet)) + 1e-9
    dry = np.pad(x, (0, len(wet) - len(x)))
    return dry * (1 - mix) + wet * mix


def shape(x, fade_in=0.008, fade_out=0.35):
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi: x[:fi] *= np.linspace(0, 1, fi)
    if fo: x[-fo:] *= np.linspace(1, 0, fo) ** 1.6
    return x


def loudness(x):
    """Rough RMS of the loudest half-second — a better level match than peak,
    which just tracks whichever cue has the sharpest transient."""
    b = int(0.5 * SR)
    if len(x) < b: return np.sqrt((x ** 2).mean())
    return max(np.sqrt((x[i:i + b] ** 2).mean()) for i in range(0, len(x) - b, b // 2))


def to_target(x, target=0.14):
    x = x * (target / (loudness(x) + 1e-9))
    peak = np.max(np.abs(x))
    if peak > 0.95: x *= 0.95 / peak         # keep the transients intact
    return x


def trim_tail(x, floor=0.004, keep=0.25):
    """Reverb padding leaves a second of near-silence on the end. Cut back to
    where the sound actually stops, plus a breath."""
    b = int(0.05 * SR)
    last = len(x)
    for i in range(len(x) - b, 0, -b):
        if np.sqrt((x[i:i + b] ** 2).mean()) > floor:
            last = min(len(x), i + b + int(keep * SR))
            break
    out = x[:last]
    fo = int(0.12 * SR)
    if len(out) > fo: out[-fo:] *= np.linspace(1, 0, fo)
    return out


def write(name, x, bitrate='128k'):
    raw = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    path = os.path.join(OUT, name + '.mp3')
    p = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le',
                        '-ar', str(SR), '-ac', '1', '-i', 'pipe:0', '-b:a', bitrate, path],
                       input=raw, capture_output=True)
    if p.returncode:
        print(p.stderr.decode()[:400]); sys.exit(1)
    print(f'  {name}.mp3  {len(x)/SR:.2f}s  {os.path.getsize(path)//1024}KB')


def find(folder, *words):
    for f in sorted(glob.glob(os.path.join(folder, '*'))):
        low = os.path.basename(f).lower()
        if any(w in low for w in words):
            return f
    return None


# ---------------------------------------------------------------- entry horn
def build_horn(src):
    # The usable blast sits a couple of seconds in; trim to the onset and take
    # the sustain before the recording starts falling away.
    x = decode(src, start=2.0, dur=4.4)
    x = x[onset(x):]
    x = x[:int(3.0 * SR)]
    x = shape(x, fade_in=0.006, fade_out=0.55)
    x = trim_tail(tail(x, seconds=1.1, mix=0.20))
    return to_target(x, 0.155)


# ------------------------------------------------------------------ the chop
def build_chop(src):
    # An impact arrives already decayed and usually already in a room, so this
    # adds far less than the horn needs. What matters is protecting the
    # transient: it's the whole character of the sound, and it's the first
    # thing lost to over-eager normalising.
    x = decode(src)
    x = x[onset(x, thresh=0.03):]
    x = x[:int(1.2 * SR)]
    x = shape(x, fade_in=0.0005, fade_out=0.18)
    x = trim_tail(tail(x, seconds=0.35, mix=0.10), floor=0.002, keep=0.12)
    return to_target(x, 0.115)


if __name__ == '__main__':
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'sources')
    os.makedirs(OUT, exist_ok=True)
    if not os.path.isdir(folder):
        print(f'no sources folder at {folder}'); sys.exit(1)

    print('building cues from', folder)
    horn = find(folder, 'horn', 'siren')
    chop = find(folder, 'chop', 'impact', 'blade', 'slam', 'shot', 'gun', 'exit', 'hit')

    if horn:
        print(f'  horn source: {os.path.basename(horn)}')
        write('entry-horn', build_horn(horn))
    else:
        print('  no horn source found — leaving the existing entry-horn.mp3 alone')

    if chop:
        print(f'  chop source: {os.path.basename(chop)}')
        write('chop', build_chop(chop))
    else:
        print('  no chop source found — leaving the existing chop.mp3 alone')

    print('countdown tones stay synthesised: python3 tools/make-audio.py')
