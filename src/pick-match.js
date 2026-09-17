// "Presidents for four hundred" — turning that into a cell on the board.
//
// **Ported from Matt Schiffler's j-trivia** (`server/server.js`,
// `/api/clue-select`), which solved this against real rooms first. Two
// independent halves, which is the insight worth keeping: the dollar value
// and the category are found by completely different machinery, so a garbled
// category cannot cost you the value and a misheard number cannot cost you
// the category.
//
//   the value     homophone repair, then every number-shaped token in the
//                 utterance, then the LAST one that is actually on the board
//   the category  double-metaphone codes, word against word, most matches
//                 wins — and a tie is no match rather than a guess
//
// It matches on sound, not on meaning, and that is deliberate. A model asked
// to match a spoken phrase to a category name will reason its way to a
// thematic answer — Matt's live case was a model claiming "'Section' matches
// 'OF THE LAW'", which shares no sound with it at all. Phonetic matching
// cannot do that: it either finds overlap or it does not. The optional model
// fallback here is allowed only to PROPOSE, and its proposal is thrown away
// unless the word it cites as evidence really does sound like a word in both
// the category and what the player said.
//
// Nothing in this file touches the network or the rules. It takes a board and
// some transcripts and returns a cell or null; the autohost decides what a
// null means.

import { doubleMetaphone } from 'double-metaphone';

// Words that carry no identifying sound for a category. "The" matching "the"
// is not evidence of anything, and without this a stop word in two category
// names produces a tie and therefore no match at all.
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to',
  'for', 'is', 'are', 'was', 'were', 'it', 'its', 'this', 'that', 'with', 'by',
  'from', 'as', 'be', 'i', 'll', 'take', 'give', 'me', 'please', 'lets', 'let']);

export function wordCodes(word) {
  const clean = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!clean || STOPWORDS.has(clean)) return null;
  const [primary, secondary] = doubleMetaphone(clean);
  return { word: clean, primary, secondary };
}

function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Two words sound alike enough to count, by Matt's three rules: the same
 * code, one code containing the other ("metal" inside "medalists"), or a long
 * shared prefix without containment ("precedence" against "presidents").
 */
export function codesMatch(a, b) {
  if (!a || !b) return false;
  if (a.word === b.word) return true;
  const A = [a.primary, a.secondary].filter(Boolean);
  const B = [b.primary, b.secondary].filter(Boolean);
  for (const ca of A) for (const cb of B) {
    if (ca === cb) return true;
    if (ca.length >= 3 && cb.length >= 3 && (ca.startsWith(cb) || cb.startsWith(ca))) return true;
    if (sharedPrefix(ca, cb) >= 4) return true;
  }
  return false;
}

// A category's words twice over: split normally, and again with hyphens
// closed up, so a portmanteau title whose pun only works as one word
// ("MAN-AGRAMS" → "managrams") can still be matched by somebody saying it
// aloud as one word.
function categoryCodes(title) {
  const raw = String(title || '').split(/[\s"'.,!?]+/);
  const split = raw.flatMap((w) => w.split('-')).map(wordCodes).filter(Boolean);
  const joined = raw.map((w) => w.replace(/-/g, '')).map(wordCodes).filter(Boolean);
  return [...split, ...joined];
}

export function scoreCategory(saidCodes, title) {
  const catCodes = categoryCodes(title);
  let matches = 0;
  const pairs = [];
  for (const sw of saidCodes) {
    for (const cw of catCodes) {
      if (codesMatch(sw, cw)) { matches++; pairs.push(`${sw.word}~${cw.word}`); break; }
    }
  }
  return { matches, pairs };
}

// Homophones a recognizer produces for digits, applied to a SEPARATE copy of
// the utterance used only for finding the number. Matt's reasoning, and it is
// the kind of thing you only learn by shipping: a category called "THINGS TO
// DO" becomes "THINGS 2 DO" under this substitution, so the copy the category
// matcher sees must be the original.
const HOMOPHONES = [
  [/\b(to|too|tow|toe)\b/ig, '2'],
  [/\b(for|fore|four)\b/ig, '4'],
  [/\b(sex|sax)\b/ig, '6'],
  [/\b(ate|eat)\b/ig, '8'],
  [/\bwon\b/ig, '1'],
];

const WORD_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10 };

/**
 * Every number-shaped token in one utterance, left to right, with the words
 * that produced each one — so the category matcher can be handed what is
 * left after the value is taken out.
 */
function numberTokens(utterance) {
  const text = HOMOPHONES.reduce((u, [re, digit]) => u.replace(re, digit), String(utterance || ''));
  const words = text.split(/\s+/);
  const tokens = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lower = w.toLowerCase();
    // A whole-token digit first, then a digit run glued inside a token —
    // "starts with h2000" is what a recognizer does with a category called
    // "STARTS WITH H" and a $2000 clue.
    const whole = /^(\d[\d,]*)$/.exec(w);
    const embedded = !whole && /(\d+)/.exec(w);
    const digits = whole || embedded;
    let n = null;
    const indices = [i];
    if (digits) n = parseInt(digits[1].replace(/,/g, ''), 10);
    else if (WORD_NUMS[lower] != null) n = WORD_NUMS[lower];
    else if (lower === 'hundred') n = 100;
    else if (lower === 'thousand') n = 1000;
    if (n == null) continue;
    const next = (words[i + 1] || '').toLowerCase();
    if ((digits || WORD_NUMS[lower] != null) && (next === 'hundred' || next === 'thousand')) {
      n *= next === 'hundred' ? 100 : 1000;
      indices.push(i + 1);
      i++;
    }
    tokens.push({ n, indices });
  }
  return { words, tokens };
}

