// Runs the collector end to end against a local server serving real markup.
//
// This exists because the parser had its own passing test while the collector
// still crashed on a variable that had been renamed out from under it. A test
// that never invokes main() cannot catch that.
import { createServer } from 'http';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const html = readFileSync(new URL('./fixtures/boxscore.html', import.meta.url), 'utf8');
const OUT = fileURLToPath(new URL('./fixtures/tmp-box.json', import.meta.url));
if (existsSync(OUT)) unlinkSync(OUT);
writeFileSync(OUT, JSON.stringify({ games: [], careers: [] }));

let served = 0;
const server = createServer((req, res) => {
  served++;
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/box`;

const run = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [fileURLToPath(new URL('../tools/fetch-box-scores.mjs', import.meta.url)), ...args],
    { env: { ...process.env, BOX_SCORES_URL: url, BOX_SCORES_OUT: OUT } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

const r = await run(['--pages', '2']);
check('the collector runs without crashing', r.code === 0,
  r.code === 0 ? '' : r.out.split('\n').filter((l) => /Error|error/.test(l))[0] || `exit ${r.code}`);
check('it actually requested the pages', served === 2, `${served} requests`);

const data = JSON.parse(readFileSync(OUT, 'utf8'));
check('it wrote games out', (data.games || []).length > 0, `${(data.games || []).length} games`);
const pg = (data.games || []).flatMap((g) => g.players);
check('with player rows', pg.length > 0, `${pg.length} player-games`);
check('and career lines', (data.careers || []).length > 0, `${(data.careers || []).length}`);
check('the figures survive the round trip',
  pg.some((p) => p.att === 44 && p.buz === 20 && p.cor === 19 && p.inc === 3));
check('duplicate pages are not double counted', pg.length === 5,
  `${pg.length} from two identical pages of 5 rows`);
check('it reports a summary', /player-games/.test(r.out));

// and that a page it cannot parse is reported rather than swallowed
served = 0;
server.close();
const blank = createServer((_q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<html>nothing</html>'); });
await new Promise((r2) => blank.listen(0, r2));
const blankUrl = `http://127.0.0.1:${blank.address().port}/box`;
const r2 = await new Promise((resolve) => {
  const p = spawn(process.execPath, [fileURLToPath(new URL('../tools/fetch-box-scores.mjs', import.meta.url)), '--pages', '2'],
    { env: { ...process.env, BOX_SCORES_URL: blankUrl, BOX_SCORES_OUT: OUT } });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});
check('a page that parses nothing fails loudly', r2.code !== 0 && /FAILED/.test(r2.out),
  `exit ${r2.code}`);
blank.close();
if (existsSync(OUT)) unlinkSync(OUT);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
