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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --promote-prod) PROMOTE=1; TARGET="prod"; shift ;;
    *) echo "Unknown arg: $1"; shift ;;
  esac
done

echo "=== Deploy started $(date) — target=${TARGET} promote=${PROMOTE} ==="
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

# ── Promote: retag :dev → :latest BEFORE pulling/restarting prod ────────────
if [ "$PROMOTE" -eq 1 ]; then
  echo "=== Promoting :dev → :latest ==="
  docker pull "ghcr.io/kammelaraj-arch/shitaleco-backend:dev"
  for svc in backend admin quick-donation kiosk screen service; do
    img="ghcr.io/kammelaraj-arch/shitaleco-${svc}"
    # Snapshot current :latest as :previous (rollback target)
    docker tag "${img}:latest" "${img}:previous" 2>/dev/null || true
    # Promote :dev → :latest
    if docker pull "${img}:dev" 2>/dev/null; then
      docker tag "${img}:dev" "${img}:latest"
      echo "  ✓ promoted ${svc}"
    else
      echo "  - skipped ${svc} (no :dev image)"
    fi
  done
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

echo "=== Pulling images for ${STACK_NAME} stack ==="
if [ "$TARGET" = "dev" ]; then
  # Dev stack pulls :dev (most CI builds)
  docker compose -f "$COMPOSE" pull 2>&1 | tail -10 || true
elif [ "$PROMOTE" -eq 1 ]; then
  # Prod promotion path — :latest was JUST retagged from :dev locally above.
  # Skip the registry pull so we don't overwrite our promotion with whatever
  # stale :latest happens to be on GHCR (CI builds :dev, not :latest, so the
  # registry's :latest is from before the dev/prod split).
  echo "Skipping docker pull — using locally promoted :latest tags"
else
  # Plain prod deploy (no promotion) — fall back to pulling :latest from GHCR
  docker compose -f "$COMPOSE" pull backend admin quick-donation kiosk screen 2>&1 | tail -10 || true
  docker compose -f "$COMPOSE" pull service 2>/dev/null || \
    echo "service image not yet in GHCR — skipping pull"
fi

docker image prune -f
docker container prune -f

# ── Rolling restart — backend first ─────────────────────────────────────────
echo "=== Rolling restart: backend (${STACK_NAME}) ==="
docker compose -f "$COMPOSE" up -d --no-deps --force-recreate backend 2>/dev/null || \
  docker compose -f "$COMPOSE" up -d --no-deps --force-recreate backend-dev

echo "=== Waiting for backend health (${HEALTH_URL}) ==="
BACKEND_OK=0
for i in $(seq 1 30); do
  sleep 5
  if curl -sf --max-time 5 "$HEALTH_URL" > /dev/null 2>&1; then
    echo "Backend healthy after ${i} attempts"
    BACKEND_OK=1
    break
  fi
  echo "  attempt ${i}/30..."
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
    docker compose -f "$COMPOSE" up -d --no-deps --force-recreate backend
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
  docker compose -f "$COMPOSE" up -d --no-deps --force-recreate \
    admin-dev quick-donation-dev kiosk-dev screen-dev 2>/dev/null || true
else
  docker compose -f "$COMPOSE" up -d --no-deps --force-recreate admin quick-donation kiosk screen
  docker compose -f "$COMPOSE" up -d --no-deps --force-recreate service 2>/dev/null || \
    echo "service container not yet available — skipping"

  # Reload nginx (prod only — dev nginx auto-reloads)
  docker compose -f "$COMPOSE" exec -T nginx nginx -s reload 2>/dev/null || \
    docker compose -f "$COMPOSE" up -d --no-deps nginx
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
  docker compose -f "$COMPOSE" logs --tail=20 backend 2>/dev/null || \
    docker compose -f "$COMPOSE" logs --tail=20 backend-dev
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
