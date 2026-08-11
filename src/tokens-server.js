// Server-side token assignment.
//
// The client can suggest a token, but only the server sees the whole roster,
// so de-conflicting has to happen here. Two players who land on the same shape
// get different colourways rather than one of them being refused — the shape
// is the identity, the colour is just how you tell two of them apart.

export const TOKEN_NAMES = [
  'crowbar', 'wrench', 'morningstar', 'bone', 'chair', 'pan',
  'sledge', 'trident', 'anchor', 'horseshoe', 'pipe', 'baguette',
  'trophy', 'boot', 'rollingpin', 'brick', 'torch', 'axe',
  'harpoon', 'broom', 'fish', 'umbrella', 'ladder', 'kettlebell',
];
export const COLOUR_NAMES = ['brass', 'chalk', 'slate', 'live', 'blood', 'violet'];

const key = (a) => a && `${a.art}:${a.colour}`;

/**
 * Pick a token for a player joining, avoiding what the room already has.
 * Every shape is used once before any shape repeats, so a small field gets
 * maximum variety rather than six crowbars in six colours.
 */
export function assignToken(taken, rng = Math.random) {
  const used = new Set([...taken].map(key).filter(Boolean));
  const shapesUsed = new Set([...taken].filter(Boolean).map((a) => a.art));

  // Shapes nobody has yet, shuffled so it is not always the same order.
  const fresh = TOKEN_NAMES.filter((n) => !shapesUsed.has(n));
  if (fresh.length) {
    const art = fresh[Math.floor(rng() * fresh.length)];
    return { art, colour: COLOUR_NAMES[0] };
  }

  // Every shape is spoken for, so repeat a shape in an unused colour.
  const pairs = [];
  for (const c of COLOUR_NAMES) {
    for (const n of TOKEN_NAMES) if (!used.has(`${n}:${c}`)) pairs.push({ art: n, colour: c });
  }
  if (!pairs.length) return { art: TOKEN_NAMES[0], colour: COLOUR_NAMES[0] };
  return pairs[Math.floor(rng() * pairs.length)];
}

/**
 * A player has asked for a particular shape. Give it to them, in a colour
 * nobody else is using it in. Their own current token does not count as taken.
 */
export function resolveChoice(art, colour, taken) {
  if (!TOKEN_NAMES.includes(art)) return null;
  const used = new Set([...taken].map(key).filter(Boolean));
  const wanted = COLOUR_NAMES.includes(colour) ? colour : COLOUR_NAMES[0];
  if (!used.has(`${art}:${wanted}`)) return { art, colour: wanted };
  const free = COLOUR_NAMES.find((c) => !used.has(`${art}:${c}`));
  return { art, colour: free || wanted };
}
