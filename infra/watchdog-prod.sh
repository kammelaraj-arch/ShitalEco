#!/bin/bash
# Prod self-heal watchdog — runs on the HOST via cron (every 2 min).
#
# WHY THIS EXISTS (17-Jun outage):
#   A "Promote to Prod" recreated the backend container (new docker IP). The
#   deployer then died mid-promote, so the final nginx-restart in deploy.sh
#   never ran. nginx kept routing to the dead old upstream IP → every domain
#   503'd "Connection refused" for ~40 min. Nothing healed it: the backend
#   container was *healthy*, so monitor.sh (which only restarts UNHEALTHY
#   containers, every 15 min) never acted, and all of deploy.sh's safety nets
#   live INSIDE the deployer that had just died.
#
#   This watchdog is deliberately EXTERNAL to the deployer and the backend, so
#   it still fires when either dies. It probes the real public path and, on
#   sustained failure, restarts nginx (the usual fix — flushes stale upstream
#   DNS) and only then, if needed, brings the backend back.
#
# WHY IT'S SAFE (a prior watchdog caused an all-day crashloop on 12-Jun):
#   * Acts ONLY on the real user-facing signal: public HTTPS /health.
#   * Requires TWO consecutive failures before touching anything (ignores
#     transient blips / a single slow tick).
#   * Stands down while a deploy/promote is running (pgrep deploy.sh) so it
#     never fights the deployer.
#   * Escalates gently: restart nginx first (cheap, safe, idempotent). Only if
#     that doesn't fix it does it `up -d` the backend.
#   * Rate-limited: nginx kick <= once / 5 min, backend kick <= once / 15 min,
#     so it can never enter a restart loop.
#   * Pure restart / `up -d` — never deletes data, never changes image tags.
set -uo pipefail

COMPOSE_FILE=/opt/shitaleco/docker-compose.prod.yml
ENV_FILE=/opt/shitaleco/.env
NGINX=shitaleco-nginx-1
HEALTH_URL=https://shital.org.uk/health
LOG=/var/log/shital-prod-watchdog.log
STATE=/run/shital-prod-watchdog

mkdir -p "$STATE"
ts()  { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# 0. Stand down during an active deploy/promote — never fight the deployer.
#    The deployer runs deploy.sh; its process is visible in the host PID view.
if pgrep -f 'deploy\.sh' >/dev/null 2>&1; then
  exit 0
fi

# 1. Probe the real public path (what users actually hit). -k tolerates the
#    self-signed cert presented to a host-local TLS probe.
code=$(curl -sk -o /dev/null -w '%{http_code}' -m 8 "$HEALTH_URL" 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then
  rm -f "$STATE/fail"            # healthy → clear the consecutive-fail marker
  exit 0
fi

# 2. Require two consecutive failures before acting (~2-4 min of real downtime
#    on a 2-min cron), so a single transient blip is never enough.
if [ ! -f "$STATE/fail" ]; then
  echo "$code" > "$STATE/fail"
  log "health=$code (1st failure — arming; will heal next tick if still down)"
  exit 0
fi
log "health=$code (2nd consecutive failure — healing)"

now=$(date +%s)
kick_age() { local t; t=$(stat -c %Y "$1" 2>/dev/null || echo 0); echo $((now - t)); }

cd /opt/shitaleco 2>/dev/null || { log "cannot cd /opt/shitaleco — aborting"; exit 1; }
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p shitaleco)

# 3. Step one: restart nginx to flush the stale upstream DNS. This is the
#    common fix and is cheap + safe + idempotent.
if [ "$(kick_age "$STATE/nginx_kick")" -ge 300 ]; then
  log "restarting nginx ($NGINX) to flush stale upstream"
  docker restart "$NGINX" >>"$LOG" 2>&1 || "${COMPOSE[@]}" up -d --no-deps nginx >>"$LOG" 2>&1
  touch "$STATE/nginx_kick"
  sleep 8
  code=$(curl -sk -o /dev/null -w '%{http_code}' -m 8 "$HEALTH_URL" 2>/dev/null || echo 000)
  log "after nginx restart: health=$code"
  if [ "$code" = "200" ]; then rm -f "$STATE/fail"; exit 0; fi
else
  log "nginx kick rate-limited (last $(kick_age "$STATE/nginx_kick")s ago)"
fi

# 4. Still down: bring backend + nginx up. Heavier (backend boot runs schema
#    migrations), so limited to once / 15 min.
if [ "$(kick_age "$STATE/backend_kick")" -ge 900 ]; then
  log "still down after nginx restart — bringing backend + nginx up"
  "${COMPOSE[@]}" up -d --no-deps backend nginx >>"$LOG" 2>&1
  touch "$STATE/backend_kick"
else
  log "backend kick rate-limited (last $(kick_age "$STATE/backend_kick")s ago)"
fi

# 5. Keep the log bounded.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
