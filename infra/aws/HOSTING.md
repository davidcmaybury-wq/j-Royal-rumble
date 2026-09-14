<!-- David's record of the hosting as actually built, kept verbatim. This is
     the authority for how the live site runs — see infra/aws/README.md for why
     the CloudFormation design that used to live here was removed. -->

# J! Royal Rumble — AWS hosting setup (updated Aug 14, 2026)

## Live URLs
- **Game: https://j-royal-rumble.net** (also https://www.j-royal-rumble.net)
- CloudFront direct: https://d3ncvftlopqa7m.cloudfront.net (same thing)
- Direct to server (HTTP, no TLS): http://3.15.120.241:8080

## Architecture
Browser → CloudFront (HTTPS, websockets pass through, caching disabled) → Lightsail VM (Ohio) running the Node server.
Domain `j-royal-rumble.net` registered at **Cloudflare** (DNS only, no Cloudflare proxy) → CNAMEs to CloudFront.

## Resources (AWS account J-Royal-Rumble, 227214487186)
| Resource | Details |
|---|---|
| Lightsail instance | `j-royal-rumble`, Ubuntu 24.04, **1 GB RAM / 2 vCPU / 40 GB SSD, $7/mo**, us-east-2a + 1 GB swap file |
| Static IP | `j-royal-rumble-ip` = **3.15.120.241** (free while attached) |
| Firewall | TCP 22, 80, 8080 open |
| CloudFront | `E2ET7D15EAUXOY` → origin `3.15.120.241.nip.io:8080` (HTTP only), CachingDisabled + AllViewer policies, all HTTP methods, no WAF. Alternate domain names: j-royal-rumble.net, www.j-royal-rumble.net |
| ACM certificate | `471458ab-518f-4981-b2bc-62ef230fcbe0` (us-east-1), covers apex + www, DNS-validated, auto-renews via the Cloudflare CNAME records |
| S3 | (none — earlier static-site bucket deleted; app is a Node/Socket.IO server) |

## DNS (managed in Cloudflare, all records DNS-only / grey cloud)
| Type | Name | Target | Purpose |
|---|---|---|---|
| CNAME | `_ee49cb40b722714924168c4cdc26daa8` | `_e453537d9ad5368035b8baa9178331a2.jkddzztszm.acm-validations.aws.` | ACM cert validation (apex) — keep for auto-renewal |
| CNAME | `_f048ce144007f8a5781700fb916adac5.www` | `_d468d00330c9ca85ddbe9694c492a9cd.jkddzztszm.acm-validations.aws.` | ACM cert validation (www) — keep for auto-renewal |
| CNAME | `@` | `d3ncvftlopqa7m.cloudfront.net` | apex → CloudFront (Cloudflare flattens) |
| CNAME | `www` | `d3ncvftlopqa7m.cloudfront.net` | www → CloudFront |

Important: keep these records **DNS only** in Cloudflare. Turning on the orange-cloud proxy would put Cloudflare in front of CloudFront (double CDN, websocket/TLS complications).

## How the server runs
- App cloned to `/home/ubuntu/app` from https://github.com/davidcmaybury-wq/j-Royal-rumble
- systemd unit `rumble.service`: runs `node src/server.js` as user `ubuntu`, PORT=8080, NODE_ENV=production, auto-restart + starts on boot
- Match logs go to `/data/logs` (dir persists across deploys/reboots)
- `/when` availability goes to `/data/when.json`, same reason. `/data` is
  already created and owned by `ubuntu`; `/api/health` says `durable: true` when
  it is landing in the right place.
- Node 20 (nodesource), deps installed with `npm install --omit=dev`

## Secrets and environment
Everything the app needs beyond the code. **No value in this file, ever** — this
repo is public.

Where they live now: `/etc/systemd/system/rumble.service.d/override.conf`, as
inline `Environment=` lines. That file is `644 root:root`, i.e. **readable by
any local user on the box**. Fine-ish for two keys on a one-user machine, not
fine once a Discord bot token is in there. Move them to an `EnvironmentFile`:

