#!/bin/bash
# Install the prod self-heal watchdog as a fast systemd timer (every 30s).
#
# WHY systemd (not the old */2 cron): cron's finest granularity is 1 minute,
# and with the watchdog's 2-consecutive-failure guard that meant up to ~4 min
# of real downtime before nginx was healed. A 30s timer + 2 failures heals the
# front door in ~60-90s — the difference between "a blip" and "an outage".
#
# SAFE TO RUN ANYTIME: it only copies the script and (re)registers the timer.
# It does NOT restart, recreate, or stop any container. deploy.sh and
# deploy-vultr both re-run it on every successful prod deploy, so a fresh
# server gets it automatically; running it by hand activates the safety net
# WITHOUT a full deploy.
#
# Idempotent: re-running replaces the script + unit files and removes the
# legacy cron entry so there is exactly ONE runner.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/shitaleco/infra
mkdir -p "$DEST"
# When invoked from /opt/shitaleco/infra itself (e.g. deploy-vultr after a
# git reset), src and dest are the SAME file — `install` errors out
# ("are the same file") and, under `set -e`, would abort before the systemd
# units are written. Only copy when they differ; always ensure it's executable.
SRC="$SRC_DIR/watchdog-prod.sh"; DST="$DEST/watchdog-prod.sh"
if [ "$(readlink -f "$SRC" 2>/dev/null)" != "$(readlink -f "$DST" 2>/dev/null)" ]; then
  install -m 0755 "$SRC" "$DST"
fi
chmod 0755 "$DST"

# Drop the legacy */2 cron runner if present — the systemd timer replaces it,
# and two concurrent runners would race.
if crontab -l 2>/dev/null | grep -q 'shital-prod-watchdog'; then
  ( crontab -l 2>/dev/null | grep -v 'shital-prod-watchdog' ) | crontab - || true
  echo "  removed legacy */2 cron runner"
fi

# systemd oneshot service that runs one watchdog probe.
cat > /etc/systemd/system/shital-nginx-watchdog.service << 'UNIT'
[Unit]
Description=SHITAL prod front-door (nginx) self-heal watchdog — one probe
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/opt/shitaleco/infra/watchdog-prod.sh
# Never let a hung probe pile up; the timer fires again in 30s anyway.
TimeoutStartSec=60
UNIT

# Timer: first run 60s after boot, then every 30s. AccuracySec keeps it tight.
cat > /etc/systemd/system/shital-nginx-watchdog.timer << 'UNIT'
[Unit]
Description=Run the SHITAL prod nginx self-heal watchdog every 30s

[Timer]
OnBootSec=60
OnUnitActiveSec=30
AccuracySec=5s
Unit=shital-nginx-watchdog.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now shital-nginx-watchdog.timer

echo "=== Prod nginx watchdog installed (systemd timer, every 30s) ==="
systemctl is-active shital-nginx-watchdog.timer >/dev/null \
  && echo "  timer active" \
  || { echo "WARN: timer not active after install"; systemctl status shital-nginx-watchdog.timer --no-pager || true; exit 1; }
systemctl list-timers shital-nginx-watchdog.timer --no-pager 2>/dev/null | head -3 || true
