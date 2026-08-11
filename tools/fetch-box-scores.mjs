#!/usr/bin/env node
// Collects the official Jeopardy! daily box scores into data/box-scores.json.
//
//   node tools/fetch-box-scores.mjs            first 20 pages
//   node tools/fetch-box-scores.mjs --all      all 184 pages, slowly
//   node tools/fetch-box-scores.mjs --pages 60
//
// Run this rather than asking an assistant to fetch pages by hand — 184 pages
// through a chat is both slow and wasteful. One request every two seconds is
// polite to somebody else's server; there is no hurry here.
//
// The show publishes these itself, so this is reading a public dataset rather
// than scraping something the owner would rather you didn't.

import { writeFileSync, readFileSync, existsSync } from 'fs';

// Overridable so the collector itself can be run against a local fixture in
// the tests. Testing the parser alone was not enough: it passed while main()
// still referenced a variable that no longer existed.
const BASE = process.env.BOX_SCORES_URL || 'https://www.jeopardy.com/track/jeopardata';
const OUT = process.env.BOX_SCORES_OUT
  ? new URL('file://' + process.env.BOX_SCORES_OUT)
  : new URL('../data/box-scores.json', import.meta.url);
const DELAY_MS = 2000;

import { pathToFileURL } from 'url';
const args = process.argv.slice(2);
const all = args.includes('--all');
const pageArg = args.indexOf('--pages');
const pages = all ? 184 : (pageArg >= 0 ? Number(args[pageArg + 1]) : 20);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = args.includes('--dump');
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();

// The page classes every row by section: `game-totals`, `cumulative-totals`,
// `jeopardy-round` and so on, with the contestant name in a <th> and the
// figures in <td>s. So there is nothing to pattern-match — read the classes.
//
// Two earlier versions of this guessed at the markup from a converted view and
// silently matched nothing across forty pages. The lesson is in the test:
// parse against a real fixture, and fail loudly when you find nothing.

const CELL = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const ROW = /<tr([^>]*)>([\s\S]*?)<\/tr>/gi;

export function toText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function cellsOf(rowHtml) {
  const out = [];
  CELL.lastIndex = 0;
  let m;
  while ((m = CELL.exec(rowHtml))) out.push(toText(m[1]));
  return out;
}

// Every <tr> on the page, with its class and its cell text.
export function rowsOf(html) {
  const rows = [];
  ROW.lastIndex = 0;
  let m;
  while ((m = ROW.exec(html))) {
    rows.push({ cls: (m[1].match(/class="([^"]*)"/) || [, ''])[1], cells: cellsOf(m[2]) });
  }
  return rows;
}

const num = (s) => Number(String(s).replace(/[^\d-]/g, '')) || 0;
const corInc = (s) => {
  const m = String(s).match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { cor: +m[1], inc: +m[2] } : null;
};

// Table boundaries: each box score is its own <table>.
function tables(html) {
  return String(html).split(/<table\b/i).slice(1);
}

export function parseGames(html) {
  const games = [];
  for (const t of tables(html)) {
    const date = (toText(t).match(/Daily Box Score ([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1] || null;
    const players = [];
    for (const r of rowsOf(t)) {
      if (!/\bgame-totals\b/.test(r.cls) || /header-row/.test(r.cls)) continue;
      const [name, att, buz, , ci] = r.cells;
      const parsed = corInc(ci);
      if (!name || !parsed) continue;
      players.push({ name, att: num(att), buz: num(buz), cor: parsed.cor, inc: parsed.inc });
    }
    if (players.length) games.push({ date, players });
  }
  return games;
}

export function parseCareers(html) {
  const out = [];
  for (const t of tables(html)) {
    for (const r of rowsOf(t)) {
      if (!/\bcumulative-totals\b|\bfinal-totals\b/.test(r.cls) || /header-row/.test(r.cls)) continue;
      const [name, winnings, wins, buzPct, ci] = r.cells;
      const parsed = corInc(ci);
      if (!name || !parsed) continue;
      // Tournament box scores have no "Games Won" column, so the money lands
      // where the win count should be. Nobody has won sixty games; anything
      // that large is a prize, and the win count is simply unknown.
      const w = num(wins);
      out.push({ name, winnings: num(winnings), wins: w > 60 ? null : w,
        buzPct: num(buzPct), cor: parsed.cor, inc: parsed.inc });
    }
  }
  return out;
}

async function main() {
  const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const games = new Map((existing.games || []).map((g) => [g.date + JSON.stringify(g.players.map((p) => p.name)), g]));
  const careers = new Map((existing.careers || []).map((c) => [c.name + ':' + c.wins, c]));

  console.log(`fetching ${pages} page${pages === 1 ? '' : 's'}, one every ${DELAY_MS / 1000}s`);
  let fetched = 0, empty = 0;
  for (let p = 0; p < pages; p++) {
    let html;
    try {
      const res = await fetch(`${BASE}?page=${p}`, { headers: { 'user-agent': 'j-royal-rumble calibration (personal project)' } });
      if (!res.ok) { console.log(`  page ${p}: HTTP ${res.status}`); continue; }
      html = await res.text();
      if (dump && p === 0) {
        writeFileSync(new URL('../data/page-dump.html', import.meta.url), html);
        console.log('  wrote data/page-dump.html for inspection');
      }
    } catch (e) { console.log(`  page ${p}: ${e.message}`); continue; }

    const g = parseGames(html), c = parseCareers(html);
    if (!g.length) {
      console.log(`\n  page ${p}: parsed nothing — the page layout may have changed`);
      empty++;
    }
    g.forEach((x, i) => games.set((x.date || p + ':' + i)
      + JSON.stringify(x.players.map((y) => y.name)), x));
    for (const x of c) careers.set(x.name + ':' + x.wins, x);
    fetched++;
    process.stdout.write(`\r  page ${p + 1}/${pages}  ${games.size} games, ${careers.size} career lines`);
    if (p < pages - 1) await sleep(DELAY_MS);
  }
  console.log('');

  const out = {
    ...existing,
    source: 'Official Jeopardy! daily box scores, https://www.jeopardy.com/track/jeopardata',
    collected: new Date().toISOString(),
    pagesFetched: fetched,
    games: [...games.values()],
    careers: [...careers.values()].sort((a, b) => b.wins - a.wins),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

  // Fail loudly. A silent zero-parse across forty pages is how the first version
  // of this wasted an afternoon.
  if (empty === fetched && fetched > 0) {
    console.log('\nFAILED: fetched ' + fetched + ' pages and parsed nothing from any of them.');
    console.log('The page structure has probably changed. Run with --dump to save a page.');
    process.exit(1);
  }
  if (empty) console.log(`note: ${empty} of ${fetched} pages parsed nothing`);

  const pg = out.games.flatMap((x) => x.players);
  const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  console.log(`\n${pg.length} player-games, ${out.careers.length} career lines`);
  console.log(`  attempts  median ${med(pg.map((p) => p.att))}`);
  console.log(`  BUZ%      median ${Math.round(med(pg.map((p) => p.buz / p.att * 100)))}%`);
  console.log(`  correct%  median ${Math.round(med(pg.map((p) => p.cor / (p.cor + p.inc) * 100)))}%`);
  const sc = out.careers.filter((c) => c.wins >= 6);
  if (sc.length) {
    console.log(`\n  superchamps (6+ wins): ${sc.length}, BUZ% median ${Math.round(med(sc.map((c) => c.buzPct)))}%`);
  }
  console.log('\nthen: node tools/calibrate-bots.mjs');

}

// Only run the collector when this file is executed directly, so the parser
// can be imported and tested on its own.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
