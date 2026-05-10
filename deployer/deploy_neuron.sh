#!/bin/bash
# Wrapper that the deployer container invokes when it gets a hit on
# /deploy/neuron. Ensures /workspace is on the deploy branch and that
# neuron-platform/deploy.sh actually exists on disk before running it
# — past incidents showed the bind-mounted checkout can get partially
# wiped between runs.
set -eo pipefail

LOG=/tmp/deploy-neuron-$(date +%s).log
exec >> "$LOG" 2>&1

echo "=== Neuron deploy started $(date) ==="
cd /workspace

# Same branch the ShitalEco deployer uses.
BRANCH="${NEURON_DEPLOY_BRANCH:-claude/shital-erp-platform-iR2UF}"

git fetch origin "$BRANCH" --quiet || {
  echo "::error::git fetch failed on /workspace"
  exit 1
}
git checkout -B "$BRANCH" "origin/$BRANCH" --quiet
git reset --hard "origin/$BRANCH" --quiet

if [ ! -f neuron-platform/deploy.sh ]; then
  echo "::error::neuron-platform/deploy.sh missing after reset to origin/$BRANCH"
  git log -1 --oneline
  exit 1
fi

echo "=== Running neuron-platform/deploy.sh @ $(git rev-parse --short HEAD) ==="
bash neuron-platform/deploy.sh
echo "=== Neuron deploy complete $(date) ==="
