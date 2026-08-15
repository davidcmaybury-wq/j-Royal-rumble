// Stable badges: a line-art gemstone in the stable's colour.
//
// Line art rather than a filled shape because these sit inline beside names on
// three different screens at 14 to 22 pixels, and a solid lozenge at that size
// is just a coloured dot — the facets are what make a diamond read as a diamond
// and not as a generic marker.
//
// One drawing per stone, not one drawing recoloured: the whole point is that a
// player glancing at the scoreboard can tell Ruby from Sapphire without reading.

const SHAPES = {
  // Brilliant cut: a table across the top and facets converging on a point.
  Diamond: 'M3 9h18l-9 12L3 9zm0 0l4-5h10l4 5M7 4l2 5m6-5l-2 5M3 9h18',
  // Cushion cut, corners clipped.
  Ruby: 'M7 4h10l4 5-9 12L3 9l4-5zm0 0l2 5h6l2-5M9 9l3 12M15 9l-3 12',
  // Step cut: the long rectangular table an emerald is known for.
  Emerald: 'M6 4h12l3 4v8l-3 4H6l-3-4V8l3-4zm0 0l2 4h8l2-4M8 8v8m8-8v8M6 20l2-4h8l2 4',
  // Kite facets, a broader spread.
  Sapphire: 'M12 3l9 7-9 11L3 10l9-7zm0 0v18M3 10h18M7 6l3 4m7-4l-3 4',
  // Cabochon: domed, unfaceted, the way onyx is usually cut.
  Onyx: 'M4 14a8 8 0 0116 0v1a2 2 0 01-2 2H6a2 2 0 01-2-2v-1zM7 12a5 5 0 015-3',
  // Pear cut.
  Topaz: 'M12 3c4 5 7 8 7 11a7 7 0 01-14 0c0-3 3-6 7-11zm0 0v18M6 12h12',
};

/** The badge for a stable. Returns an empty string for an unknown stone. */
export function gem(name, colour, size = 18) {
  const d = SHAPES[name];
  if (!d) return '';
  return `<svg class="gem" viewBox="0 0 24 24" width="${size}" height="${size}"
    role="img" aria-label="${name}" fill="none" stroke="${colour}"
    stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="${d}"/></svg>`;
}

export const GEM_NAMES = Object.keys(SHAPES);
