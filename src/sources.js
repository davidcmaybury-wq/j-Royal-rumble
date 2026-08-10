// Normalizes every clue source into the shape RumbleGame's categoryPool returns:
//   { id, title, note, source, clues: [{ id, row, text, answer }] }
// Row is 1-5 and is the ONLY thing that determines value in a Rumble.
// Original dollar amounts are discarded; they exist here only to recover row.

export const ROW_LADDER = {
  'Jeopardy!': [200, 400, 600, 800, 1000],
  'Double Jeopardy!': [400, 800, 1200, 1600, 2000],
};

// --- media / unanswerable filtering (permissive) ----------------------

const MEDIA_PATTERNS = [
  /<a\s[^>]*href=/i,            // j-archive media anchor
  /\[(audio|video)[^\]]*\]/i,
  /\b(seen|shown|heard|pictured|displayed) here\b/i,
  /\bthis (video|audio|clip|picture|image|photo|painting|map|chart)\b/i,
  /\b(painted|drew|sculpted|wrote|sang|played|composed|built|designed) this\s*[.?!]?$/i,
  /\bclue crew\b/i,
  /\b(of the clue crew)\b/i,
];

export function isUnanswerableWithoutMedia(text) {
  return MEDIA_PATTERNS.some((re) => re.test(text));
}

