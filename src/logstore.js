// Saving match logs on the server.
//
// THE THING TO KNOW: logs must live outside the app directory, because a deploy
// replaces it. On Lightsail — where the site runs now — a deploy is a git pull
// in /home/ubuntu/app, so /data is untouched by it and by reboots. On the old
// Fly box the machine filesystem was wiped by every deploy and /data was where
// a volume mounted. Either way the rule is the same, and it is why the path is
// checked rather than assumed: logs written anywhere else are gone by the next
// release.
//
// If /data does not exist the logs still get written, next to the app, and the
// health endpoint and the /logs page both say plainly that they will not
// survive a deploy. Make it once on the box:
//
//   sudo mkdir -p /data/logs && sudo chown -R ubuntu:ubuntu /data
//
// Until then, treat these as a convenience for the current session only.

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
      ? 'outside the app directory — survives deploys'
      : 'inside the app directory — WIPED BY THE NEXT DEPLOY',
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
            // Logs written before hosts were recorded have none. They are all
            // David's, but the analysis should say "unknown" rather than guess.
            host: j.host ?? null,
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
