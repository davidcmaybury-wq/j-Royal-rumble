// Cleaning library text at load. Categories imported before the escape fix
// carry their escapes, and some carry them twice, having been through two
// converters: `FOREVER "YOUNG\"`, `\"AIN" DROPS`. Cleaning at load costs a
// second at boot and saves rebuilding a 47,000-category library.
//
// Its own module (it lived inline in server.js until 0.104.1) so that
// test/library-text.mjs can run it over every category and clue in the
// library. test/escapes.mjs samples live boards at random, which is how the
// one clue below survived: one clue in 235,000 is not something a sample finds.

/** Undo repeated backslash escapes and HTML entities; trim a stray trailing backslash. */
export function unescapeText(t) {
  if (typeof t !== 'string') return t;
  let out = t;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/\\(["'\\])/g, '$1');
    if (next === out) break;
    out = next;
  }
  return out.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    // A backslash with nothing after it is not an escape the loop can undo:
    // one clue (arch:2023-02-22:r2:travel-facts, "…from 1473 to 1481\")
    // reached the screen with it. Found by the Alumni Game's library check,
    // 2026-11-11.
    .replace(/\\+\s*$/, '')
    .replace(/\s+/g, ' ').trim();
}

/** Clean every title, note and clue in place; returns how many categories and clues changed. */
export function cleanLibrary(library) {
  let cats = 0, clues = 0;
  for (const c of library) {
    const t = unescapeText(c.title), n = unescapeText(c.note);
    if (t !== c.title || n !== c.note) cats++;
    c.title = t; c.note = n;
    for (const x of c.clues) {
      const tx = unescapeText(x.text), an = unescapeText(x.answer);
      if (tx !== x.text || an !== x.answer) clues++;
      x.text = tx; x.answer = an;
    }
  }
  return { cats, clues };
}
