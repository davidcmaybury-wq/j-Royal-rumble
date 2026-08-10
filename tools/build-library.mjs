#!/usr/bin/env node
// Rebuilds data/library.ndjson.gz.
//
//   node tools/build-library.mjs add <folder>     merge boards into the library
//   node tools/build-library.mjs seasons <folder> merge archive season TSVs
//   node tools/build-library.mjs list             what's in there now
//
// Boards can be j-trivia.org JSON or jparty.tv CSV, mixed in one folder, and
// subfolders are walked. Existing material is kept; anything already present
// with the same category id is skipped rather than duplicated.

import { fromTtgJson, fromJpartyCsv, parseCsv, fromClueTsv, parseLooseJson } from '../src/sources.js';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { join, extname, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'data/library.ndjson.gz');

const load = () => existsSync(LIB)
  ? gunzipSync(readFileSync(LIB)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

function save(cats) {
  writeFileSync(LIB, gzipSync(cats.map((c) => JSON.stringify(c)).join('\n') + '\n', { level: 9 }));
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const summarise = (cats) => {
  const by = {};
  for (const c of cats) by[c.source] = (by[c.source] || 0) + 1;
  return by;
};

const [, , cmd, target] = process.argv;

if (cmd === 'list' || !cmd) {
  const cats = load();
  console.log(`${cats.length} categories, ${cats.reduce((n, c) => n + c.clues.length, 0)} clues`);
  console.log(summarise(cats));
  const files = [...new Set(cats.filter((c) => c.source === 'original')
    .map((c) => c.provenance?.title).filter(Boolean))];
  console.log(`${files.length} original games:`);
  files.sort().forEach((f) => console.log('  ' + f));
  process.exit(0);
}

if (!target) {
  console.error('give me a folder: node tools/build-library.mjs add ./boards');
  process.exit(1);
}

const existing = load();
const seen = new Set(existing.map((c) => c.id));
const added = [];
let skipped = 0, failed = 0;

if (cmd === 'add') {
  for (const file of walk(target)) {
    const ext = extname(file).toLowerCase();
    if (!['.json', '.csv'].includes(ext)) continue;
    let cats = [];
    try {
      const text = readFileSync(file, 'utf8');
      if (ext === '.csv') {
        cats = fromJpartyCsv(parseCsv(text), { label: basename(file) })
          .map((c) => ({ ...c, source: 'original' }));
      } else {
        const doc = parseLooseJson(text);
        if (!Array.isArray(doc.rounds)) throw new Error('not a j-trivia.org board');
        cats = fromTtgJson(doc).map((c) => ({ ...c, source: 'original',
          provenance: { file: basename(file), title: doc.title, author: doc.author || null } }));
      }
    } catch (e) {
      console.log(`  skip  ${basename(file)} — ${e.message}`);
      failed++; continue;
    }
    const fresh = cats.filter((c) => !seen.has(c.id));
    fresh.forEach((c) => seen.add(c.id));
    skipped += cats.length - fresh.length;
    added.push(...fresh);
    console.log(`  ${String(fresh.length).padStart(3)}  ${basename(file)}` +
      (cats.length !== fresh.length ? `  (${cats.length - fresh.length} already present)` : ''));
  }
} else if (cmd === 'seasons') {
  for (const file of walk(target).filter((f) => f.endsWith('.tsv'))) {
    const season = Number(basename(file).match(/\d+/)?.[0]);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const cols = lines[0].split('\t');
    const rows = lines.slice(1).map((l) => {
      const v = l.split('\t');
      return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
    });
    const cats = fromClueTsv(rows).map((c) => ({ ...c, provenance: { ...c.provenance, season } }));
    const fresh = cats.filter((c) => !seen.has(c.id));
    fresh.forEach((c) => seen.add(c.id));
    skipped += cats.length - fresh.length;
    added.push(...fresh);
    console.log(`  season ${season}: ${fresh.length} categories`);
  }
} else {
  console.error(`unknown command "${cmd}" — use add, seasons, or list`);
  process.exit(1);
}

const all = existing.concat(added);
save(all);
console.log(`\nadded ${added.length} categories` +
  (skipped ? `, skipped ${skipped} already present` : '') +
  (failed ? `, ${failed} files unreadable` : ''));
console.log(`library now ${all.length} categories`);
console.log(summarise(all));
