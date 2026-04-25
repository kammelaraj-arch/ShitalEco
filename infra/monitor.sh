#!/bin/bash
# ─── ShitalEco Infra & Backup Monitor ─────────────────────────────────────────
# Runs every 15 min via cron. Performs deterministic health checks, compares
# results against the previous state, and emails the relevant people only on
# state transitions (so you don't get spammed every 15 min for the same issue).
#
# Severity routing:
#   critical → rajk + vinitl + it@ + gtrustees
#   high     → rajk + it@ + gtrustees
#   medium   → wembley + rajk
#   weekly digest → gtrustees + it@   (Sundays 06:00 UTC, --weekly-digest)
#
# Usage:
#   bash monitor.sh                  # normal run
#   bash monitor.sh --weekly-digest  # send digest email
#   bash monitor.sh --test           # send a test alert to verify mail works
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

APP_DIR="/opt/shitaleco"
BACKUP_DIR="$APP_DIR/backups"
STATE_FILE="$BACKUP_DIR/monitor.state"
LOG_FILE="$BACKUP_DIR/monitor.log"
MAIL_PY="$APP_DIR/infra/monitor-mail.py"

DOMAIN="shital.org.uk"
DB_CONTAINER="shitaleco-db-1"
DB_USER="shitaleco_db_user"
DB_NAME="shitaleco_db"

# ── Recipient groups ────────────────────────────────────────────────────────
RECIP_CRITICAL="rajk@shirdisai.org.uk,vinitl@shirdisai.org.uk,it@shirdisai.org.uk,gtrustees@shirdisai.org.uk"
RECIP_HIGH="rajk@shirdisai.org.uk,it@shirdisai.org.uk,gtrustees@shirdisai.org.uk"
RECIP_MEDIUM="wembley@shirdisai.org.uk,rajk@shirdisai.org.uk"
RECIP_DIGEST="gtrustees@shirdisai.org.uk,it@shirdisai.org.uk"

mkdir -p "$BACKUP_DIR"
touch "$STATE_FILE" "$LOG_FILE"

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

# ── State helpers ───────────────────────────────────────────────────────────
prev_status() { grep "^${1}=" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | awk '{print $1}'; }

# All check results accumulated here, written at end
declare -A NEW_STATE
# Alerts to send: array of "severity|name|message"
ALERTS=()

record() {
    local name=$1 status=$2 msg=$3 severity=$4
    NEW_STATE[$name]="$status $(date +%s)"
    local prev
    prev=$(prev_status "$name")
    if [ "$prev" != "$status" ]; then
        ALERTS+=("${severity}|${name}|${status}|${msg}")
        log "TRANSITION $name: $prev -> $status — $msg"
    fi
}

# ── Checks ──────────────────────────────────────────────────────────────────

check_api_health() {
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$DOMAIN/health" || echo 000)
    if [ "$code" = "200" ]; then
        record api_health ok "API responding 200" critical
    else
        record api_health fail "API /health returned HTTP $code" critical
    fi
}

check_donate_page() {
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$DOMAIN/donate/" || echo 000)
    if [ "$code" = "200" ]; then
        record donate_page ok "Donate page 200" critical
    else
        record donate_page fail "Donate page returned HTTP $code (kiosks may be down)" critical
    fi
}

check_containers() {
    local broken
    broken=$(docker ps -a --filter "name=shital" --format '{{.Names}} {{.Status}}' \
             | grep -Ev 'Up.*\(healthy\)|Up [0-9]+ (seconds|minutes|hours|days|weeks)( |$)' \
             | grep -v '^$' || true)
    if [ -z "$broken" ]; then
        record containers ok "All shital* containers up" critical
    else
        record containers fail "Containers not healthy: $(echo "$broken" | tr '\n' ';' | head -c 300)" critical
    fi
}

