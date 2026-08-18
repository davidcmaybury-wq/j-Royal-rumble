// The guards must fail closed.
//
// Both of these defaulted to open. /api/logs served all 52 saved match logs to
// the public for months — handles, buzz times, every answer — and /api/control
// was protected by the literal string 'daymay', which was sitting in a public
// repo. An external review found the first and missed the second, because an
// unauthenticated request to /api/control correctly returned 403.
//
// This suite runs against a server started WITHOUT keys, so it asserts the
// refusing behaviour directly rather than trusting the configuration.
const U = process.env.SEC_URL || 'http://127.0.0.1:8097';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const code = async (p, h = {}) => (await fetch(U + p, { headers: h })).status;

console.log('UNCONFIGURED GUARDS REFUSE');
check('/api/logs refuses without a key', await code('/api/logs') === 403);
check('/api/logs/<file> refuses too', await code('/api/logs/anything.json') === 403);
check('/api/control refuses without a key', await code('/api/control') === 403);
// The published default is the whole point of this one.
check('and refuses the old published default', await code('/api/control?key=daymay') === 403);
check('an empty key does not match an unset one', await code('/api/control?key=') === 403);
check('/api/control/download refuses', await code('/api/control/download') === 403);

console.log('\nPUBLIC HEALTH IS THIN');
{
  // Must be asked over a non-loopback address: localhost deliberately gets the
  // full body so deploy-remote.sh can read matchesInPlay before restarting and
  // ending people's games. Testing from 127.0.0.1 would exercise the wrong path.
  const os = await import('os');
  const lan = Object.values(os.networkInterfaces()).flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal)?.address;
  const port = new URL(U).port;
  if (!lan) {
    check('SKIPPED: no non-loopback address to test the public path from', true);
  } else {
  const r = await (await fetch(`http://${lan}:${port}/api/health`)).json();
  const keys = Object.keys(r).sort();
  check('it answers', r.status === 'ok', JSON.stringify(keys));
  check('and carries nothing but status and version',
    keys.join(',') === 'status,version', keys.join(','));
  for (const leak of ['machine', 'logs', 'matchesInPlay', 'playersInPlay', 'library', 'wrongAnswers']) {
    check(`  no ${leak}`, !(leak in r));
  }
  // The deploy guard reads matchesInPlay from the box itself before restarting
  // and ending people's games. Losing that would be worse than the leak.
  check('version is still public, because /history prints it anyway',
    typeof r.version === 'string' && r.version.length > 0, r.version);
  }
}

console.log('\nBUT THE BOX ITSELF STILL SEES EVERYTHING');
{
  // The deploy guard depends on this. CLAUDE.md: never take it out.
  const r = await (await fetch(`${U}/api/health`)).json();
  check('localhost still gets matchesInPlay', typeof r.matchesInPlay === 'number');
  check('and the log status the deploy script reports', !!r.logs);
}

console.log('\nTHE STACK IS NOT ADVERTISED');
{
  const r = await fetch(`${U}/`);
  check('no x-powered-by header', !r.headers.get('x-powered-by'),
    r.headers.get('x-powered-by') || 'absent');
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
