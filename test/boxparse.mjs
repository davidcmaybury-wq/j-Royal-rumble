// The box-score parser, against a fixture. This exists because the first
// version matched HTML structure, found nothing across forty pages, and said
// so to nobody — the collector wrote the seed file back out unchanged.
import { readFileSync } from 'fs';
import { toText, parseGames, parseCareers, rowsOf } from '../tools/fetch-box-scores.mjs';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

// The fixture is the real markup, taken off the live page. Two earlier
// versions of this parser were written against a converted view instead and
// matched nothing at all.
const html = readFileSync(new URL('./fixtures/boxscore.html', import.meta.url), 'utf8');

const games = parseGames(html);
check('finds both box scores', games.length === 2, `${games.length}`);
const all = games.flatMap((g) => g.players);
check('finds every game-totals row', all.length === 5, `${all.length}`);
// 'SUAZO' contains 'ZO', not a heading — match whole words only.
check('names come out clean of column headings',
  all.every((p) => !/\b(Final|Score|Total|Winnings|ATT|BUZ|COR|INC|DD)\b/i.test(p.name)),
  all.map((p) => p.name).join(', '));
const riggle = all.find((p) => /RIGGLE/i.test(p.name));
check('the numbers are right', riggle && riggle.att === 44 && riggle.buz === 20
  && riggle.cor === 19 && riggle.inc === 3,
  riggle ? `${riggle.att}/${riggle.buz}, ${riggle.cor}/${riggle.inc}` : 'not found');
check('it takes game totals, not the per-round rows',
  !all.some((p) => p.att === 20 && p.buz === 6), 'round rows excluded');
check('a mixed-case name with an entity survives',
  all.some((p) => p.name === 'Luigi de Guzman'), all.map((p) => p.name).join(', '));
check('buz never exceeds attempts', all.every((p) => p.buz <= p.att));

const careers = parseCareers(html);
check('finds the career lines', careers.length === 2, `${careers.length}`);
const luigi = careers.find((c) => /Luigi/.test(c.name));
check('career numbers are right',
  luigi && luigi.wins === 5 && luigi.buzPct === 57 && luigi.cor === 134,
  luigi ? `${luigi.wins} wins, ${luigi.buzPct}%, ${luigi.cor}/${luigi.inc}` : 'not found');

check('the date comes off each box score',
  games[0].date === 'July 24, 2026' && games[1].date === 'September 15, 2022',
  games.map((g) => g.date).join(' / '));
check('header rows are not mistaken for players',
  !all.some((p) => /Game Totals|Cumulative/i.test(p.name)));
check('rows are read by class, not by pattern',
  rowsOf(html).some((r) => /game-totals/.test(r.cls)));
check('a page with no box scores yields nothing rather than nonsense',
  parseGames('<html><body>nothing here</body></html>').length === 0);

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
