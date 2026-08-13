// 8-bit wrestlers, drawn from parameters.
//
// One source for both the little avatar on a score tile and the figures in the
// animations, so a player is recognisably themselves being thrown out of the
// ring. The Python generator that used to bake animation frames is gone: it
// could only produce fixed colours, and two copies of the same sprite code
// would have drifted apart within a week.
//
// Everything is drawn as whole pixels on a 64x40 grid and scaled up, so it
// stays crisp at any size.

export const SINGLETS = {
  classic: '#C8564A',   // plain trunks
  strap:   '#D6A93F',   // singlet with a shoulder strap
  full:    '#4F7FD1',   // full singlet
  trunks:  '#7B4FC4',   // high-cut trunks with a belt
  briefs:  '#3FA98C',   // plain briefs, old school
  tights:  '#C4457E',   // full-length tights
};
export const SINGLET_STYLES = Object.keys(SINGLETS);

export const SINGLET_COLOURS = {
  crimson: '#C8564A', gold: '#D6A93F', azure: '#4F7FD1', violet: '#7B4FC4',
  jade: '#3FA98C', magenta: '#C4457E', bone: '#D8D2C4', slate: '#5E6B95',
  orange: '#E07A2F', black: '#2A2E3C',
};
export const SINGLET_COLOUR_NAMES = Object.keys(SINGLET_COLOURS);

export const HAIR_STYLES = ['bald', 'short', 'mullet', 'mohawk', 'long', 'topknot'];
export const HAIR_COLOURS = {
  black: '#241C1A', brown: '#5A3A22', blond: '#D8B15A', ginger: '#B45426',
  grey: '#9AA0AE', bleach: '#E8E2D2', green: '#3F9A5A', pink: '#D9629A',
};
export const HAIR_COLOUR_NAMES = Object.keys(HAIR_COLOURS);

export const SKINS = ['#E8B48A', '#C98D63', '#9C6340', '#6E4327', '#F0C9A6'];

const INK = '#0A0E1C';
const NAVY = '#1B2444';
const LINE = '#2A3556';
const ROPE = '#B99340';
const BRASS = '#D6A93F';
const CHALK = '#EEEBE1';
const SLATE = '#5E6B95';
const BOOT = '#2A2E3C';

const W = 64, H = 40;
const MAT_Y = 31;
const ROPES = [17, 22, 27];

const px = (x, y, w, h, fill) =>
  (w <= 0 || h <= 0) ? '' : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/**
 * One wrestler. `look` carries the appearance; the rest is pose.
 *
 * look: { singlet, colour, hair, hairColour, skin, referee }
 * arms: down | up | grab | throw | raise | flex
 * legs: stand | wide | run | tuck
 */
