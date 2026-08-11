// Shared client: connection, durable identity, and buzz timing.
// Loaded by both console.html and buzzer.html.

// The host console and admin window take the code from the path. The player
// buzzer sets it once the player has typed and confirmed it.
let _gameId = (location.pathname.split('/')[2] || '').toUpperCase();
export const gameId = () => _gameId;
export const setGameId = (v) => { _gameId = (v || '').toUpperCase(); };
export const hostKey = location.hash.slice(1);

export const socket = io({ transports: ['websocket'] });

// --- durable player identity -----------------------------------------
// The socket id changes on every reconnect. In an hour-long elimination
// match someone's wifi will blip, and coming back as a stranger would cost
// them their score and their place in the draw. So identity lives in a
// token on their own device, scoped per match.

const key = () => `rumble:${_gameId}:token`;
export function myToken() {
  try { return localStorage.getItem(key()) || null; } catch { return null; }
}
export function saveToken(t) {
  try { localStorage.setItem(key(), t); } catch { /* private mode: session only */ }
}

// --- buzz timing ------------------------------------------------------
// The host's activation is compensated for Zoom audio lag: the server sends
// an absolute instant `at`, every client arms at that same instant, and the
// reaction clock starts there. One anchor for everyone — live players and
// spectators alike — or the comparison would be meaningless.

// Wall clocks disagree. A device a second out would measure every reaction a
// second wrong, which is how a match ends up reporting 8ms buzzes. So we
// estimate the offset against the server and correct for it.
let clockOffset = 0;         // add to Date.now() to get server time
let offsetSamples = [];

export function syncClock(rounds = 5) {
  let done = 0;
  const step = () => {
    if (done++ >= rounds) return;
    const t0 = Date.now();
    socket.timeout(4000).emit('time-probe', null, (err, serverNow) => {
      if (err || !serverNow) return setTimeout(step, 400);
      const t1 = Date.now();
      const rtt = t1 - t0;
      // Assume the reply took half the round trip to reach us.
      offsetSamples.push({ rtt, offset: serverNow + rtt / 2 - t1 });
      // Trust the fastest exchanges; a slow one carries the most uncertainty.
      const best = offsetSamples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, 3);
      clockOffset = best.reduce((n, x) => n + x.offset, 0) / best.length;
      setTimeout(step, 250);
    });
  };
  step();
}

export const serverNow = () => Date.now() + clockOffset;
export const clockInfo = () => ({
  offset: Math.round(clockOffset),
  samples: offsetSamples.length,
  spread: offsetSamples.length > 1
    ? Math.round(Math.max(...offsetSamples.map((s) => s.offset))
      - Math.min(...offsetSamples.map((s) => s.offset))) : 0,
});

let armedAt = null;        // performance.now() value when buzzers went live
let lockoutMs = 250;
let earlyUntil = 0;
let sent = false;

// A personal nudge on top of the host's delay. Everyone's audio path is a
// little different — different Zoom client, different buffer, headphones or
// speakers — and only the player can feel whether theirs is early or late.
let personalLag = 0;
export function getLag() { return personalLag; }
export function setLag(ms) {
  personalLag = Math.max(-500, Math.min(1000, Math.round(ms / 10) * 10));
  try { localStorage.setItem('rumble:lag', String(personalLag)); } catch (e) {}
  return personalLag;
}
try {
  const stored = Number(localStorage.getItem('rumble:lag'));
  if (!isNaN(stored)) personalLag = stored;
} catch (e) {}

export function armAt(serverInstant, lockout = 250) {
  lockoutMs = lockout;
  sent = false;
  const waitMs = serverInstant + personalLag - serverNow();
  const target = performance.now() + waitMs;
  armedAt = target;
  return Math.max(0, waitMs);
}

export function disarm() { armedAt = null; sent = false; }

export function isArmed() { return armedAt != null && performance.now() >= armedAt; }

// Returns 'sent' | 'early' | 'locked' | 'duplicate'
export function attemptBuzz() {
  const now = performance.now();
  if (sent) return 'duplicate';
  if (now < earlyUntil) return 'locked';       // still serving the penalty
  if (armedAt == null || now < armedAt) {
    // Jumping the lights is a penalty, not an entry. This must NOT go to the
    // server as a buzz — an early press has no meaningful reaction time, and
    // sending one would put a zero at the front of the race.
    earlyUntil = now + lockoutMs;
    socket.emit('early-buzz');                 // recorded for stats only
    return 'early';
  }
  sent = true;
  socket.emit('buzz', { ms: Math.round((now - armedAt) * 10) / 10, status: 'good' });
  return 'sent';
}

// How much of the early-buzz penalty is left, in ms. Zero when clear.
export function lockoutRemaining() {
  return Math.max(0, Math.round(earlyUntil - performance.now()));
}

// --- latency calibration ---------------------------------------------
// Mirrors the existing app: a rolling round-trip sample reported each ping
// cycle so the host can see who is on a slow connection.

let latencySamples = [];
export function startLatencyReports(intervalMs = 8000) {
  const ping = () => {
    const t0 = performance.now();
    socket.timeout(5000).emit('ping-probe', null, () => {
      const rtt = (performance.now() - t0) / 2;
      latencySamples.push(rtt);
      if (latencySamples.length > 8) latencySamples.shift();
      // Report the median, not the mean. One slow exchange shouldn't make a
      // good connection look bad, and the host is using this to set the delay.
      const sorted = latencySamples.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      socket.emit('buzzer-latency', [Math.round(med * 10) / 10, latencySamples.length]);
    });
  };
  setInterval(ping, intervalMs);
  ping();
}

export const fmt = (n) => (n ?? 0).toLocaleString();
export const ord = (n) => {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
};
