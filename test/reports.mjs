// Reporting a bug from inside a match.
//
// No account, no third-party form: people are playing outside David's own tests
// now and the only channel was telling him directly. The context is attached by
// the page rather than asked for, because a report written five minutes later
// has lost the room code and what actually happened.
const U = process.env.URL || 'http://127.0.0.1:8080';
const KEY = process.env.RUMBLE_ADMIN_KEY || 'ci-admin-key';
const auth = { 'x-admin-key': KEY };
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const post = (body) => fetch(`${U}/api/report`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then((r) => r.json());

const r = await post({ kind: 'bug', text: 'The board went blue between clues',
  context: { gameId: 'TEST', screen: 'buzzer', name: 'Dave', clue: 12, version: '9.9.9' } });
check('anybody can file one, with no key', r.ok === true, r.file);

const empty = await post({ kind: 'bug', text: '   ' });
check('an empty one is refused', !!empty.error, empty.error);

const idea = await post({ kind: 'idea', text: 'A rematch button' });
check('ideas file too', idea.ok === true);

// The text is capped rather than trusted.
const huge = await post({ kind: 'bug', text: 'x'.repeat(9000) });
check('a very long one is accepted but capped', huge.ok === true);

const ctl = await (await fetch(`${U}/api/control`, { headers: auth })).json();
const mine = (ctl.reports || []).find((x) => x.gameId === 'TEST');
check('it reaches the control room', !!mine, mine && mine.kind);
check('carrying the context nobody had to type',
  mine && mine.screen === 'buzzer' && mine.clue === 12 && mine.name === 'Dave',
  mine && `${mine.screen} clue ${mine.clue} ${mine.name}`);
const long = (ctl.reports || []).find((x) => x.text.startsWith('xxx'));
check('and the long one was trimmed', long && long.text.length <= 2000,
  long && `${long.text.length} chars`);

// The bulk download and its marker.
const before = ctl.newCount;
check('the control room says how much is waiting', before > 0, String(before));

const dl = await fetch(`${U}/api/control/download`, { headers: auth });
check('the download is served', dl.ok, String(dl.status));
const bundle = await dl.json();
check('containing the reports', (bundle.reports || []).length > 0,
  `${bundle.reports.length} reports, ${bundle.logs.length} logs`);
check('as an attachment', /attachment/.test(dl.headers.get('content-disposition') || ''));

await new Promise((r2) => setTimeout(r2, 300));
const after = await (await fetch(`${U}/api/control`, { headers: auth })).json();
check('and the marker moved, so nothing repeats', after.newCount === 0,
  `${before} -> ${after.newCount}`);

// A full archive is a copy, not a handover: it must not move the marker.
await post({ kind: 'bug', text: 'one more' });
await new Promise((r2) => setTimeout(r2, 200));
const mid = await (await fetch(`${U}/api/control`, { headers: auth })).json();
await fetch(`${U}/api/control/download?all=1`, { headers: auth }).then((x) => x.json());
await new Promise((r2) => setTimeout(r2, 300));
const end = await (await fetch(`${U}/api/control`, { headers: auth })).json();
check('downloading everything leaves the marker alone',
  end.newCount === mid.newCount && mid.newCount > 0,
  `${mid.newCount} -> ${end.newCount}`);

const noKey = await fetch(`${U}/api/control/download`);
check('the download needs the control-room password', noKey.status === 403,
  String(noKey.status));

// Dealing with them: resolved is reversible, deleted is not.
{
  const list = await (await fetch(`${U}/api/control`, { headers: auth })).json();
  const one = (list.reports || [])[0];
  check('there is something to act on', !!one, one && one.file);
  if (one) {
    const post = (body) => fetch(`${U}/api/control/report/${encodeURIComponent(one.file)}`,
      { method: 'POST', headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify(body) }).then((r) => r.json());

    const done = await post({ resolved: true });
    check('a report can be marked resolved', !!done.resolved, done.resolved);
    let now = await (await fetch(`${U}/api/control`, { headers: auth })).json();
    check('and it comes back marked',
      (now.reports.find((r) => r.file === one.file) || {}).resolved, 'stamped');
    check('with settled ones sorted below the rest',
      !now.reports[0].resolved || now.reports.every((r) => r.resolved));

    await post({ resolved: false });
    now = await (await fetch(`${U}/api/control`, { headers: auth })).json();
    check('resolving is reversible',
      !(now.reports.find((r) => r.file === one.file) || {}).resolved);

    const n0 = now.reports.length;
    await post({ remove: true });
    now = await (await fetch(`${U}/api/control`, { headers: auth })).json();
    check('and a spurious one can be deleted', now.reports.length === n0 - 1,
      `${n0} -> ${now.reports.length}`);
  }

  const noKey = await fetch(`${U}/api/control/report/anything.json`, { method: 'POST' });
  check('acting on a report needs the password', noKey.status === 403, String(noKey.status));
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
