// The host's voice on this screen. Shared by the buzzer, the watch screen and
// the console, so the three play a clip the same way and report the same
// number back.
//
// The server sends `host-speaks {sid, host, text, url, durationMs, at}` and
// has already scheduled whatever comes next off `durationMs`; this page's job
// is to start the clip as fast as it can and say when it did. `heard {sid,
// lateMs}` is the gap between the server's send and this client's playback
// start, in server time, and the spread of it across a room is the one number
// the autohost design leaves to measurement (docs/autohost-design.md, "two
// players hear the read at different times"). A clip that cannot play is
// reported too, with a reason, because a silent host with no signal is the
// bug this project keeps finding.
//
// Autoplay: a page that has had no gesture cannot play anything. The element
// is primed on the first pointer or key event, the same way sound.js unlocks
// its cues, and until then every clip is refused and `onRefused` fires so the
// page can say "turn your sound on" instead of standing there.

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

// `now` is the page's server-synced clock (rumble.js's serverNow). A page
// without one — the watch screen has no clock sync — still plays, but does not
// report `heard`: a number off an unsynced clock would be a lie in the spread.
export function attachHostVoice(socket, { now = null, onSpeak = () => {}, onRefused = () => {}, enabled = () => true } = {}) {
  const el = new Audio();
  el.preload = 'auto';
  let primed = false, current = null;

  async function prime() {
    if (primed) return true;
    try {
      el.src = SILENT_WAV;
      await el.play();
      el.pause();
      primed = true;
      removeEventListener('pointerdown', tryPrime, true);
      removeEventListener('keydown', tryPrime, true);
    } catch { /* no gesture yet; the next one tries again */ }
    return primed;
  }
  const tryPrime = () => { prime(); };
  addEventListener('pointerdown', tryPrime, true);
  addEventListener('keydown', tryPrime, true);
  prime();

  socket.on('host-speaks', (msg) => {
    current = msg;
    onSpeak(msg);
    if (!msg.url) return;            // read from the clock; the text is on screen
    if (!enabled()) return;          // this screen has sound off on purpose
    if (!primed) { onRefused(msg, 'no gesture yet'); return; }
    try {
      el.src = msg.url;
      el.currentTime = 0;
      const p = el.play();
      const report = () => {
        if (current !== msg || !now) return;
        socket.emit('heard', { sid: msg.sid, lateMs: now() - msg.at });
      };
      el.onplaying = report;
      if (p && p.catch) p.catch((e) => onRefused(msg, e && e.name ? e.name : 'refused'));
    } catch (e) {
      onRefused(msg, e && e.message ? e.message : 'refused');
    }
  });

  // The next thing the host says replaces this one; nothing else stops it.
  return {
    isPrimed: () => primed,
    stop: () => { try { el.pause(); } catch { /* fine */ } },
  };
}
