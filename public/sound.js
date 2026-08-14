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
  toprope: '/audio/toprope.mp3',
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
      : k === 'join' ? 0.6 : k === 'toprope' ? 0.75 : 0.55;
    pool[k] = a;
  }
}

// Unlocking only counts if it worked.
//
// The first version set ready = true before the play promises settled, so one
// call made without a user gesture marked the whole thing done and it never
// tried again. A whole match ran silently that way.
export async function unlock() {
  if (ready) return true;
  const first = pool.join || Object.values(pool)[0];
  if (!first) return false;
  // Silence everything while priming. The browser only needs a play() to have
  // happened during a gesture, not to have been heard — and unmuted, this fired
  // all nine cues at once on the first click of the setup screen, which sounded
  // like the page falling downstairs.
  const was = new Map();
  for (const [k, a] of Object.entries(pool)) { was.set(k, a.volume); a.volume = 0; }
  const restore = () => { for (const [k, a] of Object.entries(pool)) a.volume = was.get(k); };
  try {
    await first.play();
    first.pause();
    first.currentTime = 0;
    ready = true;
    // Prime the rest now that the browser is satisfied.
    const rest = Object.values(pool).filter((a) => a !== first)
      .map((a) => a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {}));
    Promise.all(rest).then(restore);
    return true;
  } catch (e) {
    // No gesture yet, or the file has not loaded. Leave ready false so the
    // next gesture tries again.
    restore();
    return false;
  }
}

/** Keep trying on every interaction until one of them takes. */
export function armUnlock() {
  const attempt = () => {
    unlock().then((ok) => {
      if (ok) {
        removeEventListener('pointerdown', attempt, true);
        removeEventListener('keydown', attempt, true);
      }
    });
  };
  addEventListener('pointerdown', attempt, true);
  addEventListener('keydown', attempt, true);
  attempt();
}

export const isReady = () => ready;
export const setMuted = (v) => { muted = v; };
export const isMuted = () => muted;

export function play(name) {
  if (muted) return;
  const a = pool[name];
  if (!a) return;
  // Rewind and reuse rather than cloning. A cloned element has never been
  // played during a user gesture and has not necessarily loaded its source, so
  // its play() was rejected and the rejection swallowed — silently, every time.
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => { ready = false; });
  } catch (e) { /* nothing useful to do here */ }
}

/** For the console, so a host can tell whether sound is actually working. */
export function diagnostics() {
  return {
    ready,
    muted,
    cues: Object.keys(pool).length,
    loaded: Object.values(pool).filter((a) => a.readyState >= 2).length,
  };
}

// Two eliminations on the same clue used to stack a second cue behind the
// first, 190ms apart. That worked when the sound was an impact. It is a tune
// now, and two copies of a tune a fifth of a second apart is a mess — so it
// plays once however many players went out together.
export function chops() {
  play('chop');
}
