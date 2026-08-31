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

for (const page of ['console.html', 'setup.html', 'buzzer.html', 'admin.html', 'watch.html', 'welcome.html', 'control.html']) {
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
for (const page of ['console.html', 'setup.html', 'buzzer.html', 'admin.html', 'watch.html', 'welcome.html', 'control.html']) {
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
    // Records rather than discards, so a renderer that is supposed to emit one
    // row per player can actually be counted. It used to be a no-op, which made
    // "did every live player get a row?" unaskable.
    appendChild(c){ this.children.push(c); return c; },
    removeChild(){}, remove(){}, insertBefore(){},
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
  // Eight live players, because eight is the largest roster recorded and the
  // size the ring bug was reported at. The console returns early on a lobby
  // phase, so the ring check below re-runs render() with phase 'live'.
  live: Array.from({ length: 8 }, (_, i) => ({
    token: 'L' + i, name: 'Live' + i, draw: i + 1, score: 3000 - i * 100,
    connected: true, isBot: false, hasAvatar: false, state: 'live',
    topRope: false, target: null, stable: null, capped: false,
    tokenArt: { art: 'crowbar', colour: 'brass' },
  })),
  queue: [], out: [], board: [], clues: 0, uploads: [],
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

  // Namespace imports (`import * as sfx from '/sound.js'`) were not stripped,
  // so new Function() threw "Cannot use import statement outside a module" on
  // setup, console and buzzer — and the catch below discarded it. The renderer
  // probe has therefore never run on the three pages that matter most. Captured
  // rather than deleted so the name can be stubbed.
  const namespaces = [];
  js = js.replace(/import\s*\*\s*as\s+([\w$]+)\s+from\s*'[^']+';?/g, (_, n) => {
    namespaces.push(n);
    return '';
  });

  // Every module-level function declaration whose name suggests it paints.
  // Renderers with parameters count too.
  //
  // This used to match only zero-argument functions, which meant
  // renderMech(st, you) was never exercised — and it had been throwing
  // "lagHint is not defined" through several releases, silently emptying the
  // whole mechanics panel, with this guard reporting all clear.
  const painters = [...js.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm)]
    .filter((m) => /^render|^paint|^draw/.test(m[1]))
    .map((m) => ({ name: m[1], arity: m[2].trim() ? m[2].split(',').length : 0 }));

  // Which state variable this page keeps its view in.
  const stateVar = /\bS\s*=\s*(null|await)/.test(js) ? 'S' : (/\bV\s*=/.test(js) ? 'V' : null);

  const probe = `
    ;globalThis.__refErrors = [];
    try { globalThis.__rerender = render; } catch (e) {}
    ${stateVar ? `try { ${stateVar} = globalThis.__seed; } catch (e) {}` : ''}
    ${painters.map((fn) => {
      // Plausible arguments: most take (state-ish, player-ish). Anything the
      // stub cannot satisfy throws a different error, which is ignored — only
      // missing identifiers are reported.
      const args = ['\'live\'', 'globalThis.__player', 'globalThis.__player',
                    'globalThis.__player'].slice(0, fn.arity).join(', ');
      return `
    try { ${fn.name}(${args}); } catch (e) {
      if (/is not defined|before initialization/.test(e.message))
        globalThis.__refErrors.push('${fn.name}: ' + e.message);
    }`;
    }).join('')}
  `;

  // Stubs return an empty array rather than an empty string: it coerces to ''
  // in a template, and it also survives .map/.join/.length, which a string does
  // not. A stub that throws stops the probe before it reaches the code we care
  // about — which is exactly what happened on the first attempt at this.
  // Callable *and* property-accessible. A plain function stub broke every page
  // that does `socket.on(...)` on an imported binding: the script threw at the
  // first line, the painter calls appended after it never ran, and the check
  // still reported "N renderers exercised" — a count of what it meant to call.
  // console, buzzer and admin had never actually been exercised.
  const stubs = imported.map((n) =>
    `var ${n} = new Proxy(function(){ return []; }, {`
    + ` get: (t, k) => (k in t ? t[k] : function(){ return []; }) });`)
    // Anything reached through a namespace import answers with a no-op.
    .concat(namespaces.map((n) =>
      `var ${n} = new Proxy({}, { get: () => function(){ return []; } });`))
    .join('\n');
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
    var addEventListener = function(){}, removeEventListener = function(){};
    var requestAnimationFrame = function(){ return 0; }, cancelAnimationFrame = function(){};
    var setTimeout = function(){ return 0; }, setInterval = function(){ return 0; };
    var clearTimeout = function(){}, clearInterval = function(){};
    var matchMedia = function(){ return { matches: false, addEventListener(){} }; };
    ${stubs}
  `;

  globalThis.__seed = JSON.parse(JSON.stringify(SEED));
  // A stand-in player, for renderers that take one.
  globalThis.__player = { token: 'aaaa', name: 'Test', draw: 1, score: 3000,
    state: 'live', topRope: false, topRopeWait: 0, target: null, revivals: 0,
    cluesToEntry: null, queuePlace: null, bounty: 0, entryStake: 3000 };
  globalThis.__refErrors = [];
  globalThis.__byId = null;
  let loadError = null;
  // A page that does not parse cannot be reference-checked, and used to be
  // reported as clean: the catch below filters on "is not defined", which a
  // SyntaxError message never matches. 0.95.3 shipped a backtick inside an HTML
  // comment inside a template literal — the string closed early, the whole
  // setup page died on "Loading...", and this suite passed.
  let syntaxError = null;
  try {
    // Memoized by id. getElementById used to mint a fresh stub per call, so
    // nothing a renderer wrote could be read back afterwards.
    const byId = new Map();
    const doc = {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubEl());
        return byId.get(id);
      },
      querySelector: () => stubEl(),
      querySelectorAll: () => [], createElement: () => stubEl(),
      body: stubEl(), head: stubEl(), addEventListener(){}, removeEventListener(){},
    };
    // eslint-disable-next-line no-new-func
    new Function(header + '\n' + js + '\n' + probe)(
      doc,
      { addEventListener(){}, removeEventListener(){}, open(){}, matchMedia: () => ({ matches: false, addEventListener(){} }) },
      { origin: '', hash: '#k', pathname: '/setup/AAAA', href: '' });
    globalThis.__byId = byId;
  } catch (e) {
    if (e instanceof SyntaxError) syntaxError = e.message;
    else if (/is not defined|before initialization/.test(e.message)) loadError = e.message;
  }
  check(`${page}: the inline script parses`, !syntaxError, syntaxError || 'parses');
  // --- every live player must get a row ------------------------------------
  //
  // Reported from JZAW: a player was live in the engine from clue 0, won clues
  // 12-16, and was never shown in the host console's ring. The engine record was
  // coherent throughout, so the defect is on the render side — the same family
  // as the vanished mechanics panel and the dock overlap: state right, screen
  // wrong, nothing thrown.
  //
  // The console builds the ring by iterating S.live and appending one node per
  // player, so the honest check is a count: give it eight and expect eight. A
  // filter or an early return that drops one is exactly what this catches.
  if (page === 'console.html' && globalThis.__byId) {
    // Re-render out of the lobby: the ring is only built once a match is live.
    try {
      globalThis.__seed.phase = 'live';
      globalThis.__rerender && globalThis.__rerender();
    } catch { /* the assertion below reports it */ }
    // Never silently skip: a check that quietly does not run is how the last
    // three of these got through.
    const ring = globalThis.__byId.get('ring');
    const wanted = (SEED.live || []).length;
    const got = ring ? ring.children.length : -1;
    check(`${page}: the ring renders a row for every live player`,
      wanted > 0 && got === wanted,
      ring ? `${got} rows for ${wanted} live` : 'the probe never touched #ring');
  }

  const errs = [loadError, ...(globalThis.__refErrors || [])].filter(Boolean);
  check(`${page}: every reference resolves when its renderers run`,
    errs.length === 0,
    errs.length ? errs[0] : `${painters.length} renderers exercised`);
}

// --- a function that is called but never defined --------------------------
//
// `lagHint()` was called from renderMech and defined nowhere, through several
// releases. It threw on every render, silently emptying the whole mechanics
// panel — top rope, targeting, bounties, the lag control, the watch link. The
// executing check above missed it because renderMech returns early in a stub
// DOM, so this reads the source instead, which is what the bug actually is.
for (const page of ['console.html', 'setup.html', 'buzzer.html', 'admin.html', 'watch.html', 'welcome.html', 'control.html']) {
  const html = readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
  const i = html.indexOf('<script type="module">');
  if (i < 0) continue;
  const raw = html.slice(i + 22, html.lastIndexOf('</script>'));

  // Strip comments and string literals before looking for calls. Without this
  // the scan trips over CSS inside template literals — var(), clamp(), min() —
  // and over ordinary prose in comments.
  const js = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  // Everything this script defines or brings in.
  const defined = new Set([
    ...[...raw.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...raw.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
    ...[...raw.matchAll(/import\s*\{([^}]*)\}/g)]
      .flatMap((m) => m[1].split(',').map((x) => x.split(/\s+as\s+/).pop().trim())),
    ...[...raw.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...raw.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)].map((m) => m[1]),
    // destructured locals and loop bindings
    ...[...raw.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)]
      .flatMap((m) => m[1].split(',').map((x) => x.split(':').pop().split('=')[0].trim())),
    ...[...raw.matchAll(/(?:for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)|catch\s*\(\s*([A-Za-z_$][\w$]*))/g)]
      .flatMap((m) => [m[1], m[2]]).filter(Boolean),
  ].filter(Boolean));

  const KNOWN = new Set(['fetch', 'setTimeout', 'setInterval', 'clearTimeout',
    'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'parseInt',
    'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date',
    'Promise', 'Map', 'Set', 'RegExp', 'Error', 'console', 'alert', 'confirm',
    'prompt', 'io', 'structuredClone', 'queueMicrotask', 'atob', 'btoa',
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
    'super', 'this', 'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else',
    // CSS functions that appear inside strings the stripper does not reach —
    // an inline style attribute built by concatenation, for instance.
    'var', 'calc', 'clamp', 'min', 'max', 'rgba', 'rgb', 'url', 'translate',
    'async', 'resolve', 'reject', 'require', 'addEventListener',
    'removeEventListener', 'matchMedia', 'getComputedStyle', 'URL',
    'AudioContext', 'Audio', 'Image', 'FileReader', 'Blob', 'FormData']);

  // Bare calls: `name(` not preceded by a dot, and not a declaration.
  const called = new Set([...js.matchAll(/(^|[^.\w$])([a-z_$][\w$]*)\s*\(/g)]
    .map((m) => m[2]));
  const missing = [...called].filter((n) => !defined.has(n) && !KNOWN.has(n));

  check(`${page}: every function it calls is defined`,
    missing.length === 0, missing.join(', ') || `${called.size} calls checked`);
}

// --- a read of an element that is never rendered ---------------------------
//
// The converse of the orphan-toggle check below, and the direction that
// actually bit: save() read g('longevity').checked for four toggles that were
// never rendered, so every "Save settings" click crashed — on the live site,
// for several releases. The orphan check only asked whether rendered toggles
// were read; nothing asked whether reads had anything to read.
for (const page of ['console.html', 'setup.html', 'buzzer.html', 'admin.html', 'watch.html', 'welcome.html', 'control.html']) {
  const src = readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
  const reads = [...new Set([...src.matchAll(/\bg\('([\w-]+)'\)/g)].map((m) => m[1]))];
  // Rendered ids come two ways: literal id="x" markup, and the page's little
  // component helpers — adv('x', num('x' — which interpolate the id.
  const made = new Set([...src.matchAll(/\b(?:adv|num|tog|sel)\('([\w-]+)'/g)].map((m) => m[1]));
  const missing = reads.filter((id) => !src.includes(`id="${id}"`) && !made.has(id));
  check(`${page}: everything g() reads is actually rendered`,
    missing.length === 0, missing.join(', ') || `${reads.length} reads`);
}

// --- a toggle that is never read back is decoration -----------------------
//
// Five settings shipped this way: the switch rendered, the host flipped it, and
// nothing happened, because the edit that added the render anchored on a line
// that did not match and the one adding the read never landed. The defaults
// happened to be sensible, so nobody noticed.
{
  const src = readFileSync(new URL('../public/setup.html', import.meta.url), 'utf8');
  const rendered = [...new Set([...src.matchAll(/adv\('(\w+)'/g)].map((m) => m[1]))];
  const read = new Set([...src.matchAll(/g\('(\w+)'\)\.checked/g)].map((m) => m[1]));
  const orphans = rendered.filter((id) => !read.has(id));
  check('setup.html: every toggle it renders is also read back',
    orphans.length === 0,
    orphans.length ? orphans.join(', ') : `${rendered.length} toggles`);

  // And every one of them has to be a real setting the engine knows about.
  const eng = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
  const block = eng.slice(eng.indexOf('DEFAULT_SETTINGS'), eng.indexOf('\n};', eng.indexOf('DEFAULT_SETTINGS')));
  const known = new Set([...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));
  const unknown = rendered.filter((id) => !known.has(id));
  check('and every one is a setting the engine has a default for',
    unknown.length === 0, unknown.join(', ') || 'all known');

  // --- the quick presets have to cover every mechanic ---------------------
  //
  // Quick mode picks a rule set; the rule set names every mechanic explicitly,
  // on or off. A mechanic added to the page but left out of the lists would be
  // whatever the last preset happened to leave it at — so choosing Tournament
  // would silently keep somebody's half-finished experiment switched on.
  const listed = new Set();
  for (const name of ['STANDARD_RULES', 'ADVANCED_RULES']) {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    for (const q of (m ? m[1] : '').matchAll(/'(\w+)'/g)) listed.add(q[1]);
  }
  const uncovered = rendered.filter((id) => !listed.has(id));
  check('setup.html: every mechanic is in a quick-setup rule set',
    uncovered.length === 0, uncovered.join(', ') || `${listed.size} covered`);

  const notASetting = [...listed].filter((id) => !known.has(id));
  check('and every rule the presets name is a real engine setting',
    notASetting.length === 0, notASetting.join(', ') || 'all known');

  // --- a preset must be able to recognise its own settings ----------------
  //
  // presetOf() is what the dropdown reads back, and it is derived rather than
  // remembered, so applying a preset and then asking which preset is active has
  // to give the same answer. It stopped doing that the moment 0.94.0 put
  // `targetBackfire` in these tables: the rules branch compared every value
  // with `!!s[id] === on`, which is false for 0 and 0.5 whatever the setting,
  // so no rule set could ever match. The preset still applied — the dropdown
  // just snapped back to Custom and looked like it refused to change.
  //
  // Run the page's own tables and comparison rather than a copy, so a value of
  // a new type added to a preset trips this instead of shipping.
  const presetSrc = src.slice(src.indexOf('const STANDARD_RULES'),
    src.indexOf('\n}', src.indexOf('function presetOf')) + 2);
  const S = { settings: {} };
  const { RULESETS, SPEEDS, presetOf } =
    new Function('S', presetSrc + '\nreturn { RULESETS, SPEEDS, presetOf };')(S);

  for (const [kind, table] of [['rules', RULESETS], ['speed', SPEEDS]]) {
    for (const [key, p] of Object.entries(table)) {
      S.settings = { ...p.set };
      const got = presetOf(kind);
      check(`setup.html: applying ${p.label} reads back as ${p.label}, not Custom`,
        got === key, got === '' ? 'Custom' : got);
    }
  }

  // And the readout stays honest in the other direction: change one value the
  // preset pins and it must stop claiming to be that preset.
  S.settings = { ...RULESETS.arcade.set, targetBackfire: 1 };
  check('setup.html: a changed setting reads back as Custom',
    presetOf('rules') === '', presetOf('rules'));
}

// --- nothing transient may sit on the host's controls ----------------------
//
// The entry banner blocked the host twice in one match. It is anchored at
// bottom:92px against a dock whose height is min-height:92px, and .race wraps,
// so as soon as several people buzz — every time, with robots in the field —
// the chip row runs to two lines, the dock grows, and the banner lands on top
// of Correct / Wrong / Nobody got it.
//
// First it ate the keyboard, through a `querySelector('.entry')` guard in the
// keydown handler. That was removed, and it went on eating the mouse, because
// it had z-index:60 and its own click-to-dismiss. Both times the console looked
// stopped and nothing threw.
//
// It decorates; it must never take input.
{
  const src = readFileSync(new URL('../public/console.html', import.meta.url), 'utf8');

  // Anchored to the start of a line: `.tosscap.entry{` contains `.entry{`, and
  // matching that instead reads a one-property colour rule and passes for the
  // wrong reason. (It did, while this check was being written.)
  const rule = (src.match(/^\.entry\{[\s\S]*?\}/m) || [''])[0];
  check('console.html: the entry banner cannot take a click',
    /pointer-events\s*:\s*none/.test(rule),
    rule ? rule.slice(0, 40) + '…' : 'no .entry rule at all');

  // --- and neither can anything else anchored near the dock ----------------
  //
  // The check above named one class, so the next overlay reintroduced the bug
  // in a different element: the YouTube entrance box sat at bottom:14px, 200 by
  // 113, straight over Correct / Wrong / Nobody, with no pointer-events:none.
  // The host pressed Correct for up to ten seconds and the console read as
  // frozen. That is three times an overlay has taken the host's controls.
  //
  // So the rule is now general: on the host's screens, a fixed overlay anchored
  // to the bottom must be click-through. Full-screen modals (inset:0) are
  // exempt — those are things the host is meant to click.
  {
    const themeCss = readFileSync(new URL('../public/theme-player.js', import.meta.url), 'utf8');
    const offenders = [];
    for (const [file, text] of [['console.html', src], ['theme-player.js', themeCss]]) {
      for (const m of text.matchAll(/(^|\n)\s*(\.[A-Za-z0-9_-]+)\{([^}]*position\s*:\s*fixed[^}]*)\}/g)) {
        const body = m[3].replace(/\s+/g, ' ');
        if (!/(^|;|\s)bottom\s*:/.test(body)) continue;   // not near the dock
        if (/inset\s*:\s*0/.test(body)) continue;          // a full-screen modal
        if (!/pointer-events\s*:\s*none/.test(body)) offenders.push(`${file} ${m[2]}`);
      }
    }
    check('and no bottom-anchored overlay on the console can take a click',
      offenders.length === 0, offenders.join(', ') || 'all click-through');
  }

  const banner = src.slice(src.indexOf('function banner('),
    src.indexOf('function banner(') + 1200);
  check('and banner() binds no click handler',
    !/\.onclick\s*=\s*kill/.test(banner), 'banner()');

  // Comments stripped first, or the note explaining the removed guard matches
  // the guard it is describing.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('and the keyboard handler does not bail while it is up',
    !/querySelector\(\s*'\.entry'\s*\)\s*\)\s*return/.test(code), 'keydown');
}

console.log(`\n${fails ? fails + ' FAILURES' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
