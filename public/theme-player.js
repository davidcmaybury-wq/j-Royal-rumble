// Entrance music, wherever it is played from.
//
// It used to live only on the watch screen, which was the wrong bet: a watch
// screen is optional. In a live match nobody had one open with sound, so every
// entrance passed in silence and the host filed a bug from the console — the
// one screen that could not have played it. Music now comes out of the buzzers
// and the host console, which always exist.
//
// One shared module rather than a copy in each: it is fiddly enough — the
// YouTube player has to be present and covered rather than hidden, and a
// browser can still refuse — that two versions would drift.

const CSS = `
.ytbox{position:fixed;right:14px;bottom:14px;width:200px;height:113px;z-index:70;
border:2px solid var(--line,#2A3556);border-radius:6px;overflow:hidden;background:#000}
.ytbox iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.ytcover{position:absolute;inset:0;background:var(--panel,#131A30);display:flex;
align-items:center;justify-content:center;gap:9px;text-align:center;padding:12px;
color:var(--chalk,#EEEBE1);font-size:13.5px}
.ytcover .note{color:var(--brass,#D6A93F);font-size:24px;line-height:1}
`;

let audioEl = null;
let frameEl = null;
let styled = false;

export function stopTheme() {
  if (audioEl) { audioEl.pause(); audioEl = null; }
  if (frameEl) { frameEl.remove(); frameEl = null; }
}

/**
 * Play one entrance.
 *
 * `enabled` is the caller's own sound state — a page that has not been clicked
 * cannot play anything anyway, and playing over a muted host console would be
 * worse than silence.
 */
export function playTheme(entrance, enabled = true) {
  if (!enabled || !entrance || !entrance.theme) return;
  stopTheme();
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  const t = entrance.theme;
  const secs = Math.min(10, Math.max(1, t.seconds || 5));

  if (t.kind === 'youtube') {
    // Present and covered, never hidden. Browsers refuse autoplay to an iframe
    // with no size, and YouTube will not start a player nobody can see — that
    // was the original failure. So it renders full size and a card goes over
    // the top: the sound comes through, the video does not.
    const box = document.createElement('div');
    box.className = 'ytbox';
    const f = document.createElement('iframe');
    f.width = 200; f.height = 113;
    f.allow = 'autoplay; encrypted-media';
    f.setAttribute('playsinline', '');
    f.src = `https://www.youtube-nocookie.com/embed/${t.id}`
      + `?autoplay=1&start=${t.start || 0}&controls=0&modestbranding=1&rel=0&playsinline=1`;
    box.appendChild(f);
    const cover = document.createElement('div');
    cover.className = 'ytcover';
    cover.innerHTML = `<span class="note">&#9835;</span><span>${
      entrance.name ? entrance.name + ' is coming in' : 'Entrance music'}</span>`;
    box.appendChild(cover);
    document.body.appendChild(box);
    frameEl = box;
    setTimeout(stopTheme, secs * 1000);
    return;
  }

  const src = t.kind === 'library' ? `/audio/themes/${t.key}.mp3` : t.url;
  const a = new Audio(src);
  a.volume = 0.85;
  audioEl = a;
  a.play().catch(() => { /* refused; the entrance still happens */ });
  a.onended = () => { if (audioEl === a) audioEl = null; };
  setTimeout(() => { if (audioEl === a) stopTheme(); }, secs * 1000);
}
