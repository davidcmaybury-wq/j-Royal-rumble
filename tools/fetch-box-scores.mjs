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

const BASE = 'https://www.jeopardy.com/track/jeopardata';
const OUT = new URL('../data/box-scores.json', import.meta.url);
const DELAY_MS = 2000;

const args = process.argv.slice(2);
const all = args.includes('--all');
const pageArg = args.indexOf('--pages');
const pages = all ? 184 : (pageArg >= 0 ? Number(args[pageArg + 1]) : 20);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();

// Each box score is a table. We want the "Game Totals" block, which carries a
// row per player: name, ATT, BUZ, BUZ%, COR/INC.
function parsePage(html) {
  const games = [];
  const dates = [...html.matchAll(/Daily Box Score\s*<[^>]*>\s*([A-Z][a-z]+ \d{1,2}, \d{4})/g)]
    .map((m) => m[1]);
  const blocks = html.split(/Game Totals/).slice(1);
  blocks.forEach((block, i) => {
    const cut = block.split(/Cumulative Totals|Final Totals|KEY/)[0];
    const rows = [...cut.matchAll(
      /<tr[^>]*>\s*<t[dh][^>]*>([^<]{2,60}?)<\/t[dh]>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)%\s*<\/td>\s*<td[^>]*>\s*(\d+)\/(\d+)\s*<\/td>/g)];
    const players = rows.map((m) => ({
      name: strip(m[1]), att: +m[2], buz: +m[3], cor: +m[5], inc: +m[6],
    })).filter((p) => p.att > 0 && !/ATT|Game/i.test(p.name));
    if (players.length) games.push({ date: dates[i] || null, players });
  });
  return games;
}

function parseCareers(html) {
  const out = [];
  const blocks = html.split(/Cumulative Totals|Final Totals/).slice(1);
  for (const b of blocks) {
    const cut = b.split(/KEY/)[0];
    const m = cut.match(
      /<t[dh][^>]*>([^<]{2,60}?)<\/t[dh]>\s*<td[^>]*>\s*\$([\d,]+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)%\s*<\/td>\s*<td[^>]*>\s*(\d+)\/(\d+)\s*<\/td>/);
    if (m) out.push({ name: strip(m[1]), winnings: +m[2].replace(/,/g, ''),
      wins: +m[3], buzPct: +m[4], cor: +m[5], inc: +m[6] });
  }
  return out;
}

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const games = new Map((existing.games || []).map((g) => [g.date + JSON.stringify(g.players.map((p) => p.name)), g]));
const careers = new Map((existing.careers || []).map((c) => [c.name + ':' + c.wins, c]));

console.log(`fetching ${pages} page${pages === 1 ? '' : 's'}, one every ${DELAY_MS / 1000}s`);
let fetched = 0;
for (let p = 0; p < pages; p++) {
  let html;
  try {
    const res = await fetch(`${BASE}?page=${p}`, { headers: { 'user-agent': 'j-royal-rumble calibration (personal project)' } });
    if (!res.ok) { console.log(`  page ${p}: HTTP ${res.status}`); continue; }
    html = await res.text();
  } catch (e) { console.log(`  page ${p}: ${e.message}`); continue; }

  const g = parsePage(html), c = parseCareers(html);
  for (const x of g) games.set((x.date || p) + JSON.stringify(x.players.map((y) => y.name)), x);
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
