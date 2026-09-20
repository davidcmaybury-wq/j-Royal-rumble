# For the dev chat: give the box a judge key, properly

*From the design chat, 2026-09-20. David hit this trying to start a match; the work is yours because it is the box and a secret, not code.*

## What happened

David set up an autohost match, pressed Start, and got:

> The computer cannot host: no ANTHROPIC_API_KEY set, so it cannot rule on answers

That refusal is correct and should stay. An autohost match has nobody at a console, so a match with no judge is a match that cannot be played, and failing at the start button naming the variable is better than failing at clue one in front of the room. What was wrong with it is that it named one of two ways out. I have already fixed the wording (below); what I cannot do from here is put a key on the box.

## What I want you to do

**1. Get a key that is this app's and nothing else's.** In the Anthropic Console, a key in its own workspace with a spend limit on it. Not David's personal key, not one shared with anything else — this one lives in a file on a box, and the whole point of it being its own key is that rotating it is a two-minute job that breaks nothing else.

**2. Put it in an `EnvironmentFile`, and move the others while you are there.** `infra/aws/HOSTING.md` has said since the box was built that the inline `Environment=` lines in `/etc/systemd/system/rumble.service.d/override.conf` are `644 root:root` — readable by any local user — and that this is "fine-ish for two keys on a one-user machine, not fine once a Discord bot token is in there." A key that bills money is the same class of thing. So this is the occasion:

```
sudo install -m 600 -o root -g root /dev/null /etc/rumble.env
sudo nano /etc/rumble.env          # KEY=value per line, no quotes, no export
sudo nano /etc/systemd/system/rumble.service.d/override.conf
#   [Service]
#   EnvironmentFile=/etc/rumble.env
#   (delete the inline Environment= lines for the same names)
sudo systemctl daemon-reload
```

The recipe is already in HOSTING.md under *Secrets and environment*; I have not changed it. Move `RUMBLE_ADMIN_KEY`, `RUMBLE_LOG_KEY` and anything else inline at the same time, so there is one place secrets live rather than two.

**3. Do NOT also set `RUMBLE_JUDGE=local` on the box.** This is the one trap. `RUMBLE_JUDGE=local` is not a fallback that the key overrides — it is a mode that *disables* the key:

```js
const LOCAL_ONLY = process.env.RUMBLE_JUDGE === 'local';
const KEY = LOCAL_ONLY ? null : process.env.ANTHROPIC_API_KEY;
```

Both set means the local judge runs and the key is never read, and nothing will look broken: matches start, the host rules, and every answer that is not word-for-word correct comes back "I could not rule on that one." If you want belt and braces, the braces are a health check, not a second variable.

**4. Restart when nobody is playing.** A restart ends every match in memory. `bash /home/ubuntu/app/tools/deploy-remote.sh --wait` holds until the box is clear; a bare `systemctl restart rumble` does not. Morning, per the house rule.

**5. Verify it from the box itself**, because the public `/api/health` is thin on purpose:

```bash
curl -s localhost:8080/api/health | python3 -m json.tool | grep -A 8 '"judge"'
```

What you want to see is `"configured": true` and `"mode": "model"`. `"mode": "local (on purpose)"` means step 3 caught you. `"mode": "local (no key)"` means the file is not being read — check `systemctl show rumble -p Environment` and that `daemon-reload` ran.

Then play one clue with it. The honest test is a wrong answer, not a right one: a right answer is settled by a fast path with no model call at all, so a key that does not work still looks fine on a correct answer and only fails when somebody misses.

**6. Say how a local dev run gets the key.** `.env` is in `.gitignore` but nothing reads it — there is no `dotenv` in the dependencies and I would rather not add one. Node 20 can do this itself: `node --env-file=.env src/server.js`. If you like that, the `dev` and `start` scripts are yours to change and it needs a `.env.example` listing the names with no values. If you would rather people export in their shell, say so in `HOSTING.md` and I will stop wondering. Either way David should be able to run a full autohost match locally without editing a file that git can see.

## What not to do

