#!/usr/bin/env bash
# Unpack any dropped update, install, commit and push in one go.
# Usage:  npm run ship "what changed"
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
drops=(j-royal-rumble*.tar.gz)
if [ ${#drops[@]} -gt 0 ]; then
  for f in "${drops[@]}"; do
    echo "unpacking $f"
    tar xzf "$f"
    rm -f "$f"
  done
else
  echo "no tarball found — shipping working tree as-is"
fi

# The library only ships when it changes, so an older copy may still be here.
rm -f data/library.json

npm install --silent

msg="${1:-Update}"
git add -A
if git diff --cached --quiet; then
  echo "nothing to commit"
  exit 0
fi
git commit -m "$msg"
git push
echo
echo "pushed. CI runs the four suites, then deploys:"
echo "  https://github.com/davidcmaybury-wq/j-Royal-rumble/actions"
