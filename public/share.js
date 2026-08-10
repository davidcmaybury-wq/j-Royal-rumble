// Turns the end-of-match screen into something shareable: a summary card, a
// full stats sheet, and the raw numbers.
//
// Everything is drawn on a canvas here rather than rendered server-side. The
// data is already in the browser, and a screenshot of a dark UI at whatever
// zoom the host happens to be at is not a deliverable.

const INK = '#0A0E1C', PANEL = '#131A30', LINE = '#2A3556';
const CHALK = '#EEEBE1', SLATE = '#7C88AB', BRASS = '#D6A93F', BLOOD = '#C81E20';

const font = (size, weight = 400, family = 'IBM Plex Sans') =>
  `${weight} ${size}px "${family}", system-ui, sans-serif`;
const mono = (size) => `400 ${size}px "IBM Plex Mono", monospace`;
const anton = (size) => `400 ${size}px "Anton", Impact, sans-serif`;
const marker = (size) => `400 ${size}px "Permanent Marker", cursive`;

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function toBlob(canvas) {
  return new Promise((r) => canvas.toBlob(r, 'image/png'));
}

// Draw the score history the same way the on-screen chart does.
function drawChart(g, hist, x, y, w, h, winnerToken) {
  if (!hist || hist.length < 2) return;
  const maxClue = hist[hist.length - 1].clue || 1;
  let maxY = 0;
  for (const p of hist) maxY = Math.max(maxY, p.ceiling || 0, ...Object.values(p.scores));
  maxY = Math.ceil(maxY / 1000) * 1000 || 1000;
  const px = (c) => x + (c / maxClue) * w;
  const py = (v) => y + h - (Math.max(0, v) / maxY) * h;

  g.strokeStyle = LINE; g.lineWidth = 1;
  g.fillStyle = SLATE; g.font = mono(13); g.textAlign = 'right';
  for (const v of [0, maxY / 2, maxY]) {
    g.beginPath(); g.moveTo(x, py(v)); g.lineTo(x + w, py(v)); g.stroke();
    g.fillText(v >= 1000 ? v / 1000 + 'k' : String(v), x - 8, py(v) + 4);
  }

  const tokens = [...new Set(hist.flatMap((p) => Object.keys(p.scores)))];
  g.lineWidth = 1.6; g.lineJoin = 'round';
  for (const tok of tokens) {
    if (tok === winnerToken) continue;
    g.strokeStyle = 'rgba(74,86,128,0.8)';
    g.beginPath();
    let open = false;
    for (const p of hist) {
      const v = p.scores[tok];
      if (v === undefined) { open = false; continue; }
      if (open) g.lineTo(px(p.clue), py(v)); else g.moveTo(px(p.clue), py(v));
      open = true;
    }
    g.stroke();
  }

  g.strokeStyle = BRASS; g.lineWidth = 2; g.setLineDash([6, 5]);
  g.beginPath();
  hist.forEach((p, i) => (i ? g.lineTo(px(p.clue), py(p.ceiling)) : g.moveTo(px(p.clue), py(p.ceiling))));
  g.stroke(); g.setLineDash([]);

  if (winnerToken) {
    g.strokeStyle = CHALK; g.lineWidth = 3.2;
    g.beginPath();
    let open = false;
    for (const p of hist) {
      const v = p.scores[winnerToken];
      if (v === undefined) { open = false; continue; }
      if (open) g.lineTo(px(p.clue), py(v)); else g.moveTo(px(p.clue), py(v));
      open = true;
    }
    g.stroke();
  }

  g.textAlign = 'right'; g.font = font(12); g.fillStyle = BRASS;
  g.fillText('ceiling', x + w, y + 14);
  g.textAlign = 'left'; g.fillStyle = SLATE; g.font = mono(12);
  g.fillText('clue 0', x, y + h + 20);
  g.textAlign = 'right';
  g.fillText('clue ' + maxClue, x + w, y + h + 20);
  g.textAlign = 'left';
}

function header(g, W, title) {
  g.fillStyle = INK; g.fillRect(0, 0, W, 10000);
  g.fillStyle = BRASS; g.font = anton(46); g.textAlign = 'left';
  g.fillText('J!', 40, 74);
  g.fillStyle = BLOOD; g.font = marker(34);
  g.fillText('Royal Rumble', 96, 72);
  g.fillStyle = SLATE; g.font = font(14);
  g.textAlign = 'right'; g.fillText(title, W - 40, 68); g.textAlign = 'left';
  g.strokeStyle = LINE; g.lineWidth = 2;
  g.beginPath(); g.moveTo(40, 96); g.lineTo(W - 40, 96); g.stroke();
}

