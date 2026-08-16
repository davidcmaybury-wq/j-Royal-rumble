#!/usr/bin/env bash
#
# Runs ON the Lightsail box. Pulls, installs, restarts.
#
# Refuses while a match is being played, because the server holds live matches
# in memory and a restart ends them — for everybody, mid-clue, with no way back.
# An automated deploy that can do that during a Friday night game is worse than
# no automated deploy at all.
#
#   deploy-remote.sh          pull and restart, unless a match is in play
#   deploy-remote.sh --force  restart anyway
#   deploy-remote.sh --wait   keep checking until the match ends, then deploy
#
set -euo pipefail
cd /home/ubuntu/app

FORCE=0; WAIT=0
for a in "$@"; do
  [ "$a" = "--force" ] && FORCE=1
  [ "$a" = "--wait" ] && WAIT=1
done

in_play() {
  curl -sf http://127.0.0.1:8080/api/health \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("matchesInPlay",0))' \
    2>/dev/null || echo 0
}

N=$(in_play)
if [ "$N" != "0" ] && [ "$FORCE" = "0" ]; then
  if [ "$WAIT" = "1" ]; then
    echo "A match is in play. Waiting for it to finish..."
    # Say something every poll.
    #
    # Silence was not just unhelpful: an SSH session with no traffic for four
    # minutes was dropped by something in the middle, the deploy died with
    # "Broken pipe", and the exit code was 255 — indistinguishable from a bad
    # key. Printing a line keeps the connection alive and the log honest.
    for i in $(seq 1 60); do           # up to twenty minutes
      sleep 20
      N=$(in_play)
      if [ "$N" = "0" ]; then echo "  ...clear, deploying now."; break; fi
      echo "  ...still $N match(es) in play ($((i * 20))s waited)"
    done
  fi
  if [ "$N" != "0" ]; then
    echo "REFUSING: $N match(es) in play. A restart would end them."
    echo "Re-run with --wait to deploy when they finish, or --force to do it now."
    exit 75                            # EX_TEMPFAIL
  fi
fi

BEFORE=$(git rev-parse --short HEAD)
git pull --ff-only
AFTER=$(git rev-parse --short HEAD)
if [ "$BEFORE" = "$AFTER" ]; then
  echo "Already at $AFTER — nothing to deploy."
  exit 0
fi

npm install --omit=dev
sudo systemctl restart rumble

# Confirm it came back up rather than assuming.
for i in $(seq 1 60); do
  sleep 2
  if curl -sf http://127.0.0.1:8080/api/health > /tmp/health.json; then
    echo "Deployed $BEFORE -> $AFTER, now running $(python3 -c 'import json;print(json.load(open("/tmp/health.json"))["version"])')"
    exit 0
  fi
done
echo "FAILED: the server did not come back. Check: sudo journalctl -u rumble -n 50"
exit 1
