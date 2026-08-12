// Sound cues, shared by the console and the player buzzer.
//
// Browsers refuse to play audio until the page has been interacted with, so
// everything routes through unlock(), which the first tap or key press calls.

const FILES = {
  entry: '/audio/entry-horn.mp3',
  chop: '/audio/chop.mp3',
  count1: '/audio/countdown-1.mp3',
  count2: '/audio/countdown-2.mp3',
  count3: '/audio/countdown-3.mp3',
  lock: '/audio/lock.mp3',
  powerup: '/audio/powerup.mp3',
  join: '/audio/join.mp3',
};

const pool = {};
let ready = false;
let muted = false;

export function preload() {
  for (const [k, src] of Object.entries(FILES)) {
    const a = new Audio(src);
    a.preload = 'auto';
    a.volume = k === 'entry' ? 0.85 : k === 'chop' ? 0.9
      : k === 'lock' ? 0.7 : k === 'powerup' ? 0.8
      : k === 'join' ? 0.6 : 0.55;
    pool[k] = a;
  }
}

export function unlock() {
  if (ready) return;
  ready = true;
  // Nudge each element so the browser considers it user-initiated.
  for (const a of Object.values(pool)) {
    a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
  }
}

export const isReady = () => ready;
export const setMuted = (v) => { muted = v; };
export const isMuted = () => muted;

export function play(name) {
  if (muted) return;
  const a = pool[name];
  if (!a) return;
  try {
    // Clone so overlapping cues don't cut each other off — two eliminations
    // on one clue should sound like two.
    const c = a.cloneNode();
    c.volume = a.volume;
    c.play().catch(() => {});
  } catch (e) { /* nothing to be done */ }
}

// Two eliminations on the same clue used to stack a second cue behind the
// first, 190ms apart. That worked when the sound was an impact. It is a tune
// now, and two copies of a tune a fifth of a second apart is a mess — so it
// plays once however many players went out together.
export function chops() {
  play('chop');
}
