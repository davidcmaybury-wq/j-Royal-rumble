// Match length estimation and the warnings built on it. Lives in its own
// module so the setup page and the test suite run the same code rather than
// two hopefully-identical copies.

// Imported from the engine itself so the setup page uses the same measured
// grid the server does. The path is relative, which resolves both in the
// browser (public/ and src/ are siblings) and under node in the tests.
import { fairnessWarning, predictMatch } from '../src/engine.js';

export const IV_MIN = 2;
export const IV_MAX = 15;

// A match is the queue emptying plus an endgame. Small rosters are almost all
// endgame — three players have no queue at all, so entry pacing tells you
// nothing and length comes down to how fast they bleed each other out.
export const ENDGAME_FLOOR = 22;

export function cluesFor(playerCount, interval, settings = {}) {
  const entry = Math.max(0, playerCount - 3) * interval;
  const base = entry + Math.max(ENDGAME_FLOOR, entry * 0.67);
  // Revival refills a queue the rest of the model assumes drains once. The
  // multiplier is fitted to the simulator, not derived — see tools/sim-mechanics.
  const rev = settings.revival
    ? 1 + (settings.revivalLimit ?? 1) * (settings.revivalFraction ?? 0.5) * 0.96
    : 1;
  return Math.round(base * rev);
}

export function estimate(playerCount, settings) {
  const n = playerCount, s = settings;
  if (n < 3) return null;
  const auto = s.entryInterval == null;
  const raw = n > 3
    ? Math.round((s.targetMinutes * 60 / s.secondsPerClue) * 0.6 / (n - 3))
    : IV_MAX;
  const iv = auto ? Math.min(IV_MAX, Math.max(IV_MIN, raw)) : s.entryInterval;
  const clues = cluesFor(n, iv, s);
  return {
    iv, raw, auto, clues,
    mins: Math.round(clues * s.secondsPerClue / 60),
    clamped: auto && n > 3 && raw !== iv,
    rough: n <= 5,
  };
}

// What length this roster can actually reach at the interval limits.
export function reachable(playerCount, settings) {
  const at = (iv) => Math.round(cluesFor(playerCount, iv, settings) * settings.secondsPerClue / 60);
  return { min: at(IV_MIN), max: at(IV_MAX) };
}

// Returns { level, text, fix?, target? }. `fix` is button copy; `target` is
// the target-minutes value that button would set.
export function warnings(playerCount, settings, precomputed = null) {
  // The estimate can be handed in, and the setup page does hand it in.
  //
  // The line above the warnings and the warnings themselves used to each work
  // one out, and a screenshot arrived showing them disagreeing at the same
  // moment — the line saying entry every 10 and 15 minutes, the warning
  // complaining it could not reach 30. Whatever let them drift apart, taking
  // one estimate and using it for both makes it impossible by construction.
  const e = precomputed || estimate(playerCount, settings);
  if (!e) return [];
  const n = playerCount, s = settings, out = [];
  const reach = reachable(n, s);

  if (e.clamped && e.raw > IV_MAX) {
    const short = (s.targetMinutes - e.mins) / s.targetMinutes;
    out.push({
      level: short > 0.25 ? 'warn' : 'note',
      text: `Auto can't stretch to ${s.targetMinutes} minutes with ${n} players — there aren't enough `
        + `entrants to space out. Entry lands on every ${IV_MAX} clues and the match runs about ${e.mins} minutes.`,
      fix: `Set the target to ${reach.max} minutes`, target: reach.max,
    });
  } else if (e.clamped && e.raw < IV_MIN) {
    out.push({
      level: 'warn',
      text: `Auto can't compress to ${s.targetMinutes} minutes with ${n} players. Entry lands on every `
        + `${IV_MIN} clues and the match still runs about ${e.mins} minutes.`,
      fix: `Set the target to ${reach.min} minutes`, target: reach.min,
    });
  }

  // Draw fairness, from the measured grid rather than a rule of thumb. It never
  // refuses anything — a host who wants a two-hour thirty-player match can have
  // one, they should just know late draws will run away with it.
  const fw = fairnessWarning(n, e.iv);
  if (fw) {
    const p = predictMatch(n, fw.suggest);
    out.push({
      level: fw.kind === 'late-draws' ? 'bad' : 'note',
      text: fw.text,
      fix: p ? `Use every ${fw.suggest} — about ${p.minutes} minutes` : null,
      interval: fw.suggest,
    });
  }

  if (e.mins > 100) {
    out.push({
      level: 'warn',
      text: `About ${e.mins} minutes is a long sitting — the last entrants would wait over an hour to play a clue.`,
      ...(e.auto ? { fix: 'Shorten to 70 minutes', target: 70 } : {}),
    });
  } else if (!e.auto && e.mins > s.targetMinutes * 1.4) {
    out.push({
      level: 'note',
      text: `Every ${e.iv} clues puts this near ${e.mins} minutes, well past your ${s.targetMinutes}-minute target.`,
    });
  }

  if (n === 3) {
    out.push({
      level: 'note',
      text: `Three players means no queue — everyone is in from the first clue and it ends when two are gone. `
        + `Length depends on how fast they drain each other, so treat any estimate loosely.`,
    });
  } else if (n <= 6) {
    out.push({
      level: 'note',
      text: `With ${n} players this plays as a duel more than a Rumble — two or three in the ring most of the `
        + `time, and ${reach.max} minutes is about the ceiling. Lower the starting score to make it bite sooner.`,
    });
  }

  if (s.revival) {
    out.push({ level: 'note', text:
      `Revival stretches a match by roughly half again — most players use their second life, ` +
      `so the queue fills back up once. It also evens out the draw: a second chance is worth ` +
      `most to whoever went in first.` });
  }
  if (s.targeting && n >= 20) {
    out.push({ level: 'note', text:
      `Targeting concentrates damage instead of spreading it. Length barely moves, but ` +
      `whoever is closest to going out tends to get finished rather than lingering.` });
  }

  if (n >= 24 && e.mins < 40) {
    out.push({
      level: 'note',
      text: `${n} players in ${e.mins} minutes is brisk — entrants will arrive faster than the field thins out.`,
    });
  }
  return out;
}