check_backup_today() {
    local today
    today=$(date -u +'%Y%m%d')
    local found_local found_uploaded
    found_local=$(find "$BACKUP_DIR/daily" -name "shitaleco-${today}-*.sql.gz" 2>/dev/null | wc -l)
    found_uploaded=$(grep "Uploaded to azure" "$BACKUP_DIR/backup.log" 2>/dev/null \
                     | grep -c "${today}" || true)
    if [ "$found_local" -gt 0 ] && [ "$found_uploaded" -gt 0 ]; then
        record backup_today ok "Backup uploaded ($found_local local, $found_uploaded uploads today)" critical
    elif [ "$(date -u +'%H')" -lt 3 ]; then
        # Before 03:00 UTC → backup hasn't run yet today, don't alarm
        record backup_today ok "Pre-backup window (cron runs 02:00)" critical
    else
        record backup_today fail "No Azure upload of today's backup (local=$found_local, uploaded=$found_uploaded)" critical
    fi
}

check_restore_test_recent() {
    local f="$BACKUP_DIR/test-restore.log"
    if [ ! -f "$f" ]; then
        record restore_test fail "test-restore.log missing — weekly test never run?" high
        return
    fi
    local age_days
    age_days=$(( ( $(date +%s) - $(stat -c %Y "$f") ) / 86400 ))
    if [ "$age_days" -le 8 ]; then
        record restore_test ok "Last test-restore ${age_days}d ago" high
    else
        record restore_test fail "test-restore last ran ${age_days}d ago (>8d) — backups unverified" high
    fi
}

check_disk() {
    local used
    used=$(df -P "$APP_DIR" | awk 'NR==2 {gsub("%",""); print $5}')
    if [ -z "$used" ] || [ "$used" -lt 80 ]; then
        record disk ok "Disk ${used}% used" high
    elif [ "$used" -lt 90 ]; then
        record disk fail "Disk ${used}% used (threshold 80%)" high
    else
        record disk fail "Disk ${used}% used (CRITICAL — clean up backups)" critical
    fi
}

check_cert_expiry() {
    local end_date end_ts now_ts days_left
    end_date=$(echo | timeout 10 openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null \
               | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2) || true
    if [ -z "$end_date" ]; then
        record cert fail "Could not read TLS cert from $DOMAIN" high
        return
    fi
    end_ts=$(date -d "$end_date" +%s 2>/dev/null || echo 0)
    now_ts=$(date +%s)
    days_left=$(( (end_ts - now_ts) / 86400 ))
    if [ "$days_left" -gt 14 ]; then
        record cert ok "Cert valid ${days_left}d" high
    elif [ "$days_left" -gt 3 ]; then
        record cert fail "TLS cert expires in ${days_left}d — Let's Encrypt renewal may be stuck" high
    else
        record cert fail "TLS cert expires in ${days_left}d (URGENT)" critical
    fi
}

check_donations_active() {
    local count
    count=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -A -t -c \
            "SELECT count(*) FROM orders WHERE created_at > NOW() - INTERVAL '24 hours';" 2>/dev/null) || count="err"
    if [ "$count" = "err" ]; then
        record donations_24h fail "Could not query orders table" high
    elif [ "$count" -eq 0 ]; then
        record donations_24h fail "No orders in last 24h — kiosks may be silently broken" medium
    else
        record donations_24h ok "$count orders in last 24h" medium
    fi
}

# ── Email dispatch ──────────────────────────────────────────────────────────

send_alert() {
    local severity=$1 name=$2 status=$3 msg=$4
    local recipients subject icon
    case "$severity" in
        critical) recipients="$RECIP_CRITICAL"; icon="[CRITICAL]" ;;
        high)     recipients="$RECIP_HIGH";     icon="[HIGH]"     ;;
        medium)   recipients="$RECIP_MEDIUM";   icon="[MEDIUM]"   ;;
        *)        recipients="$RECIP_HIGH";     icon="[ALERT]"    ;;
    esac
    if [ "$status" = "ok" ]; then
        subject="$icon RECOVERED: $name on $DOMAIN"
    else
        subject="$icon $name failing on $DOMAIN"
    fi

    local body
    body=$(cat <<EOF
Check:    $name
Status:   $status
Severity: $severity
Time:     $(date -u +'%Y-%m-%d %H:%M:%S UTC')
Host:     $(hostname)

Detail:   $msg

—

This is an automated message from the ShitalEco infra monitor.
Run on host: $(hostname)
Configured at: /opt/shitaleco/infra/monitor.sh
EOF
)

    if echo "$body" | python3 "$MAIL_PY" --to "$recipients" --subject "$subject" >> "$LOG_FILE" 2>&1; then
        log "EMAIL SENT [$severity] $name -> $recipients"
    else
        log "EMAIL FAILED [$severity] $name (see above)"
    fi
}

