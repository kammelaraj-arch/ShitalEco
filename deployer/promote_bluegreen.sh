#!/bin/bash
# ── ShitalEco Blue/Green Promote ──────────────────────────────────────────────
# Zero-downtime promote with automatic rollback. Invoked by deployer/server.py
# when PROMOTE_STRATEGY=bluegreen is set in /opt/shitaleco/.env.
#
# DORMANT until a one-time cutover is performed on the host (see below).
# This script is shipped in the repo and bind-mounted into the deployer so
# we can iterate on it without rebuilding the deployer image, but until
# PROMOTE_STRATEGY flips, server.py never calls it and Promote-to-Prod
# continues to use the legacy deploy.sh --promote-prod path.
#
# ── One-time host cutover ─────────────────────────────────────────────────────
# Before this script can run safely on prod, an operator must, on the host:
#
#   1. Start backend-blue from the current :latest image:
#        cd /opt/shitaleco
#        docker run -d --name shitaleco-backend-blue-1 \
#          --network shitaleco_internal --restart unless-stopped \
#          --env-file .env \
#          -v /opt/shitaleco/backups:/opt/shitaleco/backups \
#          -v /opt/shitaleco/media:/app/media \
#          ghcr.io/kammelaraj-arch/shitaleco-backend:latest
#
#   2. Verify blue is healthy:
#        docker exec shitaleco-backend-blue-1 curl -fsS http://localhost:8000/health
#
#   3. Repoint nginx at blue and reload:
#        echo "set \$be http://shitaleco-backend-blue-1:8000;" \
#          > /opt/shitaleco/nginx/snippets/active-backend.conf
#        docker exec shitaleco-nginx-1 nginx -t && \
#        docker exec shitaleco-nginx-1 nginx -s reload
#
#   4. Record the active colour:
#        echo blue > /opt/shitaleco/active-color
#
#   5. Confirm https://shital.org.uk/health returns 200.
#
#   6. Stop and remove the legacy backend (held only as fallback during steps 1-5):
#        docker stop shitaleco-backend-1 && docker rm shitaleco-backend-1
#
#   7. Set PROMOTE_STRATEGY=bluegreen in /opt/shitaleco/.env and restart the
#      deployer:
#        sed -i 's/^PROMOTE_STRATEGY=.*/PROMOTE_STRATEGY=bluegreen/' .env
#        echo 'PROMOTE_STRATEGY=bluegreen' >> .env  # if line absent
#        docker compose -f docker-compose.prod.yml up -d --no-deps deployer
#
# After the cutover the next Promote-to-Prod click will alternate to green,
# then back to blue, then green again, indefinitely.
# ─────────────────────────────────────────────────────────────────────────────

set -eo pipefail

# Paths inside the deployer container — /workspace is bind-mounted from
# /opt/shitaleco on the host, so writes here are visible to other containers
# (notably nginx, which has /opt/shitaleco/nginx/snippets at /etc/nginx/snippets).
WORKSPACE=/workspace
LOCK_FILE="${WORKSPACE}/.promote.lock"
STATE_FILE="${WORKSPACE}/.bluegreen-state.json"
COLOR_FILE="${WORKSPACE}/active-color"
SNIPPET_FILE="${WORKSPACE}/nginx/snippets/active-backend.conf"
NGINX_CONTAINER=shitaleco-nginx-1
SNAP_DIR="${WORKSPACE}/backups"
HISTORY_FILE="${SNAP_DIR}/deploy-history.jsonl"
LOG_DIR=/var/log/shital-deployer
LOG=${LOG_DIR}/promote-bluegreen-$(date -u +'%Y%m%dT%H%M%SZ').log
IMAGE_REPO=ghcr.io/kammelaraj-arch/shitaleco-backend
HEALTH_GATE_PROBES=30           # 30 × 10s = 5 min steady-healthy required
HEALTH_GATE_BUDGET=90           # 90 × 10s = 15 min total budget
POST_SWITCH_PROBES=6            # 6 × 10s = 60 s post-switch verify
OLD_GRACE_SECONDS=600           # 10 min instant-rollback window

