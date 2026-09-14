// Availability: when this room can actually play.
//
// The scheduling half of the site. Players sign in with Discord and paint the
// half hours they are free; the server keeps the pattern in their own local
// time (see src/when.js for why that is not negotiable), aggregates it into a
// heat map, and watches for a window the same eight-or-more people can all
// make from start to finish.
//
// It proposes; it does not announce. A window that clears the threshold goes to
// David's channel with a link to the control room, and the invite reaches the
// players only when he presses Send. An automatic ping is a message about a
// game nobody has decided to host, and one of those is all it takes for the
// room to mute the bot.
//
// Its own file rather than another thousand lines of server.js, and mounted
// rather than importing the server, so it borrows the two guards that already
// exist — `localReq` and `adminOk` — instead of growing a third copy of either.
// More than one fail-open default in this repo started life as a second copy of
// a check that was correct in the original.

import { join } from 'path';
import * as when from './when.js';
import * as discord from './discord.js';

export { when, discord };

export function mountAvailability(app, { dir: __dir, localReq, adminOk }) {

app.get('/when', (_req, res) => res.sendFile(join(__dir, '../public/when.html')));

// Where Discord sends the browser back to. Derived from the request rather than
// hardcoded, so the same build works on localhost, on the spare box and behind
// CloudFront — but RUMBLE_PUBLIC_URL wins when it is set, because the redirect
// URI has to match the one registered in the Discord application exactly, down
// to the scheme, and behind a proxy the request's own idea of its host is
// whatever the proxy forwarded.
function redirectUri(req) {
  const base = discord.config().publicUrl
    || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
  return base.replace(/\/+$/, '') + '/auth/discord/callback';
}

const secureCookie = (req) =>
  (req.get('x-forwarded-proto') || req.protocol) === 'https';

function setSession(req, res, user) {
  res.cookie(discord.COOKIE, discord.mintSession(user), {
    httpOnly: true, sameSite: 'lax', secure: secureCookie(req),
    maxAge: 90 * 86400 * 1000, path: '/',
  });
}

const sessionOf = (req) => discord.readSession(discord.cookie(req, discord.COOKIE));

// The state parameter, in its own short-lived cookie. Without it a link from
// anywhere could hand this site an authorization code and sign somebody's
// browser in as an account they do not own.
const STATE_COOKIE = 'rumble_when_state';

app.get('/auth/discord', (req, res) => {
  if (!discord.signInReady()) {
    return res.status(503).type('text/plain')
      .send('Discord sign-in is not configured on this server.');
  }
  const state = discord.newState();
  // Same-site only, and "starts with a slash" is not the same test. `//evil.com`
  // and `/\evil.com` both start with one and both are protocol-relative: the
  // browser reads them as another origin, so a sign-in link on our own domain
  // would have delivered the player somewhere else after Discord let them in.
  // That is the shape phishing wants, because the link people are asked to
  // trust is genuinely ours.
  const wanted = typeof req.query.next === 'string' ? req.query.next : '';
  // Strip first, then judge. Browsers delete tab, CR and LF from a URL before
  // they parse it, so `/<tab>/evil.example` is read as `//evil.example` — a
  // check run against the raw string sees a harmless same-site path and a
  // browser sees another origin. Normalise to what the browser will actually
  // see, and only then insist on a single leading slash.
  const clean = wanted.replace(/[\u0000-\u001F\u007F]/g, '');
  const next = /^\/(?![/\\])/.test(clean) ? clean : '/when';
  res.cookie(STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true, sameSite: 'lax', secure: secureCookie(req),
    maxAge: 10 * 60 * 1000, path: '/',
  });
  res.redirect(discord.authUrl(state, redirectUri(req)));
});

