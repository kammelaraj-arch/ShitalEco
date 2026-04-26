#!/bin/bash
# Install the cron entries for the ShitalEco monitor.
# Idempotent — re-running just refreshes the entries.
set -euo pipefail

APP_DIR="/opt/shitaleco"
MONITOR="$APP_DIR/infra/monitor.sh"
LOG_DIR="$APP_DIR/backups"

if [ ! -f "$MONITOR" ]; then
    echo "ERROR: $MONITOR not found"
    exit 1
fi

chmod +x "$MONITOR" "$APP_DIR/infra/monitor-mail.py" 2>/dev/null || true

# Build new crontab: keep all non-monitor entries, append monitor entries
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v 'shitaleco/infra/monitor.sh' > "$TMP" || true

cat >> "$TMP" <<EOF
# ── ShitalEco monitor (managed by install-monitor-cron.sh) ──
*/15 * * * * /bin/bash $MONITOR >> $LOG_DIR/monitor-cron.log 2>&1
0 6 * * 0    /bin/bash $MONITOR --weekly-digest >> $LOG_DIR/monitor-cron.log 2>&1
EOF

crontab "$TMP"
rm -f "$TMP"

echo "Installed:"
crontab -l | grep -E 'monitor.sh'
echo ""
echo "Run a test now: bash $MONITOR --test"
