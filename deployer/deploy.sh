#!/bin/bash
# ── ShitalEco Production Deploy ────────────────────────────────────────────────
# Images are built by GitHub Actions and pushed to GHCR.
# This script ONLY pulls pre-built images and does a rolling restart.
# The production server NEVER builds — that's what killed it before.
# ──────────────────────────────────────────────────────────────────────────────
set -eo pipefail
LOG=/tmp/deploy-$(date +%s).log
exec >> "$LOG" 2>&1

echo "=== Deploy started $(date) ==="
cd /workspace

git fetch origin
git reset --hard origin/claude/shital-erp-platform-iR2UF
GIT_SHA=$(git rev-parse HEAD)
echo "=== Deploying commit ${GIT_SHA} ==="

# ── Login to GHCR so we can pull private images ──────────────────────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u kammelaraj-arch --password-stdin 2>/dev/null \
    && echo "Logged in to GHCR" || echo "GHCR login failed — images may already be cached"
fi

# ── Checkpoint: tag :latest as :previous before pulling ─────────────────────
for svc in backend admin quick-donation kiosk screen; do
  docker tag ghcr.io/kammelaraj-arch/shitaleco-${svc}:latest \
             ghcr.io/kammelaraj-arch/shitaleco-${svc}:previous 2>/dev/null || true
done

# ── Pull new images from GHCR (built by CI, not here) ───────────────────────
echo "=== Pulling images from GHCR ==="
docker compose -f docker-compose.prod.yml pull backend admin quick-donation kiosk screen

# ── Prune old dangling images immediately ───────────────────────────────────
docker image prune -f
docker container prune -f

# ── Rolling restart — backend first ─────────────────────────────────────────
echo "=== Rolling restart: backend ==="
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate backend

echo "=== Waiting for backend health ==="
BACKEND_OK=0
for i in $(seq 1 30); do
  sleep 5
  if curl -sf --max-time 5 http://localhost:8000/health > /dev/null 2>&1; then
    echo "Backend healthy after ${i} attempts"
    BACKEND_OK=1
    break
  fi
  echo "  attempt ${i}/30..."
done

if [ "$BACKEND_OK" -eq 0 ]; then
  echo "!!! Backend unhealthy — rolling back to :previous ==="
  docker tag ghcr.io/kammelaraj-arch/shitaleco-backend:previous \
             ghcr.io/kammelaraj-arch/shitaleco-backend:latest 2>/dev/null || true
  docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate backend
  echo "Rolled back. Frontends NOT updated."
  exit 1
fi

curl -sf -X POST http://localhost:8000/api/v1/admin/seed-catalog || true

# ── Frontend rollout ─────────────────────────────────────────────────────────
echo "=== Rolling restart: frontends ==="
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate admin quick-donation kiosk screen

echo "Waiting for admin..."
for i in $(seq 1 20); do
  sleep 4
  curl -sf --max-time 5 http://localhost:3001/admin > /dev/null 2>&1 && break
  echo "  attempt ${i}/20..."
done

docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload 2>/dev/null || \
  docker compose -f docker-compose.prod.yml up -d --no-deps nginx

# ── Smoke tests ──────────────────────────────────────────────────────────────
echo "=== Smoke tests ==="
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
smoke "backend /health"   "http://localhost:8000/health"
smoke "admin portal"      "http://localhost:3001/admin"
smoke "nginx main"        "http://localhost:80/"
smoke "kiosk via nginx"   "http://localhost:80/kiosk/"
smoke "donate via nginx"  "http://localhost:80/donate/"
smoke "screen via nginx"  "http://localhost:80/screen/"

if [ "$SMOKE_FAIL" -ne 0 ]; then
  echo "!!! Smoke tests failed ==="
  docker compose -f docker-compose.prod.yml logs --tail=20 backend
  exit 1
fi

# ── Tag :latest as :dev and refresh dev stack ────────────────────────────────
for svc in backend admin quick-donation kiosk screen; do
  docker tag ghcr.io/kammelaraj-arch/shitaleco-${svc}:latest \
             ghcr.io/kammelaraj-arch/shitaleco-${svc}:dev 2>/dev/null || true
done

DEV_DIR=/opt/shitaleco-dev
if [ -d "$DEV_DIR/.git" ]; then
  cd "$DEV_DIR"
  git fetch origin
  git reset --hard origin/claude/shital-erp-platform-iR2UF
  docker compose -f docker-compose.dev.yml up -d --remove-orphans 2>/dev/null || true
fi

echo "=== Deploy complete $(date) — commit ${GIT_SHA} ==="