/**
 * The dollar value in one utterance, and the utterance with it removed.
 *
 * Last number wins — "let's try presidents for 400" has one candidate, but
 * homophone repair can invent earlier ones ("for" → 4) and the real, spoken
 * number is nearly always last. Only a value actually on the board counts, so
 * a stray "4" from the word "for" is skipped in favor of the 400 after it.
 */
export function extractValue(utterance, values) {
  const { words, tokens } = numberTokens(utterance);
  const allowed = new Set(values);
  for (let k = tokens.length - 1; k >= 0; k--) {
    if (!allowed.has(tokens[k].n)) continue;
    const drop = new Set(tokens[k].indices);
    const rest = words.filter((_, i) => !drop.has(i)).join(' ');
    return { value: tokens[k].n, rest };
  }
  return { value: null, rest: words.join(' ') };
}

/**
 * Match what was said against the open cells of a board.
 *
 * `board` is the engine's: an array of `{ title, clues: [{ row, revealed }] }`.
 * `heard` is one transcript or several ranked alternatives, best first.
 *
 * Returns `{ slot, row, value, why }`, or `{ slot: null, row: null, why }`
 * saying which half failed — a null is a thing the host says out loud ("which
 * category?"), so the reason has to be usable.
 */
export function matchPick(heard, board, { multiplier = 1 } = {}) {
  const alts = (Array.isArray(heard) ? heard : [heard]).map((s) => String(s || '').trim()).filter(Boolean);
  if (!alts.length) return { slot: null, row: null, why: 'nothing was heard' };

  const open = [];
  board.forEach((cat, slot) => (cat.clues || []).forEach((c) => {
    if (!c.revealed) open.push({ slot, row: c.row });
  }));
  if (!open.length) return { slot: null, row: null, why: 'the board is empty' };

  // Both the face values and what the board is showing right now: in overtime
  // a $400 clue reads $1,600, and a player calls what they can see. Our
  // problem, not Matt's — his board never multiplies.
  const FACE = [100, 200, 300, 400, 500];
  const openFaces = [...new Set(open.map((o) => FACE[o.row - 1]))];
  const values = [...new Set([...openFaces, ...openFaces.map((v) => v * multiplier)])];

  // The value comes from the first alternative that yields one on the board;
  // the category is matched against the words of every alternative merged,
  // since a recognizer's second guess often carries the word the first one
  // mangled.
  let value = null;
  const rests = [];
  for (const alt of alts) {
    const r = extractValue(alt, values);
    if (value == null && r.value != null) value = r.value;
    rests.push(r.rest);
  }
  const row = value == null ? null : FACE.indexOf(value > 500 ? value / multiplier : value) + 1;

  const saidCodes = [...new Set(rests)].join(' ').split(/\s+/).map(wordCodes).filter(Boolean);
  if (!saidCodes.length) {
    return { slot: null, row, value, why: 'no words to match a category on' };
  }
  const scored = board.map((cat, slot) => ({ slot, title: cat.title, ...scoreCategory(saidCodes, cat.title) }))
    .sort((a, b) => b.matches - a.matches);
  const best = scored[0], second = scored[1];
  if (!best || best.matches === 0) {
    return { slot: null, row, value, why: 'that did not sound like any category on the board' };
  }
  // A tie is not a match. Guessing between two categories that scored the
  // same is how a host puts up the wrong clue and the room has to unpick it.
  if (second && second.matches === best.matches) {
    return { slot: null, row, value, why: `could not tell ${best.title} from ${second.title}` };
  }
  if (row == null || row < 1 || row > 5) {
    return { slot: best.slot, row: null, value, why: `heard ${best.title}, but no dollar value` };
  }
  if (!open.some((o) => o.slot === best.slot && o.row === row)) {
    return { slot: best.slot, row, value, why: `${best.title} for ${value} is already gone` , taken: true };
  }
  return { slot: best.slot, row, value, why: best.pairs.join(', ') };
}

/**
 * Let a model propose a category when the sound alone could not decide, and
 * throw the proposal away unless its own cited evidence survives the same
 * phonetic check the primary matcher uses.
 *
 * `propose` is an async ({ categories, said }) => { slot, evidenceWord } — the
 * autohost supplies one backed by Claude; tests pass a stub or nothing at
 * all. Matt's design, including the reason the evidence word is its own field
 * rather than a quoted span in prose: a category with an apostrophe in it
 * ("THE SPORTSCASTER'S QUOTE") breaks any naive quote-pairing regex, and it
 * broke his.
 */
export async function proposeCategory(said, board, propose) {
  if (typeof propose !== 'function') return { slot: null, why: 'no fallback configured' };
  const categories = board.map((c, slot) => ({ slot, title: c.title }));
  let out;
  try { out = await propose({ categories, said }); } catch (e) { return { slot: null, why: `fallback failed: ${e.message}` }; }
  if (!out || out.slot == null) return { slot: null, why: 'the fallback had no answer' };
  const cat = categories.find((c) => c.slot === out.slot);
  const evidence = wordCodes(out.evidenceWord);
  if (!cat || !evidence) return { slot: null, why: 'the fallback cited nothing checkable' };
  const inCategory = categoryCodes(cat.title).some((cw) => codesMatch(evidence, cw));
  const inSpoken = String(said || '').split(/\s+/).map(wordCodes).filter(Boolean)
    .some((sw) => codesMatch(evidence, sw));
  if (inCategory && inSpoken) return { slot: out.slot, why: `fallback, on "${evidence.word}"` };
  return { slot: null, why: `the fallback's evidence "${out.evidenceWord}" is not in both` };
}
