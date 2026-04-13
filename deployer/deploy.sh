#!/bin/bash
set -e
LOG=/tmp/deploy-$(date +%s).log
exec >> "$LOG" 2>&1

echo "=== Deploy started $(date) ==="
cd /workspace  # this is /opt/shitaleco mounted into container

git fetch origin
git reset --hard origin/claude/shital-erp-platform-iR2UF

# Run migrations
docker exec shitaleco-backend-1 sh -c "alembic stamp base && alembic upgrade head" || true

# Build images
docker build -t ghcr.io/kammelaraj-arch/shitaleco-backend:latest ./backend
docker build -t ghcr.io/kammelaraj-arch/shitaleco-quick-donation:latest \
  -f apps/quick-donation/Dockerfile --build-arg VITE_API_URL=/api/v1 .
docker build -t ghcr.io/kammelaraj-arch/shitaleco-kiosk:latest \
  --build-arg VITE_API_URL=/api/v1 --build-arg VITE_BASE=/kiosk/ ./apps/kiosk
docker build -t ghcr.io/kammelaraj-arch/shitaleco-screen:latest ./apps/screen
docker build -t ghcr.io/kammelaraj-arch/shitaleco-admin:latest \
  -f apps/admin/Dockerfile --build-arg NEXT_PUBLIC_API_URL=/api/v1 .

# Rolling restart
docker compose -f docker-compose.prod.yml up -d --no-deps backend
sleep 15
docker compose -f docker-compose.prod.yml up -d --no-deps admin quick-donation kiosk screen
docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload 2>/dev/null || \
  docker compose -f docker-compose.prod.yml up -d --no-deps nginx

# Tag as :dev too
for svc in backend admin quick-donation kiosk screen; do
  docker tag ghcr.io/kammelaraj-arch/shitaleco-${svc}:latest \
             ghcr.io/kammelaraj-arch/shitaleco-${svc}:dev 2>/dev/null || true
done

echo "=== Deploy complete $(date) ==="
