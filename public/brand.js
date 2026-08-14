// The mark, inline, at two levels of detail.
//
// The full artwork carries thirty tick marks and three rope bars. At 24px in a
// toolbar that detail renders to mush, so small placements get a stripped
// version: the J!, the ropes, and nothing else.

// Chrome for the badge and an ember ramp for the wordmark — the two-material
// convention of an 80s arena poster. The hard horizon in the middle of the
// chrome ramp is what makes it read as metal rather than as a gradient.
const BRASS = `<linearGradient id="ch-%ID%" gradientUnits="userSpaceOnUse" x1="470" y1="148" x2="470" y2="372">
  <stop offset="0%" stop-color="#FFFDF4"/><stop offset="18%" stop-color="#E4EAF6"/>
  <stop offset="46%" stop-color="#9FB0D0"/><stop offset="55%" stop-color="#43547C"/>
  <stop offset="57%" stop-color="#8A6318"/><stop offset="68%" stop-color="#F0D48A"/>
  <stop offset="80%" stop-color="#D6A93F"/><stop offset="100%" stop-color="#7C5411"/>
</linearGradient>`;
const EMBER = `<linearGradient id="em-%ID%" gradientUnits="userSpaceOnUse" x1="512" y1="452" x2="512" y2="668">
  <stop offset="0%" stop-color="#FFF8E2"/><stop offset="22%" stop-color="#F4D888"/>
  <stop offset="46%" stop-color="#D6A93F"/><stop offset="66%" stop-color="#A8701C"/>
  <stop offset="84%" stop-color="#6E3F0C"/><stop offset="100%" stop-color="#B5551C"/>
</linearGradient>`;

const RED = `<linearGradient id="rg-%ID%" gradientUnits="userSpaceOnUse" x1="500" y1="468" x2="524" y2="598">
  <stop offset="0%" stop-color="#6E0C10"/><stop offset="14%" stop-color="#C81E20"/>
  <stop offset="30%" stop-color="#FF6A57"/><stop offset="46%" stop-color="#D8302B"/>
  <stop offset="58%" stop-color="#7E1114"/><stop offset="72%" stop-color="#E24A3C"/>
  <stop offset="88%" stop-color="#FF8A72"/><stop offset="100%" stop-color="#8E1013"/>
</linearGradient>`;

const ROPE = `<linearGradient id="pg-%ID%" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#E8D9A8"/><stop offset="45%" stop-color="#B99340"/>
  <stop offset="100%" stop-color="#6E4F12"/>
</linearGradient>`;

let seq = 0;
const uid = () => 'b' + (++seq);

function ticks() {
  let out = '';
  for (let a = 0; a < 360; a += 12) {
    const lit = a === 0;
    out += `<g transform="rotate(${a} 512 512)"><line x1="512" y1="${lit ? 30 : 34}"
      x2="512" y2="${lit ? 66 : 62}"${lit ? ' stroke="#E3BC5A" stroke-width="11"' : ''}/></g>`;
  }
  return out;
}

