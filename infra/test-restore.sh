#!/bin/bash
# ─── ShitalEco Backup Restore Test ────────────────────────────────────────────
# Downloads a backup from Azure, restores into a throwaway postgres container
# on a non-prod port, runs row-count sanity checks, and tears down. Does NOT
# touch the live database.
#
# Usage:
#   bash test-restore.sh                  # use latest daily backup from Azure
#   bash test-restore.sh daily/<file>     # specify a particular blob
#   bash test-restore.sh /local/file.sql.gz   # restore a local file (no Azure)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/shitaleco"
BACKUP_DIR="$APP_DIR/backups"
ENV_FILE="$APP_DIR/.env"
AZURE_CREDS="$BACKUP_DIR/.azure-creds.env"

# ── Load DB creds from prod .env (so test container uses the same names) ─────
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(POSTGRES_PASSWORD|POSTGRES_DB|POSTGRES_USER)=' "$ENV_FILE" 2>/dev/null || true)
  set +a
fi
DB_NAME="${POSTGRES_DB:-shitaleco_db}"
DB_USER="${POSTGRES_USER:-shitaleco_db_user}"

# ── Load Azure creds (only needed if no local file provided) ─────────────────
if [ -f "$AZURE_CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$AZURE_CREDS"
  set +a
fi

# ── Setup workspace + container ──────────────────────────────────────────────
TS=$(date +'%Y%m%d-%H%M%S')
WORK="/tmp/shitaleco-test-restore-$TS"
mkdir -p "$WORK"
LOCAL_BACKUP="$WORK/restore.sql.gz"
CONTAINER_NAME="shitaleco-restore-test-$TS"
TEST_PORT=55432
TEST_PASS="testrestore-throwaway"

cleanup() {
  echo ""
  echo "── Cleanup ──"
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  echo "Removed throwaway container and temp files."
}
trap cleanup EXIT

echo "═══ ShitalEco Backup Restore Test — $TS ═══"

# ── Resolve backup source ────────────────────────────────────────────────────
SOURCE_ARG="${1:-}"

if [ -n "$SOURCE_ARG" ] && [ -f "$SOURCE_ARG" ]; then
  echo "Using local file: $SOURCE_ARG"
  cp "$SOURCE_ARG" "$LOCAL_BACKUP"
else
  if [ -z "${AZURE_STORAGE_CONNECTION_STRING:-}" ] || [ -z "${AZURE_STORAGE_CONTAINER:-}" ]; then
    echo "ERROR: Azure creds not configured ($AZURE_CREDS missing or incomplete)."
    echo "       Provide a local backup file as argument, or configure Azure first."
    exit 1
  fi

  if [ -n "$SOURCE_ARG" ]; then
    BLOB="$SOURCE_ARG"
    echo "Using blob: $BLOB"
  else
    echo "Finding latest daily backup in Azure..."
    BLOB=$(docker run --rm -e AZURE_STORAGE_CONNECTION_STRING \
      mcr.microsoft.com/azure-cli az storage blob list \
      --container-name "$AZURE_STORAGE_CONTAINER" \
      --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
      --prefix "daily/" \
      --query "[?ends_with(name,'.sql.gz')] | sort_by(@, &properties.lastModified) | [-1].name" \
      -o tsv 2>/dev/null | tr -d '\r')
    if [ -z "$BLOB" ]; then
      echo "ERROR: No daily/*.sql.gz blobs found in container '$AZURE_STORAGE_CONTAINER'"
      exit 1
    fi
    echo "Latest blob: $BLOB"
  fi

  echo "Downloading from Azure..."
  docker run --rm -v "$WORK:$WORK" -e AZURE_STORAGE_CONNECTION_STRING \
    mcr.microsoft.com/azure-cli az storage blob download \
    --container-name "$AZURE_STORAGE_CONTAINER" \
    --name "$BLOB" \
    --file "$LOCAL_BACKUP" \
    --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
    --no-progress >/dev/null
fi

if [ ! -s "$LOCAL_BACKUP" ]; then
  echo "ERROR: Downloaded file is empty"
  exit 1
fi
SIZE=$(du -h "$LOCAL_BACKUP" | cut -f1)
echo "Backup file: $SIZE"

# ── Spin up throwaway postgres ───────────────────────────────────────────────
echo ""
echo "── Starting throwaway postgres ($CONTAINER_NAME) on port $TEST_PORT ──"
docker run -d --rm --name "$CONTAINER_NAME" \
  -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$TEST_PASS" \
  -p "$TEST_PORT:5432" \
  postgres:16-alpine >/dev/null

echo -n "Waiting for postgres to accept connections"
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo " — ready"
    break
  fi
  echo -n "."
  sleep 1
done

# ── Restore the dump ─────────────────────────────────────────────────────────
echo ""
echo "── Restoring backup into throwaway DB ──"
START=$(date +%s)
if zcat "$LOCAL_BACKUP" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q >/dev/null 2>"$WORK/restore.err"; then
  ELAPSED=$(( $(date +%s) - START ))
  echo "Restore completed in ${ELAPSED}s"
else
  echo "ERROR: Restore failed. Last lines of stderr:"
  tail -20 "$WORK/restore.err"
  exit 1
fi

# ── Sanity checks ────────────────────────────────────────────────────────────
echo ""
echo "═══ Sanity check: row counts per table ═══"
docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -X -A -F $'\t' -t -c "
SELECT format('%-40s %10s', schemaname || '.' || relname,
              (xpath('/row/c/text()',
                     query_to_xml(format('SELECT count(*) AS c FROM %I.%I',
                                          schemaname, relname),
                                  false, true, '')))[1]::text)
FROM pg_catalog.pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, relname;
"

echo ""
echo "═══ Summary ═══"
docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -X -A -t -c "
SELECT
  'Tables: ' || COUNT(*) || E'\n' ||
  'Total rows: ' || COALESCE(SUM(rows), 0)
FROM (
  SELECT (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM %I.%I',
                                     schemaname, relname),
                             false, true, '')))[1]::text::bigint AS rows
  FROM pg_catalog.pg_tables
  WHERE schemaname = 'public'
) s;
"

echo ""
echo "═══ Critical-table spot check (vs prod) ═══"
for tbl in users orders donations branches kiosk_devices terminal_devices items api_keys_store; do
  T_ROWS=$(docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -X -A -t -c \
    "SELECT count(*) FROM $tbl;" 2>/dev/null || echo "n/a")
  P_ROWS=$(docker exec shitaleco-db-1 psql -U "$DB_USER" -d "$DB_NAME" -X -A -t -c \
    "SELECT count(*) FROM $tbl;" 2>/dev/null || echo "n/a")
  printf "  %-25s test=%-8s prod=%-8s\n" "$tbl" "$T_ROWS" "$P_ROWS"
done

echo ""
echo "✓ Test restore PASSED — backup is structurally valid and restorable"
echo "  (Manually check the test/prod columns above match expectations.)"
