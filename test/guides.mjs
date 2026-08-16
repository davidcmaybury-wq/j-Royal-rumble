// The pages a new player is sent to.
//
// These are the first thing somebody sees who has never played, so a broken
// link or a page that stopped rendering is worse here than almost anywhere.
const U = process.env.URL || 'http://127.0.0.1:8080';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

for (const [path, must] of [
  ['/how-to-play', 'space bar'],
  ['/rules-101', 'Thirty players'],
  ['/rules', 'ROYAL RUMBLE'],
  ['/history', 'VERSION HISTORY'],
]) {
  const r = await fetch(`${U}${path}`);
  const body = await r.text();
  check(`${path} serves`, r.ok, String(r.status));
  check(`  and has its content`, body.includes(must), must);
}

// The welcome screen has to actually point at them.
const w = await (await fetch(`${U}/`)).text();
check('the welcome screen links to the guide', w.includes('/how-to-play'));
check('and to the rules explainer', w.includes('/rules-101'));

// The guide's markup has to balance, or the steps nest inside each other and
// the page stretches to four times its height — which is how it first shipped.
const g = await (await fetch(`${U}/how-to-play`)).text();
const body = g.slice(g.indexOf('<body>'));
const opens = (body.match(/<div/g) || []).length;
const closes = (body.match(/<\/div>/g) || []).length;
check('the guide\'s divs balance', opens === closes, `${opens} open, ${closes} closed`);

check('every step is illustrated',
  (g.match(/class="pic"/g) || []).length >= 4,
  `${(g.match(/class="pic"/g) || []).length} pictures`);
check('and the focus warning is there', /in front/i.test(g));
check('the banner identifies the page, not a bare heading',
  g.includes("markBanner") && /HOW TO PLAY/.test(g));

// The advanced rules must cover every mechanic that exists, or a player reads
// them and is surprised mid-match.
const adv = await (await fetch(`${U}/rules-101`)).text();
for (const m of ['TOP ROPE', 'TARGETING', 'BOUNTIES', 'STABLES', 'REVIVAL']) {
  check(`rules 101 covers ${m}`, adv.includes(m));
}

// The Discord copy is the source for the rules page; both must exist.
const { readFileSync } = await import('fs');
for (const f of ['discord-rules-v2.md', 'discord-advanced-mechanics.md']) {
  let ok = true;
  try { readFileSync(new URL('../docs/' + f, import.meta.url)); } catch { ok = false; }
  check(`docs/${f} ships with the package`, ok);
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
