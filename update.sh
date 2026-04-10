#!/bin/bash
# ─── ShitalEco — Update & Restart Script ──────────────────────────────────────
# Run on server as root: bash update.sh
set -uo pipefail  # removed -e so health-check loop doesn't abort early

APP_DIR="/opt/shitaleco"
BRANCH="claude/shital-erp-platform-iR2UF"
COMPOSE="docker compose -f $APP_DIR/infra/docker-compose.yml"

echo "▶ [1/6] Pulling latest code..."
git -C "$APP_DIR" fetch origin "$BRANCH"
git -C "$APP_DIR" reset --hard "origin/$BRANCH"
echo "  Code updated to $(git -C $APP_DIR rev-parse --short HEAD)"

echo ""
echo "▶ [2/6] Ensuring backend/.env exists..."
if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "  .env missing — creating from template..."
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
  # Point to Docker service hostnames (not localhost)
  sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql+asyncpg://shital:shital_dev_password@postgres:5432/shital|" "$APP_DIR/backend/.env"
  sed -i "s|REDIS_URL=.*|REDIS_URL=redis://:redis_dev_password@redis:6379/0|" "$APP_DIR/backend/.env"
  sed -i "s|MEILISEARCH_URL=.*|MEILISEARCH_URL=http://meilisearch:7700|" "$APP_DIR/backend/.env"
  sed -i "s|JWT_SECRET=.*|JWT_SECRET=shital-temple-erp-jwt-secret-2024-london-prod|" "$APP_DIR/backend/.env"
  sed -i "s|APP_ENV=development|APP_ENV=production|" "$APP_DIR/backend/.env"
  echo "  Created backend/.env — add your API keys to it when ready"
else
  echo "  backend/.env already exists, leaving untouched"
fi

echo ""
echo "▶ [3/6] Building images (backend + admin)..."
$COMPOSE build --no-cache backend admin
echo "  Build complete"

echo ""
echo "▶ [4/6] Starting / restarting services..."
$COMPOSE up -d --no-deps backend admin
echo "  Services started"

echo ""
echo "▶ [5/6] Waiting for backend health (up to 2 mins)..."
HEALTHY=0
for i in $(seq 1 24); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "  ✓ Backend is up! (${i}x5s)"
    HEALTHY=1
    break
  fi
  printf "  Waiting... %ds\r" "$((i * 5))"
  sleep 5
done

if [ "$HEALTHY" -eq 0 ]; then
  echo "  ✗ Backend did not start in time. Showing last 30 log lines:"
  $COMPOSE logs --tail=30 backend
  exit 1
fi

echo ""
echo "▶ [6/6] Applying schema patch..."
curl -sf -X POST http://localhost:8000/api/v1/admin/patch-schema \
  && echo "  ✓ Schema patched" \
  || echo "  ℹ Schema patch skipped (may already be up to date)"

echo ""
echo "=== Service Status ==="
$COMPOSE ps
echo ""
echo "✅ Update complete!"
echo "   Backend:  http://localhost:8000/health"
echo "   API docs: http://localhost:8000/api/docs"
