// Measures real latency to a running J! Royal Rumble host.
//
//   node tools/ping-host.mjs https://j-royal-rumble.net
//   node tools/ping-host.mjs https://j-royal-rumble.net https://j-royal-rumble.fly.dev
//
// Run it from wherever a player actually sits — a Codespace answers "how far is
// the datacentre from another datacentre", which is not the question. What
// matters is the spread across the room, not any one number: the buzzer
// measures reaction on the player's own device, so a long line delays when your
// lights come on but does not make your reported time slower.
import { io } from 'socket.io-client';

const bases = process.argv.slice(2);
if (!bases.length) {
  console.error('usage: node tools/ping-host.mjs <base-url> [more-urls...]');
  process.exit(1);
}
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)];
const f = (n) => (n == null ? '   -' : String(Math.round(n)).padStart(4));

for (const base of bases) {
  process.stdout.write(`\n${base}\n`);
  let health;
  try {
    const t0 = Date.now();
    health = await (await fetch(`${base}/api/health`)).json();
    process.stdout.write(`  version ${health.version}, first byte ${Date.now() - t0}ms\n`);
  } catch (e) {
    console.log(`  unreachable: ${e.message}`);
    continue;
  }

  // HTTPS round trips, which include TLS resumption and the CDN hop.
  const https = [];
  for (let i = 0; i < 15; i++) {
    const t = Date.now();
    await fetch(`${base}/api/health?cb=${Math.random()}`, { cache: 'no-store' });
    https.push(Date.now() - t);
  }
  console.log(`  HTTPS    min ${f(Math.min(...https))}  median ${f(pct(https, 0.5))}  p90 ${f(pct(https, 0.9))}  max ${f(Math.max(...https))}`);

  // The socket is what the buzzer actually uses, and the only number that
  // affects play — it sets how late your lights come on.
  const sock = io(base, { transports: ['websocket'] });
  const opened = Date.now();
  const ok = await new Promise((r) => {
    sock.once('connect', () => r(true));
    sock.once('connect_error', () => r(false));
    setTimeout(() => r(false), 8000);
  });
  if (!ok) { console.log('  socket   could not connect'); continue; }
  console.log(`  socket   connected in ${Date.now() - opened}ms`);

  const rtts = [];
  for (let i = 0; i < 20; i++) {
    const t = Date.now();
    // socket.io's own heartbeat, which is what the client library uses anyway.
    const answered = await new Promise((r) => {
      let done = false;
      sock.timeout(4000).emit('ping-probe', {}, (err) => { done = true; r(!err); });
      setTimeout(() => { if (!done) r(false); }, 4500);
    });
    if (!answered) { console.log('  socket   host did not answer the probe (old version?)'); break; }
    rtts.push(Date.now() - t);
    await new Promise((r) => setTimeout(r, 40));
  }
  console.log(`  socket   min ${f(Math.min(...rtts))}  median ${f(pct(rtts, 0.5))}  p90 ${f(pct(rtts, 0.9))}  max ${f(Math.max(...rtts))}`);
  sock.close();
}

console.log(`
What to make of it
  Under ~60ms median   nobody will notice.
  60-120ms             fine; the lag trim on the buzzer exists for this.
  Over ~150ms          worth a look, but check it is not just that one person's wifi.

The spread across your players matters more than the number. Reaction time is
measured on each player's own device, so a slow line shifts when their lights
come on, not how fast the server thinks they pressed.`);
