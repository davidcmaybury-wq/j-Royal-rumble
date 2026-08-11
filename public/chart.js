// A score-history chart, drawn as plain SVG. No library, no dependencies.
//
// Thirty overlapping lines is unreadable, so the chart leans on the shape of
// the format instead: a player's line exists only while they are in the ring,
// which means most lines are short and the survivors stand out on their own.
// The winner is the only line given colour.

export function scoreChart(history, draw, opts = {}) {
  // opts.meToken draws one more line in a second colour — on a player's own
  // results screen, finding yourself among thirty lines is the first thing
  // you want to do.
  const W = opts.width || 640, H = opts.height || 260;
  const P = { t: 14, r: 12, b: 26, l: 46 };
  if (!history || history.length < 2) return '';

  const names = new Map((draw || []).map((d) => [d.token, d.name]));
  const winner = opts.winnerToken;
  const maxClue = history[history.length - 1].clue || 1;
  let maxY = 0;
  for (const h of history) {
    maxY = Math.max(maxY, h.ceiling || 0, ...Object.values(h.scores));
  }
  maxY = Math.ceil(maxY / 1000) * 1000 || 1000;

  const x = (c) => P.l + (c / maxClue) * (W - P.l - P.r);
  const y = (v) => H - P.b - (Math.max(0, v) / maxY) * (H - P.t - P.b);

  // One path per player, broken wherever they were not in the ring.
  const tokens = [...new Set(history.flatMap((h) => Object.keys(h.scores)))];
  const paths = tokens.map((tok) => {
    let d = '', open = false;
    for (const h of history) {
      const v = h.scores[tok];
      if (v === undefined) { open = false; continue; }
      d += (open ? 'L' : 'M') + x(h.clue).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
      open = true;
    }
    return { tok, d, win: tok === winner, me: tok === opts.meToken && tok !== winner };
  }).filter((p) => p.d);

  const ceiling = history.map((h, i) =>
    (i ? 'L' : 'M') + x(h.clue).toFixed(1) + ' ' + y(h.ceiling).toFixed(1)).join(' ');

  const yTicks = [0, maxY / 2, maxY].map((v) =>
    `<line x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}" stroke="#2A3556" stroke-width="1"/>
     <text x="${P.l - 7}" y="${y(v) + 4}" text-anchor="end" fill="#7C88AB" font-size="10"
       font-family="IBM Plex Mono, monospace">${v >= 1000 ? (v / 1000) + 'k' : v}</text>`).join('');

  const step = maxClue > 120 ? 40 : maxClue > 60 ? 20 : 10;
  const xTicks = [];
  for (let c = 0; c <= maxClue; c += step) {
    xTicks.push(`<text x="${x(c)}" y="${H - 8}" text-anchor="middle" fill="#7C88AB" font-size="10"
      font-family="IBM Plex Mono, monospace">${c}</text>`);
  }

  const winPath = paths.find((p) => p.win);
  const mePath = paths.find((p) => p.me);
  const rest = paths.filter((p) => !p.win && !p.me);

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
    aria-label="Every player's score across ${maxClue} clues, with the falling ceiling">
    ${yTicks}${xTicks.join('')}
    ${rest.map((p) => `<path d="${p.d}" fill="none" stroke="#4A5680" stroke-width="1.25"
      stroke-linejoin="round" opacity="0.75"/>`).join('')}
    <path d="${ceiling}" fill="none" stroke="#D6A93F" stroke-width="1.5"
      stroke-dasharray="5 4" opacity="0.85"/>
    ${mePath ? `<path d="${mePath.d}" fill="none" stroke="#4FB286" stroke-width="2.5"
      stroke-linejoin="round"/>` : ''}
    ${winPath ? `<path d="${winPath.d}" fill="none" stroke="#EEEBE1" stroke-width="2.5"
      stroke-linejoin="round"/>` : ''}
    <text x="${W - P.r}" y="${P.t + 2}" text-anchor="end" fill="#D6A93F" font-size="10"
      font-family="IBM Plex Sans, sans-serif">ceiling</text>
    ${winPath ? `<text x="${W - P.r}" y="${P.t + 16}" text-anchor="end" fill="#EEEBE1" font-size="10"
      font-family="IBM Plex Sans, sans-serif">${names.get(winner) || 'winner'}</text>` : ''}
    ${mePath ? `<text x="${W - P.r}" y="${P.t + 30}" text-anchor="end" fill="#4FB286" font-size="10"
      font-family="IBM Plex Sans, sans-serif">you</text>` : ''}
    <text x="${P.l}" y="${H - 8}" fill="#7C88AB" font-size="10"
      font-family="IBM Plex Sans, sans-serif">clue</text>
  </svg>`;
}
