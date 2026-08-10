#!/usr/bin/env node
// Pulls new Jeopardy! material into the library once a month.
//
//   node tools/refresh-library.mjs            fetch anything new and merge it
//   node tools/refresh-library.mjs --dry-run  say what would change, touch nothing
//
// The source is the public clue dataset on GitHub, not j-archive. That matters:
// the archive's maintainer asked not to be crawled, and this keeps us off their
// server entirely. It also happens to be better data — already cleaned, with
// media-dependent clues removed and Daily Double board values preserved.
//
// Seasons already in the library are re-checked, because the most recent one
// keeps growing as episodes air. A stored hash means an unchanged file costs
// one conditional request and nothing else.

import { fromClueTsv } from '../src/sources.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { createHash as hash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'data/library.ndjson.gz');
const MANIFEST = join(ROOT, 'data/seasons.json');
const BASE = 'https://raw.githubusercontent.com/jwolle1/jeopardy_clue_dataset/main/seasons';

const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

const loadLib = () => existsSync(LIB)
  ? gunzipSync(readFileSync(LIB)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

const loadManifest = () => existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { seasons: {}, lastRun: null };

function parseTsv(text) {
  const lines = text.split('\n').filter(Boolean);
  const cols = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const v = l.split('\t');
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

async function fetchSeason(n) {
  const res = await fetch(`${BASE}/season${n}.tsv`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`season ${n}: HTTP ${res.status}`);
  return res.text();
}

const library = loadLib();
const manifest = loadManifest();
const known = new Set(library.map((c) => c.id));
const seasonsHeld = [...new Set(library.filter((c) => c.source === 'archive')
  .map((c) => c.provenance.season))].sort((a, b) => a - b);
const newest = seasonsHeld.at(-1) ?? 21;

log(`library: ${library.length} categories, archive seasons ${seasonsHeld[0] ?? '—'}–${newest}`);

// Re-check the newest season we hold (it grows), then walk forward until a 404.
const toCheck = [];
for (let n = newest; n <= newest + 6; n++) toCheck.push(n);

const added = [];
const touched = [];
let stop = false;

for (const n of toCheck) {
  if (stop) break;
  let text;
  try { text = await fetchSeason(n); } catch (e) { log(`  season ${n}: ${e.message}`); continue; }
  if (text === null) {
    if (n > newest) { log(`  season ${n}: not published yet`); stop = true; }
    continue;
  }
  const digest = hash('sha256').update(text).digest('hex').slice(0, 16);
  if (manifest.seasons[n] === digest) { log(`  season ${n}: unchanged`); continue; }

  const cats = fromClueTsv(parseTsv(text)).map((c) => ({ ...c, provenance: { ...c.provenance, season: n } }));
  const fresh = cats.filter((c) => !known.has(c.id));
  fresh.forEach((c) => known.add(c.id));
  added.push(...fresh);
  touched.push({ season: n, digest, fresh: fresh.length, total: cats.length });
  log(`  season ${n}: ${fresh.length} new categories (${cats.length} in the file)`);
}

if (!added.length) {
  log('\nnothing new.');
  if (!DRY) {
    manifest.lastRun = new Date().toISOString();
    for (const t of touched) manifest.seasons[t.season] = t.digest;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  }
  process.exit(0);
}

const dates = added.map((c) => c.provenance.airDate).sort();
log(`\n${added.length} new categories, ${added.reduce((n, c) => n + c.clues.length, 0)} clues`);
log(`covering ${dates[0]} to ${dates.at(-1)}`);

if (DRY) { log('\ndry run — nothing written'); process.exit(0); }

const all = library.concat(added);
writeFileSync(LIB, gzipSync(all.map((c) => JSON.stringify(c)).join('\n') + '\n', { level: 9 }));
for (const t of touched) manifest.seasons[t.season] = t.digest;
manifest.lastRun = new Date().toISOString();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

const by = {};
for (const c of all) by[c.source] = (by[c.source] || 0) + 1;
log(`\nlibrary now ${all.length} categories`);
log(by);
