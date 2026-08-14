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

## Deploying

`npm run ship` pushes to GitHub. GitHub runs the full test suite and, if it is
green, tells the Lightsail box to pull — so a push deploys again, and a broken
commit does not.

**Two secrets turn that on.** Until they are set the workflow is plain CI and
prints the manual command instead.

    AWS_HOST      3.15.120.241
    AWS_SSH_KEY   the private half of a key the box will accept

For the key, either paste the Lightsail default key (Lightsail console →
Account → SSH keys → download), or better, make one just for deploys:

    ssh-keygen -t ed25519 -f deploy -N ""          # on your machine
    # paste deploy.pub into ~/.ssh/authorized_keys on the box
    # paste the contents of `deploy` into the AWS_SSH_KEY secret

Then add both under Settings → Secrets and variables → Actions.

**A restart ends every match in progress** — they live in memory. So the deploy
does not simply restart: `tools/deploy-remote.sh` asks `/api/health` how many
matches are being played and holds until they finish. CI calls it with
`--wait`; by hand it refuses and tells you, unless you pass `--force`.

    bash /home/ubuntu/app/tools/deploy-remote.sh          # refuses mid-match
    bash /home/ubuntu/app/tools/deploy-remote.sh --wait   # deploys when clear
    bash /home/ubuntu/app/tools/deploy-remote.sh --force  # now, regardless

It also checks the server actually came back, rather than assuming.

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

## Moving the match logs

Run the puller **on the box**, writing straight into place:

    cd /home/ubuntu/app && node tools/pull-logs.mjs https://j-royal-rumble.fly.dev /data/logs
    curl -s localhost:8080/api/health | grep -o '"saved":[0-9]*'

It only needs HTTP to the old host, so there is no key to arrange and nothing
to copy afterwards. Pulling to a laptop or Codespace and then `scp`-ing across
is the long way round, and needs a key that only exists on the box.
