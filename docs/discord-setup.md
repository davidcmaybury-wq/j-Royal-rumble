# The Discord side of `/when`

Everything on this page is done once, in Discord's own developer portal and in
the server's environment. Until it is, `/when` still works for collecting
answers and drawing the heat map — sign-in and posting are the parts that
refuse, and each one says which variable it is missing rather than doing
nothing quietly.

## 1. Make the application

<https://discord.com/developers/applications> → **New Application**. Call it
whatever the bot should be called in the channel; that name is what players see.

From **OAuth2 → General**, copy:

- **Client ID** → `RUMBLE_DISCORD_CLIENT_ID`
- **Client Secret** (Reset Secret to see one) → `RUMBLE_DISCORD_CLIENT_SECRET`

Still on that page, add a **redirect URI**, exactly:

```
https://j-royal-rumble.net/auth/discord/callback
```

It has to match character for character — scheme, host, path, no trailing
slash. A mismatch is Discord's most common refusal and it names the URI in the
error, which the callback page passes through rather than swallowing.

The only scope the site ever asks for is `identify`. Not `email`, which would
have to be stored and which nothing here uses; not `guilds`, which hands over
every server somebody is in to answer a question about one.

## 2. Make the bot

**Bot** → **Add Bot**, then **Reset Token** and copy it:

- **Bot Token** → `RUMBLE_DISCORD_BOT_TOKEN`

No privileged intents are needed. The site never opens a gateway connection —
posting a message is one HTTPS call, and a second long-lived socket in a process
whose whole job is the first one would be held open for events nobody reads.

## 3. Invite the bot to the server

**OAuth2 → URL Generator**: tick **bot**, then under bot permissions tick
**Send Messages** (and **Mention Everyone** only if the ping should be able to
reach a role). Open the generated URL and add it to the Rumble server.

## 4. Find the two channel ids

In Discord: **Settings → Advanced → Developer Mode** on, then right-click a
channel → **Copy Channel ID**.

- The channel where proposals should land — yours, not the room's →
  `RUMBLE_DISCORD_ALERT_CHANNEL`
- The channel the invite goes to when you press Send →
  `RUMBLE_DISCORD_ROOM_CHANNEL`

They can be the same channel. They should not be.

Optionally, right-click the server → **Copy Server ID** →
`RUMBLE_DISCORD_GUILD`. Setting it means only members of that server can save
availability. The check fails *open* on anything that is not a clean 404: a
Discord outage should not lock the room out of a scheduling page.

## 5. Set them on the box

```
RUMBLE_DISCORD_CLIENT_ID=...
RUMBLE_DISCORD_CLIENT_SECRET=...
RUMBLE_DISCORD_BOT_TOKEN=...
RUMBLE_DISCORD_ALERT_CHANNEL=...
RUMBLE_DISCORD_ROOM_CHANNEL=...
RUMBLE_DISCORD_GUILD=...            # optional
RUMBLE_PUBLIC_URL=https://j-royal-rumble.net
RUMBLE_SESSION_SECRET=<32 random characters>
```

`RUMBLE_PUBLIC_URL` matters behind CloudFront: the redirect URI has to match
what is registered above, and the request's own idea of its host is whatever the
proxy forwarded. `RUMBLE_SESSION_SECRET` signs the session cookie — leave it
unset and one is generated per boot, which works and signs everybody out of
`/when` on every deploy.

They go where the other two keys go; `infra/aws/HOSTING.md` is the record of how
the service environment is set on this box.

## 6. Check it

`/api/health`, from the box or with the admin key, reports both halves:

```json
"discord": { "signIn": true, "bot": true, "alertChannel": true,
             "roomChannel": true, "guildGate": false, "missing": [] }
```

The control room's **Game nights** panel says the same thing in words, and
refuses to show a Send button it knows cannot work.

## What the bot actually posts

Two messages, both composed by the server, neither of them automatic in the way
that matters:

**To your channel**, when a window clears the threshold — nobody else sees it,
and it contains no ping:

> **11 people can play Thursday, 24 September 7:00 PM** — through 9:30 PM.
> Nobody has been told. Send it from the control room: https://j-royal-rumble.net/control

**To the room**, only when you press Send in the control room, twice:

> **Game night — Thursday, 24 September 7:00 PM** (in 2 days)
> 11 people marked themselves free through 9:30 PM.
> @alex @priya @sam …
> Can't make it, or want in? Update your availability: https://j-royal-rumble.net/when

Times go out as Discord's `<t:…>` timestamps, which each reader sees in their
own local time — the only honest way to name an hour in a message several
timezones will read.

`allowed_mentions` names exactly the players in the window and nothing else, so
an `@everyone` that found its way into composed text could not fire.

**To the room, once per version** (since 0.103.0): the note for the version the
box is running, from `docs/release-notes.md`, the first time that version boots
with the bot configured — and never again, because what has gone out is
recorded in `/data/notes-posted.json`. No ping, one message, under Discord's
2,000-character cap or it is refused before it is sent:

> **J! Royal Rumble 0.102.0 — The last one in gets a breath, and the robots learned from you**
> Overtime now waits one entry interval after the last arrival …
> <https://j-royal-rumble.net/history>

Versions the room never heard about go out as one digest, titles only, by hand:

```
cd /home/ubuntu/app && sudo bash -c 'set -a; . /etc/rumble.env; set +a; node tools/post-notes.mjs --dry-run'
cd /home/ubuntu/app && sudo bash -c 'set -a; . /etc/rumble.env; set +a; node tools/post-notes.mjs --catch-up'
```

`--since 0.97.0` trims off versions the room was told about by hand;
`--mark-posted 0.97.0,0.98.0` records without posting. `RUMBLE_NOTES=off` in
the env file switches the boot post off entirely. A release whose version has
no section in the notes file fails `test/notes.mjs`, which is the point: a
version with nothing to tell the room is a version nobody wrote up.
