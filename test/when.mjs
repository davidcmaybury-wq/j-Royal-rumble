// Availability: the clock arithmetic, the overlap, and the endpoints.
//
// The half of this that matters most is the projection. A weekly pattern is a
// wall-clock fact — "Thursday at 7" — and the instant that answers to it moves
// by an hour twice a year. Storing slots in UTC would pass every test written
// on a Tuesday in June and silently move everybody's evening on 1 November, so
// the first block below projects across a real DST boundary and asserts the
// clock reads the same on both sides of it.
//
// The second thing worth stating: a window is an INTERSECTION. Nine people free
// at seven and nine different people free at eight is not a game night, and the
// first version of this counted each half hour on its own, which says it is.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'rumble-when-'));
const STORE = join(dir, 'when.json');
process.env.RUMBLE_WHEN_FILE = STORE;

const when = await import('../src/when.js');
const { localParts, zonedToUtc } = when;

const LA = 'America/Los_Angeles';
const NY = 'America/New_York';

// --- the clock --------------------------------------------------------------

check('a wall clock becomes the instant it names',
  zonedToUtc(LA, 2026, 9, 17, 19 * 60) === Date.UTC(2026, 8, 18, 2, 0),
  new Date(zonedToUtc(LA, 2026, 9, 17, 19 * 60)).toISOString());

check('and the same clock in another zone is a different instant',
  zonedToUtc(NY, 2026, 9, 17, 19 * 60) - zonedToUtc(LA, 2026, 9, 17, 19 * 60) === -3 * 3600000);

// 2:30am on the morning the clocks go forward never happens. Inventing an
// instant for it would move somebody's evening; skipping it is the honest
// answer, and the caller drops the cell.
check('an hour that does not exist has no instant',
  zonedToUtc(LA, 2027, 3, 14, 2 * 60 + 30) === null);

// The repeated hour in the autumn resolves to its first occurrence, which is
// the one a person means when they say "half past one".
check('a repeated hour takes the first pass',
  zonedToUtc(LA, 2026, 11, 1, 90) === Date.UTC(2026, 10, 1, 8, 30),
  new Date(zonedToUtc(LA, 2026, 11, 1, 90)).toISOString());

// --- projection across a DST boundary ---------------------------------------

const sunday = {
  id: 'dst', name: 'Sunday player', tz: LA,
  weekly: { Sun: [[19 * 60, 21 * 60]] }, dates: {},
};
// 25 October through 8 November 2026: the clocks go back on 1 November.
const from = Date.UTC(2026, 9, 24);
const slots = when.playerSlots(sunday, from, from + 15 * 86400000);

check('two Sundays are found', slots.length === 8, `${slots.length} half hours`);
check('and every one of them reads 7 or 7:30 in their own zone',
  slots.every((t) => [19 * 60, 19 * 60 + 30, 20 * 60, 20 * 60 + 30]
    .includes(localParts(LA, t).hour * 60 + localParts(LA, t).minute)),
  slots.map((t) => localParts(LA, t).hour + ':' + localParts(LA, t).minute).join(' '));

// The proof that the pattern is not stored in UTC: a week apart on the clock is
// eight days' worth of hours in UTC, because an hour was given back in between.
// Stored as a UTC slot index, the second Sunday would have said 6pm.
check('a week later on the clock is a week and an hour in UTC',
  slots[4] - slots[0] === 7 * 86400000 + 3600000,
  `${(slots[4] - slots[0]) / 3600000} hours`);

// --- exceptions -------------------------------------------------------------

const exceptional = {
  ...sunday,
  dates: {
    '2026-11-01': { drop: [[19 * 60, 20 * 60]], add: [[21 * 60, 22 * 60]] },
  },
};
const ex = when.playerSlots(exceptional, from, from + 15 * 86400000);
const nov1 = ex.filter((t) => when.dateIn(LA, t) === '2026-11-01')
  .map((t) => localParts(LA, t).hour * 60 + localParts(LA, t).minute).sort((a, b) => a - b);
check('a one-time change beats the usual week that day',
  JSON.stringify(nov1) === JSON.stringify([20 * 60, 20 * 60 + 30, 21 * 60, 21 * 60 + 30]),
  nov1.join(', '));
check('and leaves the other week alone',
  ex.filter((t) => when.dateIn(LA, t) === '2026-10-25').length === 4);

// --- the overlap ------------------------------------------------------------

