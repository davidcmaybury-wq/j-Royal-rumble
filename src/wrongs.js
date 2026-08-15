// What a robot says when it is about to be wrong.
//
// A robot that buzzes and is simply marked wrong is a scoring event. A robot
// that buzzes and says "Millard Fillmore" is a player. The whole point of the
// bots is that the race feels like a race, and a wrong answer nobody hears is
// the one part of that which was still invisible.
//
// Written by Claude when ANTHROPIC_API_KEY is set, because a wrong answer has
// to be wrong in the way a person is wrong — the right shape, the right
// category, near-miss rather than nonsense. Without a key there is a local
// fallback that reuses other answers from the same board, which is cruder but
// costs nothing and never fails.

const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 4000;

/**
 * A wrong answer for one clue.
 *
 * Never throws and never blocks a match: on any failure, or with no key set, it
 * falls back to something local. Callers can await it before the buzzers arm,
 * so nothing waits on the network mid-race.
 */
export async function wrongAnswer(clue, otherAnswers = []) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return localWrong(clue, otherAnswers);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 40,
        system: 'You produce plausible WRONG answers for a Jeopardy!-style quiz, '
          + 'as a confident but mistaken player would. The answer must be the right '
          + 'KIND of thing — a person for a person, a year for a year, a river for '
          + 'a river — and it must be genuinely incorrect. Aim for a near miss: the '
          + 'other famous person from the same era, the neighbouring country, the '
          + 'sequel instead of the original. Reply with the answer alone, no '
          + 'preamble, no "What is", no punctuation beyond what the name needs.',
        messages: [{
          role: 'user',
          content: `Category: ${clue.category}\nClue: ${clue.text}\n`
            + `The correct answer is: ${clue.answer}\n`
            + (otherAnswers.length
              ? `Do not use any of these: ${otherAnswers.slice(0, 8).join('; ')}\n` : '')
            + 'Give one plausible wrong answer.',
        }],
      }),
    });
    clearTimeout(t);
    if (!r.ok) return localWrong(clue, otherAnswers);
    const j = await r.json();
    const text = (j.content || [])
      .filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
    const clean = tidy(text);
    // A "wrong" answer that matches the right one is worse than no answer at
    // all, so check rather than trust.
    if (!clean || same(clean, clue.answer)) return localWrong(clue, otherAnswers);
    return clean;
  } catch {
    return localWrong(clue, otherAnswers);
  }
}

/** Strip the quiz-show framing a model may add back in. */
function tidy(s) {
  return String(s || '')
    .replace(/^\s*(what|who|where|when)\s+(is|are|was|were)\s+/i, '')
    .replace(/^["'“”]+|["'“”?.!]+$/g, '')
    .trim()
    .slice(0, 60);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const same = (a, b) => norm(a) === norm(b);

/**
 * No key, or the call failed.
 *
 * Another answer from the same board is the best local guess at something of
 * the right kind — the categories are themed, so a neighbouring answer is
 * usually the right sort of thing and reliably the wrong one. Failing that, a
 * robot that admits it does not know is better than silence.
 */
function localWrong(clue, otherAnswers) {
  const pool = (otherAnswers || []).filter((a) => a && !same(a, clue.answer));
  if (pool.length) {
    // Deterministic per clue, so the same clue does not produce a different
    // wrong answer each time it is re-tossed.
    const i = norm(clue.text || '').length % pool.length;
    return tidy(pool[i]);
  }
  return null;
}
