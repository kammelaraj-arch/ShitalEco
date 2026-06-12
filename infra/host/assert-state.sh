#!/bin/bash
# Prod state-invariant assertion. Runs every 60s via shital-assert-state.timer.
#
# Invariant: shitaleco-backend-1 is the ONLY container bound to host port 8000,
# and it is running. If anything else claims port 8000 (e.g. a stale
# workspace-backend-1 from the Neuron-co-located stack), purge it. If
# shitaleco-backend-1 is missing/exited, bring it up.
#
# This replaces the seven scattered recovery workflows that built up after
# the 12-Jun outage. It's the ONE automatic recovery hook on prod.

set -uo pipefail
LOG=/var/log/shital-assert-state.log
mkdir -p "$(dirname "$LOG")"

ts()  { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

DID_WORK=0

# ── 1. Purge anything bound to host port 8000 that isn't shitaleco-backend-1 ─
for cid in $(docker ps -a -q 2>/dev/null); do
  name=$(docker inspect "$cid" --format '{{.Name}}' 2>/dev/null | sed 's|^/||')
  [ -z "$name" ] && continue
  [ "$name" = "shitaleco-backend-1" ] && continue
  hp=$(docker inspect "$cid" --format '{{range $p, $bs := .HostConfig.PortBindings}}{{if eq $p "8000/tcp"}}{{range $bs}}{{.HostPort}}{{end}}{{end}}{{end}}' 2>/dev/null)
  if [ "$hp" = "8000" ]; then
    log "PURGE: ${name} (${cid}) claims host port 8000 — removing"
    docker rm -f "$cid" >> "$LOG" 2>&1 && DID_WORK=1
  fi
done

# ── 2. Ensure shitaleco-backend-1 is running ────────────────────────────────
state=$(docker inspect shitaleco-backend-1 --format '{{.State.Status}}' 2>/dev/null || echo "absent")
if [ "$state" != "running" ]; then
  log "shitaleco-backend-1 state=${state} — invoking compose up"
  cd /opt/shitaleco 2>/dev/null || { log "  FAIL: /opt/shitaleco missing"; exit 1; }
  set -a; [ -f .env ] && . .env; set +a
  timeout 60 docker compose -p shitaleco -f docker-compose.prod.yml up -d --no-deps backend >> "$LOG" 2>&1
  DID_WORK=1
fi

# ── 3. Smoke health — only LOG if degraded, do not flap-restart ─────────────
code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:8000/health 2>/dev/null || echo "000")
if [ "$code" != "200" ]; then
  s=$(docker inspect shitaleco-backend-1 --format '{{.State.Status}} restarts={{.RestartCount}} exit={{.State.ExitCode}}' 2>/dev/null || echo "absent")
  log "DEGRADED: /health=${code} container=${s}"
elif [ "$DID_WORK" = "1" ]; then
  log "RECOVERED: /health=200 after action"
fi

# ── 4. Trim log to last 2000 lines ──────────────────────────────────────────
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
  tail -n 2000 "$LOG" > "${LOG}.tmp" 2>/dev/null && mv "${LOG}.tmp" "$LOG"
fi
