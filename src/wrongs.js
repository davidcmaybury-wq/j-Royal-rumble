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
//
// THE FALLBACK USED TO BE INVISIBLE, which is the whole reason this file was
// rewritten. Every failure went through a bare `catch {}` to the local answer
// and nothing was logged, so a missing key, a rejected key, a wrong model name
// and a timeout all looked identical from the outside: robots saying nonsense.
// It ran that way in live matches. Failures are recorded and reported at
// /api/health now — see status() at the foot of this file.

import Anthropic from '@anthropic-ai/sdk';

// Haiku, by David's call: this is a throwaway sentence generated once per clue
// while the host is still reading, not a reasoning task. The cheapest model
// that writes a convincing near-miss is the right one, and the latency budget
// below is easier to hold with it.
const MODEL = 'claude-haiku-4-5';

// The whole exchange has to finish while the host reads the clue aloud, so the
// worst case is what matters, not the typical case. One retry at 2s each is a
// 4s ceiling — the same budget the hand-rolled version had, but it now buys a
// retry on the 429s and 503s that used to fall straight through to nonsense.
const TIMEOUT_MS = 2000;
const MAX_RETRIES = 1;

// Constructed once. Without a key the SDK would still build, so the key is
// checked separately rather than relying on the constructor to complain.
const KEY = process.env.ANTHROPIC_API_KEY;
const client = KEY
  ? new Anthropic({ apiKey: KEY, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES })
  : null;

// What actually happened, for /api/health. A count rather than a flag: one
// failed call on a flaky evening is not the same as every call failing, and
// the two want different responses from whoever is reading.
const stats = { asked: 0, written: 0, fellBack: 0, lastError: null };

/**
 * A wrong answer for one clue.
 *
 * Never throws and never blocks a match: on any failure, or with no key set, it
 * falls back to something local. Callers await it before the buzzers arm, so
 * nothing waits on the network mid-race.
 */
export async function wrongAnswer(clue, otherAnswers = []) {
  stats.asked += 1;
  if (!client) return fellBack(clue, otherAnswers, 'no ANTHROPIC_API_KEY set');
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 40,
      system: 'You produce plausible WRONG answers for a Jeopardy!-style quiz, '
        + 'as a confident but mistaken player would. The answer must be the right '
        + 'KIND of thing — a person for a person, a year for a year, a river for '
        + 'a river — and it must be genuinely incorrect. Aim for a near miss: the '
        + 'other famous person from the same era, the neighboring country, the '
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
    });

    // content is a union of block types; only the text ones carry an answer.
    const text = (message.content || [])
      .filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
    const clean = tidy(text);
    // A "wrong" answer that matches the right one is worse than no answer at
    // all, so check rather than trust.
    if (!clean) return fellBack(clue, otherAnswers, 'model returned no text');
    if (same(clean, clue.answer)) {
      return fellBack(clue, otherAnswers, 'model returned the correct answer');
    }
    stats.written += 1;
    return clean;
  } catch (e) {
    // Typed errors rather than a message match, so the reason in /api/health
    // says which of these it was — they need different fixes and used to be
    // indistinguishable.
    return fellBack(clue, otherAnswers, describe(e));
  }
}

/**
 * Why the call failed, in words a host can act on.
 *
 * Most specific first, and the order is load-bearing:
 * APIConnectionTimeoutError extends APIConnectionError extends APIError in this
 * SDK, so a generic check placed above them would swallow both.
 *
 * The base class is APIError, not APIStatusError — that name exists in the
 * Python SDK and not in this one, and `instanceof undefined` throws a TypeError
 * from inside the catch, taking the whole function down. Verified against
 * @anthropic-ai/sdk 0.117.1 rather than recalled.
 */
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

// Recorded and said out loud once. The log line is deliberately not per-clue:
// a key that is simply absent would otherwise print on every clue of every
// match, and a line that appears a hundred times is one nobody reads.
let announced = null;
function fellBack(clue, otherAnswers, why) {
  stats.fellBack += 1;
  stats.lastError = why;
  if (announced !== why) {
    announced = why;
    console.log(`robot wrong answers: falling back to the board — ${why}`);
  }
  return localWrong(clue, otherAnswers);
}

/**
 * Which source the robots' wrong answers are actually coming from.
 *
 * Reported by /api/health so the answer to "why are the robots talking
 * nonsense" is one request away instead of a guess.
 */
export function status() {
  return {
    model: MODEL,
    // What the room is hearing right now, not what was configured.
    mode: stats.written > 0 && stats.lastError === null ? 'claude'
      : stats.written > 0 ? 'mixed' : 'local',
    configured: !!client,
    asked: stats.asked,
    written: stats.written,
    fellBack: stats.fellBack,
    lastError: stats.lastError,
  };
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
 *
 * This is the path David saw in live play, and it is cruder than it looks on
 * paper: "the right sort of thing" holds only while the category is tight. On
 * a loose category it is the nonsense he reported.
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
