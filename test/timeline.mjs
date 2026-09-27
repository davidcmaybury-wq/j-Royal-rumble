// Every press is reported relative to ACTIVATION — the one measure that matters.
//
// Drives the real public/rumble.js with a fake clock and a fake socket, so what
// is checked is exactly what the buzzer would send the server.
//
// The case this exists for: a press made while the clue is still being read
// happens before the activation message has arrived, so there is nothing to be
// relative to yet. The client holds the absolute time and converts it the
// moment activation is known. It used to report null.
import { readFileSync, writeFileSync } from 'fs';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

globalThis.__sent = []; globalThis.__now = 0;
globalThis.io = () => ({ emit: (ev, d) => __sent.push({ ev, ...(d || {}) }), on() {},
  timeout() { return { emit() {} }; }, id: 'x' });
globalThis.performance = { now: () => __now };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { pathname: '/j/TEST', hash: '', search: '' };
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, hidden: false, visibilityState: 'visible' };
globalThis.addEventListener = () => {};
const tmp = '/tmp/rumble-timeline-under-test.mjs';
writeFileSync(tmp, readFileSync(new URL('../public/rumble.js', import.meta.url), 'utf8'));
const m = await import(tmp);

// Clocks only run forward, so every scenario starts later than the last.
let base = 0;
function run(events) {
  base += 100000; __sent.length = 0; __now = base; m.disarm(); __sent.length = 0;
  for (const e of events) {
    if (e[0] === 'show') { __now = base; m.clueShown(); }
    if (e[0] === 'arrive') { __now = base + e[1]; m.armAt(Date.now() + (e[2] - e[1]), 250); }
    if (e[0] === 'press') { __now = base + e[1]; m.attemptBuzz(); }
    if (e[0] === 'next') { __now = base + e[1]; m.disarm(); }
  }
  return __sent.map((s) => ({ kind: s.ev === 'buzz' ? 'valid' : s.kind,
    t: s.ev === 'buzz' ? s.ms : s.at, neverArmed: s.neverArmed }));
}
const every60 = (from, n = 6) => [...Array(n)].map((_, i) => ['press', from + i * 60]);
const near = (a, b) => a != null && Math.abs(a - b) < 0.2;

console.log('A JUMP AND A VOLLEY, ACTIVATION ALREADY KNOWN');
{
  const out = run([['show'], ['arrive', 2900, 3000], ...every60(3000 - 25.1)]);
  check('the jump reads as -25.1ms', out[0].kind === 'early' && near(out[0].t, -25.1),
    `${out[0].kind} ${out[0].t}`);
  check('the next four are locked out, at positive times',
    out.slice(1, 5).every((p) => p.kind === 'locked' && p.t > 0),
    out.slice(1, 5).map((p) => p.t).join(', '));
  check('the sixth gets through once the 250ms penalty has run',
    out[5].kind === 'valid' && near(out[5].t, 274.9), `${out[5].kind} ${out[5].t}`);
}

console.log('\nA JUMP DURING THE READING, BEFORE ACTIVATION IS KNOWN');
{
  const out = run([['show'], ['press', 1800], ['press', 1860],
    ['arrive', 2900, 3000], ...every60(3000 - 25.1)]);
  check('the early jump is placed relative to activation, not left blank',
    out[0].kind === 'early' && near(out[0].t, -1200), `${out[0].kind} ${out[0].t}`);
  check('its follow-up is locked, and also placed', out[1].kind === 'locked' && near(out[1].t, -1140),
    `${out[1].kind} ${out[1].t}`);
  check('the penalty expires, so the second jump is a fresh one',
    out[2].kind === 'early' && near(out[2].t, -25.1), `${out[2].kind} ${out[2].t}`);
  check('and nothing came back null', out.every((p) => p.t != null),
    out.map((p) => p.t).join(', '));
}

console.log('\nA CLUE ABANDONED BEFORE IT EVER ARMED');
{
  const out = run([['show'], ['press', 1500], ['press', 1560], ['next', 4000]]);
  check('the presses are still sent, not dropped', out.length === 2, `${out.length} sent`);
  check('flagged as never armed', out.every((p) => p.neverArmed), JSON.stringify(out));
  check('with no activation to be relative to', out.every((p) => p.t === null));
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