export function wrestler(x, y, look = {}, opts = {}) {
  const {
    singlet = 'classic', colour = 'crimson', hair = 'short',
    hairColour = 'black', skin = 0, referee = false,
  } = look;
  const { arms = 'down', legs = 'stand', lean = 0, dy = 0, flip = false } = opts;

  const skinHex = SKINS[skin % SKINS.length];
  const kit = referee ? CHALK : (SINGLET_COLOURS[colour] || SINGLET_COLOURS.crimson);
  const hairHex = HAIR_COLOURS[hairColour] || HAIR_COLOURS.black;
  const o = [];
  const hx = x + (flip ? 1 : 2) + lean;
  const ty = y + 4 + dy;

  // head
  o.push(px(hx, y + dy, 4, 4, skinHex));
  o.push(px(hx + (flip ? 0 : 3), y + 1 + dy, 1, 1, INK));          // eye

  // hair sits on and around the head
  if (hair === 'short') o.push(px(hx, y - 1 + dy, 4, 2, hairHex));
  else if (hair === 'mullet') {
    o.push(px(hx, y - 1 + dy, 4, 2, hairHex));
    o.push(px(hx + (flip ? 3 : -1), y + 1 + dy, 2, 4, hairHex));
  } else if (hair === 'mohawk') {
    o.push(px(hx + 1, y - 3 + dy, 2, 4, hairHex));
  } else if (hair === 'long') {
    o.push(px(hx - 1, y - 1 + dy, 6, 2, hairHex));
    o.push(px(hx - 1, y + 1 + dy, 1, 5, hairHex));
    o.push(px(hx + 4, y + 1 + dy, 1, 5, hairHex));
  } else if (hair === 'topknot') {
    o.push(px(hx, y - 1 + dy, 4, 2, hairHex));
    o.push(px(hx + 1, y - 4 + dy, 2, 3, hairHex));
  }

  // torso, in the chosen kit
  if (referee) {
    // black and white stripes, which is the whole point of a referee
    o.push(px(x + 1, ty, 6, 8, CHALK));
    for (let i = 0; i < 3; i++) o.push(px(x + 2 + i * 2, ty, 1, 8, '#20242F'));
  } else if (singlet === 'classic') {
    o.push(px(x + 1, ty, 6, 4, skinHex));
    o.push(px(x + 1, ty + 4, 6, 4, kit));
  } else if (singlet === 'strap') {
    o.push(px(x + 1, ty, 6, 4, skinHex));
    o.push(px(x + (flip ? 5 : 1), ty, 2, 4, kit));
    o.push(px(x + 1, ty + 4, 6, 4, kit));
  } else if (singlet === 'full') {
    o.push(px(x + 1, ty, 6, 8, kit));
  } else if (singlet === 'trunks') {
    o.push(px(x + 1, ty, 6, 4, skinHex));
    o.push(px(x + 1, ty + 4, 6, 2, BRASS));
    o.push(px(x + 1, ty + 6, 6, 2, kit));
  } else if (singlet === 'briefs') {
    o.push(px(x + 1, ty, 6, 5, skinHex));
    o.push(px(x + 1, ty + 5, 6, 3, kit));
  } else if (singlet === 'tights') {
    o.push(px(x + 1, ty, 6, 4, skinHex));
    o.push(px(x + 1, ty + 4, 6, 4, kit));
  }

  // arms
  const armL = x - 1, armR = x + 7;
  if (arms === 'down') {
    o.push(px(x, ty + 1, 1, 5, skinHex));
    o.push(px(armR, ty + 1, 1, 5, skinHex));
  } else if (arms === 'up') {
    o.push(px(armL, ty - 3, 2, 5, skinHex));
    o.push(px(armR, ty - 3, 2, 5, skinHex));
  } else if (arms === 'grab') {
    o.push(px(flip ? x - 3 : x + 7, ty, 3, 2, skinHex));
  } else if (arms === 'throw') {
    o.push(px(armL, ty - 4, 2, 4, skinHex));
    o.push(px(armR, ty - 4, 2, 4, skinHex));
  } else if (arms === 'raise') {
    o.push(px(armL, ty - 5, 2, 6, skinHex));
    o.push(px(armR, ty - 5, 2, 6, skinHex));
  } else if (arms === 'flex') {
    o.push(px(armL, ty - 2, 2, 3, skinHex));
    o.push(px(armL, ty + 1, 3, 2, skinHex));
    o.push(px(armR, ty - 2, 2, 3, skinHex));
    o.push(px(x + 6, ty + 1, 3, 2, skinHex));
  }

  // legs, with boots
  const ly = y + 12 + dy;
  const legHex = singlet === 'tights' ? kit : skinHex;
  if (legs === 'stand') {
    o.push(px(x + 1, ly, 2, 3, legHex)); o.push(px(x + 1, ly + 3, 2, 1, BOOT));
    o.push(px(x + 5, ly, 2, 3, legHex)); o.push(px(x + 5, ly + 3, 2, 1, BOOT));
  } else if (legs === 'wide') {
    o.push(px(x, ly, 2, 3, legHex)); o.push(px(x, ly + 3, 2, 1, BOOT));
    o.push(px(x + 6, ly, 2, 3, legHex)); o.push(px(x + 6, ly + 3, 2, 1, BOOT));
  } else if (legs === 'run') {
    o.push(px(x, ly, 2, 3, legHex));
    o.push(px(x + 5, ly, 3, 3, legHex)); o.push(px(x + 5, ly + 3, 3, 1, BOOT));
  } else if (legs === 'tuck') {
    o.push(px(x + 1, ly, 3, 3, legHex));
    o.push(px(x + 4, ly, 3, 2, legHex));
  }
  return o.join('');
}

/** The ring, drawn behind every frame. */
export function ring() {
  const o = [px(0, MAT_Y, W, H - MAT_Y, NAVY), px(0, MAT_Y, W, 1, LINE)];
  for (const y of ROPES) o.push(px(2, y, W - 4, 1, ROPE));
  o.push(px(1, 17, 2, MAT_Y - 17, SLATE));
  o.push(px(W - 3, 17, 2, MAT_Y - 17, SLATE));
  return o.join('');
}

// --- a look from a token, so a player keeps the same one -------------------

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable look derived from a player's token. */
export function lookFor(token) {
  const h = hash(token);
  return {
    singlet: SINGLET_STYLES[h % SINGLET_STYLES.length],
    colour: SINGLET_COLOUR_NAMES[(h >>> 3) % SINGLET_COLOUR_NAMES.length],
    hair: HAIR_STYLES[(h >>> 7) % HAIR_STYLES.length],
    hairColour: HAIR_COLOUR_NAMES[(h >>> 11) % HAIR_COLOUR_NAMES.length],
    skin: (h >>> 17) % SKINS.length,
  };
}

