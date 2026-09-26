// Release notes for the room.
//
// docs/release-notes.md is the source, the way discord-rules-v2.md is for
// /rules-101: one section per version, newest first. The server posts the
// section for the version it is running to the room channel once, at boot,
// when the bot is configured; tools/post-notes.mjs posts a digest of whatever
// was never posted. What has gone out is recorded beside the logs — /data when
// it exists, next to the app otherwise — so a restart cannot repost, and a
// deploy that fails halfway cannot lose the record.
//
// Nothing here throws at the server: a note that cannot go out is a line in
// the journal, never a boot failure. A missing note for the running version is
// the one case test/notes.mjs refuses before a release, because a version with
// nothing to say to the room is a version nobody wrote up.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as discord from './discord.js';

const __dir = dirname(fileURLToPath(import.meta.url));

export const NOTES_FILE = process.env.RUMBLE_NOTES_FILE || join(__dir, '../docs/release-notes.md');
export const POSTED_FILE = process.env.RUMBLE_NOTES_POSTED
  || (existsSync('/data') ? '/data/notes-posted.json' : join(process.cwd(), 'notes-posted.json'));
export const durable = () => POSTED_FILE.startsWith('/data');

// Discord cuts a message at 2,000 characters, silently. Same cap guides.mjs
// enforces on the rules; the same reason.
export const DISCORD_CAP = 2000;

/** The sections of the notes file, newest first as written. */
export function parse(text = readFileSync(NOTES_FILE, 'utf8')) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^## (\d+\.\d+\.\d+)\s+—\s+(.+?)\s*$/.exec(line);
    if (m) { cur = { version: m[1], title: m[2], lines: [] }; out.push(cur); continue; }
    if (cur && !/^# /.test(line)) cur.lines.push(line);
  }
  for (const n of out) { n.body = n.lines.join('\n').trim(); delete n.lines; }
  return out;
}

export const find = (version, notes = parse()) => notes.find((n) => n.version === version) || null;

export function compare(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

const site = (publicUrl) => publicUrl || discord.config().publicUrl || 'https://j-royal-rumble.net';

/** One version, as it goes to the room. Angle brackets keep Discord from unfurling the link. */
export function message(note, { publicUrl } = {}) {
  return `**J! Royal Rumble ${note.version} — ${note.title}**\n${note.body}\n<${site(publicUrl)}/history>`;
}

/**
 * Several versions at once, oldest first, titles only — one message where it
 * fits, split at version boundaries where it does not. Thirty people get one
 * post about what changed, not ten; one post too many is how a room mutes a bot.
 */
export function digest(notes, { publicUrl } = {}) {
  const head = '**J! Royal Rumble — what changed since you last heard from me**\n';
  const foot = `\nThe long version of each: <${site(publicUrl)}/history>`;
  const items = [...notes].sort((a, b) => compare(a.version, b.version))
    .map((n) => `• **${n.version}** — ${n.title}`);
  const msgs = [];
  let cur = head;
  for (const it of items) {
    if ((cur + it + '\n' + foot).length > DISCORD_CAP && cur !== head) { msgs.push(cur + foot); cur = head; }
    cur += it + '\n';
  }
  msgs.push(cur + foot);
  return msgs;
}

export function posted() {
  try { return JSON.parse(readFileSync(POSTED_FILE, 'utf8')); } catch { return { versions: [] }; }
}

/** Atomic, through a rename, like the availability store. */
export function markPosted(versions) {
  const p = posted();
  for (const v of versions) if (!p.versions.includes(v)) p.versions.push(v);
  p.updatedAt = new Date().toISOString();
  mkdirSync(dirname(POSTED_FILE), { recursive: true });
  const tmp = `${POSTED_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2) + '\n');
  renameSync(tmp, POSTED_FILE);
  return p;
}

/** Can a note go out at all: a bot, a room channel, and nobody has switched it off. */
export function ready() {
  const s = discord.status();
  return s.bot && s.roomChannel && process.env.RUMBLE_NOTES !== 'off';
}

const whyNot = () => (process.env.RUMBLE_NOTES === 'off'
  ? 'RUMBLE_NOTES=off' : 'no Discord bot or room channel configured');

/** At boot: this version's note, once. Never throws; returns what happened. */
export async function autoPost(version, { log = console } = {}) {
  if (!ready()) return { posted: false, why: whyNot() };
  if (posted().versions.includes(version)) return { posted: false, why: 'already posted' };
  let note;
  try { note = find(version); } catch (e) { return { posted: false, why: `notes file: ${e.message}` }; }
  if (!note) return { posted: false, why: `no note for ${version} in docs/release-notes.md` };
  const text = message(note);
  if (text.length > DISCORD_CAP) {
    return { posted: false, why: `the note for ${version} is ${text.length} characters; Discord takes ${DISCORD_CAP}` };
  }
  try {
    await discord.announce(text);
    markPosted([version]);
    log.log(`release note ${version} posted to the room`);
    return { posted: true };
  } catch (e) {
    log.warn(`release note ${version} not posted: ${e.message}`);
    return { posted: false, why: e.message };
  }
}

/**
 * Everything never posted, as one digest. `since` trims older versions off
 * the front — the ones the room heard about by hand. Dry runs compose and
 * mark nothing.
 */
export async function catchUp({ dryRun = false, since = null } = {}) {
  const done = new Set(posted().versions);
  let missing = parse().filter((n) => !done.has(n.version));
  if (since) missing = missing.filter((n) => compare(n.version, since) >= 0);
  const versions = missing.map((n) => n.version).sort(compare);
  if (!missing.length) return { messages: [], versions };
  const messages = digest(missing);
  if (!dryRun) {
    if (!ready()) throw new Error(whyNot());
    for (const m of messages) await discord.announce(m);
    markPosted(versions);
  }
  return { messages, versions };
}
