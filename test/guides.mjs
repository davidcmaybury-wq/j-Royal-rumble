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
check('and it says what to do when the computer hosts', /computer is hosting/.test(g));

// Everything the computer host expects a player to DO has to be on this page.
// A player who does not know it is listening will sit waiting to be asked, and
// one who does not know the question form was dropped will waste their five
// seconds on "what is".
check('the guide says the computer host listens', /also <strong>listens/.test(g));
check('and shows how a clue is called out loud', /for four\s*\n?\s*hundred/.test(g));
check('and says a spoken answer is what gets ruled on',
  /say the answer out loud/i.test(g));
check('and that the question form is not required',
  /not have to phrase it as a question/.test(g));
check('and explains "be more specific" rather than leaving it a mystery',
  /be more\s*\n?\s*specific/i.test(g));
// "No audio leaves the device" was the first wording here and it overclaims:
// Chrome and Edge's own speech recognizer sends the audio to their speech
// service to produce a transcript, which this project does not control. What
// is true, and the part that actually matters to a player deciding whether to
// say yes to the mic prompt, is that WE never receive or store it.
check('and says we never receive or store the audio, not that none is sent',
  /never receive or store\s*\n?\s*your audio/i.test(g));
check('and names the browsers that can do it', /Chrome and Edge/.test(g));
check('and says what to do when they cannot, so a refusal is not a dead end',
  /If you say no/.test(g));

// The objection is the room's only check on a host that cannot be argued with,
// so a player who does not know the key exists does not have it.
check('the guide says which key objects', /press O<\/strong>|press O\b/i.test(g));
check('and that anybody can, not just the ring',
  /already out/.test(g) && /Anybody can object/i.test(g));
check('and gives both thresholds, since either can be the close one',
  /majority of\s*\n?\s*everybody in the match/i.test(g)
  && /two thirds of the players in the ring/i.test(g));
check('and says the game does not stop while they come in',
  /carries on while objections/i.test(g));
check('and explains the vote that follows an ambiguous one',
  /fifteen\s*\n?\s*seconds to pick one or throw the clue out/i.test(g));
check('and that a thrown-out clue costs nobody anything',
  /thrown-out clue costs nobody anything/i.test(g));
check('the banner identifies the page, not a bare heading',
  g.includes("markBanner") && /HOW TO PLAY/.test(g));

// The advanced rules must cover every mechanic that exists, or a player reads
// them and is surprised mid-match.
const adv = await (await fetch(`${U}/rules-101`)).text();
// Targeting is standard now, so it lives in the main rules rather than here.
for (const m of ['TOP ROPE', 'BOUNTIES', 'STABLES', 'REVIVAL']) {
  check(`rules 101 covers ${m}`, adv.includes(m));
}

// The computer host's rules are in the same file the room reads before a match,
// per the house rule that a rule landing in the engine and not in these files
// is half a rule. `/rules-101` renders that file, so this reads the page rather
// than the markdown and catches a rule that never made it through.
check('the rules the room reads say the host listens',
  /just say your answer/i.test(adv));
check('and that O objects to a ruling', /Press O to object/i.test(adv));
check('and name both thresholds',
  /majority of the whole match/i.test(adv) && /two thirds of the ring/i.test(adv));
