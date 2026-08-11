// Weapon tokens — line-art avatars in the spirit of Monopoly pieces.
//
// These render at 24px in the ring, where detail disappears and only the
// silhouette survives. So each is drawn as a bold single-weight outline with
// a distinct outer shape, rather than as a detailed illustration. If two of
// them are hard to tell apart in the contact sheet at thumbnail size, the
// drawing is wrong, not the viewer.
//
// Palette swapping handles collisions: 24 tokens across 6 colourways gives 144
// combinations, so a field of thirty never needs to repeat.

export const TOKEN_COLOURS = {
  brass:  '#D6A93F',
  chalk:  '#EEEBE1',
  slate:  '#8A97BC',
  live:   '#4FB286',
  blood:  '#C8564A',
  violet: '#9B8AC4',
};
export const COLOUR_NAMES = Object.keys(TOKEN_COLOURS);

// Each path is drawn in a 100x100 box, stroked not filled, so one weight
// reads at any size. `fills` are the few solid shapes that need mass.
const TOKENS = {
  crowbar: {
    label: 'Crowbar',
    d: 'M30 84 L64 30 M64 30 Q68 22 74 20 M74 20 L82 16 M74 20 L78 28 '
     + 'M30 84 Q26 90 20 88 Q16 86 20 80',
  },
  wrench: {
    label: 'Pipe wrench',
    d: 'M44 88 L58 40 M58 40 L46 34 L52 20 L74 26 L70 40 L58 40 '
     + 'M50 27 L60 30 M48 33 L58 36 M44 88 Q42 93 47 93 Q52 93 50 88',
  },
  morningstar: {
    label: 'Morningstar',
    // Fewer, longer spikes. Eight short ones around a small circle turned to
    // mush at thumbnail size — the star has to be in the outline.
    d: 'M14 88 L28 74 M28 74 L40 64 '
     + 'M62 8 L62 26 M62 70 L62 52 M34 39 L52 39 M90 39 L72 39 '
     + 'M42 19 L54 31 M82 59 L70 47 M42 59 L54 47 M82 19 L70 31',
    circles: [[62, 39, 16]],
  },
  bone: {
    label: 'Dinosaur bone',
    // One continuous outline. Four circles on a stick read as a dumbbell; the
    // knobs have to merge into the shaft.
    d: 'M30 58 Q17 56 15 68 Q14 79 26 78 Q26 90 37 88 Q48 86 45 74 '
     + 'L70 52 Q83 54 85 42 Q86 31 74 32 Q74 20 63 22 Q52 24 55 36 Z',
    circles: [],
  },
  chair: {
    label: 'Folding chair',
    d: 'M32 86 L38 44 L74 40 M38 44 L70 62 M70 62 L74 88 M38 62 L70 62 '
     + 'M32 86 L44 86 M62 88 L78 88',
  },
  pan: {
    label: 'Frying pan',
    d: 'M62 62 L86 86 M86 86 Q90 90 86 92',
    circles: [[42, 44, 24]],
  },
  sledge: {
    label: 'Sledgehammer',
    d: 'M52 88 L60 40 M40 24 L74 32 L70 48 L36 40 Z M52 88 Q50 93 55 93 Q60 93 58 88',
  },
  trident: {
    label: 'Trident',
    d: 'M50 88 L50 36 M26 36 L26 16 M50 36 L50 12 M74 36 L74 16 M26 36 L74 36',
  },
  anchor: {
    label: 'Anchor',
    d: 'M50 30 L50 84 M30 44 L70 44 M20 60 Q22 86 50 88 Q78 86 80 60 '
     + 'M20 60 L12 66 M20 60 L28 66 M80 60 L72 66 M80 60 L88 66',
    circles: [[50, 20, 9]],
  },
  horseshoe: {
    label: 'Horseshoe',
    // Replaces the candlestick, which was hard to tell from the torch.
    // Open at the bottom, or it reads as a padlock.
    d: 'M26 88 L26 50 Q26 18 50 18 Q74 18 74 50 L74 88',
    circles: [[36, 42, 3], [64, 42, 3], [31, 66, 3], [69, 66, 3]],
  },
  pipe: {
    label: 'Lead pipe',
    d: 'M26 74 L74 26 M20 68 L32 80 M68 20 L80 32',
  },
  baguette: {
    label: 'Baguette',
    d: 'M24 76 Q20 80 24 84 Q28 88 32 84 L76 40 Q80 36 76 32 Q72 28 68 32 Z '
     + 'M38 66 L46 74 M50 54 L58 62 M62 42 L70 50',
  },
  trophy: {
    label: 'Trophy',
    d: 'M34 20 L66 20 L64 48 Q62 60 50 60 Q38 60 36 48 Z '
     + 'M50 60 L50 74 M36 88 L64 88 M40 88 Q42 74 50 74 Q58 74 60 88 '
     + 'M34 26 Q22 26 22 36 Q22 44 34 44 M66 26 Q78 26 78 36 Q78 44 66 44',
  },
  boot: {
    label: 'Boot',
    // An L. Drawn upright it read as a chess pawn; a boot is only a boot when
    // the foot sticks out sideways.
    d: 'M32 12 L32 60 L80 60 Q88 60 88 70 L88 84 L20 84 L20 12 Z '
     + 'M20 38 L32 38 M46 62 L46 84 M62 62 L62 84',
  },
  rollingpin: {
    label: 'Rolling pin',
    // Fat barrel, thin handles — otherwise it is the same diagonal line as the
    // lead pipe.
    d: 'M14 86 L26 74 M74 26 L86 14 M26 74 L34 82 M66 18 L74 26',
    thick: 'M30 70 L70 30',
  },
  brick: {
    label: 'Brick',
    // Replaces the gavel, which was indistinguishable from the sledgehammer.
    d: 'M14 34 L50 20 L86 34 L86 62 L50 78 L14 62 Z '
     + 'M14 34 L50 48 L86 34 M50 48 L50 78',
  },
  torch: {
    label: 'Torch',
    d: 'M42 88 L46 46 L58 46 L62 88 Z M40 46 L64 46 '
     + 'M52 42 Q38 30 46 12 Q50 24 58 20 Q66 30 52 42',
  },
  axe: {
    label: 'Axe',
    // A wedge, not a loop. The first version curved the blade back on itself
    // and read as a magnifying glass.
    d: 'M32 90 L60 28 M50 14 L86 30 L76 52 L42 38 Z M54 20 L64 46',
  },
  harpoon: {
    label: 'Harpoon',
    d: 'M24 82 L66 30 M66 30 L74 16 L60 22 Z M58 38 L48 34 M64 30 L56 44',
  },
  broom: {
    label: 'Broom',
    d: 'M30 20 L54 52 M52 50 L74 66 Q84 74 76 84 Q68 92 60 84 L44 62 Z '
     + 'M58 58 L50 68 M66 64 L58 74',
  },
  fish: {
    label: 'Fish',
    d: 'M20 50 Q44 22 66 50 Q44 78 20 50 Z M66 50 L86 34 L86 66 Z M32 44 L36 44',
    circles: [[32, 44, 3]],
  },
  umbrella: {
    label: 'Umbrella',
    d: 'M50 42 L50 80 Q50 90 60 90 Q68 90 68 82 '
     + 'M16 42 Q16 12 50 12 Q84 12 84 42 Z '
     + 'M16 42 Q28 32 39 42 Q45 32 50 42 Q55 32 61 42 Q72 32 84 42',
  },
  ladder: {
    label: 'Ladder',
    d: 'M32 88 L40 14 M68 88 L60 14 M38 30 L62 30 M36 48 L64 48 M34 68 L66 68',
  },
  kettlebell: {
    label: 'Kettlebell',
    d: 'M38 44 Q36 20 50 20 Q64 20 62 44',
    circles: [[50, 62, 26]],
  },
};