**Do not put the key in CI.** `deploy.yml` runs the socket suite with `RUMBLE_JUDGE=local` deliberately: the suites pin the deterministic ladder and the refusals, not the model's judgment, and a GitHub secret spending money on every push is a cost with no test behind it. If a suite ever needs a real ruling it should skip without one, the way `test/judge.mjs` already skips its local-judge block when a key is present.

**Do not relax the start-button refusal** into a warning. There is no console in an autohost match to catch it.

**Do not commit the key, or a log containing it.** The repo is public. `/api/health` reports the judge's `mode` and `lastError` but never the key, and `lastError` is a sentence like "ANTHROPIC_API_KEY rejected" rather than anything from the key itself — keep it that way if you touch `src/judge.js`.

## Facts you will want before deciding anything

**The call is small and rare.** `claude-haiku-4-5` (override with `RUMBLE_JUDGE_MODEL`), `max_tokens: 120`, a 1,800 ms timeout and one retry (`RUMBLE_JUDGE_TIMEOUT_MS`). The timeout is tight on purpose: that call happens in silence with a room listening, unlike `wrongs.js`'s 2 s call, which happens while the host is still reading. Most answers never reach it — the deterministic ladder settles anything that normalizes to the accepted response, a repaired "What is", an "Antony in Cleopatra", a bare "what…" or silence. In the test matches roughly half the rulings never touched a model. A hundred-clue match is tens of calls of a few hundred tokens each. Put a spend limit on the workspace for safety, not because you expect it to bind.

**The same key also improves the robots.** `src/wrongs.js` uses `ANTHROPIC_API_KEY` to write a robot's wrong answer and has been falling back to local nonsense on the box all along. It will start producing plausible wrong answers the moment this lands. That is a visible change in how a match sounds, so it is worth knowing it is coming rather than wondering.

**If the key fails mid-match, nothing breaks loudly.** The judge catches it, returns `unclear`, and counts it in `failed` / `lastError` on `/api/health`. It never returns `wrong`, so a dead key cannot cost a player money — it can only cost them a clue they should have won, which the room can overrule with O. Worth a look at `failed` after the first real match.

**Outbound reachability is worth checking once.** `curl -s -o /dev/null -w '%{http_code}\n' https://api.anthropic.com/v1/messages` from the box — a 401 is a pass (it reached them and was refused for having no key). Anything that hangs or resolves nowhere is a networking problem to find now rather than at the bell.

## What I have already changed in the tree

Uncommitted, in `~/Developer/j-Royal-rumble`, on top of the objections work:

- **`src/server.js`** — the refusal now names both routes and says what the keyless one costs, rather than pointing only at the key.
- **`infra/aws/HOSTING.md`** — the variable table's `ANTHROPIC_API_KEY` row said it only affected the robots' wrong answers, which stopped being true when the judge shipped; it now says an autohost match refuses to start without it. `RUMBLE_JUDGE` is added beside it with what the local judge does and does not do.
- **`test/startfail.mjs`** — pins the refusal's wording: that it exists, names the key, names the keyless route, and says what that route costs. A refusal nobody tests is a refusal that rots, and this is the one David actually hit.

All green in David's tree.

## Two things I did not do, because they are calls rather than tasks

**The setup page should say there is no judge before the lobby fills.** It already does this for the voice — `voiceHint()` in `public/setup.html` prints the engine or the reason in red beside the autohost checkbox, off `setupView`'s `voice`. The judge is on `/api/health` but not on `setupView`, so a host with no key learns about it from a refusal after they have gathered five people. That is a small change in my area (`setupView`, `voiceHint`'s neighbor, one `test/setup.mjs` assertion) and I will make it if you want it; I have left it alone because it touches a file you may be in.

**Whether the box should ever run `RUMBLE_JUDGE=local` deliberately.** There is one honest use: a demo on a box with no key, which is what the mode was built for. If you want that available without editing the systemd file, it would want to be a per-match setting rather than an environment variable — and I would argue against it, because "the host cannot say no tonight" is not something a room should be able to switch on without noticing. Your call; if you want it, it is mine to build.
