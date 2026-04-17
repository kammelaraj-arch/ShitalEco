#!/bin/bash
# ─── Install daily backup cron on the Vultr server ───────────────────────────
# Runs backup.sh every day at 02:00 UTC.
# Daily goes to /daily, Sundays also to /weekly, 1st also to /monthly.
# Uploads to Azure Blob if AZURE_STORAGE_CONNECTION_STRING is set in .env.
# ──────────────────────────────────────────────────────────────────────────────
set -e

APP_DIR="/opt/shitaleco"
BACKUP_SCRIPT="$APP_DIR/infra/backup.sh"

# Make executable
chmod +x "$BACKUP_SCRIPT"

# Write cron entry — idempotent
CRON_LINE="0 2 * * * /bin/bash $BACKUP_SCRIPT >> $APP_DIR/backups/cron.log 2>&1"
CRON_TMP=$(mktemp)

# Grab existing cron (if any), strip our previous entry, add new one
crontab -l 2>/dev/null | grep -v "$BACKUP_SCRIPT" > "$CRON_TMP" || true
echo "$CRON_LINE" >> "$CRON_TMP"
crontab "$CRON_TMP"
rm -f "$CRON_TMP"

echo "✓ Backup cron installed"
crontab -l | grep -F "$BACKUP_SCRIPT"
echo ""
echo "Backups will run daily at 02:00 UTC"
echo "  Daily:   $APP_DIR/backups/daily/       (30 days retained)"
echo "  Weekly:  $APP_DIR/backups/weekly/      (12 weeks retained, Sundays)"
echo "  Monthly: $APP_DIR/backups/monthly/     (12 months retained, 1st)"
echo ""
echo "To enable Azure Blob upload, add to $APP_DIR/.env:"
echo "  AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
echo "  AZURE_STORAGE_CONTAINER=shitaleco-backups"
echo ""
echo "To test the backup now:  bash $BACKUP_SCRIPT"
echo "To restore a backup:     bash $BACKUP_SCRIPT restore /path/to/file.sql.gz"