/**
 * Two looks are different enough to tell apart at 24px if either the singlet
 * colour or the hair differs — those are the two things that survive at that
 * size. Everything else is detail nobody can see on a score tile.
 */
export function looksAlike(a, b) {
  if (!a || !b) return false;
  return a.colour === b.colour && a.hair === b.hair && a.hairColour === b.hairColour;
}

/** Nudge a look until it is distinguishable from everything already taken. */
export function distinctLook(token, taken = []) {
  let look = lookFor(token);
  let n = 0;
  while (taken.some((t) => looksAlike(look, t)) && n < 40) {
    n += 1;
    const h = hash(token + ':' + n);
    look = {
      ...look,
      colour: SINGLET_COLOUR_NAMES[h % SINGLET_COLOUR_NAMES.length],
      hair: HAIR_STYLES[(h >>> 5) % HAIR_STYLES.length],
      hairColour: HAIR_COLOUR_NAMES[(h >>> 9) % HAIR_COLOUR_NAMES.length],
    };
  }
  return look;
}

let seq = 0;

/**
 * The avatar: a portrait, drawn for the job rather than cropped from the body
 * sprite.
 *
 * Cropping was the obvious approach and it was wrong. The body's head is four
 * pixels across, so at 24px every player was an identical skin-coloured blob.
 * A portrait on its own 16x16 grid has room for hair shape, a face and the
 * singlet — which are the three things that survive at tile size.
 */
export function avatar(look = {}, size = 24) {
  const {
    singlet = 'classic', colour = 'crimson', hair = 'short',
    hairColour = 'black', skin = 0, referee = false,
  } = look;
  const id = 'av' + (++seq);
  const sk = SKINS[skin % SKINS.length];
  const kit = referee ? CHALK : (SINGLET_COLOURS[colour] || SINGLET_COLOURS.crimson);
  const hc = HAIR_COLOURS[hairColour] || HAIR_COLOURS.black;
  const dark = shade(sk, -28);
  const o = [];

  // shoulders and kit, behind the head
  o.push(px(1, 12, 14, 4, sk));
  if (referee) {
    o.push(px(1, 12, 14, 4, CHALK));
    for (let i = 0; i < 4; i++) o.push(px(2 + i * 3, 12, 1, 4, '#20242F'));
  } else if (singlet === 'full' || singlet === 'tights') {
    o.push(px(1, 12, 14, 4, kit));
  } else if (singlet === 'strap') {
    o.push(px(2, 12, 3, 4, kit));
  } else if (singlet === 'briefs' || singlet === 'classic') {
    o.push(px(1, 15, 14, 1, kit));
  } else if (singlet === 'trunks') {
    o.push(px(1, 14, 14, 2, kit));
    o.push(px(1, 13, 14, 1, BRASS));
  }
  o.push(px(6, 11, 4, 2, sk));            // neck

  // face
  o.push(px(4, 3, 8, 9, sk));
  o.push(px(4, 10, 8, 1, dark));          // jaw
  o.push(px(6, 6, 1, 2, INK));            // eyes
  o.push(px(9, 6, 1, 2, INK));
  o.push(px(7, 9, 2, 1, dark));           // mouth

  // hair, the thing that actually tells two players apart at 24px
  if (hair !== 'bald') o.push(px(4, 2, 8, 2, hc));
  if (hair === 'short') o.push(px(4, 4, 8, 1, hc));
  else if (hair === 'mullet') {
    o.push(px(4, 4, 8, 1, hc));
    o.push(px(3, 4, 1, 6, hc)); o.push(px(12, 4, 1, 6, hc));
  } else if (hair === 'mohawk') {
    o.push(px(4, 2, 8, 1, sk));
    o.push(px(6, 0, 4, 4, hc));
  } else if (hair === 'long') {
    o.push(px(3, 2, 10, 2, hc));
    o.push(px(2, 4, 2, 9, hc)); o.push(px(12, 4, 2, 9, hc));
  } else if (hair === 'topknot') {
    o.push(px(4, 4, 8, 1, hc));
    o.push(px(6, 0, 4, 2, hc));
  } else if (hair === 'bald') {
    o.push(px(5, 2, 6, 1, sk));
  }

  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" role="img"
    aria-label="wrestler"><defs><clipPath id="c${id}">
      <circle cx="8" cy="8" r="8"/></clipPath></defs>
    <g clip-path="url(#c${id})">
      <rect width="16" height="16" fill="#131A30"/>${o.join('')}
    </g>
    <circle cx="8" cy="8" r="7.5" fill="none" stroke="#2A3556" stroke-width=".8"/>
  </svg>`;
}

/** Darken or lighten a hex colour, for the shading a flat sprite needs. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, v + amt)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
