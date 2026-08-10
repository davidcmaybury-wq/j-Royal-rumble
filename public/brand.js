// The mark, inline, at two levels of detail.
//
// The full artwork carries thirty tick marks and three rope bars. At 24px in a
// toolbar that detail renders to mush, so small placements get a stripped
// version: the J!, the ropes, and nothing else.

const BRASS = `<linearGradient id="bg-%ID%" gradientUnits="userSpaceOnUse" x1="488" y1="163" x2="536" y2="430">
  <stop offset="0%" stop-color="#8A6318"/><stop offset="13%" stop-color="#E9C978"/>
  <stop offset="29%" stop-color="#FFF6D2"/><stop offset="44%" stop-color="#D9A93C"/>
  <stop offset="53%" stop-color="#7C5411"/><stop offset="60%" stop-color="#6A4509"/>
  <stop offset="70%" stop-color="#D2A03A"/><stop offset="84%" stop-color="#FBEEC0"/>
  <stop offset="94%" stop-color="#B8862A"/><stop offset="100%" stop-color="#6E4A0D"/>
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
  return `<svg viewBox="0 0 1024 1024" width="${size}" height="${size}" role="img"
    aria-label="J! Royal Rumble"><defs>
    <radialGradient id="sk-${id}" cx="50%" cy="40%" r="72%">
      <stop offset="0%" stop-color="#243259"/><stop offset="55%" stop-color="#131A30"/>
      <stop offset="100%" stop-color="#070A14"/></radialGradient>
    ${BRASS.replace('%ID%', id)}${RED.replace('%ID%', id)}${ROPE.replace('%ID%', id)}
    <clipPath id="cp-${id}"><circle cx="512" cy="512" r="512"/></clipPath></defs>
    <g clip-path="url(#cp-${id})">
      <rect width="1024" height="1024" fill="url(#sk-${id})"/>
      <circle cx="512" cy="512" r="470" fill="none" stroke="#2A3556" stroke-width="3"/>
      <g stroke="#5E6B95" stroke-width="7" stroke-linecap="round">${ticks()}</g>
      <rect x="72" y="742" width="880" height="13" rx="6" fill="url(#pg-${id})"/>
      <rect x="72" y="812" width="880" height="13" rx="6" fill="url(#pg-${id})"/>
      <rect x="72" y="882" width="880" height="13" rx="6" fill="url(#pg-${id})"/>
      <rect x="150" y="718" width="26" height="210" rx="8" fill="#4A5680"/>
      <rect x="848" y="718" width="26" height="210" rx="8" fill="#4A5680"/>
      <text x="512" y="428" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="360" fill="#05070E" opacity="0.72" transform="translate(0,10)">J!</text>
      <text x="512" y="428" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="360" fill="url(#bg-${id})" stroke="#2A1D05" stroke-width="7"
        paint-order="stroke">J!</text>
      <g transform="rotate(-3 512 560)">
        <text x="512" y="574" text-anchor="middle" font-family="Permanent Marker,cursive"
          font-size="128" fill="url(#rg-${id})" stroke="#2A0708" stroke-width="6"
          paint-order="stroke">Royal Rumble</text></g>
    </g></svg>`;
}

// Stripped for toolbars and small chips.
export function markSmall(size = 26) {
  const id = uid();
  return `<svg viewBox="0 0 1024 1024" width="${size}" height="${size}" role="img"
    aria-label="J! Royal Rumble"><defs>
    ${BRASS.replace('%ID%', id)}${ROPE.replace('%ID%', id)}
    <clipPath id="cs-${id}"><circle cx="512" cy="512" r="512"/></clipPath></defs>
    <g clip-path="url(#cs-${id})">
      <circle cx="512" cy="512" r="512" fill="#131A30"/>
      <circle cx="512" cy="512" r="486" fill="none" stroke="#2A3556" stroke-width="26"/>
      <rect x="40" y="790" width="944" height="34" fill="url(#pg-${id})"/>
      <rect x="40" y="880" width="944" height="34" fill="url(#pg-${id})"/>
      <text x="512" y="620" text-anchor="middle" font-family="Anton,Impact,sans-serif"
        font-size="620" fill="url(#bg-${id})" stroke="#2A1D05" stroke-width="14"
        paint-order="stroke">J!</text>
    </g></svg>`;
}

// The wide lockup, for the champion splash.
export function wordmark(width = 620) {
  const id = uid();
  return `<svg viewBox="0 0 1920 340" width="${width}" role="img"
    aria-label="J! Royal Rumble"><defs>
    <linearGradient id="wb-${id}" gradientUnits="userSpaceOnUse" x1="374" y1="76" x2="412" y2="290">
      <stop offset="0%" stop-color="#8A6318"/><stop offset="13%" stop-color="#E9C978"/>
      <stop offset="29%" stop-color="#FFF6D2"/><stop offset="44%" stop-color="#D9A93C"/>
      <stop offset="53%" stop-color="#7C5411"/><stop offset="60%" stop-color="#6A4509"/>
      <stop offset="70%" stop-color="#D2A03A"/><stop offset="84%" stop-color="#FBEEC0"/>
      <stop offset="94%" stop-color="#B8862A"/><stop offset="100%" stop-color="#6E4A0D"/></linearGradient>
    <linearGradient id="wr-${id}" gradientUnits="userSpaceOnUse" x1="1196" y1="74" x2="1226" y2="252">
      <stop offset="0%" stop-color="#6E0C10"/><stop offset="14%" stop-color="#C81E20"/>
      <stop offset="30%" stop-color="#FF6A57"/><stop offset="46%" stop-color="#D8302B"/>
      <stop offset="58%" stop-color="#7E1114"/><stop offset="72%" stop-color="#E24A3C"/>
      <stop offset="88%" stop-color="#FF8A72"/><stop offset="100%" stop-color="#8E1013"/></linearGradient>
    </defs>
    <text x="392" y="286" text-anchor="middle" font-family="Anton,Impact,sans-serif"
      font-size="286" fill="url(#wb-${id})" stroke="#2A1D05" stroke-width="6"
      paint-order="stroke">J!</text>
    <g transform="rotate(-2.5 1210 194)">
      <text x="1210" y="216" text-anchor="middle" font-family="Permanent Marker,cursive"
        font-size="176" fill="url(#wr-${id})" stroke="#2A0708" stroke-width="7"
        paint-order="stroke">Royal Rumble</text></g></svg>`;
}
