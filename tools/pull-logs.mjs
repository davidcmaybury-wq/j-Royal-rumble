// Pull every match log off the old host, so the records survive the move.
//
//   node tools/pull-logs.mjs https://j-royal-rumble.fly.dev ./log-backup [logkey]
//
// Uses the same /api/logs endpoints the log browser does, so it works from
// anywhere without flyctl. The key is only needed if RUMBLE_LOG_KEY is set on
// the server.
const [,, base, dest = './log-backup', key = ''] = process.argv;
if (!base) {
  console.error('usage: node tools/pull-logs.mjs <base-url> [dest-dir] [logkey]');
  process.exit(1);
}
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const auth = key ? `?key=${encodeURIComponent(key)}` : '';
const listing = await (await fetch(`${base}/api/logs${auth}`)).json();
if (listing.error) { console.error('server said:', listing.error); process.exit(1); }
const files = (listing.matches || []).map((m) => m.file || m);
console.log(`${files.length} logs on ${base} (durable=${listing.durable})`);
mkdirSync(dest, { recursive: true });

let got = 0, skipped = 0;
for (const f of files) {
  const out = join(dest, f);
  if (existsSync(out)) { skipped++; continue; }
  const r = await fetch(`${base}/api/logs/${encodeURIComponent(f)}${auth}`);
  if (!r.ok) { console.error(`  FAILED ${f}: ${r.status}`); continue; }
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  got++;
  if (got % 25 === 0) console.log(`  ${got}...`);
}
console.log(`done: ${got} fetched, ${skipped} already present, into ${dest}`);
console.log('\nnext: push them to the new machine —');
console.log('  aws s3 cp ' + dest + ' s3://YOUR-BUCKET/logs --recursive');
console.log('  then on the instance (via SSM session):');
console.log('  aws s3 cp s3://YOUR-BUCKET/logs /data/logs --recursive');