mkdir -p "$LOG_DIR" "$SNAP_DIR"
exec >> "$LOG" 2>&1

echo "=== Blue/green promote started $(date -u) ==="

# ── State file helpers (read by /promote-status, written at each phase) ──────
write_state() {
  local phase="$1" candidate="$2" extra="$3"
  local now
  now=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  cat > "$STATE_FILE" <<JSON
{"strategy":"bluegreen","active_color":"$(cat "$COLOR_FILE" 2>/dev/null || echo unknown)","phase":"${phase}","phase_started":"${now}","candidate":"${candidate}","extra":${extra:-null},"log":"${LOG}"}
JSON
}

record_history() {
  local status="$1" msg="$2"
  local esc
  esc=$(printf '%s' "$msg" | sed 's/"/\\"/g')
  printf '{"at":"%s","env":"prod","strategy":"bluegreen","status":"%s","message":"%s","log":"%s"}\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$status" "$esc" "$LOG" >> "$HISTORY_FILE"
}

# ── Single-flight lock ──────────────────────────────────────────────────────
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "FATAL: another promote is already in progress (lock ${LOCK_FILE})"
  record_history "concurrent_blocked" "another promote held the lock"
  exit 9
fi

# Rollback path (server.py POST /promote-rollback). When invoked with --rollback,
# swap the active colour back to whichever container is currently NOT in the
# nginx snippet. Cheap: rewrite snippet + reload nginx + flip COLOR_FILE.
if [ "${1:-}" = "--rollback" ]; then
  current=$(cat "$COLOR_FILE" 2>/dev/null || echo unknown)
  if [ "$current" = "blue" ]; then target=green; else target=blue; fi
  echo "Rollback: $current → $target"
  if ! docker inspect "shitaleco-backend-${target}-1" >/dev/null 2>&1; then
    echo "FATAL: rollback target shitaleco-backend-${target}-1 does not exist (grace expired?)"
    record_history "rollback_failed" "target container shitaleco-backend-${target}-1 missing"
    exit 4
  fi
  echo "set \$be http://shitaleco-backend-${target}-1:8000;" > "${SNIPPET_FILE}.next"
  mv -f "${SNIPPET_FILE}.next" "$SNIPPET_FILE"
  docker exec "$NGINX_CONTAINER" nginx -t
  docker exec "$NGINX_CONTAINER" nginx -s reload
  echo "$target" > "$COLOR_FILE"
  write_state idle "" "{\"last_action\":\"rollback\",\"to\":\"${target}\"}"
  record_history "rolled_back" "manual rollback to ${target}"
  echo "=== Rollback complete: active=${target} ==="
  exit 0
fi

# ── Phase 0: determine OLD / NEW colour ────────────────────────────────────────
OLD=$(cat "$COLOR_FILE" 2>/dev/null || echo "")
if [ "$OLD" = "blue" ]; then NEW=green
elif [ "$OLD" = "green" ]; then NEW=blue
else
  echo "FATAL: ${COLOR_FILE} missing or unrecognised ('${OLD}'). Complete the one-time host cutover first (see header)."
  record_history "preflight_failed" "active-color not set"
  exit 2
fi
NEW_CONTAINER="shitaleco-backend-${NEW}-1"
OLD_CONTAINER="shitaleco-backend-${OLD}-1"
PROMOTE_TS=$(date -u +'%Y%m%dT%H%M%SZ')
write_state preflight "$NEW" "{\"old\":\"${OLD}\",\"new\":\"${NEW}\"}"
echo "Active is ${OLD}; promoting to ${NEW}"

# ── Phase 1: pre-flight ───────────────────────────────────────────────────────
echo "=== Phase 1: pre-flight ==="

# GHCR login (cached for the rest of the run)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u kammelaraj-arch --password-stdin 2>/dev/null \
    && echo "Logged in to GHCR" || echo "GHCR login failed — using cached image if present"
