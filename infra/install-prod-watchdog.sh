#!/bin/bash
# Install the prod self-heal watchdog as a host cron (every 2 min).
#
# SAFE TO RUN ANYTIME: it copies the script and registers the cron entry. It
# does NOT restart, recreate, or stop any container. Run it once on the host to
# activate the safety net WITHOUT a full deploy; deploy.sh also re-runs it on
# every successful prod deploy so a fresh server gets it automatically.
#
# Idempotent: re-running replaces the script and the single cron line.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/shitaleco/infra
mkdir -p "$DEST"
install -m 0755 "$SRC_DIR/watchdog-prod.sh" "$DEST/watchdog-prod.sh"

# Replace any prior shital-prod-watchdog cron line, then add the current one.
( crontab -l 2>/dev/null | grep -v 'shital-prod-watchdog' ; \
  echo "*/2 * * * * /opt/shitaleco/infra/watchdog-prod.sh # shital-prod-watchdog" ) | crontab -

echo "=== Prod watchdog installed (every 2 min) ==="
crontab -l | grep 'shital-prod-watchdog' || { echo "WARN: cron entry not found after install"; exit 1; }
