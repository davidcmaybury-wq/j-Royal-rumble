# Moving to AWS

The app is a single small machine with a disk, and that is exactly what this
builds: one t4g.micro, Caddy in front for automatic TLS, a 10GB volume for the
match logs that outlives both deploys and the instance itself, and deploys over
SSM so there is no SSH key to lose and no port 22 open.

**About $7/month** (instance $6.10, disk $0.80, IP free while attached). The
usual managed answers cost more for nothing this app can use — an Application
Load Balancer alone is ~$16/month, and every serverless container option either
lacks a persistent disk or cannot promise exactly one always-on instance, which
this app needs because matches live in memory.

## What you need first

- An AWS account and the CLI logged in as an admin (`aws sts get-caller-identity`).
- A domain, or a subdomain you can point at an IP. TLS is not optional: the
  buzzer uses the clipboard API and audio unlock, both of which browsers
  restrict to secure origins.
- Nothing else. The Fly app stays up and untouched until the final step.

## 1. The stack

    aws cloudformation deploy \
      --stack-name rumble \
      --template-file infra/aws/stack.yml \
      --capabilities CAPABILITY_NAMED_IAM \
      --parameter-overrides \
          DomainName=rumble.yourdomain.com \
          VpcId=vpc-XXXX SubnetId=subnet-XXXX

(Default VPC and any public subnet are fine: `aws ec2 describe-vpcs`,
`aws ec2 describe-subnets`.) Then read the outputs:

    aws cloudformation describe-stacks --stack-name rumble \
      --query 'Stacks[0].Outputs'

## 2. DNS

Point an A record for the domain at `PublicIp` from the outputs. Caddy fetches
the certificate on its own the first time the name resolves — nothing to
configure, but the record must exist before the first visit.

## 3. GitHub

Create an access key for the `rumble-deployer` IAM user the stack made
(Console -> IAM -> Users -> rumble-deployer -> create access key), then add
repository secrets:

    AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
    AWS_REGION       e.g. us-east-2
    AWS_INSTANCE_ID  from the outputs
    AWS_ECR_REPO     from the outputs

That user can push this one image and restart this one instance, and nothing
else — it cannot touch the rest of the account.

## 4. First deploy

Set the repository variable (Settings -> Secrets and variables -> Actions ->
Variables) `DEPLOY_TARGET` to `aws` and push anything. The `deploy-aws`
workflow runs the whole test suite, pushes the image, and restarts the
instance; the Fly workflow sees the same variable and stands down. **Rollback
is the same switch**: set it back to anything else and Fly is the deploy of
record again. The app has no idea where it is running.

Check it: `https://rumble.yourdomain.com/api/health`.

## 5. The match logs

The records on the Fly volume come across with the puller (run it anywhere
with internet access — it uses the same endpoints the log browser does):

    node tools/pull-logs.mjs https://j-royal-rumble.fly.dev ./log-backup
    aws s3 mb s3://rumble-log-transfer
    aws s3 cp ./log-backup s3://rumble-log-transfer/logs --recursive

Then on the instance (Console -> EC2 -> Connect -> Session Manager — no key
needed):

    sudo aws s3 cp s3://rumble-log-transfer/logs /data/logs --recursive
    sudo chown -R root:root /data/logs
    aws s3 rb s3://rumble-log-transfer --force

`/api/health` should then report the full count with `durable: true`.

If `RUMBLE_LOG_KEY` is set on Fly (`fly ssh console -C env | grep RUMBLE`),
pass it as the third argument to the puller and add it to the `environment:`
list in `/srv/rumble/docker-compose.yml` on the instance.

## 6. Cutover, and only now touching Fly

1. Announce the new URL — old links keep working until step 3.
2. A last `node tools/pull-logs.mjs` sweep for any matches played since step 5.
3. `fly scale count 0 -a j-royal-rumble` — off but resurrectable.
4. Weeks later, when nothing has gone wrong: `fly apps destroy j-royal-rumble`.

## Differences worth knowing

- `/api/health` reports `machine: local` on AWS — that field read
  `FLY_MACHINE_ID`. Cosmetic.
- Region: the stack examples use us-east-2 (Ohio), the nearest thing to the
  old `ord` placement. Latency for a US-spread field is comparable.
- The instance runs Docker Compose with **one** app replica by design. Scaling
  out would split the in-memory matches across machines; do not.
- Phone deploys (the tarball-to-`incoming/` path) keep working unchanged: the
  unpack workflow commits, and whichever deploy workflow the variable selects
  takes it from there.

## If the instance dies

The volume is `DeletionPolicy: Retain` — the logs survive anything, including
deleting the whole stack. Re-deploying the stack builds a fresh instance;
attach the surviving volume in place of the new one (or copy the files across)
and run `rumble-deploy`.