when.reset();
const evening = (start, end) => ({ Thu: [[start, end]] });
for (const id of ['a', 'b', 'c', 'd']) {
  when.save(id, { name: id.toUpperCase(), tz: LA, weekly: evening(19 * 60, 21 * 60) });
}
for (const id of ['e', 'f', 'g', 'h']) {
  when.save(id, { name: id.toUpperCase(), tz: LA, weekly: evening(20 * 60, 22 * 60) });
}
const h = when.heat(Date.UTC(2026, 8, 14));
const busiest = Math.max(...h.slots.map((s) => s.n));
check('eight people overlap at the busiest half hour', busiest === 8, String(busiest));

const w4 = when.windows(h, { threshold: 4, minSlots: 4 });
check('a two-hour window is found', w4.length > 0, `${w4.length} windows`);
check('and it counts the people who can make ALL of it, not the busiest moment',
  w4[0].n === 4, `${w4[0].n} people`);

// Raise the bar above either group and there is no game night, even though
// eight people are free at eight o'clock.
check('two half-overlapping groups are not a game night',
  when.windows(h, { threshold: 5, minSlots: 4 }).length === 0);

// --- proposals --------------------------------------------------------------

when.reset();
for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
  when.save(id, { name: id.toUpperCase(), tz: LA, weekly: evening(19 * 60, 22 * 60) });
}
const found = when.scan(Date.now(), { threshold: 8, minSlots: 4 });
check('a scan finds the Thursday', found.length > 0, `${found.length} nights`);
check('nothing it proposes starts sooner than the lead time',
  found.every((x) => x.start > Date.now() + when.settings().leadHours * 3600000));

if (!found.length) {
  // Everything below reads the first one. Say so rather than passing a check
  // that never ran — a count from a different step than the claim it supports
  // reads as evidence for years.
  check('the rest of the proposal checks had something to run against', false, 'no night found');
}
when.record(found[0] || { start: 0, end: 0, n: 0, ids: [] });
const again = when.scan(Date.now(), { threshold: 8, minSlots: 4 });
check('and it is not proposed twice',
  !again.some((x) => x.start === found[0].start), `${again.length} still open`);

check('a proposal survives a reload of the store', (() => {
  when.reset();
  return !!when.proposal(found[0].start);
})());

