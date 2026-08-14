# Hosting

`HOSTING.md` is the record of how the live site is actually built, written by
David when he built it. It is the authority; read it first.

The short version: a **Lightsail** VM in Ohio running the Node server under
systemd, behind **CloudFront** for HTTPS, with the domain at **Cloudflare**
(DNS only, grey cloud). Live at <https://j-royal-rumble.net>.

## What used to be here

A CloudFormation stack (EC2 + Caddy + ECR + an SSM deploy workflow) and a
migration runbook for it. **Deleted.** It described a machine that was never
built, and a design document for an imaginary system sitting next to the real
one is a trap for anybody reading this later — including me.

The real setup is simpler than what I had designed, and better suited to the
job: CloudFront handles TLS without a certificate to renew on the box, and
Lightsail's flat $7 covers the instance, the disk and the bandwidth in one line
item.

## Two things worth knowing

**Deploys no longer run the tests.** On Fly, pushing to `main` ran all 32
suites before anything shipped. The current deploy is `git pull` over SSH, which
will happily deploy a broken commit. `npm run ship` still pushes to GitHub, but
nothing downstream acts on it.

If that matters, the fix is small: keep the GitHub Actions workflow running the
test suite on push, and have it finish by asking the Lightsail box to pull. That
restores the safety net without changing how the box is set up.

## The old Fly app

Still running as a spare, with the match logs already copied across. Two live
instances is a hazard worth taking seriously: **matches live in memory on a
single instance**, so half a group joining `fly.dev` and half joining the new
address is two separate broken games — and the worst kind, because both halves
think the match is running fine.

The defence is a variable. On the Fly box only:

    fly secrets set RUMBLE_MOVED_TO=https://j-royal-rumble.net -a j-royal-rumble

Every page then returns a "this has moved" notice and every API call a 308,
both preserving the path — so an old `/j/ABCD` link lands on the right room at
the right address. `/api/health` keeps answering so the box can still be
watched. Unset the variable and it is a normal server again.

It needs one deploy to take effect: set the repository variable
`DEPLOY_FLY=true`, push, then set it back.

`tools/pull-logs.mjs` moves match logs off a running server over HTTP if
anything else ever needs recovering.