app.get('/auth/discord/callback', async (req, res) => {
  const raw = discord.cookie(req, STATE_COOKIE) || '';
  const [want, next = '/when'] = raw.split('|');
  res.clearCookie(STATE_COOKIE, { path: '/' });
  if (!want || req.query.state !== want) {
    return res.status(400).type('text/plain').send('That sign-in did not come from here. Try again from /when.');
  }
  if (!req.query.code) {
    // The player pressed Cancel on Discord's own screen. Not an error.
    return res.redirect('/when');
  }
  try {
    const tok = await discord.exchange(String(req.query.code), redirectUri(req));
    const user = await discord.me(tok.access_token);
    if (!(await discord.inGuild(user.id))) {
      return res.status(403).type('text/plain')
        .send('This is for players in the Rumble Discord. Ask David for an invite.');
    }
    setSession(req, res, user);
    res.redirect(next);
  } catch (e) {
    console.warn('discord sign-in failed:', e.message);
    res.status(502).type('text/plain').send('Discord would not complete the sign-in: ' + e.message);
  }
});

app.post('/api/when/signout', (req, res) => {
  res.clearCookie(discord.COOKIE, { path: '/' });
  res.json({ ok: true });
});

// A way in without Discord, for the test suite and for a sandbox with no
// application registered. Refused unless the request is from this machine AND
// the variable is set — two conditions, because a dev door that only checks one
// of them is how a fail-open default gets shipped twice in the same repo.
app.get('/api/when/dev-login', (req, res) => {
  if (!process.env.RUMBLE_WHEN_DEV_LOGIN || !localReq(req)) {
    return res.status(403).json({ error: 'no' });
  }
  const id = String(req.query.id || 'dev1');
  setSession(req, res, { id, name: String(req.query.name || 'Dev ' + id), avatar: null });
  res.json({ ok: true, id });
});

app.get('/api/when/me', (req, res) => {
  const u = sessionOf(req);
  res.json({
    signedIn: !!u,
    discord: discord.status(),
    user: u ? { id: u.id, name: u.name, avatar: u.avatar } : null,
    me: u ? when.get(u.id) : null,
    settings: when.settings(),
    storage: when.status(),
  });
});

app.post('/api/when/me', (req, res) => {
  const u = sessionOf(req);
  if (!u) return res.status(401).json({ error: 'sign in first' });
  const b = req.body || {};
  if (b.tz && !when.knownZone(b.tz)) return res.status(400).json({ error: 'unknown timezone' });
  const saved = when.save(u.id, {
    name: u.name, avatar: u.avatar, tz: b.tz,
    weekly: b.weekly, dates: b.dates,
  });
  res.json({ ok: true, me: saved });
});

app.delete('/api/when/me', (req, res) => {
  const u = sessionOf(req);
  if (!u) return res.status(401).json({ error: 'sign in first' });
  res.json({ ok: when.remove(u.id) });
});

// The heat map. Counts are public — the question "is anybody around on a
// Tuesday" is not worth a sign-in — but WHO is free is only shown to somebody
// who has answered themselves. A public page listing named people's free
// evenings is a different object than a scheduling tool for a group.
app.get('/api/when/heat', (req, res) => {
  const u = sessionOf(req);
  const h = when.heat();
  const w = when.windows(h);
  const strip = (ids) => (u ? ids.map((id) => ({ id, name: h.names[id] || 'Someone' })) : []);
  res.json({
    from: h.from, to: h.to, players: h.players, slotMs: when.SLOT,
    named: !!u,
    slots: h.slots.map((s) => ({ t: s.t, n: s.n, who: strip(s.ids) })),
    windows: w.slice(0, 12).map((x) => ({
      start: x.start, end: x.end, n: x.n, who: strip(x.ids),
    })),
    settings: when.settings(),
  });
});

// --- the control room's half ------------------------------------------------

app.get('/api/when/proposals', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const h = when.heat();
  const names = h.names;
  const dress = (p) => ({ ...p, who: (p.ids || []).map((id) => names[id] || 'Someone') });
  res.json({
    proposals: when.proposals().filter((p) => p.end > Date.now() - 86400000).map(dress),
    best: when.windows(h).slice(0, 8).map((w) => ({
      ...w, who: w.ids.map((id) => names[id] || 'Someone'),
    })),
    settings: when.settings(),
    discord: discord.status(),
    storage: when.status(),
    players: when.players().map((p) => ({
      id: p.id, name: p.name, tz: p.tz, updatedAt: p.updatedAt,
      hours: Object.values(p.weekly || {}).flat()
        .reduce((n, r) => n + (r[1] - r[0]) / 60, 0),
    })),
  });
});

