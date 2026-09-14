// Discord: who somebody is, and how the room hears about a game night.
//
// Two halves that share nothing but a service:
//
//   - OAuth2, so a player proves they are a particular Discord account without
//     this site ever holding a password or an email address. The account id is
//     the identity for availability, which is also what makes a ping possible
//     later: `<@id>` reaches them, and we never learn anything else about them.
//   - The bot, over plain REST. There is no gateway connection and no library:
//     everything here is posting a message to a channel, which is one fetch.
//     A websocket to Discord would be a second long-lived connection in a
//     process whose whole job is a different long-lived connection, held open
//     for events we do not read.
//
// EVERYTHING FAILS CLOSED. Unconfigured means refusing and saying which
// variable is missing, never a silent no-op — an invite nobody received and an
// invite never sent look identical from here, and the first one is the kind of
// bug that goes a month without being noticed.
//
//   RUMBLE_DISCORD_CLIENT_ID       application id      (sign-in)
//   RUMBLE_DISCORD_CLIENT_SECRET   application secret  (sign-in)
//   RUMBLE_DISCORD_BOT_TOKEN       bot token           (posting)
//   RUMBLE_DISCORD_ALERT_CHANNEL   where proposals go  — David's channel
//   RUMBLE_DISCORD_ROOM_CHANNEL    where invites go    — the players' channel
//   RUMBLE_DISCORD_GUILD           optional: only members of this server
//   RUMBLE_PUBLIC_URL              https://j-royal-rumble.net, for redirects
//   RUMBLE_SESSION_SECRET          signs the session cookie

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

const API = 'https://discord.com/api/v10';
const env = (k) => (process.env[k] || '').trim();

export function config() {
  return {
    clientId: env('RUMBLE_DISCORD_CLIENT_ID'),
    clientSecret: env('RUMBLE_DISCORD_CLIENT_SECRET'),
    botToken: env('RUMBLE_DISCORD_BOT_TOKEN'),
    alertChannel: env('RUMBLE_DISCORD_ALERT_CHANNEL'),
    roomChannel: env('RUMBLE_DISCORD_ROOM_CHANNEL'),
    guild: env('RUMBLE_DISCORD_GUILD'),
    publicUrl: env('RUMBLE_PUBLIC_URL'),
  };
}

/** What is wired up, for /api/health and the control room. */
export function status() {
  const c = config();
  return {
    signIn: !!(c.clientId && c.clientSecret),
    bot: !!c.botToken,
    alertChannel: !!c.alertChannel,
    roomChannel: !!c.roomChannel,
    guildGate: !!c.guild,
    missing: [
      !c.clientId && 'RUMBLE_DISCORD_CLIENT_ID',
      !c.clientSecret && 'RUMBLE_DISCORD_CLIENT_SECRET',
      !c.botToken && 'RUMBLE_DISCORD_BOT_TOKEN',
      !c.alertChannel && 'RUMBLE_DISCORD_ALERT_CHANNEL',
      !c.roomChannel && 'RUMBLE_DISCORD_ROOM_CHANNEL',
    ].filter(Boolean),
  };
}

export const signInReady = () => status().signIn;

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

/**
 * Where the browser goes to sign in.
 *
 * `identify` only. Not `email`, which we would have to store and would then be
 * a second way to reach people that nothing here uses; not `guilds`, which
 * hands over the list of every server they are in to answer a question about
 * one. Membership, where it is checked at all, is asked of the bot instead.
 */
export function authUrl(state, redirectUri) {
  const c = config();
  if (!c.clientId) throw new Error('RUMBLE_DISCORD_CLIENT_ID is not set');
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `${API}/oauth2/authorize?${q}`;
}

async function ask(url, init, what) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  if (!r.ok) {
    // Discord's body says what is actually wrong — a bad redirect URI, a bot
    // that is not in the server, a channel id that is a category. Carrying it
    // through is the difference between a fixable error and "500".
    throw new Error(`${what} failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function exchange(code, redirectUri) {
  const c = config();
  if (!c.clientId || !c.clientSecret) throw new Error('Discord sign-in is not configured');
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return ask(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }, 'Discord token exchange');
}

export async function me(accessToken) {
  const u = await ask(`${API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  }, 'Discord user lookup');
  return {
    id: u.id,
    // `global_name` is the display name people actually go by since Discord
    // retired discriminators; `username` is the handle and the fallback.
    name: u.global_name || u.username,
    avatar: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
      : null,
  };
}

/**
 * Is this account in the Rumble server?
 *
 * Optional, and it fails OPEN on anything that is not a clean 404: a Discord
 * outage or a missing permission should not lock the room out of a scheduling
 * page. A gate that turns into a wall when the service it depends on wobbles is
 * worse than no gate for something this low-stakes.
 */
export async function inGuild(userId) {
  const c = config();
  if (!c.guild || !c.botToken) return true;
  try {
    const r = await fetch(`${API}/guilds/${c.guild}/members/${userId}`, {
      headers: { authorization: `Bot ${c.botToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404) return false;
    return true;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export async function postTo(channelId, content, { mentions = [] } = {}) {
  const c = config();
  if (!c.botToken) throw new Error('RUMBLE_DISCORD_BOT_TOKEN is not set');
  if (!channelId) throw new Error('no channel id for that message');
  return ask(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${c.botToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      content,
      // Ping the named players and nobody else. Without this an @everyone typed
      // by accident into a message this server composes would actually fire.
      allowed_mentions: { parse: [], users: mentions.slice(0, 100) },
    }),
  }, 'Discord message');
}

export const alert = (content, opts) => postTo(config().alertChannel, content, opts);
export const announce = (content, opts) => postTo(config().roomChannel, content, opts);

// ---------------------------------------------------------------------------
// The session cookie
//
// A signed value, not a stored session: there is nothing to keep server-side,
// and a restart — which happens on every deploy — does not sign everybody out.
// The payload is the Discord id and display name, which is exactly what the
// availability page needs and nothing more.
// ---------------------------------------------------------------------------

export const COOKIE = 'rumble_when';
const DAYS_90 = 90 * 86400 * 1000;

// A secret that is generated rather than set means sessions die at the next
// restart. That is a nuisance rather than a hazard, so it is a warning at boot
// and not a refusal — unlike the admin key, this guard protects somebody's own
// list of free evenings, not the match records.
let secret = env('RUMBLE_SESSION_SECRET');
export function sessionSecretSet() { return !!env('RUMBLE_SESSION_SECRET'); }
if (!secret) secret = randomBytes(32).toString('hex');

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const mac = (s) => createHmac('sha256', secret).update(s).digest('base64url');

export function mintSession(user) {
  const body = b64(JSON.stringify({ ...user, iat: Date.now() }));
  return `${body}.${mac(body)}`;
}

export function readSession(value) {
  if (typeof value !== 'string' || !value.includes('.')) return null;
  const [body, sig] = value.split('.');
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig || '');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const u = JSON.parse(unb64(body));
    if (!u.id || Date.now() - (u.iat || 0) > DAYS_90) return null;
    return u;
  } catch { return null; }
}

/** express does not parse cookies and this is the only one we read. */
export function cookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const newState = () => randomBytes(12).toString('base64url');