// Full circular artwork — lobby, splash, join screen.
export function markFull(size = 120) {
  const id = uid();
  const R = [['R', 176, 337.5], ['U', 132, 410.7], ['M', 132, 491.2],
             ['B', 132, 572.0], ['L', 132, 629.8], ['E', 176, 692.3]];
  const word = (fill, dy, extra) => R.map(([c, fs, x]) =>
    `<text x="${x}" y="${644 + dy}" text-anchor="middle" font-family="Anton,Impact,sans-serif"
      font-size="${fs}" fill="${fill}" ${extra}>${c}</text>`).join('');
  return `<svg viewBox="0 0 1024 1024" width="${size}" height="${size}" role="img"
    aria-label="J! Royal Rumble"><defs>
    <radialGradient id="sk-${id}" cx="50%" cy="34%" r="78%">
      <stop offset="0%" stop-color="#2A3A66"/><stop offset="52%" stop-color="#1B2444"/>
      <stop offset="100%" stop-color="#05070F"/></radialGradient>
    ${BRASS.replace('%ID%', id)}${EMBER.replace('%ID%', id)}${ROPE.replace('%ID%', id)}
    <radialGradient id="gl-${id}" cx="50%" cy="26%" r="62%">
      <stop offset="0%" stop-color="#D6A93F" stop-opacity="0.30"/>
      <stop offset="65%" stop-color="#D6A93F" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#D6A93F" stop-opacity="0"/></radialGradient>
    <clipPath id="cp-${id}"><circle cx="512" cy="512" r="512"/></clipPath></defs>
    <g clip-path="url(#cp-${id})">
      <rect width="1024" height="1024" fill="url(#sk-${id})"/>
      <ellipse cx="512" cy="300" rx="400" ry="330" fill="url(#gl-${id})"/>
      <circle cx="512" cy="512" r="470" fill="none" stroke="#2A3556" stroke-width="3"/>
      <g stroke="#5E6B95" stroke-width="7" stroke-linecap="round">${ticks()}</g>
      <path d="M512 120 L664 184 L664 306 Q664 368 512 408 Q360 368 360 306 L360 184 Z"
        fill="#0E1526" stroke="#D6A93F" stroke-width="5"/>
      <path d="M512 137 L649 194 L649 304 Q649 355 512 391 Q375 355 375 304 L375 194 Z"
        fill="none" stroke="#3C486E" stroke-width="2"/>
      <text x="512" y="351" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="212" fill="#04060C" opacity="0.8">J!</text>
      <text x="512" y="344" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="212" fill="url(#ch-${id})" stroke="#1E1608" stroke-width="5"
        paint-order="stroke">J!</text>
      <text x="512" y="505" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="82" letter-spacing="6" fill="#2A1204" opacity="0.85">ROYAL</text>
      <text x="512" y="500" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="82" letter-spacing="6" fill="url(#em-${id})" stroke="#3A1E06"
        stroke-width="4" paint-order="stroke">ROYAL</text>
      ${word('#2A1204', 8, 'opacity="0.85"')}
      ${word(`url(#em-${id})`, 0, 'stroke="#3A1E06" stroke-width="6" paint-order="stroke"')}
      <rect x="72" y="770" width="880" height="13" rx="6" fill="url(#pg-${id})"/>
      <rect x="72" y="838" width="880" height="13" rx="6" fill="url(#pg-${id})"/>
      <rect x="72" y="906" width="880" height="13" rx="6" fill="url(#pg-${id})"/>
      <rect x="150" y="748" width="26" height="200" rx="8" fill="#4A5680"/>
      <rect x="848" y="748" width="26" height="200" rx="8" fill="#4A5680"/>
    </g></svg>`;
}

// Stripped for toolbars and small chips: the badge alone, since the wordmark
// renders to mush below about 40px.
export function markSmall(size = 26) {
  const id = uid();
  // Its own ramp: the shared one is pinned to the large mark's coordinates,
  // and this glyph sits lower and much larger, so it fell entirely below the
  // horizon and came out dark.
  const ramp = `<linearGradient id="ch-${id}" gradientUnits="userSpaceOnUse"
      x1="512" y1="300" x2="512" y2="640">
      <stop offset="0%" stop-color="#FFFDF4"/><stop offset="18%" stop-color="#E4EAF6"/>
      <stop offset="46%" stop-color="#9FB0D0"/><stop offset="55%" stop-color="#43547C"/>
      <stop offset="57%" stop-color="#8A6318"/><stop offset="68%" stop-color="#F0D48A"/>
      <stop offset="80%" stop-color="#D6A93F"/><stop offset="100%" stop-color="#7C5411"/>
    </linearGradient>`;
  return `<svg viewBox="0 0 1024 1024" width="${size}" height="${size}" role="img"
    aria-label="J! Royal Rumble"><defs>
    ${ramp}
    <clipPath id="cs-${id}"><circle cx="512" cy="512" r="512"/></clipPath></defs>
    <g clip-path="url(#cs-${id})">
      <circle cx="512" cy="512" r="512" fill="#131A30"/>
      <circle cx="512" cy="512" r="486" fill="none" stroke="#2A3556" stroke-width="26"/>
      <path d="M512 150 L836 288 L836 560 Q836 700 512 790 Q188 700 188 560 L188 288 Z"
        fill="#0E1526" stroke="#D6A93F" stroke-width="22"/>
      <text x="512" y="620" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="440" fill="url(#ch-${id})" stroke="#1E1608" stroke-width="12"
        paint-order="stroke">J!</text>
    </g></svg>`;
}

// The wide lockup, for the champion splash.
export function wordmark(width = 620) {
  const id = uid();
  const R = [['R', 196, 907.5], ['U', 146, 988.5], ['M', 146, 1077.6],
             ['B', 146, 1167.0], ['L', 146, 1230.9], ['E', 196, 1300.1]];
  const word = (fill, dy, extra) => R.map(([c, fs, x]) =>
    `<text x="${x}" y="${324 + dy}" text-anchor="middle" font-family="Anton,Impact,sans-serif"
      font-size="${fs}" fill="${fill}" ${extra}>${c}</text>`).join('');
  return `<svg viewBox="0 0 1920 400" width="${width}" role="img"
    aria-label="J! Royal Rumble"><defs>
    <linearGradient id="wc-${id}" gradientUnits="userSpaceOnUse" x1="300" y1="96" x2="300" y2="300">
      <stop offset="0%" stop-color="#FFFDF4"/><stop offset="18%" stop-color="#E4EAF6"/>
      <stop offset="46%" stop-color="#9FB0D0"/><stop offset="55%" stop-color="#43547C"/>
      <stop offset="57%" stop-color="#8A6318"/><stop offset="68%" stop-color="#F0D48A"/>
      <stop offset="80%" stop-color="#D6A93F"/><stop offset="100%" stop-color="#7C5411"/></linearGradient>
    <linearGradient id="wf-${id}" gradientUnits="userSpaceOnUse" x1="1130" y1="116" x2="1130" y2="340">
      <stop offset="0%" stop-color="#FFF8E2"/><stop offset="22%" stop-color="#F4D888"/>
      <stop offset="46%" stop-color="#D6A93F"/><stop offset="66%" stop-color="#A8701C"/>
      <stop offset="84%" stop-color="#6E3F0C"/><stop offset="100%" stop-color="#B5551C"/></linearGradient>
    </defs>
    <path d="M300 78 L432 132 L432 240 Q432 292 300 326 Q168 292 168 240 L168 132 Z"
      fill="#0E1526" stroke="#D6A93F" stroke-width="4"/>
    <text x="300" y="272" text-anchor="middle" font-family="Anton,Impact,sans-serif"
      font-size="182" fill="url(#wc-${id})" stroke="#1E1608" stroke-width="4"
      paint-order="stroke">J!</text>
    <text x="1130" y="180" text-anchor="middle" font-family="Anton,Impact,sans-serif"
      font-size="82" letter-spacing="20" fill="url(#wf-${id})" stroke="#3A1E06"
      stroke-width="4" paint-order="stroke">ROYAL</text>
    ${word(`url(#wf-${id})`, 0, 'stroke="#3A1E06" stroke-width="6" paint-order="stroke"')}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Robot avatars: an escalating glow, in the spirit of the galaxy-brain
// progression. Drawn rather than borrowed — the meme itself is a set of
// copyrighted stock photographs.

const BRAIN_TIERS = {
  rookie:     { glow: 0, halo: 0,   core: '#4A5680', ring: '#2A3556', spark: 0 },
  normie:     { glow: 1, halo: 0.18, core: '#6E7CA8', ring: '#3C486E', spark: 0 },
  champ:      { glow: 2, halo: 0.34, core: '#9AA8D0', ring: '#5A6A9E', spark: 4 },
  superchamp: { glow: 3, halo: 0.52, core: '#E9C978', ring: '#8A6318', spark: 8 },
  elite:      { glow: 4, halo: 0.78, core: '#FFF6D2', ring: '#D6A93F', spark: 14 },
};

export function brainAvatar(level = 'normie', size = 26) {
  const t = BRAIN_TIERS[level] || BRAIN_TIERS.normie;
  const id = uid();
  const sparks = Array.from({ length: t.spark }, (_, i) => {
    const a = (i / Math.max(1, t.spark)) * Math.PI * 2 + 0.4;
    const r = 40 + (i % 3) * 5;
    return `<circle cx="${(50 + Math.cos(a) * r).toFixed(1)}" cy="${(50 + Math.sin(a) * r).toFixed(1)}"
      r="${1.6 + (i % 2)}" fill="${t.core}" opacity="${0.35 + t.halo * 0.5}"/>`;
  }).join('');

  // A folded-brain silhouette: two lobes and a couple of sulci. Simple enough
  // to survive at 26px, which is the size it actually gets used at.
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img"
    aria-label="${level} robot"><defs>
    <radialGradient id="h-${id}" cx="50%" cy="50%" r="50%">
      <stop offset="55%" stop-color="${t.core}" stop-opacity="${t.halo}"/>
      <stop offset="100%" stop-color="${t.core}" stop-opacity="0"/>
    </radialGradient></defs>
    <circle cx="50" cy="50" r="49" fill="#131A30"/>
    ${t.glow ? `<circle cx="50" cy="50" r="46" fill="url(#h-${id})"/>` : ''}
    ${sparks}
    <g fill="none" stroke="${t.core}" stroke-width="4.6" stroke-linecap="round">
      <path d="M50 26 C36 26 28 34 28 44 C22 47 22 57 28 60 C28 70 37 76 50 76"/>
      <path d="M50 26 C64 26 72 34 72 44 C78 47 78 57 72 60 C72 70 63 76 50 76"/>
    </g>
    <g fill="none" stroke="${t.ring}" stroke-width="2.9" stroke-linecap="round" opacity="1">
      <path d="M50 30 L50 74"/>
      <path d="M38 40 C44 43 44 49 38 52"/>
      <path d="M62 40 C56 43 56 49 62 52"/>
      <path d="M38 58 C44 60 44 65 39 67"/>
      <path d="M62 58 C56 60 56 65 61 67"/>
    </g>
    <circle cx="50" cy="50" r="47" fill="none" stroke="${t.ring}" stroke-width="2"/>
  </svg>`;
}

export const BRAIN_LEVELS = Object.keys(BRAIN_TIERS);