fi

# Pull :dev (this is what we're promoting). Fail loudly on pull error.
if ! docker pull "${IMAGE_REPO}:dev"; then
  echo "FATAL: docker pull ${IMAGE_REPO}:dev failed"
  record_history "preflight_failed" "docker pull :dev failed"
  exit 3
fi

# Sanity-import test in a throwaway container. Catches Python import errors,
# missing module-level deps, syntax errors that wouldn't show up in CI but
# would crash the backend at startup.
echo "Sanity import test against :dev"
if ! docker run --rm --network none --entrypoint sh \
      "${IMAGE_REPO}:dev" -c "python -c 'import shital.main; print(\"import OK\")'"; then
  echo "FATAL: :dev image fails to import shital.main"
  record_history "preflight_failed" "sanity import failed"
  exit 3
fi

# DB snapshot. Same path/format as deploy.sh so existing /snapshots listing finds it.
SNAP_OUT="${SNAP_DIR}/promote-${PROMOTE_TS}-bluegreen.sql.gz"
echo "DB snapshot → ${SNAP_OUT}"
set +e
docker compose -p shitaleco -f /workspace/docker-compose.prod.yml exec -T db \
    pg_dump -U "${POSTGRES_USER:-shitaleco_db_user}" \
            -d "${POSTGRES_DB:-shitaleco_db}" 2>/dev/null | gzip > "$SNAP_OUT"
pg_rc=${PIPESTATUS[0]}
set -e
if [ "$pg_rc" -ne 0 ] || [ ! -s "$SNAP_OUT" ]; then
  echo "WARNING: snapshot failed (rc=${pg_rc}). Proceeding anyway — rollback via :promote-<ts> image tag still possible."
  rm -f "$SNAP_OUT"
fi

# Tag current :latest as :promote-<ts> for image-level rollback.
docker tag "${IMAGE_REPO}:latest" "${IMAGE_REPO}:promote-${PROMOTE_TS}" 2>/dev/null || true

# ── Phase 2: bring up NEW colour ──────────────────────────────────────────────
echo "=== Phase 2: start ${NEW_CONTAINER} from :dev ==="
write_state starting_new "$NEW" "null"

# Remove any stale container with the NEW name (e.g. left over from a previous
# failed promote). It's the inactive colour by definition, so safe to nuke.
docker rm -f "$NEW_CONTAINER" 2>/dev/null || true

# `docker run`, not compose. The compose-declared backend-blue / backend-green
# services are profile-gated to "bluegreen" specifically so compose never
# touches them on a normal `up -d`. The deployer is the sole orchestrator.
if ! docker run -d \
    --name "$NEW_CONTAINER" \
    --network shitaleco_internal \
    --restart unless-stopped \
    --env-file /workspace/.env \
    -v /opt/shitaleco/backups:/opt/shitaleco/backups \
    -v /opt/shitaleco/media:/app/media \
    --memory 1024m \
    --cpus 1.0 \
    "${IMAGE_REPO}:dev" \
    sh -c "alembic upgrade head 2>&1 || echo 'WARNING: alembic failed'; exec uvicorn shital.main:app --host 0.0.0.0 --port 8000 --workers 1 --loop uvloop --http httptools"
then
  echo "FATAL: docker run ${NEW_CONTAINER} failed"
  record_history "start_failed" "docker run new colour failed"
  exit 4
fi

# ── Phase 3: health gate (15-min budget, need 5 min steady) ───────────────────
echo "=== Phase 3: health gate — need ${HEALTH_GATE_PROBES} consecutive 200s within ${HEALTH_GATE_BUDGET} probes ==="
write_state health_gate "$NEW" "null"

