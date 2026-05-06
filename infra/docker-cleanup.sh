#!/bin/sh
# Weekly disk-cleanup for the ShitalEco VPS.
# Runs every Sunday via /etc/cron.weekly. Bounded — never deletes anything
# from the running stack: only buildx cache + images + volumes that aren't
# referenced by any running container, plus old systemd journal entries.
#
# Idempotent. Logs to /var/log/shital-cleanup.log so we can audit reclaim.

set -e
LOG=/var/log/shital-cleanup.log
exec >> "$LOG" 2>&1

echo
echo "=== $(date -u +%FT%TZ) — weekly cleanup ==="
df -h / | tail -1

# Buildx layers older than 7d (the recurring 17GB disk hog on dev VPS)
docker buildx prune -af --filter 'until=168h' 2>&1 | tail -3 || true

# Untagged + dangling images older than 7d
docker image prune -af --filter 'until=168h' 2>&1 | tail -3 || true

# Volumes with no container references
docker volume prune -f 2>&1 | tail -3 || true

# Truncate any oversized container logs (guards against runaway log spam)
find /var/lib/docker/containers -name '*-json.log' -size +100M \
    -exec truncate -s 0 {} \; -print 2>&1 | head -10 || true

# Cap systemd journal at 500MB (separate config sets the persistent cap;
# this just enforces it now).
journalctl --vacuum-size=500M 2>&1 | tail -3 || true

# Local DB backups older than 14 days. Azure Blob keeps the long-term copies.
find /opt/shitaleco/backups -name '*.sql.gz' -mtime +14 -delete 2>/dev/null || true

echo "--- after ---"
df -h / | tail -1
echo "=== done ==="