```
sudo install -m 600 -o root -g root /dev/null /etc/rumble.env
sudo nano /etc/rumble.env          # KEY=value per line, no quotes, no export
sudo nano /etc/systemd/system/rumble.service.d/override.conf
#   [Service]
#   EnvironmentFile=/etc/rumble.env
#   (delete the inline Environment= lines for the same names)
sudo systemctl daemon-reload && sudo systemctl restart rumble
```

`600` means root only; systemd reads the file as root before dropping to
`ubuntu`. A restart ends live matches — do this when nobody is playing.

### The variables

| Variable | Needed for | If it is missing |
|---|---|---|
| `RUMBLE_ADMIN_KEY` | `/control`, downloading logs | **fails closed** — locks everyone out, including David. The server shouts at boot. |
| `RUMBLE_LOG_KEY` | `/api/logs` | fails closed. The admin key is a superset and also satisfies it. |
| `RUMBLE_DISCORD_CLIENT_ID` | `/when` sign-in | sign-in answers 503, page still collects nothing |
| `RUMBLE_DISCORD_CLIENT_SECRET` | `/when` sign-in | as above |
| `RUMBLE_DISCORD_BOT_TOKEN` | posting proposals | Send answers 502 naming the variable; the proposal is **not** marked sent |
| `RUMBLE_DISCORD_ALERT_CHANNEL` | where a found night is announced to David | no alert post |
| `RUMBLE_DISCORD_ROOM_CHANNEL` | where Send posts the invite | Send refuses |
| `RUMBLE_DISCORD_GUILD` | restricts sign-in to Rumble Discord members | optional; without it anyone with a Discord account can sign in |
| `RUMBLE_PUBLIC_URL` | the OAuth redirect URI behind CloudFront | sign-in breaks — see the gotcha below |
| `RUMBLE_SESSION_SECRET` | signs the `/when` session cookie | a new one per boot, so every deploy signs everybody out of `/when`. A boot note, not a refusal — it protects a list of free evenings, not the match records. |
| `ANTHROPIC_API_KEY` | robots' wrong answers | falls back to local nonsense; reported at `/api/health` |

The Discord application itself — the two channel ids, the redirect URI, what
the bot posts — is `docs/discord-setup.md`, about five minutes of clicking.

### Checking it took
```
curl -s localhost:8080/api/health | python3 -m json.tool | head -40
```
From the box (or with `?key=<admin key>` from anywhere) the body names what is
missing, per integration. `discord.missing` is the list to work through;
`availability.durable` must be `true`, meaning the store is `/data/when.json`
and not inside the app directory where the next deploy would take it.

## Deploying a new version
SSH in (Lightsail console → Connect), then:
```
cd /home/ubuntu/app && git pull && npm install --omit=dev && sudo systemctl restart rumble
```
Note: the app keeps live matches in memory — restarting kills in-progress games.

## Gotchas learned during setup
- **512 MB is not enough**: the clue library load peaks ~375 MB RSS; on the $5 Lightsail plan the OOM killer SIGKILLed node in a loop. 1 GB plan + 1 GB swap fixed it.
- CloudFront origins must be DNS names, not IPs — `3.15.120.241.nip.io` (wildcard DNS) points at the static IP. If the static IP ever changes, update the CloudFront origin hostname to `<new-ip>.nip.io`.
- Keep CloudFront cache policy = CachingDisabled (live game state must not be cached).
- The AWS account is on the Free Plan tier, which cannot register Route 53 domains — that's why the domain lives at Cloudflare.
- Latency-sensitive buzzer play also works direct via the IP URL if CloudFront ever adds noticeable lag.
- **Discord sign-in needs `RUMBLE_PUBLIC_URL` because of CloudFront.** OAuth demands the redirect URI sent to Discord match the one registered, byte for byte, and the request's own idea of its host is whatever the proxy forwarded — which is the origin hostname, not the domain. Set it to `https://j-royal-rumble.net` and register exactly `https://j-royal-rumble.net/auth/discord/callback`. A mismatch shows up as Discord refusing the sign-in, not as anything in our logs.
- **The unit's drop-in is world-readable at 644.** See Secrets and environment — with a bot token in play, use an `EnvironmentFile` at `600` instead of more inline `Environment=` lines.

## Monthly cost
~$7 (Lightsail 1 GB) + ~$11/yr domain at Cloudflare. CloudFront/data transfer ≈ $0 at friends-scale. No WAF.