consecutive=0
total=0
while [ "$total" -lt "$HEALTH_GATE_BUDGET" ]; do
  total=$((total + 1))
  sleep 10
  if docker exec "$NEW_CONTAINER" curl -fsS --max-time 5 http://localhost:8000/health >/dev/null 2>&1; then
    consecutive=$((consecutive + 1))
    if [ $((total % 6)) -eq 0 ] || [ "$consecutive" -le 1 ]; then
      echo "  ${total}/${HEALTH_GATE_BUDGET}  /health=200  streak=${consecutive}/${HEALTH_GATE_PROBES}"
    fi
    if [ "$consecutive" -ge "$HEALTH_GATE_PROBES" ]; then
      echo "Health gate PASSED (${consecutive} consecutive)"
      break
    fi
    write_state health_gate "$NEW" "{\"streak\":${consecutive},\"need\":${HEALTH_GATE_PROBES}}"
  else
    consecutive=0
    state=$(docker inspect --format '{{.State.Status}} exit={{.State.ExitCode}}' "$NEW_CONTAINER" 2>/dev/null || echo "?")
    [ $((total % 6)) -eq 0 ] && echo "  ${total}/${HEALTH_GATE_BUDGET}  /health!=200  container=${state}"
    # Fail fast if the container has exited non-zero
    if docker inspect --format '{{.State.Status}}' "$NEW_CONTAINER" 2>/dev/null | grep -q exited; then
      ec=$(docker inspect --format '{{.State.ExitCode}}' "$NEW_CONTAINER" 2>/dev/null || echo "?")
      if [ "$ec" != "0" ]; then
        echo "FATAL: ${NEW_CONTAINER} exited with code ${ec} during health gate"
        docker logs --tail 100 "$NEW_CONTAINER" 2>&1 | tail -100
        docker rm -f "$NEW_CONTAINER" || true
        record_history "health_gate_failed" "new colour crashed (exit ${ec})"
        exit 5
      fi
    fi
  fi
done

if [ "$consecutive" -lt "$HEALTH_GATE_PROBES" ]; then
  echo "FATAL: health gate timed out after ${HEALTH_GATE_BUDGET} probes (last streak=${consecutive})"
  docker logs --tail 100 "$NEW_CONTAINER" 2>&1 | tail -100
  docker rm -f "$NEW_CONTAINER" || true
  record_history "health_gate_timeout" "new colour never reached steady-healthy"
  exit 5
fi

# ── Phase 4: smoke tests (still not in nginx) ─────────────────────────────────
echo "=== Phase 4: smoke tests against ${NEW_CONTAINER} ==="
write_state smoke "$NEW" "null"

