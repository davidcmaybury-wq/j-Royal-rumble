// Saving match logs on the server.
//
// THE THING TO KNOW: a fly.io machine's own filesystem is ephemeral. Anything
// written to it survives a restart but is wiped by the next deploy, and this
// project deploys several times a day. So logs go to /data, which is where a
// fly volume mounts — and if no volume is mounted, they still get written, but
// the health endpoint says plainly that they will not survive a deploy.
//
//   fly volumes create rumble_data --size 1 --region ord
//   then add the [mounts] block in fly.toml
//
// Without that, treat these as a convenience for the current session only.

import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const DIR = process.env.RUMBLE_LOG_DIR
  || (existsSync('/data') ? '/data/logs' : join(process.cwd(), 'logs'));

let ready = false;
let lastError = null;

function ensure() {
  if (ready) return true;
  try {
    mkdirSync(DIR, { recursive: true });
    ready = true;
    return true;
  } catch (e) {
    lastError = e.message;
    return false;
  }
}

/** Is this directory somewhere that survives a deploy? */
export function durable() {
  return DIR.startsWith('/data');
}

export function logDir() {
  return DIR;
}

export function status() {
  ensure();
  let count = 0;
  try { count = readdirSync(DIR).filter((f) => f.endsWith('.json')).length; } catch (e) {}
  return {
    dir: DIR,
    durable: durable(),
    saved: count,
    error: lastError,
    note: durable()
      ? 'on a mounted volume — survives deploys'
      : 'on the machine filesystem — WIPED BY THE NEXT DEPLOY',
  };
}

const stamp = (d = new Date()) =>
  d.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '').slice(0, 16);

/**
 * Write a match's record. Called when a match ends, periodically while one is
 * running, and on shutdown — a host who closes the tab mid-match should still
 * leave something behind.
 */
export function save(code, record, { partial = false } = {}) {
  if (!record || !ensure()) return null;
  const name = `${stamp(new Date(record.startedAt || Date.now()))}-${code}`
    + (partial ? '-partial' : '') + '.json';
  const path = join(DIR, name);
  try {
    writeFileSync(path, JSON.stringify({
      ...record,
      savedAt: new Date().toISOString(),
      partial,
    }));
    return name;
  } catch (e) {
    lastError = e.message;
    return null;
  }
}

/** Newest first, so the list is useful without paging. */
export function list() {
  if (!ensure()) return [];
  try {
    return readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const s = statSync(join(DIR, f));
        let summary = null;
        try {
          const j = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
          summary = {
            version: j.version,
            clues: j.actual?.clues ?? (j.clues || []).length,
            minutes: j.actual?.minutes ?? null,
            secondsPerClueMedian: j.actual?.secondsPerClueMedian ?? null,
            players: (j.roster || []).length,
            winner: (j.standings || []).find((p) => p.winner)?.name ?? null,
            partial: !!j.partial,
          };
        } catch (e) { /* a half-written file should not break the listing */ }
        return { file: f, bytes: s.size, at: s.mtime.toISOString(), ...summary };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch (e) {
    lastError = e.message;
    return [];
  }
}

export function read(file) {
  if (!/^[\w.-]+\.json$/.test(file)) return null;   // no path traversal
  try {
    return readFileSync(join(DIR, file), 'utf8');
  } catch (e) {
    return null;
  }
}
