// The report button, shared by the buzzer, the host console and the watch
// screen.
//
// Somebody who has just hit a bug is on one of those three, not the front page
// — and a report written five minutes later has lost the room code and what
// actually happened. So the context is gathered here rather than asked for:
// which screen, which room, which clue, which version, who they are.

const CSS = `
.rbtn{position:fixed;right:12px;bottom:12px;z-index:40;padding:7px 12px;
border:1px solid var(--line);border-radius:var(--r,5px);background:#131A30E6;
color:var(--slate);font:inherit;font-size:12.5px;cursor:pointer}
.rbtn:hover{border-color:var(--brass);color:var(--brass)}
.rsheet{position:fixed;inset:0;background:#050810CC;z-index:95;display:grid;
place-items:center;padding:16px}
.rbox{background:var(--panel);border:1px solid var(--line);border-radius:var(--r,5px);
padding:20px;max-width:440px;width:100%}
.rbox h3{font-size:16px;font-weight:500;margin:0 0 4px}
.rbox p{font-size:12.5px;color:var(--slate);line-height:1.5;margin:0 0 12px}
.rkind{display:flex;gap:8px;margin-bottom:12px}
.rkind button{flex:1;padding:9px;border:1px solid var(--line);border-radius:var(--r,5px);
background:none;color:var(--slate);cursor:pointer;font:inherit;font-size:13.5px}
.rkind button.on{border-color:var(--brass);color:var(--brass);background:#241B08}
.rbox textarea{width:100%;min-height:110px;padding:11px;background:var(--ink);
color:var(--chalk);border:1px solid var(--line);border-radius:var(--r,5px);
font:inherit;font-size:14px;resize:vertical}
.rbox textarea:focus{outline:none;border-color:var(--brass)}
.rwith{font-size:11.5px;color:#3C486E;margin-top:8px;line-height:1.5}
.rbtns{display:flex;gap:8px;margin-top:16px}
.rbtns button{flex:1;padding:11px;border:1px solid var(--line);border-radius:var(--r,5px);
background:none;color:var(--slate);cursor:pointer;font:inherit}
.rbtns .prim{background:var(--brass);color:var(--ink);border-color:var(--brass);font-weight:500}
.rerr{color:var(--alarm);font-size:12.5px;min-height:1.2em;margin-top:8px}
`;

/**
 * Add the button.
 *
 * `getContext` is a function rather than a value because the interesting facts
 * — which clue, what phase — change while the page is open, and a snapshot
 * taken at load time would describe the wrong moment.
 */
export function mountReportButton(screen, getContext, opts = {}) {
  if (document.getElementById('rbtn')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const b = document.createElement('button');
  b.id = 'rbtn'; b.className = 'rbtn'; b.type = 'button';
  // Where it sits is the caller's call. Bottom-right is fine on a watch screen
  // and wrong on the host console, where it landed on top of Arm buzzers — the
  // single most-pressed control in the game.
  if (opts.place) b.style.cssText = opts.place;
  b.textContent = opts.label || 'Report a problem';
  b.onclick = () => open(screen, getContext);
  document.body.appendChild(b);
}

function open(screen, getContext) {
  let kind = 'bug';
  const ctx = { screen, userAgent: navigator.userAgent, ...(getContext() || {}) };
  const el = document.createElement('div');
  el.className = 'rsheet';
  el.innerHTML = `<div class="rbox">
    <h3>Tell us what happened</h3>
    <p>Goes straight to the people who built this. No account, no sign-in.</p>
    <div class="rkind">
      <button data-k="bug" class="on">Something went wrong</button>
      <button data-k="idea">I wish it did this</button>
    </div>
    <textarea id="rtext" maxlength="2000"
      placeholder="What were you doing, and what happened?"></textarea>
    <div class="rwith">Sent with this: ${[
      ctx.gameId ? `room ${ctx.gameId}` : null,
      screen,
      ctx.clue != null ? `clue ${ctx.clue}` : null,
      ctx.name ? ctx.name : null,
      ctx.version ? `v${ctx.version}` : null,
    ].filter(Boolean).join(' &middot; ')}</div>
    <div class="rerr" id="rerr"></div>
    <div class="rbtns">
      <button id="rcancel">Never mind</button>
      <button id="rsend" class="prim">Send it</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  el.onclick = (e) => { if (e.target === el) el.remove(); };

  for (const k of el.querySelectorAll('[data-k]')) {
    k.onclick = () => {
      kind = k.dataset.k;
      el.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === k));
    };
  }
  el.querySelector('#rcancel').onclick = () => el.remove();
  el.querySelector('#rsend').onclick = async () => {
    const text = el.querySelector('#rtext').value.trim();
    const err = el.querySelector('#rerr');
    if (!text) { err.textContent = 'Say what happened first.'; return; }
    el.querySelector('#rsend').disabled = true;
    try {
      const r = await fetch('/api/report', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, text, context: { ...ctx, ...(getContext() || {}) } }),
      });
      const j = await r.json();
      if (j.error) { err.textContent = j.error; el.querySelector('#rsend').disabled = false; return; }
      el.querySelector('.rbox').innerHTML =
        '<h3>Thank you</h3><p>That is saved. It will be read.</p>';
      setTimeout(() => el.remove(), 1600);
    } catch {
      err.textContent = 'Could not reach the server. Try again in a moment.';
      el.querySelector('#rsend').disabled = false;
    }
  };
  el.querySelector('#rtext').focus();
}
