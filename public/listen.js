// The player's microphone, on the player's own machine.
//
// The browser does the speech recognition — Chrome and Edge send the audio to
// their own speech service and hand back text, the same as any dictation
// feature on the web — and this module sends the SERVER only that text. We
// never receive, see, or pay for audio, and there is no speech service of
// ours to be down; a player who denies the microphone costs only themselves.
// **The approach is Matt Schiffler's**, from j-trivia's autohost, and so are
// most of the details below — each of them is something that bit him in a live
// match. `docs/autohost-from-jtrivia.md` records what was taken.
//
// Two kinds of window, both opened by the server's `listen` event:
//
//   answer   the buzz winner, five seconds, one sentence. Continuous mode so
//            Chrome's own silence cutoff cannot end the session while they are
//            still thinking — the real deadline is the server's, and ours only
//            has to not fire first.
//   pick     the board-holder, the whole pick clock, several tries allowed.
//            Asks for ranked alternatives, because a recognizer's second guess
//            often carries the category word the first one mangled, and the
//            matcher merges them.
//
// `SpeechRecognition` is Chrome and Edge. Everywhere else this reports itself
// unsupported at join time so the buzzer can say so once, rather than the
// player finding out when they win a race.

export const supported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * Warm the recognition pipeline on a real user gesture.
 *
 * Matt's, and the reason is worth keeping: without it, the first genuine mic
 * request of the match happens deep inside an async chain, often twenty
 * seconds after anybody last touched the page and right after a long stretch
 * of audio playback — which is where Chrome is most likely to make a meal of
 * it. Two throwaway sessions with no handlers, aborted immediately.
 */
export function prime() {
  const S = SR();
  if (!S) return;
  const fire = () => {
    try {
      const rec = new S();
      rec.lang = 'en-US';
      rec.continuous = false;
      rec.onerror = () => {};
      rec.onresult = () => {};
      rec.start();
      setTimeout(() => { try { rec.abort() } catch (e) {} }, 1);
    } catch (e) { /* already running, or refused: the real one will say so */ }
  };
  fire();
  setTimeout(fire, 200);
}

/**
 * Listen for one window.
 *
 * `onText(alternatives, { final })` fires when the recognizer commits to
 * something. `stop()` tears the session down; call it when the window closes
 * for any reason, including the server closing it.
 *
 * The teardown is deliberately thorough. Nulling `onend` and `onerror` BEFORE
 * abort is not tidiness: `.abort()` commonly fires `onerror` on its way out,
 * and an `onerror` whose job is "restart if we are still listening" will
 * cheerfully spin up an orphan recognizer nobody is tracking. Matt lost real
 * time to that one.
 */
export function listen({ kind, onText, onTrouble = () => {} }) {
  const S = SR();
  if (!S) { onTrouble('this browser cannot do speech recognition'); return { stop() {} }; }

  let rec = null, dead = false, best = '', lastAt = 0;

  const teardown = () => {
    if (!rec) return;
    try { rec.onresult = null; rec.onerror = null; rec.onend = null; rec.abort(); } catch (e) {}
    rec = null;
  };

  const start = () => {
    if (dead) return;
    teardown();
    const r = new S();
    r.lang = 'en-US';
    // Continuous for both, for the same reason: the window's length is the
    // server's business, and a recognizer that decides on its own that you
    // have stopped talking is a recognizer that cuts you off mid-thought.
    r.continuous = true;
    // Interim results give a best-known-so-far to fall back on if the window
    // closes before the recognizer commits. Better than discarding an answer
    // that was genuinely heard but not yet confirmed.
    r.interimResults = true;
    // Only the pick needs ranked alternatives; an answer is judged on content
    // and a second-best guess there is noise.
    r.maxAlternatives = kind === 'pick' ? 5 : 1;

    r.onresult = (event) => {
      const now = (performance && performance.now) ? performance.now() : Date.now();
      const result = event.results[event.results.length - 1];
      const alts = [];
      for (let i = 0; i < result.length; i++) {
        const t = (result[i].transcript || '').trim();
        if (t && alts.indexOf(t) === -1) alts.push(t);
      }
      if (!alts.length) return;
      best = alts[0];
      if (!result.isFinal) return;
      // Debounce: continuous mode can deliver the same committed phrase twice
      // in quick succession, and for an answer that means two rulings.
      if (now - lastAt < 400) return;
      lastAt = now;
      onText(alts, { final: true });
    };
    r.onerror = (e) => {
      const why = (e && e.error) || 'unknown';
      // `no-speech` and `aborted` are the normal shape of a quiet window and
      // of our own teardown; neither is worth telling the player about.
      if (why !== 'no-speech' && why !== 'aborted') onTrouble(why);
      if (!dead) setTimeout(start, 200);
    };
    r.onend = () => { if (!dead) setTimeout(start, 200); };
    rec = r;
    try { r.start(); } catch (e) { onTrouble(e && e.message ? e.message : 'could not start'); }
  };

  start();

  return {
    /** The best guess so far, committed or not — for a window closing empty. */
    best: () => best,
    stop() { dead = true; teardown(); },
  };
}