check('and say what a thrown-out clue costs',
  /nobody paid, nobody charged/i.test(adv));

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
  // --- every postable block has to fit Discord's cap ----------------------
  //
  // RULES.md opened by claiming every block sits inside the 2,000-character
  // limit. Two did not: ELIMINATION at 3,079 and ADVANCED MECHANICS at 3,029.
  // Discord truncates silently, so an over-long block loses its tail with no
  // error — the same failure the discord-*.md posting notes exist to prevent.
  // Blocks that need splitting now carry a note saying where; this checks that
  // every block either fits or documents its break points.
  {
    const rules = readFileSync(new URL('../RULES.md', import.meta.url), 'utf8');
    const over = [];
    for (const b of rules.split(/\n---+\n/)) {
      const t = b.trim();
      if (!t.startsWith('##')) continue;
      const head = t.split('\n')[0].replace(/^#+\s*/, '');
      const note = /<!--([\s\S]*?)-->/.exec(t);
      let body = t.split('\n').slice(1).join('\n')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^The Discord-ready copy[^\n]*\n/m, '').trim();
      if (body.length <= 2000) continue;
      // Over the cap: it must document where to break, and each piece must fit.
      const marks = note ? [...note[1].matchAll(/before "([^"]+)"/g)].map((m) => m[1]) : [];
      if (!marks.length) { over.push(`${head} (${body.length}, no split note)`); continue; }
      const cuts = marks.map((m) => body.indexOf(m)).filter((i) => i >= 0).sort((a, b) => a - b);
      const parts = [];
      let prev = 0;
      for (const c of cuts) { parts.push(body.slice(prev, c)); prev = c; }
      parts.push(body.slice(prev));
      const big = parts.filter((x) => x.trim().length > 2000);
      if (big.length) over.push(`${head} (a piece is ${big[0].trim().length})`);
    }
    check('every RULES.md block fits Discord, or says where to break it',
      over.length === 0, over.join('; ') || 'all within the cap');
  }

  // --- the ALPHA label, on every surface that offers the computer host -------
  //
  // David asked for it before this shipped, and it is a needle rather than a
  // comment because "we will take the label off later" is the kind of promise
  // this suite exists to keep honest. Taking it off should be a deliberate
  // change that also has to come here, not something that quietly rots off one
  // page at a time while the other three still warn people.
  {
    const surfaces = [
      ['RULES.md', '../RULES.md', 'this has never been played in a real room'],
      ['the illustrated guide', '../public/howto.html', 'brand new, so expect'],
      ['the setup page', '../public/setup.html', 'Not yet\n        played in a real room'],
      ['a player\u2019s buzzer', '../public/buzzer.html', 'alphatag'],
    ];
    for (const [what, rel, needle] of surfaces) {
      const body = readFileSync(new URL(rel, import.meta.url), 'utf8');
      check(`the computer host is marked alpha on ${what}`,
        body.includes(needle), needle);
    }
  }

  const both = read('discord-rules-v2.md') + read('discord-advanced-mechanics.md');
  for (const [what, needle] of [
    ['that the computer host is flagged as an experiment', 'treat it as an experiment'],
    ['the entry stake scales in overtime', 'stake climbs with it'],
    ['stables are named after gemstones', 'Diamond'],
    ['revival scales too', 'stake scales with it'],
    ['there is a way to report a problem', 'Report a problem'],
    ['every advanced mechanic is listed', 'STABLES'],
    ['targeting, which is standard now', 'deal with a bully'],
    ['and that ganging up is the point of it', 'Gang up'],
    ['one foot on the floor, which is on by default', 'One foot on the floor'],
    // 0.101.0: the edge is a 60 ms band, not a 70% discount. The room reads
    // this file, so it has to say the rule the engine actually runs.
    ['and that its edge is a band, not a percentage', 'nearest 60 ms'],
    // 0.102.0: overtime waits one entry interval after the last arrival.
    ['and that the last one in gets a breath before overtime', 'one entry interval to settle'],
    ['both match shapes by name', 'ARCADE'],
    ['and the other one', 'TOURNAMENT'],
    ['that a player keeps their own time', 'your own'],
    ['that the comeback is gated to people who never got going', 'three clues'],
    ['and that it stops bounties paying out', "doesn't get eliminated at all"],
    ['the top rope cooldown, which was never in the Discord copy at all',
      'wait five clues'],
    ['and that taking the climb back before the clue is free', 'costs you nothing'],
    ['that an aimed miss costs a host-set share', 'the host sets that share'],
    ['that the computer can host', 'Sometimes the computer hosts'],
    ['who Mike is', 'Mike'],
    ['and who Gene is', 'Gene'],
    ['that the voice needs sound on', 'turn your sound on'],
    ['that the board holder calls the next clue', 'calls the next clue'],
    ['that a spoken pick works too', 'say it'],
    ['that you can just say your answer when you win a buzz', 'just say your answer'],
    ['and that a partial answer earns a second try, not a miss', 'be more specific'],
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
  // And the correction that sits under it since 0.101.0: the percentage was
  // replaced by a 60 ms band, with the reason recorded rather than the old
  // argument deleted.
  ['and that the band replaced it, with the reason on the page', 'the edge is a band, not a percentage'],
  // 0.102.0: the overtime grace, named so a host can find the switch.
  ['and that overtime waits an entry interval after the last arrival', 'overtimeEntryGrace'],
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
  ['and the figures are numbered without a duplicate', 'Figure 22'],
  // The bone pile. Its whole point is that these ideas get proposed again, so
  // the section existing is the guard against re-litigating them.
  ['the bone pile of rejected ideas', 'The bone pile'],
  ['that lowering the shark is on it', 'lowering the shark is not raising the field'],
  ['and that repairs worse than their bug are on it', 'the repair was worse than the bug'],
  // The backfire dial and the draw-slot findings, 0.94.0.
  ['the backfire dial', 'The price of aiming'],
  ['that aiming back is not a surcharge', 'neither a discount nor a surcharge'],
  ['the draw-slot finding', 'The draw slot is the biggest lever measured'],
  ['and the renumbered figure run', 'Figure 37'],
  // The computer host is ALPHA and every surface that offers it says so.
  // David asked for this before it shipped, and the reason it is a needle and
  // not a comment is that "we will take the label off later" is exactly the
  // kind of promise this suite exists to keep honest — the label must come off
  // deliberately, in a change that also fails this check.
  ['that the computer host is marked alpha in the handbook', 'Not yet played in a real room'],
  // The longevity bonus, merged 2026-09-15. It has paid out since the mechanic
  // shipped and this document never once mentioned it — the gap David caught
  // reading his own handbook. Keyed on the closing line rather than a figure;
  // there is no figure to renumber.
  ['the longevity bonus is documented at all', 'getting paid to still be here'],
  ['that it fires every ten clues by default', 'Every 10th tick'],
  ['that it is flat, unlike the sweep', "survival money doesn't inflate"],
  ['and roof-clipped like everything else', 'never float you above the roof'],
  ['and the section closes on the line David wanted', 'The pot pays the fast. The clock pays the stubborn.'],
  // Matches 23-24, merged from the analysis chat's live-sep14 page. The top
  // rope needle matters most: this document told people for twenty-two matches
  // that nothing optional had ever been used, and that claim is now wrong in a
  // specific, interesting way. Keyed on the finding, not the figure number.
  ['the first live use of an optional mechanic', 'Somebody finally jumped'],
  ['that the top rope pays and drains in equal measure', 'it pays double, and it drains double'],
  ['that four uses is not a measurement', 'Four uses is\nnot a measurement'],
  ['why it went unused, which was never that it was broken', 'never\nthat it was broken'],
  ['that stables and targeting are still at zero', 'neither\nhas ever been used'],
  ['the tail correction meeting live data', 'the two hardest tests available'],
  ['that a right prediction is a boring one', 'Boring is the goal'],
  ['the two-median exhibit', 'Every fast number in the room is two numbers'],
  ['that the mode has not missed in twenty-four', 'zero for eight'],
  ['and the renumbered run reaches forty-three', 'Figure 43'],
  // Matches 21-22, merged from the analysis chat's live-sep07 page. Keyed on
  // the finding rather than the figure number, so a later renumber does not
  // quietly drop the check — the rule the Figure 22 needle above exists to
  // remind everyone of.
  ['the night one player took both belts', 'Two belts in one night'],
  ['the anticipation finding', 'timing the read the whole time'],
  ['that a settled median measures two skills', 'the fastest <em>numbers</em> are rhythm'],
  ['the overtime-tail correction', 'Time to eat a correction: the overtime tail'],
  ['that the correction keeps the number it replaced', 'about twenty clues for the overtime drain'],
  ['and the corrected figure itself', '17 to 34 clues, median 29'],
  ['that the tail branches on revival', 'revival refills a ring the drain has already emptied'],
  ['the discoverability count, now at twenty-two', 'without a single use between them'],
  ['and the renumbered run reaches forty', 'Figure 40'],
  // Matches 14-20, merged 0.96.0 from the analysis chat's pre-voiced pages.
  // Keyed on the finding, never the figure number.
  ['the new rooms broke the fastest-buzzer streak', 'The fastest buzzer won once in five matches'],
  ['that accuracy won instead', 'So what won instead? Accuracy.'],
  ['the new-room pace effect', "remaining miss is pace"],
  ['the estimator flipping sign', 'runs about 20% long in experienced rooms'],
  ['the one-room mode experiment', 'One room, two modes, two different games'],
  ['that the mode picks the winner', 'the mode picks the winner, not the room'],
  // The Aug 22 pair, merged 0.95.4. Each needle is the finding, not the figure
  // number, so a later renumber does not silently drop the check.
  ['the third host measured', 'A third host, and this time no shift'],
  ['that the host offset did not repeat', 'a host offset that moves one player is not'],
  ['the two-implementation estimator bug', 'The length estimator existed twice'],
  ['that lives are bounded by the settings', 'roster &times; (1 + revivalLimit)'],
  ['the Aug 22 race counts', 'Races won in the first two matches'],
  ['that most races is not the match', 'most races is not the match'],
  // "Pity powerup" names the player as pitiable; David renamed it to the
  // wrestling term. The negative check is the one that matters — the analysis
  // folder still ships the old name, so it can arrive again in a merge.
  ['the rejected buzz boost under its proper name', 'Kickout on 2'],
  ['the computer host, and the two voices', 'When the computer hosts'],
  ['why the voice plays on every buzzer', 'own buzzer window'],
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

for (const needle of ['pity powerup', 'Pity powerup', 'pity-study']) {
  check(`the handbook does not say "${needle}"`, !hb.includes(needle));
}

check('and no longer claims the stake is identical for everybody',
  !/identical\s+starting\s+stake/.test(hb.replace(/\s+/g, ' ')));

// --- docs/analysis carries P-labels, never in-game handles -----------------
//
// The handbook anonymizes to P-labels, and until 2026-08-22 docs/analysis used
// in-game handles for the same players. That defeats the anonymization from
// inside the same public repository: `P3: 123 ms, 47.7% back-half wins` in the
// handbook and one CSV row with 122.7 and 47.7 identify each other exactly, and
// eight of the thirteen labels fell out that way. The README went further and
// simply printed the key.
//
// Asserted as a shape rather than a list of forbidden names, because a test
// naming the handles would put them straight back into the repo.
{
  const bots = new Set(['Bront', 'Dell', 'Juno', 'Kip', 'Marlo', 'Tibbs']);
  const ok = (v) => /^P\d+$/.test(v) || bots.has(v) || v === 'ended early';
  const read = (f) => readFileSync(new URL('../docs/analysis/' + f, import.meta.url), 'utf8');

  const stats = read('player-stats.csv').trim().split('\n').slice(1)
    .map((l) => l.split(',')[0]).filter(Boolean);
  const bad1 = stats.filter((v) => !ok(v));
  check('player-stats.csv names only P-labels and robots',
    bad1.length === 0, bad1.join(', ') || `${stats.length} rows`);

  const winners = read('match-summary.csv').trim().split('\n').slice(1)
    .map((l) => l.split(',')[8]).filter(Boolean);
  const bad2 = winners.filter((v) => !ok(v));
  check('match-summary.csv names only P-labels and robots',
    bad2.length === 0, bad2.join(', ') || `${winners.length} matches`);

  const elims = JSON.parse(read('elims.json'));
  const bad3 = [...new Set(elims.map((e) => e.player))].filter((v) => !ok(v));
  check('elims.json names only P-labels and robots',
    bad3.length === 0, bad3.join(', ') || `${elims.length} eliminations`);

  // And the key itself must never come back.
  const rm = read('README.md');
  check('the analysis README does not print the anonymization key',
    !/P\d+\s*=\s*[A-Za-z]/.test(rm));
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
