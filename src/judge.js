// Ruling on a spoken answer.
//
// The autohost hears a player through their own microphone, so what arrives
// here is not what they said — it is what a speech recognizer thought they
// said. Every rule below exists because of that gap, and most of them are
// **ported from Matt Schiffler's j-trivia autohost** (`server/server.js`,
// `/api/ruling`), which has been ruling on real spoken answers for far longer
// than we have. His hard-won cases are named where they are used;
// `docs/autohost-from-jtrivia.md` records what was taken and what was left.
//
// The shape of the thing:
//
//   1. Deterministic fast paths, in order, no network. An exact match after
//      normalization; the same after one specific misheard-word repair. These
//      only ever rule CORRECT — if a fast path does not fire, nothing is
//      decided and the next stage runs. That property is what makes it safe
//      to add more of them.
//   2. A guard that rules WRONG with no model call: a bare interrogative with
//      no answer after it, which is what a recognizer emits when somebody
//      starts to answer and trails off.
//   3. Claude Haiku against a rubric, for everything else.
//   4. With no key, or when the model call fails, a local judge: normalized
//      comparison plus a conservative token check, and `local: true` on the
//      verdict so the room and the record know a model never saw it.
//
// Four verdicts, not two. `too_broad` is Matt's, and it earns its place: a
// player who says "Roosevelt" when the clue wanted "Theodore Roosevelt" has
// not answered wrongly, they have answered incompletely, and a host says "be
// more specific" rather than "no". The autohost gives them the rest of their
// window; `unclear` is a miss said plainly.
//
// WE DO NOT REQUIRE THE QUESTION FORM. Matt's rubric enforces it and his
// misheard-starter repairs exist to keep the enforcement honest. David
// decided against it for the Rumble (docs/autohost-design.md, "No question
// form"), so the rule is gone from the rubric — but the repairs stay, because
// their other job is stripping a garbled preamble off the front of a real
// answer, and that job is ours too.

import Anthropic from '@anthropic-ai/sdk';

// Haiku, for the same reason wrongs.js uses it: one short call on the clock,
// between a player finishing a sentence and the room hearing a ruling.
const MODEL = process.env.RUMBLE_JUDGE_MODEL || 'claude-haiku-4-5';

// Tighter than wrongs.js's 2s. That call happens while the host is reading
// and nobody is waiting; this one happens in silence with a room listening.
const TIMEOUT_MS = Number(process.env.RUMBLE_JUDGE_TIMEOUT_MS || 1800);
const MAX_RETRIES = 1;

// `RUMBLE_JUDGE=local` runs the deterministic judge on purpose, with no key
// and no model: that is how CI plays a whole match, and it is the honest way
// to run a demo on a box that has no key. It counts as configured — the
// refusal at the start button is for a box that has neither.
const LOCAL_ONLY = process.env.RUMBLE_JUDGE === 'local';
const KEY = LOCAL_ONLY ? null : process.env.ANTHROPIC_API_KEY;
const client = KEY
  ? new Anthropic({ apiKey: KEY, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES })
  : null;

const stats = { asked: 0, model: 0, fast: 0, local: 0, failed: 0, lastError: null,
  verdicts: { correct: 0, wrong: 0, too_broad: 0, unclear: 0 } };

export const VERDICTS = ['correct', 'wrong', 'too_broad', 'unclear'];

