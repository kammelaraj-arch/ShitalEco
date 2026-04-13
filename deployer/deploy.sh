#!/bin/bash
set -e
LOG=/tmp/deploy-$(date +%s).log
exec >> "$LOG" 2>&1

echo "=== Deploy started $(date) ==="
cd /workspace  # this is /opt/shitaleco mounted into container

git fetch origin
git reset --hard origin/claude/shital-erp-platform-iR2UF
GIT_SHA=$(git rev-parse HEAD)
echo "=== Deploying commit ${GIT_SHA} ==="

# Run migrations
docker exec shitaleco-backend-1 sh -c "alembic stamp base && alembic upgrade head" || true

# Build images
docker build -t ghcr.io/kammelaraj-arch/shitaleco-backend:latest \
  --build-arg GIT_SHA="${GIT_SHA}" ./backend
docker build -t ghcr.io/kammelaraj-arch/shitaleco-quick-donation:latest \
  -f apps/quick-donation/Dockerfile --build-arg VITE_API_URL=/api/v1 \
  --build-arg GIT_SHA="${GIT_SHA}" .
docker build -t ghcr.io/kammelaraj-arch/shitaleco-kiosk:latest \
  --build-arg VITE_API_URL=/api/v1 --build-arg VITE_BASE=/kiosk/ \
  --build-arg GIT_SHA="${GIT_SHA}" ./apps/kiosk
docker build -t ghcr.io/kammelaraj-arch/shitaleco-screen:latest \
  --build-arg GIT_SHA="${GIT_SHA}" ./apps/screen
docker build -t ghcr.io/kammelaraj-arch/shitaleco-admin:latest \
  -f apps/admin/Dockerfile --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
  --build-arg GIT_SHA="${GIT_SHA}" .

# Rolling restart — backend first
docker compose -f docker-compose.prod.yml up -d --no-deps backend

# Wait for backend health before updating frontends
echo "=== Waiting for backend health ==="
BACKEND_OK=0
for i in $(seq 1 24); do
  sleep 5
  if curl -sf http://localhost:8000/health > /dev/null; then
    echo "Backend healthy after ${i} attempts"
    BACKEND_OK=1
    break
  fi
  echo "  attempt ${i}/24..."
done

if [ "$BACKEND_OK" -eq 0 ]; then
  echo "!!! Backend unhealthy — aborting frontend rollout ==="
  exit 1
fi

# Frontend rollout
docker compose -f docker-compose.prod.yml up -d --no-deps admin quick-donation kiosk screen
docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload 2>/dev/null || \
  docker compose -f docker-compose.prod.yml up -d --no-deps nginx

# Tag as :dev too
for svc in backend admin quick-donation kiosk screen; do
  docker tag ghcr.io/kammelaraj-arch/shitaleco-${svc}:latest \
             ghcr.io/kammelaraj-arch/shitaleco-${svc}:dev 2>/dev/null || true
done

# Restart dev stack if present
DEV_DIR=/opt/shitaleco-dev
if [ -d "$DEV_DIR/.git" ]; then
  cd "$DEV_DIR"
  git fetch origin
  git reset --hard origin/claude/shital-erp-platform-iR2UF
  docker compose -f docker-compose.dev.yml up -d --remove-orphans 2>/dev/null || true
fi

echo "=== Deploy complete $(date) — commit ${GIT_SHA} ==="
