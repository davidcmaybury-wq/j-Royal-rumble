// Shared client: connection, durable identity, and buzz timing.
// Loaded by both console.html and buzzer.html.

export const gameId = location.pathname.split('/')[2] || '';
export const hostKey = location.hash.slice(1);

export const socket = io({ transports: ['websocket'] });

// --- durable player identity -----------------------------------------
// The socket id changes on every reconnect. In an hour-long elimination
// match someone's wifi will blip, and coming back as a stranger would cost
// them their score and their place in the draw. So identity lives in a
// token on their own device, scoped per match.

const KEY = `rumble:${gameId}:token`;
export function myToken() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}
export function saveToken(t) {
  try { localStorage.setItem(KEY, t); } catch { /* private mode: session only */ }
}

// --- buzz timing ------------------------------------------------------
// The host's activation is compensated for Zoom audio lag: the server sends
// an absolute instant `at`, every client arms at that same instant, and the
// reaction clock starts there. One anchor for everyone — live players and
// spectators alike — or the comparison would be meaningless.

let armedAt = null;        // performance.now() value when buzzers went live
let lockoutMs = 250;
let earlyUntil = 0;
let sent = false;

export function armAt(serverInstant, lockout = 250) {
  lockoutMs = lockout;
  sent = false;
  const waitMs = serverInstant - Date.now();
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
  if (now < earlyUntil) return 'locked';
  if (armedAt == null || now < armedAt) {
    earlyUntil = now + lockoutMs;         // jumped the lights
    socket.emit('buzz', { ms: 0, status: 'early' });
    return 'early';
  }
  sent = true;
  socket.emit('buzz', { ms: Math.round((now - armedAt) * 10) / 10, status: 'good' });
  return 'sent';
}

// --- latency calibration ---------------------------------------------
// Mirrors the existing app: a rolling round-trip sample reported each ping
// cycle so the host can see who is on a slow connection.

let latencySamples = [];
export function startLatencyReports(intervalMs = 15000) {
  const ping = () => {
    const t0 = performance.now();
    socket.timeout(5000).emit('ping-probe', null, () => {
      const rtt = (performance.now() - t0) / 2;
      latencySamples.push(rtt);
      if (latencySamples.length > 8) latencySamples.shift();
      const avg = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
      socket.emit('buzzer-latency', [Math.round(avg * 10) / 10, latencySamples.length]);
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