smoke() {
  local name="$1" path="$2" expect="$3"
  local code
  code=$(docker exec "$NEW_CONTAINER" curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:8000${path}" 2>/dev/null || echo 000)
  if echo "|${expect}|" | grep -q "|${code}|"; then
    echo "  ✓ ${name}  ${path} → ${code}"
    return 0
  fi
  echo "  ✗ ${name}  ${path} → ${code} (expected one of ${expect})"
  return 1
}

# Each test isolates a specific subsystem. Expectations are tight enough to
# catch real regressions (auth middleware not loaded, kiosk router not mounted,
# DB schema mismatch) without being so tight they false-positive on healthy
# minor differences (the recent-donations endpoint may return 200 or 401
# depending on whether the seed admin user is auto-created).
SMOKE_OK=1
smoke health           /health                                200       || SMOKE_OK=0
smoke auth_middleware  /api/v1/auth/me                        401\|403  || SMOKE_OK=0
smoke kiosk_router     /api/v1/kiosk/devices                  401\|403\|200 || SMOKE_OK=0
smoke openapi          /api/v1/openapi.json                   200       || SMOKE_OK=0

if [ "$SMOKE_OK" -ne 1 ]; then
  echo "FATAL: smoke tests failed"
  docker logs --tail 50 "$NEW_CONTAINER" 2>&1 | tail -50
  docker rm -f "$NEW_CONTAINER" || true
  record_history "smoke_failed" "smoke tests rejected new colour"
  exit 6
fi

# ── Phase 5: atomic nginx switch ──────────────────────────────────────────────
echo "=== Phase 5: atomic nginx switch — ${OLD} → ${NEW} ==="
write_state switching "$NEW" "null"

# Save the current snippet for post-switch rollback if needed.
SNIPPET_BACKUP="${SNIPPET_FILE}.before-${PROMOTE_TS}"
cp -f "$SNIPPET_FILE" "$SNIPPET_BACKUP"

# Atomic rewrite: write to .next, validate, mv into place.
echo "set \$be http://${NEW_CONTAINER}:8000;" > "${SNIPPET_FILE}.next"
if ! docker exec "$NGINX_CONTAINER" nginx -t -c /etc/nginx/nginx.conf \
       2>&1 | tail -5; then
  echo "FATAL: nginx -t failed on new snippet — aborting switch"
  rm -f "${SNIPPET_FILE}.next"
  docker rm -f "$NEW_CONTAINER" || true
  record_history "nginx_test_failed" "nginx config-test rejected new snippet"
  exit 7
fi
mv -f "${SNIPPET_FILE}.next" "$SNIPPET_FILE"
docker exec "$NGINX_CONTAINER" nginx -s reload

# Source of truth flip.
echo "$NEW" > "$COLOR_FILE"
echo "Switched: active=${NEW}"

# ── Phase 6: post-switch verify via public URL ───────────────────────────────
echo "=== Phase 6: post-switch verify (60 s through nginx) ==="
write_state post_verify "$NEW" "null"

post_ok=1
for i in $(seq 1 $POST_SWITCH_PROBES); do
  sleep 10
  if docker exec "$NGINX_CONTAINER" wget -qO- --timeout=5 http://localhost/health >/dev/null 2>&1; then
    echo "  ${i}/${POST_SWITCH_PROBES}  nginx→backend /health 200"
  else
    echo "  ${i}/${POST_SWITCH_PROBES}  /health failed via nginx"
    post_ok=0
    break
  fi
done

if [ "$post_ok" -ne 1 ]; then
  echo "FATAL: post-switch verification failed — rolling back nginx to ${OLD}"
  cp -f "$SNIPPET_BACKUP" "$SNIPPET_FILE"
  docker exec "$NGINX_CONTAINER" nginx -s reload || true
  echo "$OLD" > "$COLOR_FILE"
  docker rm -f "$NEW_CONTAINER" || true
  record_history "post_switch_failed" "rolled back nginx to ${OLD}"
  exit 8
fi
rm -f "$SNIPPET_BACKUP"

# ── Phase 7: retag :latest (only now that NEW is proven in real traffic) ──────
docker tag "${IMAGE_REPO}:dev" "${IMAGE_REPO}:latest"
echo ":latest now points at the same image as :dev"

# ── Phase 8: grace period before retiring OLD ─────────────────────────────────
echo "=== Phase 8: ${OLD_GRACE_SECONDS}s grace before retiring ${OLD_CONTAINER} ==="
write_state grace "$NEW" "{\"grace_seconds_remaining\":${OLD_GRACE_SECONDS},\"rollback_target\":\"${OLD}\"}"
# We don't actually sleep here — the deployer process would block other webhooks.
# Instead, schedule a detached cleanup via at(1) if available, otherwise just
# leave OLD running indefinitely. Disk cost of a stopped/running 1GB-RSS
# container is negligible on this VPS, and keeping OLD around means rollback
# stays instant even hours after promote.
if command -v at >/dev/null 2>&1; then
  echo "docker rm -f ${OLD_CONTAINER}" | at "now + ${OLD_GRACE_SECONDS} seconds" 2>/dev/null || true
fi

write_state idle "$NEW" "{\"rollback_available\":true,\"rollback_target\":\"${OLD}\"}"
record_history "promoted" "blue/green promote ${OLD} → ${NEW} completed"
echo "=== Promote complete: active=${NEW}; ${OLD_CONTAINER} kept warm for rollback ==="
