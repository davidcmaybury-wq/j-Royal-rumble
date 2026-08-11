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

// Run each page's script in a stub DOM, then actually call its render
// functions with plausible state.
//
// Static analysis is not enough, and this is the case that proved it: a patch
// put the avatar cache inside boot(), so `avatarOf` existed in the file but was
// invisible to renderRoster. Nothing was misspelled and nothing was missing —
// every other check here passed. Loading the module was not enough either,
// because the error only happens when the roster is drawn. So the probe seeds
// the page's state object and calls the renderers.

function stubEl() {
  const node = {
    style: {}, dataset: {}, value: '', checked: false, disabled: false,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    children: [], tagName: 'DIV',
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; },
    appendChild(){}, removeChild(){}, remove(){}, insertBefore(){},
    setAttribute(){}, getAttribute(){ return null; }, hasAttribute(){ return false; },
    addEventListener(){}, removeEventListener(){}, focus(){}, blur(){}, click(){},
    querySelector: () => stubEl(), querySelectorAll: () => [],
    closest: () => null, cloneNode: () => stubEl(),
    getBoundingClientRect: () => ({ top:0,left:0,width:0,height:0,bottom:0,right:0 }),
  };
  return node;
}

const SEED = {
  roster: [
    { token: 'p1', name: 'A', connected: true, hasAvatar: false, isBot: false,
      tokenArt: { art: 'crowbar', colour: 'brass' } },
    { token: 'b1', name: 'Bront', connected: true, hasAvatar: false, isBot: true,
      level: 'normie', bot: 'normie hands', tokenArt: null },
  ],
  settings: { targetMinutes: 30, secondsPerClue: 17.5, entryInterval: null,
    startScore: 3000, ceiling: 11000, ceilingFloor: null, ceilingDecayPerClue: null,
    stumperFraction: 0.5, potScoring: true, delay: 200, lockout: 250,
    recordMatch: false, topRope: false, targeting: false, bounties: false,
    revival: false, revivalLimit: 1, revivalFraction: 0.5, seasonRange: [22, 42] },
  blend: { archive: 50, original: 50, upload: 0 },
  available: { archive: 100, original: 100, upload: 0 },
  seasons: [22, 42], version: '0.0.0', roomCode: 'AAAA', phase: 'lobby',
  live: [], queue: [], out: [], board: [], clues: 0, uploads: [],
  you: { token: 'p1', name: 'A', state: 'live', score: 3000, tokenArt: { art: 'crowbar', colour: 'brass' } },
  mechanics: {}, ring: [], history: [], standings: [],
};

for (const page of ['setup.html', 'console.html', 'buzzer.html', 'admin.html']) {
  const html = readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
  const i = html.indexOf('<script type="module">');
  let js = html.slice(i + '<script type="module">'.length, html.lastIndexOf('</script>'));

  const imported = [];
  js = js.replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';?/g, (_, names) => {
    for (const n of names.split(',')) {
      const c = n.trim().split(/\s+as\s+/).pop().trim();
      if (c) imported.push(c);
    }
    return '';
  }).replace(/import\s+[\w$]+\s+from\s*'[^']+';?/g, '');

  // Every module-level function declaration whose name suggests it paints.
  const painters = [...js.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(\s*\)/gm)]
    .map((m) => m[1]).filter((n) => /^render|^paint|^draw/.test(n));

  // Which state variable this page keeps its view in.
  const stateVar = /\bS\s*=\s*(null|await)/.test(js) ? 'S' : (/\bV\s*=/.test(js) ? 'V' : null);

  const probe = `
    ;globalThis.__refErrors = [];
    ${stateVar ? `try { ${stateVar} = globalThis.__seed; } catch (e) {}` : ''}
    ${painters.map((fn) => `
    try { ${fn}(); } catch (e) {
      if (/is not defined|before initialization/.test(e.message))
        globalThis.__refErrors.push('${fn}: ' + e.message);
    }`).join('')}
  `;

  // Stubs return an empty array rather than an empty string: it coerces to ''
  // in a template, and it also survives .map/.join/.length, which a string does
  // not. A stub that throws stops the probe before it reaches the code we care
  // about — which is exactly what happened on the first attempt at this.
  const stubs = imported.map((n) => `var ${n} = function(){ return []; };`).join('\n');
  const header = `
    var document = arguments[0], window = arguments[1], location = arguments[2];
    var localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
    var io = function(){ return { on(){}, emit(){}, close(){}, timeout(){ return this; } }; };
    var fetch = function(){ return Promise.resolve({ json: () => ({}), ok: true }); };
    var navigator = { userAgent: '', clipboard: { writeText(){} } };
    var performance = { now: () => 0 };
    var Audio = function(){ return { play(){ return Promise.resolve(); }, pause(){} }; };
    var Image = function(){ return {}; };
    var alert = function(){}, confirm = function(){ return true; };
    ${stubs}
  `;

  globalThis.__seed = JSON.parse(JSON.stringify(SEED));
  globalThis.__refErrors = [];
  let loadError = null;
  try {
    const doc = {
      getElementById: () => stubEl(), querySelector: () => stubEl(),
      querySelectorAll: () => [], createElement: () => stubEl(),
      body: stubEl(), head: stubEl(), addEventListener(){}, removeEventListener(){},
    };
    // eslint-disable-next-line no-new-func
    new Function(header + '\n' + js + '\n' + probe)(
      doc,
      { addEventListener(){}, removeEventListener(){}, open(){}, matchMedia: () => ({ matches: false, addEventListener(){} }) },
      { origin: '', hash: '#k', pathname: '/setup/AAAA', href: '' });
  } catch (e) {
    if (/is not defined|before initialization/.test(e.message)) loadError = e.message;
  }
  const errs = [loadError, ...(globalThis.__refErrors || [])].filter(Boolean);
  check(`${page}: every reference resolves when its renderers run`,
    errs.length === 0,
    errs.length ? errs[0] : `${painters.length} renderers exercised`);
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
