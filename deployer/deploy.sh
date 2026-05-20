#!/bin/bash
# ── ShitalEco Deploy Script ───────────────────────────────────────────────────
# Modes (passed via flags from server.py):
#   --target dev    Pull :dev images, restart the dev stack
#   --target prod   Pull :latest images, restart the prod stack (rolling, with
#                   automatic rollback on health-check failure)
#   --promote-prod  Retag :dev → :latest (no rebuild — bit-identical image),
#                   then run --target prod
#
# Image flow:
#   CI builds main → tagged :dev → auto-deploys to dev (target=dev)
#   Admin clicks "Promote to Prod" → retag → deploy prod (--promote-prod)
# ──────────────────────────────────────────────────────────────────────────────
set -eo pipefail
LOG=/tmp/deploy-$(date +%s).log
exec >> "$LOG" 2>&1

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
TARGET="dev"
PROMOTE=0
RESTORE_ID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --promote-prod) PROMOTE=1; TARGET="prod"; shift ;;
    --restore) RESTORE_ID="$2"; TARGET="prod"; shift 2 ;;
    *) echo "Unknown arg: $1"; shift ;;
  esac
done

# Where snapshots live. Each promote/restore creates one entry.
#   promote-<ts>-<sha>.sql.gz  — DB dump taken just before promote
#   :promote-<ts>              — image tag pointing at the about-to-be-replaced :latest
SNAP_DIR=/workspace/backups
SNAP_GC_KEEP=10
mkdir -p "$SNAP_DIR"

echo "=== Deploy started $(date) — target=${TARGET} promote=${PROMOTE} restore=${RESTORE_ID:-none} ==="
cd /workspace

git fetch origin
git reset --hard "origin/${DEPLOY_BRANCH}"
GIT_SHA=$(git rev-parse HEAD)
echo "=== Deploying commit ${GIT_SHA} (${DEPLOY_BRANCH}) → ${TARGET} ==="

# ── Login to GHCR so we can pull private images ──────────────────────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u kammelaraj-arch --password-stdin 2>/dev/null \
    && echo "Logged in to GHCR" || echo "GHCR login failed — images may already be cached"
fi

# ── Snapshot before promote: DB dump + timestamped image tag ────────────────
# Failures here used to be silent (`2>/dev/null`) — so the snapshot listing
# was permanently empty after multiple successful promotes because the
# .sql.gz file the listing endpoint hunted for was never created. Now
# pg_dump stderr is shown loud in the deployer log AND persisted to a
# small log file alongside backups, so operators can diagnose without
# shelling into the container.
take_snapshot() {
  local ts="$1" reason="$2"
  local out="${SNAP_DIR}/${reason}-${ts}-${GIT_SHA:0:7}.sql.gz"
  local err_log="${SNAP_DIR}/${reason}-${ts}-pg_dump.log"
  echo "=== Taking ${reason} snapshot ${ts} ==="
  # The deployer's CWD is /workspace, which is NOT the prod compose project
  # ("shitaleco" — derived from /opt/shitaleco on the host). Pass an explicit
  # project name + absolute compose file path so `docker compose exec` finds
  # the running db container regardless of where the deployer was started.
  set +e
  docker compose -p shitaleco -f /workspace/docker-compose.prod.yml exec -T db \
       pg_dump -U "${POSTGRES_USER:-shitaleco_db_user}" \
               -d "${POSTGRES_DB:-shitaleco_db}" \
       2>"$err_log" | gzip > "$out"
  local pg_rc=${PIPESTATUS[0]}
  local gz_rc=${PIPESTATUS[1]}
  set -e
  if [ "$pg_rc" -eq 0 ] && [ "$gz_rc" -eq 0 ] && [ -s "$out" ]; then
    rm -f "$err_log"
    echo "  ✓ DB dump → ${out} ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out"
    echo "  ✗ DB dump failed (pg_dump rc=${pg_rc}, gzip rc=${gz_rc})"
    if [ -s "$err_log" ]; then
      echo "  ── pg_dump stderr (also in ${err_log}): ─────────────────────"
      sed 's/^/      /' "$err_log"
      echo "  ─────────────────────────────────────────────────────────────"
    fi
    echo "  → continuing with image-tag snapshot only — image-only rollback"
    echo "    will still be available for this snapshot."
  fi
  # Image-tag snapshot of current :latest, before any retag — runs even
  # when pg_dump failed so the operator can still do an image-only rollback.
  for svc in backend admin quick-donation kiosk screen service; do
    local img="ghcr.io/kammelaraj-arch/shitaleco-${svc}"
    if docker tag "${img}:latest" "${img}:${reason}-${ts}" 2>/dev/null; then
      echo "  ✓ tagged ${svc}:${reason}-${ts}"
    fi
  done
}