function drawAvatar(g, img, x, y, r) {
  g.save();
  g.beginPath(); g.arc(x + r, y + r, r, 0, Math.PI * 2); g.clip();
  g.drawImage(img, x, y, r * 2, r * 2);
  g.restore();
  g.strokeStyle = BRASS; g.lineWidth = 2;
  g.beginPath(); g.arc(x + r, y + r, r, 0, Math.PI * 2); g.stroke();
}

const loadImg = (src) => new Promise((res) => {
  if (!src) return res(null);
  const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
});

// ------------------------------------------------------------- summary card
export async function summaryImage(S) {
  const rows = (S.standings || []).slice();
  const champ = rows.find((p) => p.winner);
  const W = 1080, H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  header(g, W, `${S.clues} clues \u00B7 ${rows.length} players`);

  const av = await loadImg(champ && champ.avatar);

  g.textAlign = 'center';
  g.fillStyle = SLATE; g.font = font(15);
  g.fillText('LAST ONE STANDING', W / 2, 168);
  if (av) drawAvatar(g, av, W / 2 - 54, 190, 54);
  const nameY = av ? 372 : 268;
  g.fillStyle = BRASS; g.font = anton(champ && champ.name.length > 12 ? 76 : 104);
  g.fillText(champ ? champ.name : 'No winner', W / 2, nameY);
  if (champ) {
    g.fillStyle = SLATE; g.font = font(19);
    g.fillText(`entry #${champ.draw}  \u00B7  ${champ.tenure} clues survived  \u00B7  `
      + `${champ.correct} correct  \u00B7  ${champ.pins} toss outs`, W / 2, nameY + 40);
  }

  drawChart(g, S.history, 90, nameY + 90, W - 180, 250, champ && champ.token);

  // three short leaderboards rather than the full tables
  const boards = [
    ['Survived longest', rows.slice().sort((a, b) => b.tenure - a.tenure), (p) => p.tenure + ' clues'],
    ['Most drained', rows.slice().sort((a, b) => b.drained - a.drained), (p) => p.drained.toLocaleString()],
    ['Fastest average', rows.filter((p) => p.avg).sort((a, b) => a.avg - b.avg), (p) => p.avg.toFixed(1) + ' ms'],
  ];
  let bx = 70;
  const top = nameY + 400;
  for (const [title, list, fmt] of boards) {
    g.textAlign = 'left';
    g.fillStyle = BRASS; g.font = font(14, 500);
    g.fillText(title.toUpperCase(), bx, top);
    g.strokeStyle = LINE; g.lineWidth = 1;
    g.beginPath(); g.moveTo(bx, top + 12); g.lineTo(bx + 280, top + 12); g.stroke();
    list.slice(0, 5).forEach((p, i) => {
      const y = top + 44 + i * 34;
      g.fillStyle = p.winner ? BRASS : CHALK; g.font = font(17);
      g.fillText(`${i + 1}. ${p.name}`, bx, y);
      g.fillStyle = SLATE; g.font = mono(15); g.textAlign = 'right';
      g.fillText(fmt(p), bx + 280, y);
      g.textAlign = 'left';
    });
    bx += 320;
  }

  if (S.fastest) {
    g.textAlign = 'center'; g.fillStyle = SLATE; g.font = font(15);
    g.fillText(`Fastest buzz of the match \u00B7 ${S.fastest.name} at ${S.fastest.ms.toFixed(1)} ms`,
      W / 2, H - 46);
  }
  download(await toBlob(c), `rumble-${S.gameId}-summary.png`);
}

// ----------------------------------------------------------- full stats page
const MATCH_COLS = [['draw', 'Draw'], ['name', 'Player'], ['tenure', 'Clues'], ['outOrder', 'Out'],
  ['correct', 'Correct'], ['missed', 'Missed'], ['pins', 'Toss outs'], ['drained', 'Drained'], ['peak', 'Peak']];
