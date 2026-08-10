// Builds data/library.ndjson.gz from original boards + the public clue dataset.
// Run: node tools/build-library.mjs <seasonsDir> <originalDir>
import { fromTtgJson, fromClueTsv } from '../src/sources.js';
import { readFileSync, readdirSync, writeFileSync, createWriteStream } from 'fs';
import { createGzip } from 'zlib';
import { join } from 'path';

const [, , seasonsDir, originalDir] = process.argv;
const out = [];

if (originalDir) {
  for (const f of readdirSync(originalDir).filter((f) => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(originalDir, f), 'utf8'));
    for (const c of fromTtgJson(doc)) {
      out.push({ ...c, source: 'original', author: doc.author || null, game: doc.title });
    }
  }
}

function parseTsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const cols = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const v = lines[i].split('\t');
    const r = {};
    for (let j = 0; j < cols.length; j++) r[cols[j]] = v[j] ?? '';
    rows.push(r);
  }
  return rows;
}

if (seasonsDir) {
  for (const f of readdirSync(seasonsDir).filter((f) => f.endsWith('.tsv')).sort()) {
    const season = Number(f.match(/\d+/)[0]);
    const cats = fromClueTsv(parseTsv(join(seasonsDir, f)));
    for (const c of cats) out.push({ ...c, provenance: { ...c.provenance, season } });
    process.stdout.write(`  season ${season}: ${cats.length} categories\n`);
  }
}

const gz = createGzip({ level: 9 });
const ws = createWriteStream('data/library.ndjson.gz');
gz.pipe(ws);
for (const c of out) gz.write(JSON.stringify(c) + '\n');
gz.end();
ws.on('finish', () => {
  const by = {};
  for (const c of out) by[c.source] = (by[c.source] || 0) + 1;
  console.log(`\n${out.length} categories, ${out.reduce((n, c) => n + c.clues.length, 0)} clues`);
  console.log(by);
});