# Garbage-collect: keep latest N promote snapshots (db dump files + image tags)
gc_snapshots() {
  echo "=== GC: keeping last ${SNAP_GC_KEEP} promote snapshots ==="
  # Files
  ls -1t "${SNAP_DIR}"/promote-*.sql.gz 2>/dev/null \
    | tail -n +"$((SNAP_GC_KEEP + 1))" \
    | while read -r f ; do echo "  rm $f"; rm -f "$f"; done
  # Image tags (parse promote-<ts> tags, keep last N)
  for svc in backend admin quick-donation kiosk screen service; do
    local img="ghcr.io/kammelaraj-arch/shitaleco-${svc}"
    docker images "${img}" --format '{{.Tag}}' 2>/dev/null \
      | grep '^promote-' | sort -r | tail -n +"$((SNAP_GC_KEEP + 1))" \
      | while read -r tag ; do
          docker rmi "${img}:${tag}" >/dev/null 2>&1 \
            && echo "  untagged ${svc}:${tag}" || true
        done
  done
}

# ── Restore mode: rollback to a specific snapshot ────────────────────────────
if [ -n "$RESTORE_ID" ]; then
  echo "=== Restore mode — snapshot id=${RESTORE_ID} ==="
  DB_DUMP="${SNAP_DIR}/promote-${RESTORE_ID}-"*".sql.gz"
  DB_DUMP_FILE=$(ls $DB_DUMP 2>/dev/null | head -1 || true)
  if [ -z "$DB_DUMP_FILE" ] || [ ! -f "$DB_DUMP_FILE" ]; then
    echo "!!! No DB dump found matching ${RESTORE_ID} — aborting"
    exit 1
  fi
  # Snapshot the CURRENT state first so we can rollback the rollback
  PRE_RESTORE_TS=$(date -u +'%Y%m%dT%H%M%SZ')
  take_snapshot "$PRE_RESTORE_TS" "pre-restore"

  echo "=== Restoring images from :promote-${RESTORE_ID} → :latest ==="
  for svc in backend admin quick-donation kiosk screen service; do
    img="ghcr.io/kammelaraj-arch/shitaleco-${svc}"
    if docker tag "${img}:promote-${RESTORE_ID}" "${img}:latest" 2>/dev/null; then
      echo "  ✓ restored ${svc} → :latest"
    else
      echo "  ~ no :promote-${RESTORE_ID} for ${svc} (skipping)"
    fi
  done

  echo "=== Restoring DB from ${DB_DUMP_FILE} ==="
  if zcat "$DB_DUMP_FILE" | docker compose -f docker-compose.prod.yml exec -T db \
       psql -U "${POSTGRES_USER:-shitaleco_db_user}" \
            -d "${POSTGRES_DB:-shitaleco_db}" >/dev/null 2>&1 ; then
    echo "  ✓ DB restored"
  else
    echo "!!! DB restore failed — images already retagged. Manual intervention required."
    exit 1
  fi
  # Skip the promote retag step below — restore IS the retag for this run.
  PROMOTE=0
fi

