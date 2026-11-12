// The host's clock: how much slower or quicker a whole room presses under this
// host than the same people press elsewhere.
//
// Every press time is measured from the moment the host arms the buzzers, and
// when a host arms relative to the end of the read is a habit. Under a host who
// arms on the last syllable the room times the cadence and presses at 100 ms;
// under one who arms a beat later the same room has already reacted and the
// numbers move with it. Measured on the three players who played both Aug 16
// matches at an identical delay setting: +45, +90 and +170 ms together under
// the second host (handbook, Figure 17). That is a calibration offset, not a
// skill change — fair within a match, since everybody shares it, but it means
// a personal best is host-relative and two matches' times cannot be compared.
//
// The handbook proposed pointing the robots' calibrate-and-freeze machinery at
// the host, and this is that idea with one change. The robots freeze after 16
// buzzes because they have to act on the number mid-match. Nothing has to act
// on the host's number live, and the opening buzzes are the worst sample there
// is: everybody presses below themselves when they walk in (244 ms on the first
// live clue against 204 ms in warm-up, about ten clues to recover), so a figure
// frozen at sixteen would charge every host for the room's cold start. So it is
// measured once, when the match ends, over the whole match — the same window
// each player's history was measured over — and then it is fixed in the record.
//
// The reference is each returning player's own median across their earlier
// recorded matches, and the host's offset is the median of those differences.
// One player having a bad night moves one difference; a host moves them all.
// It needs three returning players with enough presses on both sides, or it
// says why it could not measure and records nothing — a guessed offset that
// looks like a measured one is worse than a gap.

/** Presses a player needs, in this match and in a past one, to count. */
export const MIN_PRESSES = 10;
/** Returning players needed before an offset means the host, not a player. */
export const MIN_PLAYERS = 3;

const median = (a) => {
  if (!a.length) return null;
  const v = [...a].sort((x, y) => x - y);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * Each person's median live press in one match record: contested presses only
 * (not spectators, not early, not robots), the same population Figure 17 used.
 */
export function pressMedians(record) {
  const bots = new Set((record?.standings || []).filter((p) => p.isBot).map((p) => p.name));
  const by = new Map();
  for (const c of record?.clues || []) {
    for (const b of c.buzzes || []) {
      if (b.spectator || b.early || bots.has(b.name)) continue;
      if (!(b.ms > 0 && b.ms < 4000)) continue;
      if (!by.has(b.name)) by.set(b.name, []);
      by.get(b.name).push(b.ms);
    }
  }
  return new Map([...by].map(([n, v]) => [n, { median: median(v), presses: v.length }]));
}

/**
 * Pooled history from many records: for each handle, the median of their
 * per-match medians, counting only matches where they pressed enough. A record
 * is identified by its start time, so a match's partial and final logs count
 * once, and the match being measured can be left out of its own reference.
 */
export function buildHistory(records) {
  const seen = new Map();
  for (const r of records) {
    if (!r?.startedAt) continue;
    const prev = seen.get(r.startedAt);
    if (!prev || (prev.partial && !r.partial)) seen.set(r.startedAt, r);
  }
  const per = new Map();
  for (const r of seen.values()) {
    for (const [name, { median: m, presses }] of pressMedians(r)) {
      if (presses < MIN_PRESSES) continue;
      if (!per.has(name)) per.set(name, []);
      per.get(name).push({ startedAt: r.startedAt, median: m });
    }
  }
  return per;
}

/**
 * The host's offset for one finished match, against a history built by
 * buildHistory. Positive means the room pressed slower under this host.
 */
export function hostOffset(record, history) {
  const here = pressMedians(record);
  const deltas = [];
  for (const [name, { median: m, presses }] of here) {
    if (presses < MIN_PRESSES) continue;
    const past = (history.get(name) || []).filter((x) => x.startedAt !== record.startedAt);
    if (!past.length) continue;
    const ref = median(past.map((x) => x.median));
    deltas.push({ name, delta: Math.round(m - ref), matches: past.length, presses });
  }
  const base = {
    host: record.host ?? null,
    method: 'median over returning players of (press median here − their median across earlier matches)',
    minPresses: MIN_PRESSES,
    players: deltas.length,
  };
  if (deltas.length < MIN_PLAYERS) {
    return { ...base, offsetMs: null,
      reason: `${deltas.length} returning player${deltas.length === 1 ? '' : 's'} with ${MIN_PRESSES}+ `
        + `presses here and in an earlier match; ${MIN_PLAYERS} are needed` };
  }
  const ds = deltas.map((d) => d.delta).sort((a, b) => a - b);
  return { ...base,
    offsetMs: Math.round(median(ds)),
    spread: { min: ds[0], max: ds[ds.length - 1] },
    // The handles are already throughout the log this sits in; the keyless
    // pages only ever show the offset and the count.
    byPlayer: Object.fromEntries(deltas.map((d) => [d.name, d.delta])),
  };
}
