// When the room can actually play.
//
// Players paint the half hours they are free; this keeps the pattern, and once
// enough people overlap on the same evening it proposes a game night. The store
// is deliberately boring — one JSON file, held in memory, rewritten atomically
// — because the whole thing is a few dozen people and a weekly grid, and a
// database would be more moving parts than data.
//
// The clock arithmetic lives in `public/zoned.js` and is shared with the
// availability page, the same way `engine.js` is shared with the setup page. A
// cell the browser draws at 7pm and a slot this file counts at 7pm have to be
// the same instant, and two implementations of that disagree the day the clocks
// change. That file also explains why a weekly pattern cannot be stored in UTC.
//
// THE THING TO KNOW: the file lives outside the app directory for the same
// reason the match logs do — a deploy is a git pull in /home/ubuntu/app, so
// anything written there is gone by the next release. Make it once on the box:
//
//   sudo mkdir -p /data && sudo chown -R ubuntu:ubuntu /data
//
// Without /data it still works, next to the app, and /api/health and the
// control room both say plainly that it will not survive a deploy.

import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import {
  DAYS, SLOT, knownZone, localParts, zonedToUtc, isoDate, dateIn, dowOf, addDays,
  cleanRanges, unionRanges, subtractRanges, rangeMinutes, minutesToRanges,
} from '../public/zoned.js';

export {
  DAYS, SLOT, knownZone, localParts, zonedToUtc, isoDate, dateIn, dowOf, addDays,
  unionRanges, subtractRanges, rangeMinutes, minutesToRanges,
};

const FILE = process.env.RUMBLE_WHEN_FILE
  || (existsSync('/data') ? '/data/when.json' : join(process.cwd(), 'when.json'));

export const DEFAULT_SETTINGS = {
  // How many people have to be free for the *whole* window before it is worth
  // proposing. Eight is three starters plus a queue deep enough that the entry
  // phase does not run dry — below that the match is over before it fills.
  threshold: 8,
  // Four slots is two hours. The measured median for a full field is longer
  // than that, but two hours is the honest floor for "can you play tonight".
  minSlots: 4,
  // How far ahead the heat map and the scan look.
  horizonDays: 28,
  // Nobody wants a suggestion for a game starting in twenty minutes.
  leadHours: 6,
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const EMPTY = () => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, players: {}, proposals: {} });

let db = null;
let lastError = null;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(readFileSync(FILE, 'utf8'));
    db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    db.players = db.players || {};
    db.proposals = db.proposals || {};
  } catch (e) {
    // A missing file is the ordinary first run. A corrupt one is not, and
    // starting empty over the top of it would delete everybody's answers, so it
    // is left alone on disk and reported instead.
    if (e.code !== 'ENOENT') lastError = e.message;
    db = EMPTY();
  }
  return db;
}

function flush() {
  const d = load();
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    // Write beside it and rename: a half-written file is how a store like this
    // loses everything at once, and rename is atomic on one filesystem.
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(d, null, 1));
    renameSync(tmp, FILE);
    lastError = null;
    return true;
  } catch (e) {
    lastError = e.message;
    return false;
  }
}

/** Only for tests: drop the in-memory copy so the next read comes off disk. */
export function reset() { db = null; lastError = null; cache = { key: '', value: null }; }

export function durable() { return FILE.startsWith('/data'); }
export function file() { return FILE; }

export function settings() { return { ...load().settings }; }

export function setSettings(patch) {
  const d = load();
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (patch[k] == null) continue;
    const v = Number(patch[k]);
    if (Number.isFinite(v) && v > 0) d.settings[k] = v;
  }
  flush();
  return settings();
}

export function players() { return Object.values(load().players); }
export function get(id) { return load().players[id] || null; }

/**
 * Write one player's availability. The identity fields come from Discord and
 * are refreshed on every save, because display names change and a stale one in
 * a game-night ping is worse than useless.
 */
