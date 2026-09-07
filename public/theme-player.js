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
/* Top right, and click-through.

   It used to sit at bottom:14px, which put a 200x113 box straight over the
   right-hand end of the host's dock — exactly where Correct / Wrong / Nobody
   are — for up to ten seconds, with nothing to let a click through. The host
   pressed Correct, nothing happened, and the console read as frozen until a
   reload. Reported after two matches on 0.95.8; measured at 1440x900 the box
   spanned y 773-886 against a dock starting at 808.

   This is the third time an overlay has taken the host's controls (the entry
   banner twice before). pointer-events:none is the guarantee; moving it clear
   of the dock is so it does not hide the buttons either. */
.ytbox{position:fixed;right:14px;top:58px;width:200px;height:113px;z-index:70;
pointer-events:none;
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
// The YouTube half used to have no failure signal at all. The audio half raises
// `theme-refused` when play() is rejected; the iframe was appended and then
// nobody asked whether anything came out of it, so a blocked embed and a
// playing one looked identical from here. Seven players set YouTube themes on
// 2026-09-07 and the room heard none of them, with nothing logged anywhere,
// because this is the branch almost everybody picks.
//
// enablejsapi=1 makes the player answer. Everything below exists to turn "it
// was quiet" into a reason somebody can act on.
let ytWatch = null;

const YT_REASON = {
  2: 'the link is malformed',
  5: 'the player failed in this browser',
  100: 'that video does not exist any more',
  101: 'the owner does not allow it to be embedded',
  150: 'the owner does not allow it to be embedded',
  153: 'YouTube refused to embed it here',
};

// `fix` matters as much as `reason`. "Click Sound" is right when the browser is
// waiting for a gesture and actively misleading when YouTube will not embed the
// video at all — the host would click Sound, hear nothing again, and conclude
// the console was broken.
function refuse(name, reason, fix) {
  window.dispatchEvent(new CustomEvent('theme-refused', { detail: { name, reason, fix } }));
}

// One listener for the module, not one per entrance: a listener added on every
// walk-in would still be there thirty entrances later, all of them firing.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (ev) => {
    if (!ytWatch) return;
    if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(ev.origin)) return;
    let d;
    try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
    if (!d || d.id !== ytWatch.id) return;
    if (d.event === 'onError') {
      ytWatch.settled = true;
      refuse(ytWatch.name, YT_REASON[d.info] || `YouTube error ${d.info}`,
        'That link cannot be used here — ask them for a different one.');
    }
    // 1 is playing. Anything reaching it means the room heard something.
    if (d.event === 'onStateChange' && d.info === 1) ytWatch.settled = true;
  });
}

export function stopTheme() {
  if (audioEl) { audioEl.pause(); audioEl = null; }
  if (frameEl) { frameEl.remove(); frameEl = null; }
  // Settle it before dropping it, or the silence check below fires against a
  // player the caller deliberately cut short when the buzzers armed.
  if (ytWatch) { ytWatch.settled = true; ytWatch = null; }
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
    // origin is required alongside enablejsapi, and YouTube checks it: the pair
    // has to travel together or the player answers nothing.
    f.src = `https://www.youtube-nocookie.com/embed/${t.id}`
      + `?autoplay=1&start=${t.start || 0}&controls=0&modestbranding=1&rel=0&playsinline=1`
      + `&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
    const watch = { id: 'jrr:' + Date.now(), name: entrance.name || null, settled: false };
    ytWatch = watch;
    f.onload = () => {
      // Subscribing is two messages, not one: `listening` opens the channel and
      // `addEventListener` asks for the events. Sending only the second gets a
      // player that never speaks, which is indistinguishable from the failure
      // this code exists to report.
      for (const ev of ['onReady', 'onStateChange', 'onError']) {
        try {
          f.contentWindow.postMessage(JSON.stringify(
            { event: 'listening', id: watch.id, channel: 'widget' }), '*');
          f.contentWindow.postMessage(JSON.stringify(
            { event: 'command', func: 'addEventListener', args: [ev], id: watch.id, channel: 'widget' }), '*');
        } catch { /* cross-origin before load; the timer below still reports */ }
      }
    };
    // If nothing has reported playing by now, nothing is going to. Long enough
    // to clear a slow start on a cold connection, short enough that the host
    // still has the entrance in mind when the console tells them.
    setTimeout(() => {
      if (ytWatch === watch && !watch.settled) {
        watch.settled = true;
        refuse(watch.name, 'YouTube never started playing',
          'Check the console for a player error, or ask them for a different link.');
      }
    }, 4000);
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
  // A refusal used to be swallowed here, so an entrance with no music looked
  // identical to one with music the host could not hear — nothing in the room
  // could tell which. The entrance still happens either way; the difference is
  // that somebody is now told why it was silent.
  a.play().catch((err) => {
    refuse(entrance.name || null,
      `the browser refused to play it (${(err && err.name) || 'refused'})`,
      'Click Sound to allow it.');
  });
  a.onended = () => { if (audioEl === a) audioEl = null; };
  setTimeout(() => { if (audioEl === a) stopTheme(); }, secs * 1000);
}