export function stripMediaLinks(text) {
  return text
    .replace(/<a\s[^>]*>(.*?)<\/a>/gis, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?i>|<\/?em>|<\/?b>/gi, '')
    .replace(/\\'/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// --- adapter 1: j-trivia TTG JSON -------------------------------------

export function fromTtgJson(doc, { includeFinal = false } = {}) {
  const out = [];
  doc.rounds.forEach((round, roundIndex) => {
    const ladder = roundIndex === 0
      ? ROW_LADDER['Jeopardy!'] : ROW_LADDER['Double Jeopardy!'];
    round.forEach((cat, catIndex) => {
      const clues = cat.clues.map((c) => ({
        row: ladder.indexOf(c.value) + 1,
        text: stripMediaLinks(c.text),
        answer: stripMediaLinks(c.correctResponse),
        wasDailyDouble: !!c.dailyDouble,
      }));
      out.push(finalize({
        id: `ttg:${slug(doc.title)}:r${roundIndex}:c${catIndex}`,
        title: cat.category,
        note: (cat.comments || '').trim() || null,
        source: 'ttg',
        provenance: { title: doc.title, author: doc.author },
        clues,
      }));
    });
  });
  if (includeFinal && doc.final_jeopardy_round) {
    // Deliberately unused by the Rumble; kept so nothing is silently dropped.
  }
  return out.filter(Boolean);
}

// --- adapter 2: jparty.tv seven-column CSV ---------------------------
// Real header: Round, Value, Daily Double, Category, Response, Clue, Media
// Note the order: Response comes BEFORE Clue. Media holds an asset URL.

export function fromJpartyCsv(rows, { label = 'upload' } = {}) {
  const LADDER = { 'Jeopardy': [200,400,600,800,1000], 'Double Jeopardy': [400,800,1200,1600,2000] };
  const groups = new Map();
  for (const r of rows) {
    const round = (r['Round'] || '').trim();
    if (!LADDER[round]) continue;               // drops Final Jeopardy
    const category = (r['Category'] || '').trim();
    const key = `${round}|${category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, rs] of groups) {
    const [round, category] = key.split('|');
    const ladder = LADDER[round];
    out.push(finalize({
      id: `csv:${slug(label)}:${slug(round)}:${slug(category)}`,
      title: category, note: null, source: 'upload',
      provenance: { file: label, round },
      clues: rs.map((r) => ({
        row: ladder.indexOf(Number(String(r['Value']).replace(/[$,]/g, ''))) + 1,
        text: stripMediaLinks(r['Clue'] || ''),
        answer: stripMediaLinks(r['Response'] || ''),
        wasDailyDouble: /true|yes|1/i.test(r['Daily Double'] || ''),
      })),
    }));
  }
  return out.filter(Boolean);
}

// Minimal RFC4180 parser — clue text is full of commas and quoted quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// --- adapter 3: public 216k dataset -----------------------------------
// Daily Doubles carry the contestant's WAGER, not the row value, so their
// row can't be read off the value. We detect off-ladder values and assign
// them the rung missing from their category.

export function fromPublicDataset(records, { from = null, to = null } = {}) {
  const groups = new Map();
  for (const r of records) {
    const round = r.round ?? r.Round;
    if (!ROW_LADDER[round]) continue;              // drops Final and Tiebreaker
    const air = r.air_date ?? r['Air Date'];
    if (from && air < from) continue;
    if (to && air > to) continue;
    const show = r.show_number ?? r['Show Number'];
    const category = r.category ?? r.Category;
    const key = `${show}|${round}|${category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      rawValue: parseMoney(r.value ?? r.Value),
      text: stripMediaLinks(r.question ?? r.Question ?? ''),
      rawText: r.question ?? r.Question ?? '',
      answer: stripMediaLinks(r.answer ?? r.Answer ?? ''),
      round, show, category, air,
    });
  }

  const cats = [];
  for (const [key, raw] of groups) {
    const ladder = ROW_LADDER[raw[0].round];
    const taken = new Set();
    const onLadder = [];
    const offLadder = [];
    for (const c of raw) {
      const idx = ladder.indexOf(c.rawValue);
      if (idx >= 0 && !taken.has(idx)) { taken.add(idx); onLadder.push({ ...c, row: idx + 1 }); }
      else offLadder.push(c);
    }
    // Assign each off-ladder clue (a Daily Double) the lowest free rung.
    for (const c of offLadder) {
      const free = ladder.map((_, i) => i).find((i) => !taken.has(i));
      if (free === undefined) continue;
      taken.add(free);
      onLadder.push({ ...c, row: free + 1, wasDailyDouble: true });
    }
    const [show, round, category] = key.split('|');
    cats.push(finalize({
      id: `pub:${show}:${slug(round)}:${slug(category)}`,
      title: category, note: null, source: 'public',
      provenance: { show: Number(show), round, airDate: raw[0].air },
      clues: onLadder,
    }));
  }
  return cats.filter(Boolean);
}

// --- shared ----------------------------------------------------------

// A category is usable only if all five rungs are present and answerable.
function finalize(cat) {
  const byRow = new Map();
  for (const c of cat.clues) {
    if (!c.row || c.row < 1 || c.row > 5) return null;
    if (!c.text || !c.answer) return null;
    if (isUnanswerableWithoutMedia(c.rawText ?? c.text)) return null;
    if (byRow.has(c.row)) return null;
    byRow.set(c.row, c);
  }
  if (byRow.size !== 5) return null;
  return {
    id: cat.id,
    title: cat.title,
    note: cat.note ?? null,
    source: cat.source,
    provenance: cat.provenance,
    clues: [1, 2, 3, 4, 5].map((row) => {
      const c = byRow.get(row);
      return {
        id: `${cat.id}:${row}`, row,
        text: c.text, answer: c.answer,
        wasDailyDouble: !!c.wasDailyDouble,
      };
    }),
  };
}

const parseMoney = (v) =>
  v == null ? NaN : Number(String(v).replace(/[$,]/g, ''));
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Weighted pool: draws categories by source according to a blend ratio.
export function makeWeightedPool(buckets, rng) {
  const pools = Object.entries(buckets)
    .filter(([, v]) => v.categories.length > 0)
    .map(([name, v]) => ({ name, weight: v.weight, items: shuffle(v.categories.slice(), rng), i: 0 }));
  const total = pools.reduce((s, p) => s + p.weight, 0);
  return () => {
    let roll = rng() * total;
    for (const p of pools) {
      roll -= p.weight;
      if (roll <= 0 || p === pools[pools.length - 1]) {
        if (p.i >= p.items.length) { p.items = shuffle(p.items, rng); p.i = 0; }
        return p.items[p.i++];
      }
    }
    return null;
  };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- adapter 4: jwolle1 clue dataset (TSV) ---------------------------
// Column names are j-archive's convention, which is INVERTED from plain English:
//   `answer` holds the CLUE TEXT, `question` holds the CORRECT RESPONSE.
// `clue_value` is the board value even for Daily Doubles (the wager lives in
// `daily_double_value`), so row is directly recoverable — no inference needed.

export function fromClueTsv(rows, { from = null, to = null, games = null } = {}) {
  const LADDER = { '1': [200,400,600,800,1000], '2': [400,800,1200,1600,2000] };
  const byGame = new Map();
  for (const r of rows) {
    if (!LADDER[r.round]) continue;                 // drops Final Jeopardy (round 3)
    if (from && r.air_date < from) continue;
    if (to && r.air_date > to) continue;
    if (!byGame.has(r.air_date)) byGame.set(r.air_date, []);
    byGame.get(r.air_date).push(r);
  }
  let dates = [...byGame.keys()].sort();
  if (games) dates = dates.slice(0, games);

  const out = [];
  for (const date of dates) {
    const groups = new Map();
    for (const r of byGame.get(date)) {
      const key = `${r.round}|${r.category}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, rs] of groups) {
      const ladder = LADDER[rs[0].round];
      out.push(finalize({
        id: `arch:${date}:r${rs[0].round}:${slug(rs[0].category)}`,
        title: rs[0].category,
        note: cleanNote(rs[0].comments),
        source: 'archive',
        provenance: { airDate: date, round: Number(rs[0].round), season: 41 },
        clues: rs.map((r) => ({
          row: ladder.indexOf(Number(r.clue_value)) + 1,
          text: stripMediaLinks(r.answer),          // yes: `answer` is the clue
          answer: stripMediaLinks(r.question),      // yes: `question` is the response
          wasDailyDouble: r.daily_double_value !== '0',
        })),
      }));
    }
  }
  return out.filter(Boolean);
}

// Host asides like "(Ken: I'll name the islands; you'll supply the sea.)" are
// the archive's equivalent of a TTG category note. Strip the speaker prefix.
function cleanNote(s) {
  if (!s || !s.trim()) return null;
  return s.trim().replace(/^\((?:[A-Z][a-z]+:\s*)?/, '(')
    .replace(/^\((.*)\)$/, '$1')
    .replace(/^[A-Z][a-z]+:\s*/, '')
    .trim() || null;
}
