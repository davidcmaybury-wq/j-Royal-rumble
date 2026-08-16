// What people tell us went wrong, or what they wish it did.
//
// Written to disk beside the match logs rather than sent anywhere: no account
// to make, no third-party form, nothing to sign up for. People are playing
// outside David's own tests now and the only channel was telling him directly.
//
// The same /data rule as the logs — that is the mounted volume, and anything
// written into the app directory is wiped by the next deploy.

import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync,
  unlinkSync } from 'fs';
import { join } from 'path';

const DIR = process.env.RUMBLE_REPORT_DIR
  || (existsSync('/data') ? '/data/reports' : join(process.cwd(), 'reports'));

// A report is a paragraph, not an essay. Long enough to describe what happened,
// short enough that a stuck key cannot fill the disk.
const MAX_TEXT = 2000;
const MAX_PER_HOUR = 20;

let ready = false;
let lastError = null;
const recent = [];          // timestamps, for the rate limit

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

const clean = (v, max = 120) => String(v == null ? '' : v).slice(0, max);

/**
 * Save one report.
 *
 * `context` is gathered by the page rather than typed: the room code, the
 * version, which screen, who they are and which clue was up. A report written
 * five minutes later has lost all of that, and it is what turns "the buzzer did
 * something weird" into something anybody can chase.
 */
export function save({ kind, text, context = {} }) {
  const now = Date.now();
  while (recent.length && now - recent[0] > 3600e3) recent.shift();
  if (recent.length >= MAX_PER_HOUR) {
    return { error: 'That is a lot of reports in one hour. Try again shortly.' };
  }
  const body = String(text || '').trim().slice(0, MAX_TEXT);
  if (!body) return { error: 'Say what happened first.' };
  if (!ensure()) return { error: lastError || 'cannot write reports here' };

  const at = new Date(now);
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const type = kind === 'idea' ? 'idea' : 'bug';
  const file = `${stamp}-${type}-${clean(context.gameId, 8) || 'nomatch'}.json`;
  const record = {
    kind: type,
    text: body,
    at: at.toISOString(),
    // Everything we would otherwise have to ask for.
    gameId: clean(context.gameId, 8),
    version: clean(context.version, 20),
    screen: clean(context.screen, 20),
    name: clean(context.name, 40),
    token: clean(context.token, 60),
    clue: Number.isFinite(+context.clue) ? +context.clue : null,
    phase: clean(context.phase, 20),
    userAgent: clean(context.userAgent, 300),
  };
  try {
    writeFileSync(join(DIR, file), JSON.stringify(record, null, 2));
    recent.push(now);
    return { ok: true, file };
  } catch (e) {
    lastError = e.message;
    return { error: e.message };
  }
}

/** Newest first, for the control room. */
export function list() {
  if (!ensure()) return [];
  try {
    return readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const s = statSync(join(DIR, f));
        let r = {};
        try { r = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { /* half-written */ }
        return {
          file: f, bytes: s.size, at: r.at || s.mtime.toISOString(),
          kind: r.kind || 'bug', text: r.text || '', gameId: r.gameId || '',
          version: r.version || '', screen: r.screen || '', name: r.name || '',
          clue: r.clue ?? null, resolved: r.resolved || null,
        };
      })
      // Unresolved first, then newest: the ones still needing something done
      // should not scroll away under a pile of settled ones.
      .sort((a, b) => (!!a.resolved - !!b.resolved) || (a.at < b.at ? 1 : -1));
  } catch {
    return [];
  }
}

/**
 * Mark one as dealt with, or throw it away.
 *
 * Resolving keeps the file and stamps it, because a report that turned out to
 * matter is worth still having; deleting is for the ones that are noise. Both
 * are the control room's business, not a player's.
 */
export function update(file, { resolved, remove } = {}) {
  if (!ensure()) return { error: lastError || 'cannot write reports here' };
  const safe = String(file).replace(/[^A-Za-z0-9._-]/g, '');
  const full = join(DIR, safe);
  if (!existsSync(full)) return { error: 'no such report' };
  if (remove) {
    try { unlinkSync(full); return { ok: true, removed: safe }; }
    catch (e) { return { error: e.message }; }
  }
  try {
    const r = JSON.parse(readFileSync(full, 'utf8'));
    r.resolved = resolved ? new Date().toISOString() : null;
    writeFileSync(full, JSON.stringify(r, null, 2));
    return { ok: true, resolved: r.resolved };
  } catch (e) {
    return { error: e.message };
  }
}

export function read(file) {
  if (!ensure()) return null;
  const safe = String(file).replace(/[^A-Za-z0-9._-]/g, '');
  try { return readFileSync(join(DIR, safe), 'utf8'); } catch { return null; }
}

export function status() {
  const ok = ensure();
  return {
    dir: DIR,
    durable: DIR.startsWith('/data'),
    saved: ok ? list().length : 0,
    error: lastError,
  };
}

export const dir = () => DIR;