# ── Promote: retag :dev → :latest BEFORE pulling/restarting prod ────────────
if [ "$PROMOTE" -eq 1 ]; then
  PROMOTE_TS=$(date -u +'%Y%m%dT%H%M%SZ')
  take_snapshot "$PROMOTE_TS" "promote"

  echo "=== Promoting :dev → :latest ==="
  PROMOTE_FAILED=""
  for svc in backend admin quick-donation kiosk screen service; do
    img="ghcr.io/kammelaraj-arch/shitaleco-${svc}"
    # Snapshot current :latest as :previous (rollback target).
    docker tag "${img}:latest" "${img}:previous" 2>/dev/null || true

    # Pull :dev LOUDLY. The previous version swallowed stderr with
    # `2>/dev/null`, so when GHCR auth blipped or the registry 5xx'd, the
    # script printed "skipped" and prod kept serving its stale :latest —
    # which is how a hand-built service image (commit ed19268-paypal-fix)
    # sat on prod for days despite "successful" promotes.
    pull_out=$(docker pull "${img}:dev" 2>&1) && pull_rc=0 || pull_rc=$?
    if [ "$pull_rc" -eq 0 ]; then
      dev_id=$(docker image inspect "${img}:dev" --format '{{.Id}}' 2>/dev/null || echo "unknown")
      docker tag "${img}:dev" "${img}:latest"
      echo "  ✓ promoted ${svc} (image_id=${dev_id})"
    else
      echo "  !!! FAILED to promote ${svc}: docker pull exit=${pull_rc}"
      echo "      ${pull_out}"
      PROMOTE_FAILED="${PROMOTE_FAILED} ${svc}"
    fi
  done
  if [ -n "$PROMOTE_FAILED" ]; then
    echo "!!! Promote partially failed for:${PROMOTE_FAILED}"
    echo "!!! Prod will continue serving STALE :latest for those services."
    echo "!!! Common causes: GHCR auth (GITHUB_TOKEN missing/expired), :dev tag never pushed by CI, transient registry 5xx."
    # Record the failure in the deploy history so the admin UI surfaces it.
    HISTORY_FILE=/workspace/backups/deploy-history.jsonl
    mkdir -p "$(dirname "$HISTORY_FILE")"
    SHORT_SHA="${GIT_SHA:0:7}"
    cat >> "$HISTORY_FILE" <<JSON
{"at":"$(date -u +'%Y-%m-%dT%H:%M:%SZ')","env":"prod","sha":"${GIT_SHA}","short":"${SHORT_SHA}","branch":"${DEPLOY_BRANCH}","status":"promote_partial","message":"promote failed for:${PROMOTE_FAILED}"}
JSON
    exit 1
  fi
  gc_snapshots
fi

# ── Branch on target ────────────────────────────────────────────────────────
if [ "$TARGET" = "dev" ]; then
  COMPOSE="docker-compose.dev.yml"
  STACK_NAME="dev"
  HEALTH_URL="http://localhost:8001/health"
  HISTORY_TAG="dev"
else
  COMPOSE="docker-compose.prod.yml"
  STACK_NAME="prod"
  HEALTH_URL="http://localhost:8000/health"
  HISTORY_TAG="prod"
fi

# ── Resolve env-file (root cause of repeat dev outages) ─────────────────────
# docker-compose.dev.yml has `${JWT_SECRET:?must be set in .env.dev}` etc.
# When the deployer ran `docker compose up -d` without --env-file, compose
# tried to interpolate against the shell's empty env → bailed out → admin/
# nginx stuck in 'Created' forever. We now pick the env-file explicitly per
# target and pass --env-file to every compose call. Fallback chain:
#   dev  → /workspace-dev/.env.dev → /workspace/.env.dev → /workspace/.env
#   prod → /workspace/.env
# Also: ensure /opt/shitaleco-dev/.env.dev exists (symlink to prod .env if
# missing) so manual `docker compose up -d` from the dev dir works too —
# the user's recovery would have worked first-try with this in place.
resolve_env_file() {
  local t="$1"
  if [ "$t" = "dev" ]; then
    for candidate in /workspace-dev/.env.dev /workspace/.env.dev /workspace/.env; do
      [ -f "$candidate" ] && echo "$candidate" && return 0
    done
  else
    [ -f /workspace/.env ] && echo "/workspace/.env" && return 0
  fi
  return 1
}
ENV_FILE="$(resolve_env_file "$TARGET" 2>/dev/null || true)"
if [ -n "$ENV_FILE" ]; then
  echo "=== Using env file: $ENV_FILE ==="
