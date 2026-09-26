// Pull every match log off a host — the old one so the records survive a
// move, or the live one to hand a bundle to the analysis chat.
//
//   node --env-file=.env tools/pull-logs.mjs https://j-royal-rumble.net ~/Downloads/rumble-logs
//
// Uses the same /api/logs endpoints the log browser does, so it works from
// anywhere. The key comes from RUMBLE_LOG_KEY (or RUMBLE_ADMIN_KEY, which is a
// superset) in the environment and travels as a header, never on the command
// line and never in the URL: an argument sits in shell history and a query
// string sits in CloudFront's request logs. A third argument is still accepted
// for the old usage, but it takes the same route once it is here.
const [,, base, dest = './log-backup', keyArg = ''] = process.argv;
if (!base) {
  console.error('usage: node --env-file=.env tools/pull-logs.mjs <base-url> [dest-dir]');
  process.exit(1);
}
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const key = keyArg || process.env.RUMBLE_LOG_KEY || process.env.RUMBLE_ADMIN_KEY || '';
const headers = key ? { 'x-log-key': key, 'x-admin-key': key } : {};
const listing = await (await fetch(`${base}/api/logs`, { headers })).json();
if (listing.error) { console.error('server said:', listing.error); process.exit(1); }
const files = (listing.matches || []).map((m) => m.file || m);
console.log(`${files.length} logs on ${base} (durable=${listing.durable})`);
mkdirSync(dest, { recursive: true });

let got = 0, skipped = 0;
for (const f of files) {
  const out = join(dest, f);
  if (existsSync(out)) { skipped++; continue; }
  const r = await fetch(`${base}/api/logs/${encodeURIComponent(f)}`, { headers });
  if (!r.ok) { console.error(`  FAILED ${f}: ${r.status}`); continue; }
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  got++;
  if (got % 25 === 0) console.log(`  ${got}...`);
}
console.log(`done: ${got} fetched, ${skipped} already present, into ${dest}`);

// The simplest route is to run this ON the box and write straight into place —
// it only needs to reach the old host over HTTP, so there is no key to arrange
// and nothing to copy afterwards.
if (dest !== '/data/logs' && !/j-royal-rumble\.net/.test(base)) {
  console.log(`
To get them onto the live server, run this there rather than copying:

  cd /home/ubuntu/app && node tools/pull-logs.mjs ${base} /data/logs

Then check it took:

  curl -s localhost:8080/api/health | grep -o '"saved":[0-9]*'`);
} else {
  console.log('\nWritten straight into /data/logs. Check with:');
  console.log("  curl -s localhost:8080/api/health | grep -o '\"saved\":[0-9]*'");
}