/**
 * Strip everything that is not the answer.
 *
 * Matt's `normalizeForRulingMatch`, with the question-form preamble still
 * removed even though we no longer require it — a player who says "what is
 * Chanel" and a player who says "Chanel" have given the same answer, and the
 * fast path should fire for both.
 */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^(i think it'?s|i'?ll say|i'?ll go with|my guess is|um,?|uh,?)\s*/i, '')
    .replace(/^(what|who|where|when|why|how)\s+(is|are|was|were)\s+/i, '')
    .replace(/[?.!,'"]/g, '')
    .replace(/\b(a|an|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Speech recognition hears the start of a Jeopardy answer as an unrelated
// word with some regularity: Matt's list, from his live matches. For him the
// repair protects a question-form rule we do not have; for us it strips a
// nonsense word off the front of an otherwise correct answer, which would
// otherwise fail the exact match and go to the model for no reason.
// Extensible — add what the logs show.
const MISHEARD_STARTERS = [
  { pattern: /^chris\b/i, replacement: 'What is' },
  { pattern: /^core\b/i, replacement: 'Who are' },
  { pattern: /^quiz\b/i, replacement: 'Who is' },
];

export function repairStarter(text) {
  const t = String(text || '').trim();
  for (const { pattern, replacement } of MISHEARD_STARTERS) {
    if (pattern.test(t)) return t.replace(pattern, replacement);
  }
  return t;
}

// A recognizer that heard somebody begin and stop. Matt found this live: a
// player said just "what" on a Daily Double and it was ruled correct, because
// the model had nothing to work with and guessed. Caught before any model
// sees it.
const BARE_INTERROGATIVE = /^(what|who|where|when|why|how)(\s+(is|are|was|were))?$/i;

export function isBareInterrogative(text) {
  return BARE_INTERROGATIVE.test(String(text || '').trim().replace(/[?.!,'"]+$/, ''));
}

/**
 * Rule on one spoken answer.
 *
 * Never throws. Always returns
 * `{ verdict, reason, via, ms, local? }` where `via` is 'exact' | 'grace' |
 * 'bare' | 'model' | 'local', so the record says which stage decided and the
 * next argument about a ruling can start from that rather than from memory.
 */
export async function judge({ clue, answer, said, category = '' }) {
  const t0 = Date.now();
  stats.asked += 1;
  const done = (verdict, reason, via, extra = {}) => {
    stats.verdicts[verdict] = (stats.verdicts[verdict] || 0) + 1;
    return { verdict, reason, via, ms: Date.now() - t0, ...extra };
  };

  const heard = repairStarter(said);
  if (!heard) { stats.fast += 1; return done('unclear', 'nothing was heard', 'bare'); }
  if (isBareInterrogative(heard)) {
    stats.fast += 1;
    return done('unclear', 'no actual answer given', 'bare');
  }

  const want = normalize(answer);
  const got = normalize(heard);
  if (want && got === want) {
    stats.fast += 1;
    return done('correct', 'exact match', 'exact');
  }

  // Matt's "in" for "and" grace. A recognizer mishears the conjunction often
  // enough — "Anthony in Cleopatra" — that it is worth a deterministic pass.
  // Safe by construction: it can only ever turn a non-match into a match, so
  // a wrong answer cannot be made right by it.
  if (want && got.replace(/\bin\b/g, 'and') === want) {
    stats.fast += 1;
    return done('correct', 'matched after correcting a likely "and" misheard as "in"', 'grace');
  }

  if (!client) {
    const r = localJudge(got, want);
    stats.local += 1;
    // In deliberate local mode the verdict stands on its own; with no key at
    // all it is a fallback and says so, which is what makes the autohost
    // treat it differently out loud.
    return done(r.verdict, r.reason, 'local', LOCAL_ONLY ? {} : { local: true });
  }

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 120,
      system: RUBRIC,
      messages: [{
        role: 'user',
        content: `Category: ${category}\nClue: ${clue}\nCorrect answer: ${answer}\n`
          + `Player said: ${heard}\n\nRule on it.`,
      }],
    });
    const text = (message.content || []).filter((c) => c.type === 'text')
      .map((c) => c.text).join(' ').trim();
    const parsed = parseVerdict(text);
    if (!parsed) throw new Error(`could not read the ruling from: ${text.slice(0, 80)}`);
    stats.model += 1;
    return done(parsed.verdict, parsed.reason, 'model');
  } catch (e) {
    // A judge that cannot rule does not guess. The local judge is
    // conservative and the verdict says it was local, so the autohost can put
    // it to the room rather than announce it as a ruling.
    stats.failed += 1;
    stats.lastError = describe(e);
    const r = localJudge(got, want);
    stats.local += 1;
    return done(r.verdict, `${r.reason} (the judge was unavailable: ${stats.lastError})`,
      'local', { local: true });
  }
}

// The rubric. Matt's, minus the question-form rule, plus the two lines our
// format needs. Every clause here is a live failure somebody fixed.
const RUBRIC = [
  'You are ruling on a player\'s spoken answer to a Jeopardy!-style clue.',
  'Reply with JSON only, no preamble and no markdown:',
  '{"verdict":"correct"|"wrong"|"too_broad"|"unclear","reason":"one short sentence"}',
  '',
  'The answer does NOT need to be phrased as a question. Judge the content.',
  '',
  'The player was heard through speech recognition, so the text may be garbled.',
  'Accept homophones and words phonetically very close to the right answer',
  '("Curie" heard as "Curry", "Macbeth" as "Mac Beth"). Do not accept when',
  'syllables are added or dropped or the core sound changes.',
  'If the right answer joins two parts with "and" and the player joined them',
  'with "in", assume the recognizer misheard and rule as if they said "and".',
  'Ignore filler and preamble ("I think it\'s", "um", "I\'ll say").',
  'A surname alone is correct when it identifies the person unambiguously in',
  'this category and clue, and too_broad when it does not.',
  '',
  'Rule too_broad when the answer names a real but wider category containing',
  'the right answer ("sterilization" for "pasteurization").',
  'Check the answer against every specific element the clue describes. An',
  'answer that fails one of them is wrong even when it is closely related.',
  'Extra words that do not change the meaning are fine. Extra words that',
  'contradict it, or add a wrong fact (a middle name, a date, a nationality),',
  'make it wrong.',
  'Rule unclear only when the text carries no attempt at an answer at all.',
].join('\n');

function parseVerdict(text) {
  const t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  // Regex rather than JSON.parse, Matt's reasoning: a response truncated by
  // the token budget still yields a verdict, and the verdict is the field
  // that matters. The reason is human-readable only.
  const v = /"verdict"\s*:\s*"(correct|wrong|too_broad|unclear)"/i.exec(t);
  if (!v) return null;
  const r = /"reason"\s*:\s*"([^"]*)/.exec(t);
  return { verdict: v[1].toLowerCase(), reason: r ? r[1] : 'no reason given' };
}

/**
 * Ruling with no model: only what can be decided from the words themselves.
 *
 * Deliberately timid. It says `correct` only when every meaningful word of
 * the right answer was said, and `unclear` — never `wrong` — otherwise,
 * because "I could not tell" is the truth and the autohost has somewhere to
 * put that (the room) whereas a confident wrong ruling has to be argued out
 * of afterwards.
 */
export function localJudge(got, want) {
  if (!want) return { verdict: 'unclear', reason: 'no answer on file to compare against' };
  if (!got) return { verdict: 'unclear', reason: 'nothing was heard' };
  if (got === want) return { verdict: 'correct', reason: 'exact match' };
  const stop = new Set(['of', 'and', 'in', 'on', 'at', 'to', 'for', 'is', 'was', 'by']);
  const words = (s) => s.split(' ').filter((w) => w && !stop.has(w));
  const wanted = words(want), said = new Set(words(got));
  if (!wanted.length) return { verdict: 'unclear', reason: 'nothing to compare' };
  const hit = wanted.filter((w) => said.has(w)).length;
  if (hit === wanted.length) {
    return { verdict: 'correct', reason: 'every word of the answer was said' };
  }
  // Part of the answer and nothing that is not part of it — "Roosevelt" for
  // "Theodore Roosevelt". That is the shape of an incomplete answer rather
  // than a wrong one, which is exactly what too_broad is for, and it is
  // decidable from the words alone.
  const wantedSet = new Set(wanted);
  const saidWords = [...said];
  if (hit > 0 && saidWords.length && saidWords.every((w) => wantedSet.has(w))) {
    return { verdict: 'too_broad', reason: `heard ${hit} of ${wanted.length} words of the answer` };
  }
  return { verdict: 'unclear', reason: `heard ${hit} of ${wanted.length} words of the answer` };
}

// Same typed-error discipline as wrongs.js, and the same ordering trap: the
// connection errors extend one another, so specific comes first.
function describe(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'ANTHROPIC_API_KEY rejected';
  if (e instanceof Anthropic.PermissionDeniedError) return `key cannot use ${MODEL}`;
  if (e instanceof Anthropic.NotFoundError) return `no such model: ${MODEL}`;
  if (e instanceof Anthropic.RateLimitError) return 'rate limited';
  if (e instanceof Anthropic.APIConnectionTimeoutError) return `timed out after ${TIMEOUT_MS}ms`;
  if (e instanceof Anthropic.APIConnectionError) return 'could not reach the API';
  if (e instanceof Anthropic.APIError) return `API error ${e.status}`;
  return e?.message ? String(e.message).slice(0, 120) : 'unknown failure';
}

/** For /api/health, and for the record at the end of a match. */
export function status() {
  return {
    model: MODEL, configured: !!client || LOCAL_ONLY,
    mode: client ? 'model' : LOCAL_ONLY ? 'local (on purpose)' : 'local (no key)',
    asked: stats.asked, fast: stats.fast, viaModel: stats.model, viaLocal: stats.local,
    failed: stats.failed, lastError: stats.lastError,
    verdicts: { ...stats.verdicts },
  };
}