app.post('/api/when/settings', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  res.json({ settings: when.setSettings(req.body || {}) });
});

// Look now rather than at the next tick. Useful right after changing the
// threshold, when waiting half an hour to see what it did is the difference
// between tuning it and guessing.
app.post('/api/when/scan', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const found = await scanForGameNights({ quiet: req.body?.quiet !== false });
  res.json({ found: found.length, proposals: found });
});

app.post('/api/when/proposals/:key/dismiss', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const p = when.update(req.params.key, { dismissed: true });
  if (!p) return res.status(404).json({ error: 'no such proposal' });
  res.json({ ok: true, proposal: p });
});

app.post('/api/when/proposals/:key/send', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'bad admin key' });
  const p = when.proposal(req.params.key);
  if (!p) return res.status(404).json({ error: 'no such proposal' });
  if (p.sent) return res.status(409).json({ error: 'already sent', at: p.sent });
  try {
    await discord.announce(inviteText(p, req.body?.note), { mentions: p.ids });
    res.json({ ok: true, proposal: when.update(p.key, { sent: new Date().toISOString() }) });
  } catch (e) {
    // The failure has to reach the person who pressed the button. A Send that
    // reports success and posts nothing is the exact shape of the silent
    // failures this codebase keeps finding.
    res.status(502).json({ error: e.message });
  }
});

// --- the scan ---------------------------------------------------------------

// Discord renders <t:seconds:F> in each reader's own local time, which is the
// only honest way to name a time in a message several timezones will read.
const stamp = (ms, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function inviteText(p, note) {
  const n = (p.ids || []).length;
  return [
    `**Game night — ${stamp(p.start)}** (${stamp(p.start, 'R')})`,
    `${n} ${n === 1 ? 'person' : 'people'} marked themselves free through ${stamp(p.end, 't')}.`,
    note ? String(note).slice(0, 400) : '',
    (p.ids || []).map((id) => `<@${id}>`).join(' '),
    'Can\'t make it, or want in? Update your availability: '
      + (discord.config().publicUrl || 'https://j-royal-rumble.net') + '/when',
  ].filter(Boolean).join('\n');
}

function proposalText(p) {
  const url = discord.config().publicUrl || 'https://j-royal-rumble.net';
  return [
    `**${p.n} people can play ${stamp(p.start)}** — through ${stamp(p.end, 't')}.`,
    `Nobody has been told. Send it from the control room: ${url}/control`,
  ].join('\n');
}

/**
 * Find game nights and tell David about them.
 *
 * Recorded before it is posted, and recorded either way. A proposal that failed
 * to post is still a proposal — re-finding it every half hour and failing to
 * post it every half hour would be an unbounded retry loop against somebody
 * else's rate limiter.
 */
async function scanForGameNights({ quiet = false } = {}) {
  when.sweep();
  const found = when.scan();
  const out = [];
  for (const w of found.slice(0, 2)) {   // at most two new ones per pass
    const rec = when.record(w);
    out.push(rec);
    if (quiet || !discord.status().bot || !discord.status().alertChannel) continue;
    try {
      await discord.alert(proposalText(rec));
      when.update(rec.key, { posted: true });
    } catch (e) {
      console.warn('could not post a game-night proposal:', e.message);
      when.update(rec.key, { postError: e.message });
    }
  }
  return out;
}

const WHEN_SCAN_MS = Math.max(5, Number(process.env.RUMBLE_WHEN_SCAN_MINUTES) || 30) * 60000;
// Not at boot. Deploys are frequent and a scan on every restart would turn a
// busy afternoon into a run of notices about the same Thursday.
setTimeout(() => {
  scanForGameNights().catch((e) => console.warn('game-night scan:', e.message));
  setInterval(() => scanForGameNights().catch((e) => console.warn('game-night scan:', e.message)),
    WHEN_SCAN_MS).unref?.();
}, 2 * 60000).unref?.();

}
