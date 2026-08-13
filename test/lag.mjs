// The lag trim, which a player reported as doing nothing.
//
// It was doing exactly what it should — 0, 100 and 1000ms all arm when they
// ought to. What it lacked was any sign of it. The lights on the shared screen
// arrive at the same moment whatever you set, because the trim only moves your
// own buzzer, and at a large positive value every press lands before your arm
// and becomes a lockout rather than a slow buzz.
globalThis.performance = { now: () => Date.now() };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {};
globalThis.location = { pathname: '/j/ABCD', hash: '', origin: '' };
globalThis.io = () => ({ on() {}, emit() {}, timeout() { return this; }, close() {} });
globalThis.document = { getElementById: () => null, addEventListener() {}, querySelector: () => null };

const { armAt, setLag, getLag, attemptBuzz, isArmed, disarm } = await import('../public/rumble.js');
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const armIn = (lag, serverWait = 200) => { setLag(lag); return armAt(Date.now() + serverWait, 250); };

// Measure once and reuse. Calling armIn twice — once for the condition and once
// for the message — meant the two evaluated different moments, and a
// millisecond of drift between them failed the check while printing the value
// that would have passed it. A tolerance too: this is wall-clock arithmetic and
// a slow runner can lose a millisecond mid-call.
const near = (got, want, slack = 3) => Math.abs(got - want) <= slack;

for (const [lag, want, label] of [
  [0, 200, 'no trim arms on the signal'],
  [100, 300, 'a positive trim arms later'],
  [1000, 1200, 'and scales all the way up'],
  [-100, 100, 'a negative trim arms sooner'],
]) {
  const got = armIn(lag);
  check(label, near(got, want), `${Math.round(got)}ms, wanted ${want}ms`);
}
{
  const got = armIn(-5000);
  check('but never before now', got === 0, `${got}ms`);
}

// Rounded to the nearest ten on purpose: the control is a trim for audio-path
// differences, and single milliseconds are noise at that scale.
setLag(37);
check('the value is rounded to the nearest ten', getLag() === 40, String(getLag()));
setLag(9999);
check('and clamped at the top', getLag() <= 1000, String(getLag()));
setLag(-9999);
check('and at the bottom', getLag() >= -500, String(getLag()));

// The trap: with a big positive trim, a press at the old moment is a lockout.
setLag(0);
armAt(Date.now() - 50, 250);       // already armed
disarm();
setLag(800);
armAt(Date.now() + 100, 250);      // arms 900ms from now
check('a press before the trimmed arm is an early press, not a slow buzz',
  attemptBuzz() === 'early',
  'which is why a large positive value looks like nothing happening');
check('and the buzzer is not armed yet', !isArmed());

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
