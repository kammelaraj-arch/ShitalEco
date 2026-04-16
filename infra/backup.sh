#!/bin/bash
# ─── ShitalEco Database Backup Script ─────────────────────────────────────────
# Runs daily from cron — keeps:
#   - Daily backups: last 30 days
#   - Weekly backups: last 12 weeks (kept on Sundays)
#   - Monthly backups: last 12 months (kept on the 1st)
#
# Uploads to Azure Blob Storage if AZURE_STORAGE_CONNECTION_STRING + CONTAINER
# are set in /opt/shitaleco/.env.
#
# Usage:
#   bash backup.sh           → run full daily + weekly/monthly rotation
#   bash backup.sh restore <file>  → restore a backup (WARNING: destructive)
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

APP_DIR="/opt/shitaleco"
BACKUP_DIR="$APP_DIR/backups"
ENV_FILE="$APP_DIR/.env"
LOG_FILE="$BACKUP_DIR/backup.log"
DB_CONTAINER="shitaleco-db-1"
DB_NAME="shitaleco_db"
DB_USER="shitaleco_db_user"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── Load Azure creds (.env first, then admin-UI-managed creds file) ──────────
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(AZURE_STORAGE_CONNECTION_STRING|AZURE_STORAGE_CONTAINER|AZURE_STORAGE_ACCOUNT|AZURE_STORAGE_KEY)=' "$ENV_FILE" 2>/dev/null || true)
  set +a
fi
# Creds saved via Admin UI override .env values
AZURE_CREDS_FILE="$BACKUP_DIR/.azure-creds.env"
if [ -f "$AZURE_CREDS_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$AZURE_CREDS_FILE"
  set +a
fi

# ── RESTORE mode ────────────────────────────────────────────────────────────
if [ "${1:-}" = "restore" ]; then
  FILE="${2:-}"
  if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo "Usage: $0 restore <path-to-backup.sql.gz>"
    exit 1
  fi
  echo "⚠️  WARNING: This will REPLACE all data in $DB_NAME with contents of $FILE"
  echo "Press Ctrl+C within 10 seconds to abort..."
  sleep 10
  log "Restoring from $FILE"
  zcat "$FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
  log "Restore complete"
  exit 0
fi

# ── DAILY BACKUP ────────────────────────────────────────────────────────────
DATE=$(date +'%Y%m%d-%H%M%S')
DAILY_FILE="$BACKUP_DIR/daily/shitaleco-$DATE.sql.gz"

log "Starting daily backup → $DAILY_FILE"

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  log "ERROR: DB container $DB_CONTAINER not running — backup aborted"
  exit 1
fi

if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists 2>>"$LOG_FILE" | gzip > "$DAILY_FILE"; then
  SIZE=$(du -h "$DAILY_FILE" | cut -f1)
  log "✓ Daily backup complete ($SIZE)"
else
  log "ERROR: pg_dump failed"
  rm -f "$DAILY_FILE"
  exit 1
fi

# Verify the backup isn't tiny/corrupt
MIN_SIZE=1024  # 1 KB minimum
ACTUAL_SIZE=$(stat -c%s "$DAILY_FILE" 2>/dev/null || stat -f%z "$DAILY_FILE")
if [ "$ACTUAL_SIZE" -lt "$MIN_SIZE" ]; then
  log "ERROR: Backup file too small ($ACTUAL_SIZE bytes) — probably corrupt"
  mv "$DAILY_FILE" "$DAILY_FILE.suspect"
  exit 1
fi

# ── WEEKLY (Sunday only) ─────────────────────────────────────────────────────
if [ "$(date +%u)" = "7" ]; then
  WEEKLY_FILE="$BACKUP_DIR/weekly/shitaleco-week-$(date +'%Y-W%V').sql.gz"
  cp "$DAILY_FILE" "$WEEKLY_FILE"
  log "✓ Weekly snapshot saved → $WEEKLY_FILE"
fi

# ── MONTHLY (1st of month only) ──────────────────────────────────────────────
if [ "$(date +%d)" = "01" ]; then
  MONTHLY_FILE="$BACKUP_DIR/monthly/shitaleco-$(date +'%Y-%m').sql.gz"
  cp "$DAILY_FILE" "$MONTHLY_FILE"
  log "✓ Monthly snapshot saved → $MONTHLY_FILE"
fi

# ── UPLOAD TO AZURE BLOB (if configured) ────────────────────────────────────
if [ -n "${AZURE_STORAGE_CONNECTION_STRING:-}" ] && [ -n "${AZURE_STORAGE_CONTAINER:-}" ]; then
  log "Uploading to Azure Blob container: $AZURE_STORAGE_CONTAINER"
  if command -v az >/dev/null 2>&1; then
    AZ_CMD="az"
  else
    # Use Azure CLI via Docker (no install needed on the host)
    AZ_CMD="docker run --rm -v $BACKUP_DIR:/backups -e AZURE_STORAGE_CONNECTION_STRING mcr.microsoft.com/azure-cli az"
  fi

  BLOB_PATH="daily/$(basename "$DAILY_FILE")"
  if $AZ_CMD storage blob upload \
      --container-name "$AZURE_STORAGE_CONTAINER" \
      --file "$DAILY_FILE" \
      --name "$BLOB_PATH" \
      --overwrite \
      --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
      >>"$LOG_FILE" 2>&1; then
    log "✓ Uploaded to azure://$AZURE_STORAGE_CONTAINER/$BLOB_PATH"
  else
    log "⚠ Azure upload failed — backup remains local"
  fi

  # Upload weekly/monthly too if they were created today
  [ -f "${WEEKLY_FILE:-}" ] && $AZ_CMD storage blob upload \
    --container-name "$AZURE_STORAGE_CONTAINER" \
    --file "$WEEKLY_FILE" \
    --name "weekly/$(basename "$WEEKLY_FILE")" \
    --overwrite \
    --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
    >>"$LOG_FILE" 2>&1 && log "✓ Uploaded weekly snapshot"

  [ -f "${MONTHLY_FILE:-}" ] && $AZ_CMD storage blob upload \
    --container-name "$AZURE_STORAGE_CONTAINER" \
    --file "$MONTHLY_FILE" \
    --name "monthly/$(basename "$MONTHLY_FILE")" \
    --overwrite \
    --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
    >>"$LOG_FILE" 2>&1 && log "✓ Uploaded monthly snapshot"
else
  log "Azure Blob upload skipped (AZURE_STORAGE_CONNECTION_STRING not set)"
fi

# ── ROTATION ─────────────────────────────────────────────────────────────────
# Keep last 30 daily, 12 weekly, 12 monthly
find "$BACKUP_DIR/daily"   -name "shitaleco-*.sql.gz" -mtime +30  -delete 2>/dev/null
find "$BACKUP_DIR/weekly"  -name "shitaleco-*.sql.gz" -mtime +90  -delete 2>/dev/null
find "$BACKUP_DIR/monthly" -name "shitaleco-*.sql.gz" -mtime +380 -delete 2>/dev/null

# Keep log file under 1 MB
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE")" -gt 1048576 ]; then
  tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

log "Backup run complete"
echo ""
