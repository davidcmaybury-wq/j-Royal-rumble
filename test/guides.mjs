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
  // The handbook is David's HTML, not the generated PDF. That PDF drifted for
  // weeks and still described a game without stables in it.
  ['/handbook', 'Royal Rumble'],
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
// Targeting is standard now, so it lives in the main rules rather than here.
for (const m of ['TOP ROPE', 'BOUNTIES', 'STABLES', 'REVIVAL']) {
  check(`rules 101 covers ${m}`, adv.includes(m));
}

// The Discord copy is the source for the rules page; both must exist.
const { readFileSync } = await import('fs');
for (const f of ['discord-rules-v2.md', 'discord-advanced-mechanics.md']) {
  let ok = true;
  try { readFileSync(new URL('../docs/' + f, import.meta.url)); } catch { ok = false; }
  check(`docs/${f} ships with the package`, ok);
}

// The handbook has to describe the game as it is now.
//
// It served a PDF that was months behind while the current HTML sat in docs/
// unlinked, and nothing noticed. These are the mechanics that exist; if one is
// added and this is not updated, that is the reminder.
{
  const hb = await (await fetch(`${U}/handbook`)).text();
  const r = await fetch(`${U}/handbook`);
  check('the handbook is served as a page', /text\/html/.test(r.headers.get('content-type') || ''),
    r.headers.get('content-type'));
  // Targeting is standard now, so it lives in the main rules rather than here.
for (const m of ['TOP ROPE', 'BOUNTIES', 'STABLES', 'REVIVAL']) {
    check(`the handbook covers ${m}`, hb.includes(m));
  }
  check('and is current on the ceiling', /10,500/.test(hb));
  const pdf = await fetch(`${U}/handbook.pdf`);
  check('the printable copy is still there', pdf.ok, String(pdf.status));
}

// The player-facing docs have to describe the game that is actually running.
//
// These drifted four releases deep before anybody noticed — the rules people
// read still described a fixed entry stake after it had been changed. Each
// entry here is a rule a player would be surprised by.
{
  const { readFileSync } = await import('fs');
  const read = (f) => readFileSync(new URL('../docs/' + f, import.meta.url), 'utf8');
  const both = read('discord-rules-v2.md') + read('discord-advanced-mechanics.md');
  for (const [what, needle] of [
    ['the entry stake scales in overtime', 'stake climbs with it'],
    ['stables are named after gemstones', 'Diamond'],
    ['revival scales too', 'stake scales with it'],
    ['there is a way to report a problem', 'Report a problem'],
    ['every advanced mechanic is listed', 'STABLES'],
    ['targeting, which is standard now', 'deal with a bully'],
    ['and that ganging up is the point of it', 'Gang up'],
    ['one foot on the floor, which is on by default', 'One foot on the floor'],
    ['both match shapes by name', 'ARCADE'],
    ['and the other one', 'TOURNAMENT'],
    ['that a player keeps their own time', 'your own'],
    ['that the comeback is gated to people who never got going', 'three clues'],
    ['and that it stops bounties paying out', "doesn't get eliminated at all"],
    ['the top rope cooldown, which was never in the Discord copy at all',
      'wait five clues'],
    ['and that taking the climb back before the clue is free', 'costs you nothing'],
  ]) {
    check(`the rules mention ${what}`, both.includes(needle), needle);
  }
}

// Old links must not lead to a stale copy.
const pdf = await fetch(`${U}/handbook.pdf`, { redirect: 'manual' });
check('the old PDF link redirects to the real handbook',
  pdf.status === 301 && /\/handbook$/.test(pdf.headers.get('location') || ''),
  `${pdf.status} -> ${pdf.headers.get('location')}`);

// And the handbook it lands on has to know about the current rules. It is the
// long form and the easiest thing to forget: it went four releases describing
// an identical entry stake after that had stopped being true.
const hb = await (await fetch(`${U}/handbook`)).text();
for (const [what, needle] of [
  ['stables', 'Stable'],
  ['the small-field ceiling', '10,500'],
  ['the gemstone names', 'Diamond'],
  ['the stake riding the multiplier', 'rides the overtime'],
  ['one foot on the floor', 'One foot on the floor'],
  // The comeback boost shipped at 50% for one release, which measures as very
  // nearly nothing because no casual gets under the elite at that value. The
  // handbook has to keep saying why, or the next person to find 70% "generous"
  // will move it back and rediscover the cliff in a live match.
  ['why the comeback boost is not a dial', 'threshold, not a dial'],
  ['and quotes a reproducible figure for it', '11.0%'],
  // The handbook credited P11's VWQW arc to the comeback; the logs give him
  // eight race wins at elimination, so it was revival's queue re-entry. The
  // correction is recorded rather than deleted, per the house convention.
  ['that the VWQW attribution was corrected', 'attribution above is overturned'],
  ['and where the trigger belongs', 'Where the trigger belongs'],
  ['that a withdrawn top-rope climb serves no cooldown', 'serves no cooldown'],
  // Open, not settled. It is in the handbook so the next person to touch the
  // ceiling finds the numbers before changing it, per the house rule.
  ['the open finding that the ceiling eats the scaled stake', 'eats the scaled stake'],
  // The leveling budget, merged from the v4 notes. The interference result is
  // the one a future change is most likely to undo by "helpfully" stacking a
  // second race-structure lever on top of the comeback.
  ['the leveling budget', 'The leveling budget'],
  ['that levers interfere rather than stack', 'do not stack'],
  ['and that the winner cooldown feeds the second shark', 'second shark'],
  // Shipped 0.90.0. The strict/loose distinction is the thing most likely to be
  // "helpfully" widened later to recover the missing point of casual win share.
  ['that arrivals are not clipped to a roof they never touched', 'never touched'],
  ['and that the flag covers the arrival, not what it wins', 'arrival-only flag'],
  // The analysis chat's graphs always go into the online handbook — David's
  // standing rule, in README-FOR-DEV-CHAT.md. A chart left in that folder is
  // half-delivered, so these assert the merged ones are actually on the page.
  ['the configuration map that indexes the shark problem', 'every measured configuration'],
  ['the trigger study figures', 'Race wins at the moment of first elimination'],
  ['and the figures are numbered without a duplicate', 'Figure 21'],
]) {
  check(`the handbook covers ${what}`, hb.includes(needle), needle);
}
// Players' broadcast performance is internal study only and must never be in an
// outward-facing document — David's standing rule. The chart page still exists in
// the analysis folder, and the rule there is that its graphs always go into the
// handbook, so this is the guard against a future session merging it back.
for (const needle of ['Accuracy does not transfer', 'does a strong televised record',
  'real broadcast games', 'carry over?']) {
  check(`the handbook has no broadcast-performance analysis: ${needle}`,
    !hb.includes(needle));
}

check('and no longer claims the stake is identical for everybody',
  !/identical\s+starting\s+stake/.test(hb.replace(/\s+/g, ' ')));

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