# ── Weekly digest ───────────────────────────────────────────────────────────

weekly_digest() {
    local body subject
    subject="[Digest] ShitalEco weekly status — $(date -u +'%Y-%m-%d')"
    local containers backup_count latest_backup disk_used cert_days orders_week

    containers=$(docker ps --filter "name=shital" --format '  {{.Names}}: {{.Status}}' || echo "  (docker query failed)")
    backup_count=$(find "$BACKUP_DIR/daily" -name "*.sql.gz" -mtime -7 2>/dev/null | wc -l)
    latest_backup=$(ls -t "$BACKUP_DIR/daily/"*.sql.gz 2>/dev/null | head -1 | xargs -I{} basename {} 2>/dev/null || echo "none")
    disk_used=$(df -P "$APP_DIR" | awk 'NR==2 {print $5}')
    cert_days=$(echo | timeout 10 openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null \
                | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 \
                | xargs -I{} date -d "{}" +%s 2>/dev/null \
                | awk -v now=$(date +%s) '{print int(($1-now)/86400)}' || echo "?")
    orders_week=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -A -t -c \
                  "SELECT count(*) FROM orders WHERE created_at > NOW() - INTERVAL '7 days';" 2>/dev/null || echo "?")

    body=$(cat <<EOF
ShitalEco — Weekly Status Digest
$(date -u +'%Y-%m-%d %H:%M UTC')

Site:           https://$DOMAIN
Host:           $(hostname)

── Containers ──
$containers

── Backups ──
Backups in last 7 days:  $backup_count
Latest backup file:      $latest_backup
Azure upload (today):    $(grep "Uploaded to azure" "$BACKUP_DIR/backup.log" 2>/dev/null | grep "$(date -u +'%Y-%m-%d')" | tail -1 | sed 's/^.*Uploaded /  /' || echo "  (none yet today)")

── Health ──
Disk usage:              $disk_used
TLS cert valid for:      ${cert_days} days
Orders this week:        $orders_week

── Last test-restore ──
$( [ -f "$BACKUP_DIR/test-restore.log" ] \
   && echo "  $(stat -c %y "$BACKUP_DIR/test-restore.log" | cut -d. -f1)" \
   || echo "  never run" )

—

Have a great week.
EOF
)

    if echo "$body" | python3 "$MAIL_PY" --to "$RECIP_DIGEST" --subject "$subject" >> "$LOG_FILE" 2>&1; then
        log "WEEKLY DIGEST sent to $RECIP_DIGEST"
    else
        log "WEEKLY DIGEST FAILED"
    fi
}

# ── Modes ───────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--test" ]; then
    log "TEST MODE: sending diagnostic email to $RECIP_HIGH"
    body="Monitor test message at $(date -u). If you see this, Microsoft Graph + monitor-mail.py are wired correctly."
    echo "$body" | python3 "$MAIL_PY" --to "$RECIP_HIGH" --subject "[TEST] ShitalEco monitor wiring" >> "$LOG_FILE" 2>&1
    cat "$LOG_FILE" | tail -10
    exit 0
fi

if [ "${1:-}" = "--weekly-digest" ]; then
    weekly_digest
    exit 0
fi

# Normal run: do all checks
log "Monitor run started"

check_api_health
check_donate_page
check_containers
check_backup_today
check_restore_test_recent
check_disk
check_cert_expiry
check_donations_active

# Atomically replace state file
{
    for k in "${!NEW_STATE[@]}"; do
        echo "${k}=${NEW_STATE[$k]}"
    done
} > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"

# Dispatch alerts (state transitions only)
for entry in "${ALERTS[@]:-}"; do
    [ -z "$entry" ] && continue
    IFS='|' read -r severity name status msg <<< "$entry"
    send_alert "$severity" "$name" "$status" "$msg"
done

# Trim log to last 5 MB
if [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5242880 ]; then
    tail -2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

log "Monitor run complete (${#ALERTS[@]} transitions)"