export function save(id, { name, avatar, tz, weekly, dates }) {
  const d = load();
  const prev = d.players[id] || {};
  const zone = knownZone(tz) ? tz : (prev.tz || 'America/Los_Angeles');

  const week = {};
  const fromWeek = weekly || prev.weekly || {};
  for (const day of DAYS) {
    const r = unionRanges(fromWeek[day] || [], []);
    if (r.length) week[day] = r;
  }

  const ex = {};
  const src = dates || prev.dates || {};
  for (const [key, v] of Object.entries(src)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const add = unionRanges(v?.add || [], []);
    const drop = unionRanges(v?.drop || [], []);
    if (add.length || drop.length) ex[key] = { add, drop };
  }

  d.players[id] = {
    id,
    name: String(name || prev.name || 'Someone').slice(0, 60),
    avatar: avatar || prev.avatar || null,
    tz: zone,
    weekly: week,
    dates: ex,
    joinedAt: prev.joinedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  flush();
  return d.players[id];
}

export function remove(id) {
  const d = load();
  if (!d.players[id]) return false;
  delete d.players[id];
  flush();
  return true;
}

export function status() {
  const d = load();
  return {
    file: FILE,
    durable: durable(),
    players: Object.keys(d.players).length,
    proposals: Object.keys(d.proposals).length,
    error: lastError,
    note: durable()
      ? 'outside the app directory — survives deploys'
      : 'inside the app directory — WIPED BY THE NEXT DEPLOY',
  };
}

// ---------------------------------------------------------------------------
// Projection and the heat map
// ---------------------------------------------------------------------------

export const floorSlot = (ms) => Math.floor(ms / SLOT) * SLOT;

/**
 * Every half-hour instant one player is free between `from` and `to`.
 *
 * Walks their local calendar rather than the UTC clock, because everything
 * about the pattern is local: which day of the week a date is, which exceptions
 * apply to it, and what offset it sits at. The window is widened by a day at
 * each end so a player whose evening straddles midnight UTC is not clipped.
 */
export function playerSlots(p, from, to) {
  const tz = knownZone(p.tz) ? p.tz : 'America/Los_Angeles';
  const out = [];
  const start = localParts(tz, from - 86400000);
  let date = { y: start.y, m: start.m, d: start.d };
  const stop = to + 86400000;

  for (let guard = 0; guard < 400; guard++) {
    const key = isoDate(date.y, date.m, date.d);
    const base = (p.weekly || {})[DAYS[dowOf(date.y, date.m, date.d)]] || [];
    const ex = (p.dates || {})[key];
    const ranges = ex
      ? unionRanges(subtractRanges(base, ex.drop || []), ex.add || [])
      : cleanRanges(base);

    for (const minute of rangeMinutes(ranges)) {
      const t = zonedToUtc(tz, date.y, date.m, date.d, minute);
      if (t != null && t >= from && t < to) out.push(t);
    }

    const midnight = zonedToUtc(tz, date.y, date.m, date.d, 0);
    if (midnight != null && midnight > stop) break;
    date = addDays(date.y, date.m, date.d, 1);
  }
  return out;
}

/**
 * Who is free when, across everybody, for the next `horizonDays`.
 *
 * Cached, because it is read on every page load and only changes when somebody
 * saves. The key carries the window start as well as the players' stamps, so it
 * also expires as the window slides forward.
 */
let cache = { key: '', value: null };

export function heat(now = Date.now(), opts = {}) {
  const s = settings();
  const horizonDays = opts.horizonDays || s.horizonDays;
  const from = floorSlot(now);
  const to = from + horizonDays * 86400000;
  const d = load();
  const stamp = Object.values(d.players).map((p) => p.id + p.updatedAt).sort().join('|');
  const key = `${from}|${horizonDays}|${stamp}`;
  if (cache.key === key) return cache.value;

  const who = new Map();      // slot -> [id]
  for (const p of Object.values(d.players)) {
    for (const t of playerSlots(p, from, to)) {
      if (!who.has(t)) who.set(t, []);
      who.get(t).push(p.id);
    }
  }

  const names = {};
  for (const p of Object.values(d.players)) names[p.id] = p.name;

  const slots = [...who.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, ids]) => ({ t, n: ids.length, ids }));

  const value = { from, to, slots, names, players: Object.keys(d.players).length };
  cache = { key, value };
  return value;
}

/**
 * Windows worth playing: a run of consecutive half hours that the SAME people
 * can all make, start to finish.
 *
 * The intersection and not the per-slot count is the whole point. Nine people
 * free at 7:00 and nine different people free at 8:00 is not a game — and the
 * first version of this counted each slot on its own, which says there is one.
 */
export function windows(h, opts = {}) {
  const s = { ...settings(), ...opts };
  const slots = h.slots;
  const out = [];
  let i = 0;
  while (i < slots.length) {
    let members = new Set(slots[i].ids);
    let j = i;
    // Contiguous in time, not merely adjacent in the array: an empty half hour
    // is a gap, and a window with a gap in it is two windows.
    while (j + 1 < slots.length && slots[j + 1].t === slots[j].t + SLOT) {
      const next = new Set(slots[j + 1].ids.filter((id) => members.has(id)));
      if (next.size < s.threshold) break;
      members = next;
      j++;
    }
    if (j - i + 1 >= s.minSlots && members.size >= s.threshold) {
      out.push({
        start: slots[i].t, end: slots[j].t + SLOT,
        slots: j - i + 1, n: members.size, ids: [...members],
      });
      i = j + 1;
    } else {
      i++;
    }
  }
  // Biggest group first, then earliest: the question is "when can the most
  // people play", not "what is next".
  return out.sort((a, b) => b.n - a.n || a.start - b.start);
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function proposals() {
  return Object.values(load().proposals).sort((a, b) => a.start - b.start);
}

export function proposal(key) { return load().proposals[String(key)] || null; }

const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/**
 * New game nights worth telling David about.
 *
 * Anything already proposed — sent, dismissed or just sitting there — is not
 * proposed again, and neither is anything overlapping it. Without that the scan
 * re-offers the same Thursday every half hour, which is how a useful notice
 * becomes something you mute.
 */
export function scan(now = Date.now(), opts = {}) {
  const s = { ...settings(), ...opts };
  const h = heat(now, { horizonDays: s.horizonDays });
  const known = proposals();
  const earliest = now + s.leadHours * 3600000;
  const fresh = [];
  for (const w of windows(h, s)) {
    if (w.start < earliest) continue;
    if (known.some((k) => overlaps(k.start, k.end, w.start, w.end))) continue;
    if (fresh.some((k) => overlaps(k.start, k.end, w.start, w.end))) continue;
    fresh.push(w);
  }
  return fresh;
}

export function record(w, extra = {}) {
  const d = load();
  const key = String(w.start);
  d.proposals[key] = {
    key,
    start: w.start,
    end: w.end,
    n: w.n,
    ids: w.ids,
    foundAt: new Date().toISOString(),
    posted: false,
    sent: null,
    dismissed: false,
    ...extra,
  };
  flush();
  return d.proposals[key];
}

export function update(key, patch) {
  const d = load();
  const p = d.proposals[String(key)];
  if (!p) return null;
  Object.assign(p, patch);
  flush();
  return p;
}

/** A proposal whose evening has been and gone stops being anybody's business. */
export function sweep(now = Date.now()) {
  const d = load();
  let gone = 0;
  for (const [key, p] of Object.entries(d.proposals)) {
    if (p.end < now - 7 * 86400000) { delete d.proposals[key]; gone++; }
  }
  if (gone) flush();
  return gone;
}