else
  echo "!!! No env file found for target=$TARGET — compose interpolation will fail"
fi

# Heal the persistent dev gotcha: /opt/shitaleco-dev/.env.dev not existing.
# Best-effort: create it as a symlink to the prod .env so the same secrets
# are reused. If the host filesystem isn't writable from the deployer, the
# symlink fails silently and we fall back to passing --env-file directly.
if [ "$TARGET" = "dev" ] && [ -f /workspace-dev/.env.dev ]; then
  : # already there
elif [ "$TARGET" = "dev" ] && [ -d /workspace-dev ] && [ -f /workspace/.env ]; then
  ln -sf /workspace/.env /workspace-dev/.env.dev 2>/dev/null && \
    echo "  → linked /workspace-dev/.env.dev → /workspace/.env"
fi

# Build the base compose command once so EVERY call below uses --env-file.
if [ -n "$ENV_FILE" ]; then
  COMPOSE_CMD="docker compose --env-file $ENV_FILE -f $COMPOSE"
else
  COMPOSE_CMD="docker compose -f $COMPOSE"
fi
echo "=== Compose command: $COMPOSE_CMD ==="

echo "=== Pulling images for ${STACK_NAME} stack ==="
if [ "$TARGET" = "dev" ]; then
  # Dev stack pulls :dev (most CI builds)
  $COMPOSE_CMD pull 2>&1 | tail -10 || true
elif [ "$PROMOTE" -eq 1 ]; then
  # Prod promotion path — :latest was JUST retagged from :dev locally above.
  # Skip the registry pull so we don't overwrite our promotion with whatever
  # stale :latest happens to be on GHCR (CI builds :dev, not :latest, so the
  # registry's :latest is from before the dev/prod split).
  echo "Skipping docker pull — using locally promoted :latest tags"
else
  # Plain prod deploy (no promotion) — fall back to pulling :latest from GHCR
  $COMPOSE_CMD pull backend admin quick-donation kiosk screen 2>&1 | tail -10 || true
  $COMPOSE_CMD pull service 2>/dev/null || \
    echo "service image not yet in GHCR — skipping pull"
fi

docker image prune -f
# DO NOT `docker container prune -f` here. It removes ALL stopped containers
# on the host, with no compose-project / label filter — so if a prod
# container ever stopped (OOM, crash, mid-deploy force-recreate window),
# the next deploy permanently deleted it. That's exactly how
# shitaleco-backend-1 ended up missing on prod and nginx started 502'ing
# every request. We rely on `up -d --force-recreate` below to handle
# container churn; we never need a blanket prune.

# ── Self-healing: ensure every required service is present ──────────────────
# Every deploy MUST end with all required containers running. If any has
# been removed (manual `docker rm`, host reboot, an earlier-version
# deploy's prune line, OOM-then-crashloop-then-stopped), `up -d` (no
# --force-recreate) creates it from compose. This runs BEFORE the rolling
# restart so the force-recreate phase below has something to recreate
# (and doesn't no-op on a missing container).

