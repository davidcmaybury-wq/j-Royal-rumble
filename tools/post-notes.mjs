// Post release notes to the room by hand, or see what would go.
//
//   node tools/post-notes.mjs --dry-run                 what the catch-up digest would say
//   node tools/post-notes.mjs --catch-up                post everything never posted, as one digest
//   node tools/post-notes.mjs --catch-up --since 0.97.0 ...skipping versions the room heard about by hand
//   node tools/post-notes.mjs --version 0.102.0         post one version's full note
//   node tools/post-notes.mjs --mark-posted 0.97.0,0.98.0   record without posting
//
// Needs the bot's environment, which on the box lives in /etc/rumble.env and is
// root-only, so run it there as:
//
//   cd /home/ubuntu/app && sudo bash -c 'set -a; . /etc/rumble.env; set +a; node tools/post-notes.mjs --dry-run'
//
// The record of what has gone out is the same one the server keeps
// (/data/notes-posted.json on the box), so a version posted here is not
// posted again at the next boot, and vice versa.
import * as notes from '../src/notes.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const dryRun = flag('--dry-run');

const show = (msgs) => msgs.forEach((m, i) => {
  console.log(`\n--- message ${i + 1} of ${msgs.length} (${m.length} chars) ---\n${m}`);
});

if (value('--mark-posted')) {
  const vs = value('--mark-posted').split(',').map((s) => s.trim()).filter(Boolean);
  const p = notes.markPosted(vs);
  console.log(`recorded as posted: ${vs.join(', ')} -> ${notes.POSTED_FILE} (${p.versions.length} total)`);
} else if (value('--version')) {
  const v = value('--version');
  const note = notes.find(v);
  if (!note) { console.error(`no note for ${v} in ${notes.NOTES_FILE}`); process.exit(1); }
  const text = notes.message(note);
  show([text]);
  if (text.length > notes.DISCORD_CAP) { console.error(`too long for Discord (${notes.DISCORD_CAP})`); process.exit(1); }
  if (!dryRun) {
    if (!notes.ready()) { console.error('cannot post: no Discord bot or room channel configured (or RUMBLE_NOTES=off)'); process.exit(1); }
    const { announce } = await import('../src/discord.js');
    await announce(text);
    notes.markPosted([v]);
    console.log(`\nposted ${v}; recorded in ${notes.POSTED_FILE}`);
  }
} else {
  const r = await notes.catchUp({ dryRun: dryRun || !flag('--catch-up'), since: value('--since') });
  if (!r.versions.length) { console.log('nothing to catch up: every version in the notes file is recorded as posted'); process.exit(0); }
  console.log(`versions never posted: ${r.versions.join(', ')}`);
  show(r.messages);
  if (dryRun || !flag('--catch-up')) {
    console.log('\n(dry run — add --catch-up without --dry-run to post and record)');
  } else {
    console.log(`\nposted ${r.messages.length} message(s); recorded ${r.versions.length} version(s) in ${notes.POSTED_FILE}`
      + (notes.durable() ? '' : ' — NOT under /data, so the next deploy forgets it'));
  }
}