export const TOKEN_NAMES = Object.keys(TOKENS);
export const tokenLabel = (name) => (TOKENS[name] || {}).label || name;

let seq = 0;

/**
 * One token as an inline SVG. Line art in a single colour on the app's ink,
 * so a ring full of them reads as texture rather than as competing pictures.
 */
export function weaponToken(name = 'crowbar', size = 26, colour = 'brass') {
  const t = TOKENS[name] || TOKENS.crowbar;
  const c = TOKEN_COLOURS[colour] || TOKEN_COLOURS.brass;
  const id = 'wt' + (++seq);
  const circles = (t.circles || [])
    .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('');
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img"
    aria-label="${t.label}">
    <circle cx="50" cy="50" r="50" fill="#131A30"/>
    <circle cx="50" cy="50" r="47" fill="none" stroke="${c}" stroke-width="2" opacity="0.45"/>
    <g fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"
       stroke-linejoin="round">${t.d ? `<path d="${t.d}"/>` : ''}${circles}${
      t.thick ? `<path d="${t.thick}" stroke-width="15"/>` : ''}</g>
  </svg>`;
}

/**
 * Assign a token to each player so no two look alike. Runs through every
 * token in one colour before reaching for the next colourway, so a small
 * field gets maximum shape variety rather than six crowbars in six colours.
 */
export function assignTokens(tokens, seed = 0) {
  const out = {};
  tokens.forEach((tok, i) => {
    const n = (i + seed) % (TOKEN_NAMES.length * COLOUR_NAMES.length);
    out[tok] = {
      token: TOKEN_NAMES[n % TOKEN_NAMES.length],
      colour: COLOUR_NAMES[Math.floor(n / TOKEN_NAMES.length) % COLOUR_NAMES.length],
    };
  });
  return out;
}

/** A stable default from a player's token string, so it survives a refresh. */
export function tokenFor(playerToken) {
  let h = 0;
  for (let i = 0; i < String(playerToken).length; i++) {
    h = (h * 31 + String(playerToken).charCodeAt(i)) >>> 0;
  }
  return {
    token: TOKEN_NAMES[h % TOKEN_NAMES.length],
    colour: COLOUR_NAMES[Math.floor(h / TOKEN_NAMES.length) % COLOUR_NAMES.length],
  };
}
