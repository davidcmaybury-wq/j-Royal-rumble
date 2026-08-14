// Workflow files, checked for the things a YAML parser happily accepts and
// GitHub then rejects — which takes the whole file down, runs no jobs, and
// reports as a failure with nothing in it.
//
// This has cost two broken pushes: the `secrets` context is not available in a
// step's `if`, and a plain YAML check cannot see that.
import { readFileSync, readdirSync } from 'fs';
let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const dir = new URL('../.github/workflows/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
check('there are workflows to check', files.length > 0, files.join(', '));

for (const f of files) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const lines = src.split('\n');

  // `secrets` in any `if:` — job level or step level — is rejected.
  const badIf = [];
  lines.forEach((l, i) => {
    if (/^\s*if:/.test(l) && /\bsecrets\./.test(l)) badIf.push(i + 1);
  });
  check(`${f}: no 'secrets' inside an if:`, badIf.length === 0,
    badIf.length ? `lines ${badIf.join(', ')} — route it through job-level env` : 'clean');

  // `env` referenced in an `if` has to be defined at job or workflow level; a
  // step's own env block is not in scope for its own condition.
  const jobEnv = new Set();
  let inJobEnv = false;
  for (const l of lines) {
    if (/^    env:\s*$/.test(l)) { inJobEnv = true; continue; }
    if (!inJobEnv) continue;
    if (/^\s*(#|$)/.test(l)) continue;          // comments and blanks stay inside
    const m = l.match(/^      (\w+):/);
    if (m) { jobEnv.add(m[1]); continue; }
    inJobEnv = false;
  }
  const orphanEnv = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*if:.*\benv\.(\w+)/);
    if (m && !jobEnv.has(m[1])) orphanEnv.push(`${m[1]} (line ${i + 1})`);
  });
  check(`${f}: every env used in an if: is defined at job level`,
    orphanEnv.length === 0, orphanEnv.join(', ') || 'clean');

  // Every `node test/x.mjs` in a workflow has to name a suite that exists.
  const suites = [...src.matchAll(/node (test\/[\w-]+\.mjs)/g)].map((m) => m[1]);
  const missing = suites.filter((t) => {
    try { readFileSync(new URL('../../' + t, dir)); return false; } catch { return true; }
  });
  check(`${f}: every suite it runs exists`, missing.length === 0,
    missing.join(', ') || `${suites.length} suites`);
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
