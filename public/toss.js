// The three 8-bit sequences, drawn with whoever is actually involved.
//
// Generated at runtime rather than baked as frame strings, which is what lets
// the wrestler being thrown out be the player who was actually thrown out. The
// Python generator that used to produce these could only do fixed colours.

import { wrestler, ring, lookFor } from '/wrestlers.js';

const W = 64, H = 40, FPS = 9;
const CHALK = '#EEEBE1', BRASS = '#D6A93F', LINE = '#2A3556', SLATE = '#5E6B95';
const px = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
const spin = (inner, cx, cy, deg) =>
  `<g transform="rotate(${deg} ${cx} ${cy})">${inner}</g>`;

// Nobody won the clue, so nobody threw them out — the referee does it. Stripes
// on purpose: it should be obvious this was not a person.
const REF = { referee: true, hair: 'short', hairColour: 'black', skin: 1 };

const FRAMES = {
  toss: 18,
  climb: 12,
  entry: 24,
};

function tossFrame(i, thrower, victim) {
  const o = [];
  if (i < 2) o.push(wrestler(14, 17, thrower, { arms: 'down', legs: 'stand' }));
  else if (i < 4) o.push(wrestler(15, 17, thrower, { arms: 'grab', legs: 'wide' }));
  else if (i < 7) o.push(wrestler(15, 16, thrower, { arms: 'up', legs: 'wide' }));
  else if (i < 9) o.push(wrestler(14, 17, thrower, { arms: 'throw', legs: 'wide', lean: 1 }));
  else if (i < 15) o.push(wrestler(14, 18, thrower, { arms: 'down', legs: 'wide' }));
  else o.push(wrestler(14, 16, thrower, { arms: 'raise', legs: 'stand' }));

  if (i < 2) o.push(wrestler(28, 17, victim, { arms: 'down', legs: 'stand', flip: true }));
  else if (i < 4) o.push(wrestler(25, 17, victim, { arms: 'down', legs: 'wide', flip: true }));
  else if (i < 7) {
    const lift = 7 - i;
    o.push(spin(wrestler(20, 10 + lift, victim, { arms: 'up', legs: 'tuck', flip: true }),
      24, 16 + lift, -70));
  } else {
    const t = i - 7;
    const x = 22 + t * 5.6;
    const y = 8 - 3.2 * t + 0.55 * t * t;
    if (x < W + 12) {
      o.push(spin(wrestler(Math.round(x), Math.round(y), victim,
        { arms: 'up', legs: 'tuck', flip: true }), x + 4, y + 8, -70 - t * 46));
      for (const k of [1, 2, 3]) {
        o.push(px(Math.round(x) - k * 4, Math.round(y) + 7, 2, 1, k > 1 ? LINE : SLATE));
      }
    }
  }
  if (i === 7 || i === 8) {
    for (const [fx, fy] of [[19, 11], [27, 7], [31, 13], [23, 5], [16, 8]]) {
      o.push(px(fx, fy, 2, 2, i === 7 ? CHALK : BRASS));
    }
  }
  return o.join('');
}

function climbFrame(i, climber, other) {
  const o = [];
  const post = W - 8;
  if (i < 2) o.push(wrestler(post - 10, 17, climber, { arms: 'down', legs: 'wide' }));
  else if (i < 5) {
    const rise = i - 2;
    o.push(wrestler(post - 8 + rise * 2, 15 - rise * 3, climber, { arms: 'up', legs: 'tuck' }));
  } else {
    const bob = (i - 5) % 4;
    const dy = bob === 1 ? -1 : bob === 3 ? 1 : 0;
    o.push(wrestler(post - 3, 6 + dy, climber,
      { arms: bob % 2 === 0 ? 'raise' : 'up', legs: 'wide' }));
    for (let k = 0; k < 3; k++) {
      if ((i + k) % 3 === 0) o.push(px(post - 8 + k * 6, 4 + (k % 2) * 3, 2, 2, CHALK));
    }
  }
  if (other) o.push(wrestler(14, 17, other, { arms: 'down', legs: 'stand', flip: true }));
  return o.join('');
}

function entryFrame(i, who) {
  const o = [];
  if (i < 8) {
    const x = -10 + i * 4;
    o.push(px(x, 27, 8, 4, '#C8564A'));
    o.push(px(x + 6, 26, 4, 4, '#C98D63'));
    o.push(px(x + 1, 31, 3, 1, '#C98D63'));
    for (const [k, c] of [[2, SLATE], [5, LINE], [8, LINE]]) {
      if (x - k > -4 && (i + k) % 2) o.push(px(x - k, 29 + (k % 2), 2, 1, c));
    }
  } else if (i < 13) {
    const t = i - 8;
    o.push(wrestler(22, 17 + Math.max(0, 4 - t), who,
      { arms: t < 3 ? 'down' : 'up', legs: t < 3 ? 'tuck' : 'stand' }));
  } else {
    const pose = Math.floor((i - 13) / 2) % 3;
    o.push(wrestler(22, 17, who, {
      arms: ['flex', 'up', 'raise'][pose],
      legs: ['wide', 'stand', 'wide'][pose],
    }));
    if (pose === 0) for (const [fx, fy] of [[17, 12], [35, 12]]) o.push(px(fx, fy, 2, 2, BRASS));
    else if (pose === 2) for (const [fx, fy] of [[19, 9], [33, 9]]) o.push(px(fx, fy, 2, 2, CHALK));
  }
  return o.join('');
}

export const SECONDS = Object.fromEntries(
  Object.entries(FRAMES).map(([k, n]) => [k, n / FPS]));

let seq = 0;

/**
 * `who` carries the looks: { thrower, victim } for a toss, { climber, other }
 * for a climb, { entrant } for an entry. Anything missing falls back to a
 * generic wrestler, and a toss with no thrower gets the referee.
 */
export function animation(name = 'toss', size = 150, who = {}) {
  const n = FRAMES[name] || FRAMES.toss;
  const id = 'a' + (++seq);
  const dur = n / FPS;
  const thrower = who.thrower || (name === 'toss' ? REF : lookFor('generic-a'));
  const victim = who.victim || lookFor('generic-b');
  const climber = who.climber || lookFor('generic-a');
  const entrant = who.entrant || lookFor('generic-b');

  const draw = (i) => name === 'climb' ? climbFrame(i, climber, who.other)
    : name === 'entry' ? entryFrame(i, entrant)
    : tossFrame(i, thrower, victim);

  const css = [];
  const groups = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n * 100).toFixed(4);
    const b = ((i + 1) / n * 100).toFixed(4);
    css.push(`@keyframes ${id}k${i}{0%,${a}%{opacity:0}`
      + `${a}%,${(+b - 0.0001).toFixed(4)}%{opacity:1}`
      + `${b}%,100%{opacity:0}}`
      + `#${id}f${i}{animation:${id}k${i} ${dur}s steps(1,end) 1 forwards}`);
    groups.push(`<g id="${id}f${i}">${draw(i)}</g>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${size}" role="img"
    aria-label="8-bit wrestling animation">
    <style>${css.join('')}
      @media (prefers-reduced-motion:reduce){
        [id^="${id}f"]{animation:none;opacity:0}
        #${id}f${n - 1}{opacity:1}}
    </style>
    <rect width="100%" height="100%" fill="#0A0E1C" rx="2"/>
    ${ring()}
    ${groups.join('')}
  </svg>`;
}

export const tossAnimation = (size, who) => animation('toss', size, who);
export const TOSS_SECONDS = FRAMES.toss / FPS;
