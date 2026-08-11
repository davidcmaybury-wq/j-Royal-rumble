// Checks each page against its own markup: every element the script binds to
// must exist, and every symbol it imports must be used.
//
// This exists because a patch that failed to insert one <input> left the script
// calling .oninput on null. That threw partway down the binding block and took
// the End match button with it — a whole control silently dead, with no syntax
// error and every other suite passing.
import { readFileSync } from 'fs';

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

for (const page of ['console.html', 'setup.html', 'buzzer.html', 'admin.html']) {
  const html = readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
  const i = html.indexOf('<script type="module">');
  const js = html.slice(i, html.lastIndexOf('</script>'));
  const markup = html.slice(0, i);

  // Ids the script asks for directly, outside of strings it builds itself.
  const wanted = new Set();
  for (const m of js.matchAll(/\$\(\s*'([a-zA-Z0-9_-]+)'\s*\)/g)) wanted.add(m[1]);
  for (const m of js.matchAll(/getElementById\(\s*'([a-zA-Z0-9_-]+)'\s*\)/g)) wanted.add(m[1]);

  // Ids present in the static markup.
  const present = new Set();
  for (const m of html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)) present.add(m[1]);

  // Some pages build ids from a template — `<input id="${k}">` fed by a helper
  // called as num('targetMinutes', ...). Those can't be matched structurally,
  // so treat an id as created if its name appears as a string literal
  // somewhere other than the lookup itself.
  const elsewhere = (id) => {
    const stripped = js
      .replace(new RegExp("\\$\\(\\s*'" + id + "'\\s*\\)", 'g'), '')
      .replace(new RegExp("getElementById\\(\\s*'" + id + "'\\s*\\)", 'g'), '');
    return stripped.includes("'" + id + "'");
  };

  const missing = [...wanted].filter((id) => !present.has(id) && !elsewhere(id));
  check(`${page}: every element the script binds to exists`, missing.length === 0,
    missing.length ? 'missing #' + missing.join(', #') : `${wanted.size} ids`);

  // An import that is never used means a patch landed in one place but not the other.
  const imports = [];
  for (const m of js.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const name of m[1].split(',')) {
      const n = name.trim().split(/\s+as\s+/).pop().trim();
      if (n) imports.push(n);
    }
  }
  const unused = imports.filter((n) => {
    const body = js.replace(/import\s*\{[^}]+\}\s*from[^;]+;/g, '');
    return !new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(body);
  });
  check(`${page}: no imported symbol goes unused`, unused.length === 0,
    unused.length ? unused.join(', ') : `${imports.length} imports`);
}

// Every class the script puts on an element must exist in the stylesheet.
//
// A patch once inserted a dialog's markup but not its CSS, because the anchor
// it matched on had changed. The dialog rendered as unstyled text at the foot
// of the page — valid HTML, valid JS, no error anywhere, and completely
// unusable. Checking ids was not enough; classes carry the layout.
for (const page of ['console.html', 'setup.html', 'buzzer.html', 'admin.html']) {
  const html = readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
  const i = html.indexOf('<script type="module">');
  const js = html.slice(i, html.lastIndexOf('</script>'));
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

  // Classes the script assigns, from className= and class="..." in templates.
  const used = new Set();
  // Only literal, complete class attributes. Anything containing a template
  // expression or a concatenation is skipped rather than guessed at — the
  // point is to catch a missing stylesheet rule, not to parse JavaScript.
  const CLASS_NAME = /^[a-z][a-z0-9_-]*$/i;
  const add = (raw) => {
    for (const c of raw.split(/\s+/)) if (CLASS_NAME.test(c)) used.add(c);
  };
  for (const m of js.matchAll(/className\s*=\s*'([^'`$+]+)'\s*;/g)) add(m[1]);
  for (const m of js.matchAll(/class="([^"`${}+]*)"/g)) add(m[1]);

  // Classes the stylesheet knows about, plus anything in the static markup
  // that is presumably styled by an ancestor rule.
  const styled = new Set();
  for (const m of style.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) styled.add(m[1]);

  const unstyled = [...used].filter((c) => !styled.has(c));
  check(`${page}: every class the script applies is styled`, unstyled.length === 0,
    unstyled.length ? unstyled.join(', ') : `${used.size} classes`);
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