// --- the page draws what it was given ---------------------------------------
//
// The same trick pagerefs.mjs uses on the other pages: run the inline script in
// a stub DOM and look at what it wrote. Static checks say every id exists; they
// cannot say that a saved Thursday comes back painted, and "the grid is empty"
// throws nothing — which is the failure mode this repo keeps meeting.
{
  const html = readFileSync(new URL('../public/when.html', import.meta.url), 'utf8');
  const i = html.indexOf('<script type="module">');
  let js = html.slice(i + '<script type="module">'.length, html.lastIndexOf('</script>'));

  // The imports are real arithmetic, not decoration, so they are injected
  // rather than stubbed: a no-op zonedToUtc would draw a grid that proves
  // nothing.
  const zoned = await import('../public/zoned.js');
  js = js.replace(/import\s*\{[^}]*\}\s*from\s*'[^']+';?/g, '');

  const byId = new Map();
  const stub = () => ({
    style: {}, dataset: {}, value: '', checked: false, hidden: false,
    className: '', _h: '', _t: '',
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, setPointerCapture() {}, focus() {},
    querySelectorAll: () => [], querySelector: () => null, closest: () => null,
  });
  const doc = {
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, stub()); return byId.get(id); },
    querySelector: () => null, querySelectorAll: () => [], createElement: stub,
    body: stub(), addEventListener() {}, elementFromPoint: () => null,
  };

  const me = {
    signedIn: true, user: { id: 'u1', name: 'Tester', avatar: null },
    discord: { signIn: true, missing: [] },
    me: { id: 'u1', name: 'Tester', tz: LA, weekly: { Thu: [[19 * 60, 21 * 60]] }, dates: {} },
    settings: { threshold: 8, minSlots: 4 }, storage: { durable: true },
  };
  // A Thursday evening in the window the page shows by default.
  const hot = zoned.zonedToUtc(LA, 2026, 9, 17, 19 * 60);
  const heatBody = {
    from: hot - 86400000, to: hot + 86400000, players: 9, named: true,
    slots: [{ t: hot, n: 9, who: [{ id: 'u1', name: 'Tester' }] }],
    windows: [{ start: hot, end: hot + 2 * 3600000, n: 9, who: [{ id: 'u1', name: 'Tester' }] }],
    settings: { threshold: 8, minSlots: 4 },
  };
  const answers = { '/api/when/me': me, '/api/when/heat': heatBody, '/api/health': { version: '0.0.0' } };

  const header = `
    var document = arguments[0], window = arguments[1], location = arguments[2];
    var zonedImports = arguments[3], calls = arguments[4], answers = arguments[5];
    var { DAYS, SLOT, zonedToUtc, localParts, isoDate, dowOf, addDays,
          minutesToRanges, rangeMinutes, knownZone } = zonedImports;
    var fetch = function (url) {
      calls.push(String(url));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(
        answers[String(url).split('?')[0]] || {}) });
    };
    var confirm = function () { return true; };
    var alert = function () {};
    var setTimeout = function (fn) { return 0; };
    var clearTimeout = function () {};
  `;

  const calls = [];
  let threw = null;
  try {
    // eslint-disable-next-line no-new-func
    const run = new Function(header + '\n' + js);
    run(doc, { addEventListener() {} }, { reload() {}, href: '' },
      zoned, calls, answers);
    // boot() is async; let its two awaited fetches settle.
    for (let k = 0; k < 8; k++) await Promise.resolve();
    await wait(50);
  } catch (e) {
    threw = e.message;
  }
  check('the page runs against a stub DOM', !threw, threw || 'no throw');

  const grid = byId.get('grid')?.innerHTML || '';
  const cells = (grid.match(/class="cell/g) || []).length;
  // 15:00 to midnight, seven days.
  check('the usual-week grid draws every half hour of the evening',
    cells === 18 * 7, `${cells} cells`);

  // The whole point of loading: a pattern that was saved comes back painted.
  const painted = (grid.match(/class="cell on"/g) || []).length;
  check('and a saved Thursday comes back painted', painted === 4, `${painted} on`);

  const heatGrid = byId.get('heat')?.innerHTML || '';
  check('the heat map draws the same shape', (heatGrid.match(/class="cell/g) || []).length === 18 * 7);
  check('and paints the busiest half hour at the top of the ramp',
    heatGrid.includes('h6'), heatGrid.includes('h6') ? 'h6 present' : 'no hot cell');

  check('the best-windows list names the window',
    (byId.get('best')?.innerHTML || '').includes('9 free'),
    (byId.get('best')?.innerHTML || '').slice(0, 60));

  check('and it asked the server for both halves',
    calls.includes('/api/when/me') && calls.includes('/api/when/heat'), calls.join(' '));
}

// --- the endpoints ----------------------------------------------------------

const PORT = 8095;
const U = `http://127.0.0.1:${PORT}`;
const KEY = 'when-test-key';
const srv = spawn('node', ['src/server.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    RUMBLE_ADMIN_KEY: KEY,
    RUMBLE_WHEN_DEV_LOGIN: '1',
    RUMBLE_WHEN_FILE: join(dir, 'server-when.json'),
    // Fake credentials, so /auth/discord builds a real redirect instead of
    // answering 503. Nothing here talks to Discord — the test stops at the
    // redirect this server issues — but without them the sign-in checks below
    // pass on "not configured", which is a check that never runs.
    RUMBLE_DISCORD_CLIENT_ID: 'test-client-id',
    RUMBLE_DISCORD_CLIENT_SECRET: 'test-client-secret',
    RUMBLE_SESSION_SECRET: 'test-session-secret',
  },
  stdio: 'ignore',
});

let up = false;
for (let i = 0; i < 90 && !up; i++) {
  await wait(500);
  try { up = (await fetch(`${U}/api/health`)).ok; } catch { /* still booting */ }
}
check('a server with availability switched on boots', up);

if (up) {
  const page = await fetch(`${U}/when`);
  check('/when serves the page', page.ok && (await page.text()).includes('WHEN CAN YOU PLAY'));
  check('and the shared clock module is served to the browser',
    (await fetch(`${U}/zoned.js`)).ok);

  const out = await (await fetch(`${U}/api/when/me`)).json();
  check('a stranger is not signed in', out.signedIn === false);
  check('and is told whether sign-in is even configured here',
    typeof out.discord?.signIn === 'boolean', JSON.stringify(out.discord?.missing || []));

  const refused = await fetch(`${U}/api/when/me`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ weekly: { Thu: [[1140, 1260]] } }),
  });
  check('and cannot save anything', refused.status === 401, String(refused.status));

  // --- sign-in must not be usable to send somebody somewhere else ----------
  //
  // `next` decides where a player lands after Discord lets them in, and the
  // first test on it was `startsWith('/')`. `//evil.example` starts with a
  // slash and is a protocol-relative URL: the browser reads it as another
  // origin. The link being phished with would have been a genuine one on our
  // own domain, which is exactly what makes the pattern work.
  //
  // Asserted against the redirect the server actually issues, not against the
  // regex, so rewriting the check in a way that reopens this still fails here.
  const destOf = async (next) => {
    const r = await fetch(`${U}/auth/discord?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
    // The destination is remembered in the state cookie and used verbatim after
    // Discord returns, so that cookie is where an injected target would show up.
    const raw = (r.headers.get('set-cookie') || '')
      .split(/,(?=\s*rumble_)/).find((c) => c.includes('rumble_when_state')) || '';
    const val = decodeURIComponent((/rumble_when_state=([^;]*)/.exec(raw) || [, ''])[1]);
    return { status: r.status, dest: val.split('|')[1] || '' };
  };

  const good = await destOf('/when');
  check('sign-in is actually exercised, not skipped as unconfigured',
    good.status === 302, `status ${good.status}`);
  check('an ordinary same-site path is carried through', good.dest === '/when', good.dest);

  // The last two are the ones a raw string test misses: browsers strip tab and
  // newline out of a URL before parsing, so these arrive at another origin.
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example',
                     '/\t/evil.example', '/\n/evil.example']) {
    const r = await destOf(bad);
    check(`sign-in will not carry ${JSON.stringify(bad)} as a destination`,
      r.dest === '/when', `it kept ${JSON.stringify(r.dest)}`);
  }

  // The dev door: only from this machine, and only with the variable set.
  const login = await fetch(`${U}/api/when/dev-login?id=tester&name=Tester`);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('the local test door signs somebody in', login.ok && cookie.includes('rumble_when'));

  const saved = await fetch(`${U}/api/when/me`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ tz: LA, weekly: { Thu: [[19 * 60, 22 * 60]] } }),
  });
  check('a signed-in player can save', saved.ok, String(saved.status));

  const mine = await (await fetch(`${U}/api/when/me`, { headers: { cookie } })).json();
  check('and gets it back', JSON.stringify(mine.me?.weekly?.Thu) === '[[1140,1320]]',
    JSON.stringify(mine.me?.weekly));

  const bad = await fetch(`${U}/api/when/me`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ tz: 'Mars/Olympus' }),
  });
  check('a timezone nobody has heard of is refused', bad.status === 400);

  const heat = await (await fetch(`${U}/api/when/heat`)).json();
  check('the heat map is public', heat.slots.length > 0, `${heat.slots.length} half hours`);
  // Counts answer "is anybody around on a Tuesday". Names are a different
  // object: a public page listing when named people are free.
  check('but names are not', heat.named === false
    && heat.slots.every((s) => s.who.length === 0));
  const named = await (await fetch(`${U}/api/when/heat`, { headers: { cookie } })).json();
  check('and are shown to somebody who has answered themselves',
    named.named === true && named.slots.some((s) => s.who.length > 0));

  check('the control endpoints refuse without the admin key',
    (await fetch(`${U}/api/when/proposals`)).status === 403);
  const admin = await (await fetch(`${U}/api/when/proposals`, {
    headers: { 'x-admin-key': KEY },
  })).json();
  check('and answer with it', Array.isArray(admin.proposals), JSON.stringify(admin.settings));
  check('reporting what Discord is missing rather than pretending it is wired',
    Array.isArray(admin.discord.missing) && admin.discord.missing.length > 0,
    admin.discord.missing.join(', '));

  // One tester cannot clear a threshold of eight, so lower it and prove the
  // dial is what the scan actually reads.
  const tuned = await (await fetch(`${U}/api/when/settings`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
    body: JSON.stringify({ threshold: 1, minSlots: 4 }),
  })).json();
  check('the threshold is adjustable from the control room',
    tuned.settings.threshold === 1, JSON.stringify(tuned.settings));

  const scan = await (await fetch(`${U}/api/when/scan`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
    body: JSON.stringify({ quiet: true }),
  })).json();
  check('a scan on demand finds the night that clears it', scan.found > 0, String(scan.found));

  // The failure has to arrive. A Send that reports success and posts nothing is
  // the exact shape of the silent failure this codebase keeps finding.
  const send = await fetch(`${U}/api/when/proposals/${scan.proposals[0].key}/send`, {
    method: 'POST', headers: { 'x-admin-key': KEY },
  });
  check('sending with no bot token fails loudly', send.status === 502,
    (await send.json()).error);

  const after = await (await fetch(`${U}/api/when/proposals`, {
    headers: { 'x-admin-key': KEY },
  })).json();
  check('and a failed send is not recorded as sent',
    after.proposals.every((p) => !p.sent));
}

srv.kill();
try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp */ }

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
