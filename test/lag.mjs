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

check('no trim arms on the signal', Math.round(armIn(0)) === 200, `${Math.round(armIn(0))}ms`);
check('a positive trim arms later', Math.round(armIn(100)) === 300, `${Math.round(armIn(100))}ms`);
check('and scales all the way up', Math.round(armIn(1000)) === 1200, `${Math.round(armIn(1000))}ms`);
check('a negative trim arms sooner', Math.round(armIn(-100)) === 100, `${Math.round(armIn(-100))}ms`);
check('but never before now', armIn(-5000) === 0, `${armIn(-5000)}ms`);

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
