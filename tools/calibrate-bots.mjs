#!/usr/bin/env node
// Fits the robot parameters against real observed play.
//
//   node tools/calibrate-bots.mjs
//
// The reference is a table of solo games — one strong human against two robots
// over 61 clues — recorded by the author of the original model. Each row is a
// robot standard: attempts per game, and how many it got right and wrong once
// it won the buzz.
//
// Reproducing those three numbers is the whole test. If the simulation matches,
// the parameters are right; if it doesn't, they aren't.

import { makeBot, planClue, BUZZ_PROFILE, useProfile, timingOf, PROFILES } from '../src/bots.js';

// This reproduces the original author's recorded games, so it runs on his
// scale. The game's own default is `measured`, anchored on real buzz times.
useProfile('observed');
import { makeRng } from '../src/engine.js';

const OBSERVED = {
  rookie:     { games: 3,  att: 21.7, right: 3.7,  wrong: 1.0 },
  normie:     { games: 27, att: 29.1, right: 9.1,  wrong: 1.3 },
  champ:      { games: 11, att: 38.3, right: 14.9, wrong: 3.4 },
  superchamp: { games: 3,  att: 45.0, right: 18.7, wrong: 3.7 },
};
// The human in those games, for scale.
const HUMAN = { att: 49.4, right: 33.0, wrong: 3.5 };

const CLUES = 61;
const ROWS = [1, 2, 3, 4, 5];

// A stand-in for the strong human: attempts most clues and has very quick hands.
const humanBrain = {
  attemptRate: HUMAN.att / CLUES,
  accuracy: [0.95, 0.93, 0.90, 0.87, 0.83],
  buzz: { mean: 45, sd: 30 },
};

// The 44 robot appearances across 22 games mean two robots per game, drawn
// from the observed mix — a superchamp usually sits next to a normie, not
// another superchamp. Pairing like with like would have two superchamps winning
// 45 of 61 clues between them, which leaves the human's 36.5 impossible.
const MIX = [['rookie', 3], ['normie', 27], ['champ', 11], ['superchamp', 3]];
const MIX_TOTAL = MIX.reduce((n, [, w]) => n + w, 0);
function drawLevel(rng) {
  let r = rng() * MIX_TOTAL;
  for (const [lvl, w] of MIX) { r -= w; if (r <= 0) return lvl; }
  return 'normie';
}

function playGame(table, rng) {
  const stats = table.map(() => ({ att: 0, right: 0, wrong: 0 }));
  for (let i = 0; i < CLUES; i++) {
    const row = ROWS[i % 5];
    const bids = [];
    table.forEach((b, idx) => {
      const plan = planClue(b, row, rng);
      if (!plan.attempt) return;
      stats[idx].att++;
      bids.push({ idx, ms: plan.ms, correct: plan.correct });
    });
    if (!bids.length) continue;
    bids.sort((a, b) => a.ms - b.ms);
    const win = bids[0];
    if (win.correct) stats[win.idx].right++;
    else stats[win.idx].wrong++;
  }
  return stats;
}

// Play the mix, and accumulate per level the way the observed table was built.
function measureAll(games = 12000) {
  const rng = makeRng(17);
  const per = {};
  const human = { att: 0, right: 0, wrong: 0, games: 0 };
  for (let g = 0; g < games; g++) {
    const brains = [makeBot(rng, { level: drawLevel(rng), profile: 'observed' }),
                    makeBot(rng, { level: drawLevel(rng), profile: 'observed' })];
    const table = [...brains, humanBrain];
    const stats = playGame(table, rng);
    brains.forEach((b, i) => {
      const t = (per[b.level] ||= { att: 0, right: 0, wrong: 0, n: 0 });
      t.att += stats[i].att; t.right += stats[i].right; t.wrong += stats[i].wrong; t.n++;
    });
    human.att += stats[2].att; human.right += stats[2].right; human.wrong += stats[2].wrong;
    human.games++;
  }
  const out = {};
  for (const [lvl, t] of Object.entries(per)) {
    out[lvl] = { att: t.att / t.n, right: t.right / t.n, wrong: t.wrong / t.n, n: t.n };
  }
  out.human = { att: human.att / human.games, right: human.right / human.games,
                wrong: human.wrong / human.games, n: human.games };
  return out;
}

const pad = (n, w = 7) => String(n).padStart(w);
const fmt = (n) => n.toFixed(1);
const off = (got, want) => {
  const d = got - want;
  const pct = want ? Math.abs(d) / want * 100 : 0;
  const flag = pct > 25 ? '  <-- off' : '';
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}${flag}`;
};

console.log('Simulated against the observed solo games (61 clues, 2 robots + 1 strong human)\n');
console.log(`${'level'.padEnd(12)}${pad('att')}${pad('want')}${pad('right')}${pad('want')}${pad('wrong')}${pad('want')}   drift`);
const ALL = measureAll();
let worst = 0;
for (const [level, want] of Object.entries(OBSERVED)) {
  const got = ALL[level];
  console.log(
    level.padEnd(12) +
    pad(fmt(got.att)) + pad(fmt(want.att)) +
    pad(fmt(got.right)) + pad(fmt(want.right)) +
    pad(fmt(got.wrong)) + pad(fmt(want.wrong)) +
    '   att ' + off(got.att, want.att) + ', right ' + off(got.right, want.right));
  worst = Math.max(worst,
    Math.abs(got.right - want.right) / Math.max(1, want.right));
}

const h = ALL.human;
console.log(
  'human'.padEnd(12) +
  pad(fmt(h.att)) + pad(fmt(HUMAN.att)) +
  pad(fmt(h.right)) + pad(fmt(HUMAN.right)) +
  pad(fmt(h.wrong)) + pad(fmt(HUMAN.wrong)) +
  '   att ' + off(h.att, HUMAN.att) + ', right ' + off(h.right, HUMAN.right));

console.log('\nWhat separates a superchamp from a strong human, in the observed data:');
console.log('  accuracy once they win the buzz:   83% vs 90%   — a small gap');
console.log('  share of their presses that win:   50% vs 74%   — the real gap');
console.log('\nSo a robot is beaten on the buzzer, not on knowledge. Making the good ones');
console.log('harder means faster hands, not a bigger brain — which is also what happens');
console.log('at the top of the real game.');

console.log('\nBuzz profiles, and what each implies in J!ometry terms.');
console.log('Time% is the chance of winning a buzz when all three attempt; 33.3 is average,');
console.log('and roughly 46 is a strong champion across a career.\n');
for (const set of ['observed', 'broadcast', 'measured']) {
  useProfile(set);
  const line = Object.entries(PROFILES[set])
    .map(([k, v]) => `${k} ${String(v.mean).padStart(3)}ms/${String(timingOf({ buzz: v })).padStart(4)}%`)
    .join('   ');
  console.log(`  ${set.padEnd(10)} ${line}`);
}
useProfile('observed');
console.log('\nThe original scale spreads far wider than real contestants do — a jedi at');
console.log('85% would be twice the best champion on record. That is only invisible while');
console.log('the human it is measured against is equally superhuman.');
// A guard rather than a target. The middle standards still come in 15-25%
// light on races won, which would need the original module to close properly.
if (worst > 0.35) {
  console.log(`\nFAIL a standard drifted more than 35% from observed play`);
  process.exit(1);
}
console.log('\nok   every standard within 35% of observed play');
process.exit(0);