# Robustness pre-step 1: load .env so subsequent `docker compose` calls
# don't recreate containers with blank POSTGRES_PASSWORD / JWT_SECRET.
# If the deploy doesn't load these and a force-recreate fires, the new
# container ends up with no DB password and a broken JWT signer.
if [ -f /workspace/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /workspace/.env
  set +a
fi

# Robustness pre-step 2: sweep up docker's auto-renamed stale containers.
# When `docker compose up` tries to create a container whose name is
# already taken by a stuck/zombie container, docker auto-renames the old
# one to `<short_hex>_<original>` and the new one fails to start —
# leaving BOTH in Created state and blocking every subsequent up -d.
# This is exactly how dev ended up with bd9a41c5ffb0_*-admin-dev-1
# blocking shitaleco-dev-admin-dev-1 from starting after a merge train.
# Find anything matching that pattern and remove it BEFORE up -d.
echo "=== Sweeping renamed-by-docker stale containers ==="
STALE=$(docker ps -a --format '{{.Names}}' \
  | grep -E '^[0-9a-f]{12}_shital' || true)
if [ -n "$STALE" ]; then
  echo "$STALE" | while read -r c; do
    [ -z "$c" ] && continue
    echo "  rm $c (auto-renamed zombie)"
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
else
  echo "  none"
fi

echo "=== Ensure all required ${STACK_NAME} containers exist ==="
if [ "$TARGET" = "dev" ]; then
  REQUIRED_SERVICES="db-dev backend-dev admin-dev quick-donation-dev kiosk-dev screen-dev nginx-dev"
else
  REQUIRED_SERVICES="db backend admin quick-donation kiosk screen service nginx certbot backup-scheduler deployer"
fi
$COMPOSE_CMD up -d --no-deps $REQUIRED_SERVICES 2>&1 | tail -30 || true

# Audit + self-heal — if any required service is not running, force-recreate
# it specifically (covers the 'Created but never started' state that blocked
# dev admin/nginx after the big merge train: docker compose up -d created
# the container but a stale rename left it stuck, and the audit was
# warn-only so nothing healed it). We retry up to twice with --force-recreate
# before giving up loud. This makes the deploy idempotent: re-running it
# converges on the desired state instead of leaving the stack half-broken.
audit_and_heal() {
  local attempt="$1"
  local missing=""
  for svc in $REQUIRED_SERVICES; do
    if [ "$TARGET" = "dev" ]; then
      cname="shitaleco-dev-${svc}-1"
    else
      cname="shitaleco-${svc}-1"
    fi
    state=$(docker inspect "$cname" --format '{{.State.Status}}' 2>/dev/null || echo "absent")
    if [ "$state" != "running" ] && [ "$state" != "restarting" ]; then
      echo "  !!! ${cname} is '${state}' (expected running) — attempt ${attempt}"
      missing="${missing} ${svc}"
    fi
  done
  echo "${missing# }"
}

NEED_HEAL=$(audit_and_heal 1)
HEAL_ATTEMPT=0
while [ -n "$NEED_HEAL" ] && [ "$HEAL_ATTEMPT" -lt 2 ]; do
  HEAL_ATTEMPT=$((HEAL_ATTEMPT + 1))
  echo "=== Self-heal attempt ${HEAL_ATTEMPT}: force-recreating ${NEED_HEAL} ==="
  # rm any 'Created' (never-started) instances so up -d doesn't no-op on
  # them — this is the actual failure mode dev hit (Created admin-dev +
  # nginx-dev stayed Created forever because up -d sees them present).
  for svc in $NEED_HEAL; do
    if [ "$TARGET" = "dev" ]; then
      cname="shitaleco-dev-${svc}-1"
    else
      cname="shitaleco-${svc}-1"
    fi
    s=$(docker inspect "$cname" --format '{{.State.Status}}' 2>/dev/null || echo "absent")
    if [ "$s" = "created" ] || [ "$s" = "exited" ]; then
      echo "  rm $cname ($s)"
      docker rm -f "$cname" >/dev/null 2>&1 || true
    fi
  done
  # shellcheck disable=SC2086
  $COMPOSE_CMD up -d --no-deps --force-recreate $NEED_HEAL 2>&1 | tail -20 || true
  sleep 5
  NEED_HEAL=$(audit_and_heal "post-heal-${HEAL_ATTEMPT}")
done

MISSING="$NEED_HEAL"
if [ -n "$MISSING" ]; then
  echo "!!! Some required containers are STILL not running after ${HEAL_ATTEMPT} self-heal attempts: ${MISSING}"
  echo "!!! Check `docker logs <container>` and the compose file for env-var errors."
fi

# ── Rolling restart — backend first ─────────────────────────────────────────
# Safety net — if a backend container is missing entirely (previously
# pruned, host reboot, manual `docker rm`), `up -d --force-recreate` may
# leave compose unhappy in some edge cases. `up -d` (without
# force-recreate, against the actual service name) is the most reliable
# path to recreate a missing container. Then below we force-recreate so
# we get the new image even if compose found an existing container.
echo "=== Ensure-create: backend (${STACK_NAME}) ==="
$COMPOSE_CMD up -d --no-deps backend 2>/dev/null || \
  $COMPOSE_CMD up -d --no-deps backend-dev

echo "=== Rolling restart: backend (${STACK_NAME}) ==="
$COMPOSE_CMD up -d --no-deps --force-recreate backend 2>/dev/null || \
  $COMPOSE_CMD up -d --no-deps --force-recreate backend-dev

echo "=== Waiting for backend health (${HEALTH_URL}) ==="
# 60 × 5s = 300s. Lifespan runs _patch_schema() + sync_from_digital_dna()
# (~30 capability rows) before /health serves; deploy-dev.yml's comment
# pegs cold start at 90-150s, so the old 150s window sat right on the
# edge and rolled back every deploy as "backend health check failed".
BACKEND_OK=0
for i in $(seq 1 60); do
  sleep 5
  if curl -sf --max-time 5 "$HEALTH_URL" > /dev/null 2>&1; then
    echo "Backend healthy after ${i} attempts"
    BACKEND_OK=1
    break
  fi
  echo "  attempt ${i}/60..."
done

HISTORY_FILE=/workspace/backups/deploy-history.jsonl
mkdir -p "$(dirname "$HISTORY_FILE")"
SHORT_SHA="${GIT_SHA:0:7}"
COMMIT_MSG=$(cd /workspace && git log -1 --format='%s' "$GIT_SHA" 2>/dev/null | sed 's/"/\\"/g' | head -c 200)

if [ "$BACKEND_OK" -eq 0 ]; then
  echo "!!! Backend unhealthy on ${STACK_NAME} — rolling back to :previous ==="
  if [ "$TARGET" = "prod" ]; then
    docker tag ghcr.io/kammelaraj-arch/shitaleco-backend:previous \
               ghcr.io/kammelaraj-arch/shitaleco-backend:latest 2>/dev/null || true
    $COMPOSE_CMD up -d --no-deps --force-recreate backend
  fi
  cat >> "$HISTORY_FILE" <<JSON
{"at":"$(date -u +'%Y-%m-%dT%H:%M:%SZ')","env":"${HISTORY_TAG}","sha":"${GIT_SHA}","short":"${SHORT_SHA}","branch":"${DEPLOY_BRANCH}","status":"rolled_back","message":"backend health check failed"}
JSON
  exit 1
fi

# Prod-only: warm seed-catalog endpoint (best-effort)
if [ "$TARGET" = "prod" ]; then
  curl -sf -X POST http://localhost:8000/api/v1/admin/seed-catalog || true
fi

# ── Frontend rollout ─────────────────────────────────────────────────────────
echo "=== Rolling restart: frontends (${STACK_NAME}) ==="
if [ "$TARGET" = "dev" ]; then
  $COMPOSE_CMD up -d --no-deps --force-recreate \
    admin-dev quick-donation-dev kiosk-dev screen-dev 2>/dev/null || true
else
  # `docker tag :dev :latest` updates Docker's local manifest, but if a stale
  # :latest is cached from a previous (manual or partial) pull, `--force-recreate`
  # alone will happily restart the container with the OLD image. Explicitly
  # `docker compose pull` here re-resolves :latest from the local daemon's
  # most recent tag — which is the one we just retagged in the promote step.
  $COMPOSE_CMD pull admin quick-donation kiosk screen service 2>&1 | tail -15
  $COMPOSE_CMD up -d --no-deps --force-recreate admin quick-donation kiosk screen service

  # Verify each prod frontend container is now serving the expected GIT_SHA
  # by reading the baked-in /usr/share/nginx/html/version.txt from each
  # frontend image. Surfaces stale-image bugs immediately (this is exactly
  # the trap that left service.shital.org.uk serving ed19268-paypal-fix for
  # days — a manual image with that tag had taken over :latest and the
  # silent promote skip masked the issue).
  echo "=== Verify frontend image versions ==="
  for svc in admin quick-donation kiosk screen service; do
    cid=$($COMPOSE_CMD ps -q "$svc" 2>/dev/null || true)
    if [ -n "$cid" ]; then
      v=$(docker exec "$cid" cat /usr/share/nginx/html/version.txt 2>/dev/null || echo "<not-served>")
      echo "  ${svc}: ${v}"
      # Sanity flag: GIT_SHA from the image should be a clean 40-char hex.
      # The manual image had GIT_SHA='ed19268…-paypal-fix' — anything that
      # doesn't match [0-9a-f]{40} is a smell worth surfacing.
      case "$v" in
        [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
        *) echo "  ⚠️  ${svc}: GIT_SHA is not a clean 40-char hex — likely a hand-built image (NOT a CI build)." ;;
      esac
    fi
  done

  # Reload nginx (prod only — dev nginx auto-reloads)
  $COMPOSE_CMD exec -T nginx nginx -s reload 2>/dev/null || \
    $COMPOSE_CMD up -d --no-deps nginx
fi

# ── Smoke tests ──────────────────────────────────────────────────────────────
echo "=== Smoke tests (${STACK_NAME}) ==="
SMOKE_FAIL=0
smoke() {
  local label=$1 url=$2
  if curl -sf --max-time 8 "$url" > /dev/null 2>&1; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label FAILED"
    SMOKE_FAIL=1
  fi
}
if [ "$TARGET" = "dev" ]; then
  smoke "dev backend /health" "http://localhost:8001/health"
  smoke "dev nginx"            "http://localhost:8080/"
else
  smoke "backend /health"   "http://localhost:8000/health"
  smoke "nginx main"        "http://localhost:80/"
  smoke "kiosk via nginx"   "http://localhost:80/kiosk/"
  smoke "donate via nginx"  "http://localhost:80/donate/"
  smoke "screen via nginx"  "http://localhost:80/screen/"
fi

if [ "$SMOKE_FAIL" -ne 0 ]; then
  echo "!!! Smoke tests failed ==="
  $COMPOSE_CMD logs --tail=20 backend 2>/dev/null || \
    $COMPOSE_CMD logs --tail=20 backend-dev
  cat >> "$HISTORY_FILE" <<JSON
{"at":"$(date -u +'%Y-%m-%dT%H:%M:%SZ')","env":"${HISTORY_TAG}","sha":"${GIT_SHA}","short":"${SHORT_SHA}","branch":"${DEPLOY_BRANCH}","status":"smoke_fail","message":"${COMMIT_MSG}"}
JSON
  exit 1
fi

# ── Endpoint sanity check (catches stale images that "look healthy") ────────
# Hit a few endpoints we KNOW only exist in newer code — if any returns 404
# we're running an old image despite a "successful" restart.
echo "=== Endpoint sanity check ==="
ENDPOINT_FAIL=0
endpoint_check() {
  local label=$1 url=$2 expect=$3
  local got
  got=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$url" || echo 000)
  if [ "$got" = "$expect" ] || { [ "$expect" = "401" ] && [ "$got" = "403" ]; }; then
    echo "  ✓ $label ($got)"
  else
    echo "  ✗ $label expected $expect, got $got"
    ENDPOINT_FAIL=1
  fi
}
if [ "$TARGET" = "prod" ]; then
  endpoint_check "/health"                          "http://localhost:8000/health"                       "200"
  endpoint_check "/api/v1/admin/system/version"     "http://localhost:8000/api/v1/admin/system/version"  "401"
  endpoint_check "/api/v1/admin/system/environments" "http://localhost:8000/api/v1/admin/system/environments" "401"
  endpoint_check "/api/v1/gift-aid/gasds/buildings" "http://localhost:8000/api/v1/gift-aid/gasds/buildings"  "401"
else
  # Dev — backend exposed on 8001, dev nginx on 8080.
  endpoint_check "dev backend /health"        "http://localhost:8001/health"          "200"
  endpoint_check "dev nginx hub"              "http://localhost:8080/"                "200"
  endpoint_check "dev admin via nginx"        "http://localhost:8080/admin/"          "200"
fi

# Bulletproof admin smoketest: hit the admin's *own* internal port too
# (not just through nginx) so a working backend + broken admin is caught
# as 'admin broken' rather than 'something somewhere in the chain'.
# For dev, the admin container exposes port 80 internally. We retry up
# to 6 times with 5s gaps because the container can be still warming up
# nginx right after a force-recreate. If after 30s the smoketest still
# fails, we force-recreate the admin container ONE more time and re-test
# before giving up — last-ditch self-heal.
admin_smoketest() {
  local svc=$1
  local cname
  if [ "$TARGET" = "dev" ]; then
    cname="shitaleco-dev-${svc}-1"
  else
    cname="shitaleco-${svc}-1"
  fi
  local i
  for i in 1 2 3 4 5 6; do
    local code
    code=$(docker exec "$cname" wget -q -O /dev/null -S 'http://127.0.0.1/admin/' 2>&1 | grep -oE 'HTTP/[0-9.]+ [0-9]+' | head -1 | awk '{print $2}')
    if [ "$code" = "200" ]; then
      echo "  ✓ in-container admin smoketest (HTTP 200, attempt $i)"
      return 0
    fi
    echo "  · attempt $i — admin not serving yet (got '$code'), waiting 5s…"
    sleep 5
  done
  echo "  ✗ in-container admin smoketest FAILED after 30s — force-recreating ${cname} ONCE more"
  docker rm -f "$cname" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  $COMPOSE_CMD up -d --no-deps --force-recreate "$svc" 2>&1 | tail -10 || true
  sleep 10
  code=$(docker exec "$cname" wget -q -O /dev/null -S 'http://127.0.0.1/admin/' 2>&1 | grep -oE 'HTTP/[0-9.]+ [0-9]+' | head -1 | awk '{print $2}')
  if [ "$code" = "200" ]; then
    echo "  ✓ recovered after force-recreate (HTTP 200)"
    return 0
  fi
  echo "  ✗ admin STILL broken after final force-recreate (got '$code')"
  return 1
}

echo "=== In-container admin smoketest ==="
if [ "$TARGET" = "dev" ]; then
  admin_smoketest admin-dev || ENDPOINT_FAIL=1
else
  admin_smoketest admin || ENDPOINT_FAIL=1
fi
if [ "$ENDPOINT_FAIL" -ne 0 ]; then
  echo "WARNING: One or more sanity-check endpoints did not respond as expected."
  echo "         The deploy may have restarted with a stale image."
fi

# ── Success ─────────────────────────────────────────────────────────────────
echo "=== Deploy complete $(date) — commit ${GIT_SHA} → ${STACK_NAME} ==="

SANITY="true"
[ "${ENDPOINT_FAIL:-0}" -ne 0 ] && SANITY="false"

cat >> "$HISTORY_FILE" <<JSON
{"at":"$(date -u +'%Y-%m-%dT%H:%M:%SZ')","env":"${HISTORY_TAG}","sha":"${GIT_SHA}","short":"${SHORT_SHA}","branch":"${DEPLOY_BRANCH}","status":"success","message":"${COMMIT_MSG}","sanity_pass":${SANITY}}
JSON
