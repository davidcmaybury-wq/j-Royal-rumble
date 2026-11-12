// A recorded handle cannot be shadowed by the same letters in another case.
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'rumble-handles-'));
process.env.RUMBLE_LOG_DIR = dir;
writeFileSync(join(dir, '2026-08-31-01-03-SPEV.json'), JSON.stringify({
  standings: [{ name: 'brian' }, { name: 'Nam' }, { name: 'Rookie Robot', isBot: true }],
}));
writeFileSync(join(dir, 'broken.json'), '{"standings": [');
const logs = await import('../src/logstore.js');

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

check('a new name that differs from a recorded one only in case is refused',
  logs.handleClashes('Brian').join() === 'brian', JSON.stringify(logs.handleClashes('Brian')));
check('the recorded spelling itself is let through, because that is the same person back',
  logs.handleClashes('brian').length === 0);
check('surrounding spaces do not get a lookalike past the door',
  logs.handleClashes('  BRIAN ').join() === 'brian');
check('a name nobody has used is let through', logs.handleClashes('Brianna').length === 0);
check('robots are not anybody\'s identity, so their names stay free',
  logs.handleClashes('rookie robot').length === 0);
check('a half-written log does not break the door', logs.recordedHandles().has('Nam'));

logs.save('TPPZ', { startedAt: '2026-10-12T01:03:00Z', standings: [{ name: 'Wild Thing' }] });
check('a match saved after boot joins the record at once',
  logs.handleClashes('wild thing').join() === 'Wild Thing');

const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
check('the join path asks the record before admitting a name',
  /socket\.on\('join'[\s\S]{0,2500}handleClashes\(wanted\)/.test(server));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
