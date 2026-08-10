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
};

const pool = {};
let ready = false;
let muted = false;

export function preload() {
  for (const [k, src] of Object.entries(FILES)) {
    const a = new Audio(src);
    a.preload = 'auto';
    a.volume = k === 'entry' ? 0.85 : k === 'chop' ? 0.9 : 0.55;
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

// Two eliminations on the same clue: a second chop just behind the first.
export function chops(n = 1) {
  play('chop');
  for (let i = 1; i < Math.min(n, 3); i++) setTimeout(() => play('chop'), 190 * i);
}
