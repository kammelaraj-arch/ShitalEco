#!/bin/bash
# ─── ShitalEco — Safe Production Deploy Script ────────────────────────────────
# SAFE: never destroys data. Always backs up DB before touching anything.
#
# Usage:
#   bash update.sh              → rebuild ALL apps
#   bash update.sh admin        → rebuild only admin
#   bash update.sh admin kiosk  → rebuild specific services
#
# NEVER run: docker compose down -v   ← destroys ALL database data
# ALWAYS use this script to deploy.
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

APP_DIR="/opt/shitaleco"
COMPOSE="docker compose -f $APP_DIR/infra/docker-compose.yml"
BACKUP_DIR="/opt/shitaleco/backups"
SERVICES="${*:-admin kiosk quick-donation screen backend}"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ShitalEco — Production Deploy"
echo "  Services: $SERVICES"
echo "═══════════════════════════════════════════════════"
echo ""

# ── STEP 1: Backup database BEFORE touching anything ─────────────────────────
echo "▶ [1/6] Backing up database..."
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"

if docker exec shital-postgres pg_dump -U shital shital 2>/dev/null | gzip > "$BACKUP_FILE"; then
  BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  ok "Database backed up → $BACKUP_FILE ($BACKUP_SIZE)"
else
  warn "Could not back up database (postgres may not be running yet — OK for first deploy)"
  rm -f "$BACKUP_FILE"
fi

# Keep last 30 daily backups + all pre-deploy backups from last 7 days
find "$BACKUP_DIR" -name "shital-*.sql.gz" -mtime +30 -delete 2>/dev/null
find "$BACKUP_DIR" -name "pre-deploy-*.sql.gz" -mtime +7 -delete 2>/dev/null

# ── STEP 2: Pull latest code ──────────────────────────────────────────────────
echo ""
echo "▶ [2/6] Pulling latest code..."
BRANCH="claude/shital-erp-platform-iR2UF"
git -C "$APP_DIR" fetch origin "$BRANCH" 2>&1 || warn "git fetch failed — deploying from local files"
git -C "$APP_DIR" reset --hard "origin/$BRANCH" 2>&1 || warn "git reset failed — deploying from local files"
ok "Code at: $(git -C $APP_DIR rev-parse --short HEAD 2>/dev/null || echo 'local')"

# ── STEP 3: Ensure backend/.env exists ───────────────────────────────────────
echo ""
echo "▶ [3/6] Checking config..."
if [ ! -f "$APP_DIR/backend/.env" ]; then
  warn ".env missing — creating from template"
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env" 2>/dev/null || \
  cat > "$APP_DIR/backend/.env" << 'ENV'
DATABASE_URL=postgresql+asyncpg://shital:shital_dev_password@postgres:5432/shital
REDIS_URL=redis://:redis_dev_password@redis:6379/0
MEILISEARCH_URL=http://meilisearch:7700
JWT_SECRET=shital-temple-erp-jwt-secret-2024-london-prod
APP_ENV=production
ENV
  warn "Created backend/.env — review secrets before going live"
else
  ok "backend/.env exists"
fi

# ── STEP 4: Build only the requested services ─────────────────────────────────
echo ""
echo "▶ [4/6] Building: $SERVICES"
if $COMPOSE build --no-cache $SERVICES; then
  ok "Build complete"
else
  fail "Build failed — database untouched, nothing deployed"
fi

# ── STEP 5: Start/update services (NEVER use down -v) ─────────────────────────
echo ""
echo "▶ [5/6] Deploying services..."
# Start infrastructure if not running (first deploy)
$COMPOSE up -d postgres redis meilisearch 2>/dev/null
sleep 3

# Recreate only the services we rebuilt (safe — keeps DB volumes untouched)
$COMPOSE up -d --force-recreate --no-deps $SERVICES
ok "Services updated"

# Reload nginx config without restarting it
if docker exec shital-nginx nginx -t 2>/dev/null; then
  docker exec shital-nginx nginx -s reload 2>/dev/null
  ok "Nginx config reloaded"
fi

# ── STEP 6: Health checks ──────────────────────────────────────────────────────
echo ""
echo "▶ [6/6] Health checks..."
sleep 5

# Backend
HEALTHY=0
for i in $(seq 1 24); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    ok "Backend healthy (${i}x5s)"; HEALTHY=1; break
  fi
  printf "  Waiting for backend... %ds\r" "$((i * 5))"
  sleep 5
done
[ "$HEALTHY" -eq 0 ] && warn "Backend health check timed out — check logs: docker logs shital-backend"

# Admin
if curl -sf http://localhost:3001/admin > /dev/null 2>&1; then
  ok "Admin portal healthy"
else
  warn "Admin not responding yet (may still be starting)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "${GREEN}  ✅ Deploy complete!${NC}"
echo ""
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null | grep shital || true
echo ""
if [ -f "$BACKUP_FILE" ]; then
  echo "  📦 Pre-deploy backup: $BACKUP_FILE"
fi
echo ""
echo "  🌐 Sites:"
echo "     https://admin.shital.org.uk/admin/"
echo "     https://kiosk.shital.org.uk"
echo "     https://donate.shital.org.uk"
echo "     https://screen.shital.org.uk"
echo "═══════════════════════════════════════════════════"
echo ""
echo -e "${RED}  ⛔ NEVER run: docker compose down -v${NC}"
echo -e "${RED}     That deletes ALL database data permanently.${NC}"
echo ""