const BUZZ_COLS = [['draw', 'Draw'], ['name', 'Player'], ['att', 'Attempts'], ['early', 'Early'],
  ['won', 'Won'], ['rate', 'Win rate'], ['avg', 'Avg ms'], ['best', 'Best ms']];

const cell = (p, k) => {
  if (k === 'name') return p.name;
  if (k === 'outOrder') return p.outOrder || '\u2014';
  if (k === 'rate') return p.att ? Math.round(p.won / p.att * 100) + '%' : '\u2014';
  if (k === 'peak' || k === 'drained') return (p[k] || 0).toLocaleString();
  if (k === 'avg' || k === 'best') return p[k] == null ? '\u2014' : p[k].toFixed(1);
  return String(p[k] ?? 0);
};

function table(g, rows, cols, x, y, w, title) {
  g.textAlign = 'left';
  g.fillStyle = BRASS; g.font = font(15, 500);
  g.fillText(title.toUpperCase(), x, y);
  const colW = w / cols.length;
  const hy = y + 30;
  g.fillStyle = SLATE; g.font = font(12, 500);
  cols.forEach(([, label], i) => {
    g.textAlign = i === 1 ? 'left' : 'right';
    g.fillText(label.toUpperCase(), i === 1 ? x + colW : x + colW * (i + 1) - 12, hy);
  });
  g.strokeStyle = LINE; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, hy + 10); g.lineTo(x + w, hy + 10); g.stroke();
  rows.forEach((p, r) => {
    const ry = hy + 40 + r * 30;
    if (r % 2) { g.fillStyle = PANEL; g.fillRect(x, ry - 20, w, 30); }
    cols.forEach(([k], i) => {
      g.fillStyle = p.winner ? BRASS : (i === 1 ? CHALK : SLATE);
      g.font = i === 1 ? font(15) : mono(14);
      g.textAlign = i === 1 ? 'left' : 'right';
      g.fillText((p.winner && i === 1 ? '\u25C6 ' : '') + cell(p, k),
        i === 1 ? x + colW : x + colW * (i + 1) - 12, ry);
    });
  });
  return hy + 40 + rows.length * 30;
}

export async function fullStatsImage(S) {
  const rows = (S.standings || []).slice().sort((a, b) => b.tenure - a.tenure);
  const W = 1100;
  const H = 460 + 60 + rows.length * 30 + 90 + rows.length * 30 + 120;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  header(g, W, `${S.clues} clues \u00B7 ${rows.length} players`);

  const champ = rows.find((p) => p.winner);
  g.textAlign = 'left';
  g.fillStyle = SLATE; g.font = font(14);
  g.fillText('LAST ONE STANDING', 40, 138);
  g.fillStyle = BRASS; g.font = anton(58);
  g.fillText(champ ? champ.name : 'No winner', 40, 194);

  drawChart(g, S.history, 90, 240, W - 180, 210, champ && champ.token);

  let y = table(g, rows, MATCH_COLS, 40, 520, W - 80, 'Match');
  y = table(g, rows.slice().sort((a, b) => b.won - a.won), BUZZ_COLS, 40, y + 60, W - 80, 'Buzzers');

  g.fillStyle = SLATE; g.font = font(13); g.textAlign = 'center';
  g.fillText(S.fastest ? `Fastest buzz \u00B7 ${S.fastest.name} at ${S.fastest.ms.toFixed(1)} ms` : '',
    W / 2, y + 44);
  download(await toBlob(c), `rumble-${S.gameId}-stats.png`);
}

// ------------------------------------------------------------------- raw csv
export function statsCsv(S) {
  const rows = (S.standings || []).slice().sort((a, b) => b.tenure - a.tenure);
  const head = ['draw', 'player', 'winner', 'clues_survived', 'out_order', 'correct', 'missed',
    'toss_outs', 'drained', 'peak', 'buzz_attempts', 'early_buzzes', 'races_won', 'win_rate',
    'avg_ms', 'best_ms'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [head.join(',')];
  for (const p of rows) {
    lines.push([p.draw, p.name, p.winner ? 'yes' : 'no', p.tenure, p.outOrder ?? '',
      p.correct, p.missed, p.pins, p.drained, p.peak, p.att, p.early, p.won,
      p.att ? (p.won / p.att).toFixed(3) : '', p.avg ?? '', p.best ?? ''].map(esc).join(','));
  }
  download(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }),
    `rumble-${S.gameId}-stats.csv`);
}
