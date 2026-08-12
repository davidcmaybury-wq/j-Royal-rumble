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
    # A short arcade phrase, kept whole and given a little room so it carries
    # over a shared screen. The siren this replaced needed trimming to its
    # onset and a long tail; a jingle needs neither.
    x = decode(src)
    lead = onset(x, thresh=0.02)
    if lead > int(0.05 * SR):
        x = x[lead:]
    x = shape(x, fade_in=0.002, fade_out=0.06)
    x = tail(x, seconds=0.3, mix=0.10)
    x = trim_tail(x, floor=0.002, keep=0.10)
    return to_target(x, 0.155)


def resample(x, factor):
    """Crude pitch shift: read the samples at a different rate. Slower than 1
    drops the pitch and lengthens it, which is exactly what a smaller sibling
    of a sound wants."""
    n = int(len(x) / factor)
    idx = np.linspace(0, len(x) - 1, n)
    return np.interp(idx, np.arange(len(x)), x)


# ------------------------------------------------------- going out of the ring
def build_chop(src):
    # This one is a musical phrase, not an impact, and it wants the opposite
    # treatment. An impact is trimmed hard to its onset and cut short to protect
    # the transient; a jingle has to keep its whole shape or it stops resolving.
    # So: no onset trim beyond leading silence, no truncation, and only a
    # whisper of room since a chiptune already sits in its own space.
    x = decode(src)
    lead = onset(x, thresh=0.02)
    if lead > int(0.05 * SR):          # only trim if there is real silence there
        x = x[lead:]
    x = shape(x, fade_in=0.002, fade_out=0.06)
    x = tail(x, seconds=0.25, mix=0.07)
    x = trim_tail(x, floor=0.002, keep=0.10)
    return to_target(x, 0.135)


# --------------------------------------------------------- somebody signs up
def build_join(src):
    # The same source as the entry cue, deliberately: signing up and walking
    # into the ring are the same kind of event at different scales, so this is
    # the same phrase made smaller. Pitched down five semitones and cut to its
    # opening, so it reads as a relative of the horn rather than a repeat of it.
    #
    # Quieter than everything else too — the host hears this thirty times while
    # a room fills up, and a cue you hear thirty times should sit under the
    # conversation rather than on top of it.
    x = decode(src)
    lead = onset(x, thresh=0.02)
    if lead > int(0.05 * SR):
        x = x[lead:]
    x = resample(x, 2 ** (-5 / 12))
    x = x[:int(0.5 * SR)]
    x = shape(x, fade_in=0.002, fade_out=0.10)
    x = tail(x, seconds=0.18, mix=0.05)
    x = trim_tail(x, floor=0.002, keep=0.06)
    return to_target(x, 0.090)


if __name__ == '__main__':
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'sources')
    os.makedirs(OUT, exist_ok=True)
    if not os.path.isdir(folder):
        print(f'no sources folder at {folder}'); sys.exit(1)

    print('building cues from', folder)
    horn = find(folder, 'start', 'horn', 'siren')
    chop = find(folder, 'die', 'lose', 'chop', 'impact', 'blade', 'slam', 'shot', 'gun', 'exit', 'hit')

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

    join = find(folder, 'start', 'join', 'reload', 'coin')
    if join:
        print(f'  join source: {os.path.basename(join)}')
        write('join', build_join(join))
    else:
        print('  no join source found — leaving the existing join.mp3 alone')

    print('countdown tones stay synthesised: python3 tools/make-audio.py')
