// Wall clocks, and turning them into instants.
//
// Shared by the server and the availability page, the same way `engine.js` is
// shared by the server and the setup page — because the browser has to place a
// cell on the grid at exactly the instant the server thinks that cell means,
// and two implementations of that drift the day the clocks change.
//
// THE THING TO KNOW: a weekly pattern cannot be stored in UTC. "Thursday at
// 7pm" is a wall-clock fact about a person; the UTC instant that answers to it
// moves by an hour twice a year, and differs per person anyway. So a pattern is
// kept in local minutes plus an IANA zone, and converted per real date.

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const SLOT = 30 * 60 * 1000;          // half an hour, the painting unit

const FORMATTERS = new Map();
function partsFor(tz) {
  if (!FORMATTERS.has(tz)) {
    FORMATTERS.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return FORMATTERS.get(tz);
}

/** Is this a timezone this runtime actually knows? */
export function knownZone(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_+\-/]{3,64}$/.test(tz)) return false;
  try { partsFor(tz).format(0); return true; } catch { return false; }
}

/** The wall clock in `tz` at instant `ms`. */
export function localParts(tz, ms) {
  const p = {};
  for (const { type, value } of partsFor(tz).formatToParts(new Date(ms))) p[type] = value;
  // Some ICU builds render midnight as hour 24 under hour12:false.
  const hour = +p.hour === 24 ? 0 : +p.hour;
  return { y: +p.year, m: +p.month, d: +p.day, hour, minute: +p.minute, second: +p.second };
}

/** Offset of `tz` at instant `ms`, as local minus UTC, in milliseconds. */
function offsetAt(tz, ms) {
  const p = localParts(tz, ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second) - ms;
}

/**
 * The instant at which the clock in `tz` reads this local date and minute.
 *
 * Two passes, because the offset you need depends on the answer you are looking
 * for: guess with the offset at the naive instant, then re-read the offset at
 * the guess. That settles every ordinary case and both ends of a DST change.
 *
 * Returns null for a wall-clock time that does not exist — 2:30am on the
 * morning the clocks go forward. Skipping it is right: nobody is available at a
 * time that never happens, and inventing an instant for it would silently move
 * somebody's evening by an hour.
 */
export function zonedToUtc(tz, y, m, d, minutes) {
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let t = naive - offsetAt(tz, naive);
  t = naive - offsetAt(tz, t);
  const back = localParts(tz, t);
  if (back.y !== y || back.m !== m || back.d !== d
      || back.hour * 60 + back.minute !== minutes) return null;
  return t;
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** The local calendar date in `tz` at instant `ms`, as YYYY-MM-DD. */
export function dateIn(tz, ms) {
  const p = localParts(tz, ms);
  return isoDate(p.y, p.m, p.d);
}

/** Day of week (0 = Sunday) for a calendar date, with no zone involved. */
export function dowOf(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The calendar date `n` days after this one. Pure date arithmetic, no zone. */
export function addDays(y, m, d, n) {
  const x = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

// --- ranges: minutes past local midnight, [start, end), on the half hour -----

export const cleanRanges = (ranges) => (Array.isArray(ranges) ? ranges : [])
  .map((r) => [Math.round(r[0] / 30) * 30, Math.round(r[1] / 30) * 30])
  .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1])
    && r[0] >= 0 && r[1] <= 1440 && r[1] > r[0])
  .sort((a, b) => a[0] - b[0]);

export function unionRanges(a, b) {
  const out = [];
  for (const r of cleanRanges([...cleanRanges(a), ...cleanRanges(b)])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function subtractRanges(a, b) {
  let out = cleanRanges(a).map((r) => [r[0], r[1]]);
  for (const cut of cleanRanges(b)) {
    const next = [];
    for (const r of out) {
      if (cut[1] <= r[0] || cut[0] >= r[1]) { next.push(r); continue; }
      if (cut[0] > r[0]) next.push([r[0], cut[0]]);
      if (cut[1] < r[1]) next.push([cut[1], r[1]]);
    }
    out = next;
  }
  return out;
}

/** Half-hour starts covered by a set of ranges. */
export function rangeMinutes(ranges) {
  const out = [];
  for (const [s, e] of cleanRanges(ranges)) for (let m = s; m < e; m += 30) out.push(m);
  return out;
}

/** The inverse: half-hour starts back into ranges. */
export function minutesToRanges(mins) {
  const sorted = [...new Set(mins)].filter((m) => m >= 0 && m < 1440).sort((a, b) => a - b);
  const out = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m === last[1]) last[1] = m + 30;
    else out.push([m, m + 30]);
  }
  return out;
}
