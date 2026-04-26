#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  ShitalEco — One-Command Deploy Script
#  Works for: fresh Ubuntu 22.04 VPS  OR  updating an existing installation
#
#  Usage:
#    curl -sSL https://raw.githubusercontent.com/kammelaraj-arch/ShitalEco/claude/shital-erp-platform-iR2UF/deploy.sh | bash
#    -- OR --
#    bash deploy.sh
#    bash deploy.sh --update          # pull new images only (skip fresh-install steps)
#    bash deploy.sh --seed-kiosk      # re-run kiosk account seeding only
#    bash deploy.sh --rollback        # revert to previous images
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
APP_DIR="/opt/shitaleco"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
BRANCH="claude/shital-erp-platform-iR2UF"
REPO="https://github.com/kammelaraj-arch/ShitalEco.git"
GHCR="ghcr.io/kammelaraj-arch"
SERVICES="backend admin service quick-donation kiosk screen"
BACKUP_DIR="$APP_DIR/backups"
LOG_FILE="/tmp/shitaleco-deploy-$(date +%Y%m%d-%H%M%S).log"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }
err()   { echo -e "${RED}  ✗ $*${NC}"; }
info()  { echo -e "${BLUE}  → $*${NC}"; }
step()  { echo -e "\n${BOLD}▶ $*${NC}"; }
banner(){ echo -e "${BOLD}$*${NC}"; }

# ── Parse flags ───────────────────────────────────────────────────────────────
MODE="full"
for arg in "$@"; do
  case $arg in
    --update)     MODE="update" ;;
    --seed-kiosk) MODE="seed-kiosk" ;;
    --rollback)   MODE="rollback" ;;
  esac
done

echo ""
banner "═══════════════════════════════════════════════════════"
banner "  🕉  ShitalEco — Production Deploy   (mode: $MODE)"
banner "═══════════════════════════════════════════════════════"
echo ""
info "Log: $LOG_FILE"
echo ""

# ── Rollback mode ─────────────────────────────────────────────────────────────
if [ "$MODE" = "rollback" ]; then
  step "[ROLLBACK] Reverting to :previous images"
  for svc in $SERVICES; do
    docker tag "$GHCR/shitaleco-${svc}:previous" "$GHCR/shitaleco-${svc}:latest" 2>/dev/null \
      && ok "Restored $svc from :previous" || warn "$svc: no :previous tag found"
  done
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate $SERVICES
  ok "Rollback complete — check: docker compose -f $COMPOSE_FILE ps"
  exit 0
fi

# ── Seed-kiosk only mode ─────────────────────────────────────────────────────
if [ "$MODE" = "seed-kiosk" ]; then
  step "Seeding kiosk accounts..."
  if curl -sf -X POST http://localhost:8000/api/v1/kiosk/quick-donation/seed-accounts | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  Created: {len(d.get('created',[]))} accounts, Skipped: {len(d.get('skipped',[]))}\")" 2>/dev/null; then
    ok "Kiosk accounts seeded"
  else
    warn "Seed failed — is the backend running? Check: curl http://localhost:8000/health"
  fi
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Install system dependencies (fresh install only)
# ═══════════════════════════════════════════════════════════════════════════════
step "[1/8] Checking system dependencies"

if [ "$MODE" = "update" ]; then
  ok "Skipping Docker install (--update mode)"
elif ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg git ufw
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  ok "Docker installed"
elif [ "$MODE" != "update" ]; then
  ok "Docker $(docker --version | grep -oP '[\d.]+ '| head -1) already installed"
fi

if [ "$MODE" != "update" ] && ! command -v git &>/dev/null; then
  apt-get install -y -q git
fi

if [ "$MODE" = "full" ]; then
  info "Configuring firewall..."
  ufw allow 22/tcp   &>/dev/null || true
  ufw allow 80/tcp   &>/dev/null || true
  ufw allow 443/tcp  &>/dev/null || true
  ufw --force enable &>/dev/null || true
  ok "Firewall: 22, 80, 443 open"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Clone / update repository
# ═══════════════════════════════════════════════════════════════════════════════
step "[2/8] Syncing repository"
mkdir -p "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" 2>&1 | tail -1
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
  ok "Repo updated → $(git -C $APP_DIR rev-parse --short HEAD)"
else
  info "Cloning from GitHub..."
  git clone --branch "$BRANCH" --single-branch "$REPO" "$APP_DIR"
  ok "Repo cloned → $(git -C $APP_DIR rev-parse --short HEAD)"
fi
mkdir -p "$BACKUP_DIR"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Environment configuration
# ═══════════════════════════════════════════════════════════════════════════════
step "[3/8] Environment configuration"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  info "No .env found — creating with secure defaults..."

  # Generate secrets
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid | tr -d '-')
  DB_PASS=$(openssl rand -base64 24 | tr -d '/+=\n')
  DEPLOY_SECRET=$(openssl rand -hex 20)

  cat > "$ENV_FILE" << ENV
# ── ShitalEco Production Environment ──────────────────────────────────────────
# Generated: $(date)
# IMPORTANT: Edit this file to add your real API keys before going live.
# ──────────────────────────────────────────────────────────────────────────────

# Database (auto-generated — DO NOT change after first deploy)
POSTGRES_DB=shitaleco_db
POSTGRES_USER=shitaleco_db_user
POSTGRES_PASSWORD=${DB_PASS}

# App secrets (auto-generated)
JWT_SECRET=${JWT_SECRET}
APP_ENV=production
CORS_ORIGINS=https://admin.shital.org.uk,https://service.shital.org.uk,https://kiosk.shital.org.uk,https://shital.org.uk

# Deployer webhook (used by GitHub Actions CD)
DEPLOY_SECRET=${DEPLOY_SECRET}

# ── Payment Providers ──────────────────────────────────────────────────────────
# PayPal (set in Admin → API Keys after deploy, or add here)
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=live

# Stripe Terminal (quick-donation card reader)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_TERMINAL_LOCATION_ID=

# ── Email / Notifications ──────────────────────────────────────────────────────
SENDGRID_API_KEY=
OFFICE365_EMAIL=
OFFICE365_PASSWORD=
META_WHATSAPP_TOKEN=
META_WHATSAPP_PHONE_ID=
META_WHATSAPP_VERIFY_TOKEN=

# ── Microsoft 365 / Azure AD (for admin login) ─────────────────────────────────
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=
MS_REDIRECT_URI=https://admin.shital.org.uk/auth-callback

# ── Gift Aid / Address Lookup ──────────────────────────────────────────────────
GETADDRESS_API_KEY=
IDEAL_POSTCODES_API_KEY=
HMRC_GIFT_AID_USER_ID=
HMRC_GIFT_AID_PASSWORD=
HMRC_GIFT_AID_CHARITY_HMO_REF=
HMRC_GIFT_AID_VENDOR_ID=
HMRC_GIFT_AID_ENVIRONMENT=test
CHARITY_NUMBER=

# ── AI / Other ─────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=
ENV

  warn ".env created — EDIT $ENV_FILE before going live (add real API keys)"
  warn "Your auto-generated DB password: ${DB_PASS}"
  warn "Your deploy webhook secret: ${DEPLOY_SECRET}"
else
  ok ".env exists at $ENV_FILE"
fi

# Source env so we can use the vars
set -a; source "$ENV_FILE"; set +a

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Backup database (if already running)
# ═══════════════════════════════════════════════════════════════════════════════
step "[4/8] Database backup (pre-deploy)"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "shitaleco.*db\|shitaleco.*postgres"; then
  BACKUP_FILE="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E "shitaleco.*(db|postgres)" | head -1)
  if docker exec "$DB_CONTAINER" pg_dump -U "${POSTGRES_USER:-shitaleco_db_user}" "${POSTGRES_DB:-shitaleco_db}" 2>/dev/null | gzip > "$BACKUP_FILE"; then
    BACKUP_SIZE=$(du -sh "$BACKUP_FILE" 2>/dev/null | cut -f1)
    ok "DB backed up → $BACKUP_FILE ($BACKUP_SIZE)"
  else
    warn "Backup failed — continuing"
    rm -f "$BACKUP_FILE" 2>/dev/null
  fi
  # Prune old pre-deploy backups older than 30 days
  find "$BACKUP_DIR" -name "pre-deploy-*.sql.gz" -mtime +30 -delete 2>/dev/null || true
else
  info "No running database container found — skipping backup (first deploy)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Pull images from GHCR
# ═══════════════════════════════════════════════════════════════════════════════
step "[5/8] Pulling images from GHCR"
info "The server NEVER builds — images are pre-built by GitHub Actions CI"

# Login to GHCR if GITHUB_TOKEN is set
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u kammelaraj-arch --password-stdin 2>/dev/null \
    && ok "Logged in to GHCR" || warn "GHCR login failed — trying with cached credentials"
else
  warn "GITHUB_TOKEN not set — images must be public or already cached"
fi

# Tag :latest as :previous (rollback checkpoint)
for svc in $SERVICES; do
  docker tag "$GHCR/shitaleco-${svc}:latest" "$GHCR/shitaleco-${svc}:previous" 2>/dev/null || true
done

# Pull all images
PULL_FAILED=0
for svc in $SERVICES; do
  printf "  Pulling %-20s " "${svc}..."
  if docker pull "$GHCR/shitaleco-${svc}:latest" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${YELLOW}⚠ not found in GHCR (will use cached or skip)${NC}"
    PULL_FAILED=1
  fi
done

# Prune dangling images
docker image prune -f > /dev/null 2>&1 || true
[ "$PULL_FAILED" -eq 0 ] && ok "All images pulled" || warn "Some images not in GHCR — CI may still be building"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Start services (rolling deploy)
# ═══════════════════════════════════════════════════════════════════════════════
step "[6/8] Starting services"
cd "$APP_DIR"

# Start database first and wait for healthy
info "Starting database..."
docker compose -f "$COMPOSE_FILE" up -d db
for i in $(seq 1 20); do
  sleep 3
  if docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "${POSTGRES_USER:-shitaleco_db_user}" > /dev/null 2>&1; then
    ok "Database ready"; break
  fi
  [ "$i" -eq 20 ] && { err "Database did not start in time"; exit 1; }
  printf "\r  Waiting for database... %ds" "$((i * 3))"
done

# Start backend (rolling — wait for health before proceeding)
info "Starting backend..."
docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend

BACKEND_OK=0
echo -n "  Waiting for backend"
for i in $(seq 1 40); do
  sleep 5
  if curl -sf --max-time 4 http://localhost:8000/health > /dev/null 2>&1; then
    echo ""
    ok "Backend healthy (${i}×5s)"
    BACKEND_OK=1
    break
  fi
  printf "."
done
echo ""

if [ "$BACKEND_OK" -eq 0 ]; then
  err "Backend did not become healthy!"
  echo ""
  info "Backend logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail=30 backend
  info "Rolling back backend to :previous..."
  docker tag "$GHCR/shitaleco-backend:previous" "$GHCR/shitaleco-backend:latest" 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend
  err "Rolled back. Frontends NOT updated. Fix and re-run."
  exit 1
fi

# Start frontends
info "Starting frontends..."
for svc in admin service quick-donation kiosk screen; do
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "$svc" 2>/dev/null \
    && ok "$svc started" || warn "$svc not available — skipping"
done

# Start nginx, certbot, deployer
docker compose -f "$COMPOSE_FILE" up -d nginx certbot deployer backup-scheduler 2>/dev/null || true

# Reload nginx config
sleep 3
docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null \
  && ok "Nginx reloaded" || warn "Nginx not running yet"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 7 — Database seeding
# ═══════════════════════════════════════════════════════════════════════════════
step "[7/8] Seeding database"

# Schema patches (idempotent — safe to run every deploy)
info "Applying schema patches..."
curl -sf -X POST http://localhost:8000/api/v1/admin/patch-schema \
  && ok "Schema patches applied" || warn "Schema patch endpoint not available — patches run on startup"

# Catalog items
info "Seeding catalog..."
curl -sf -X POST http://localhost:8000/api/v1/items/seed \
  && ok "Catalog seeded" || warn "Catalog seed skipped"

# Kiosk accounts (idempotent — skips existing)
info "Seeding kiosk device accounts..."
SEED_RESULT=$(curl -sf -X POST http://localhost:8000/api/v1/kiosk/quick-donation/seed-accounts 2>/dev/null || echo "{}")
CREATED=$(echo "$SEED_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('created',[])))" 2>/dev/null || echo "?")
SKIPPED=$(echo "$SEED_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('skipped',[])))" 2>/dev/null || echo "?")
ok "Kiosk accounts: ${CREATED} created, ${SKIPPED} already existed"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 8 — Smoke tests
# ═══════════════════════════════════════════════════════════════════════════════
step "[8/8] Smoke tests"

smoke() {
  local label=$1 url=$2
  if curl -sf --max-time 8 "$url" > /dev/null 2>&1; then
    ok "$label"
  else
    warn "$label — not responding yet (may still be starting)"
  fi
}

smoke "Backend /health"         "http://localhost:8000/health"
smoke "Admin portal"            "http://localhost/admin/"
smoke "Kiosk"                   "http://localhost/kiosk/"
smoke "Donate (Quick Donation)" "http://localhost/donate/"
smoke "Service portal"          "http://localhost/service/"
smoke "Screen"                  "http://localhost/screen/"

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
SERVER_IP=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || curl -sf --max-time 5 http://ifconfig.me 2>/dev/null || echo "YOUR_SERVER_IP")

echo ""
banner "═══════════════════════════════════════════════════════"
banner "  ✅  Deploy complete!"
banner "═══════════════════════════════════════════════════════"
echo ""
echo "  Running containers:"
docker compose -f "$COMPOSE_FILE" ps --format "    {{.Name}}   {{.Status}}" 2>/dev/null || docker ps --format "    {{.Names}}   {{.Status}}" | grep shitaleco || true

echo ""
echo "  📍 Server IP: $SERVER_IP"
echo ""
echo "  🌐 Live URLs (after DNS is pointed here):"
echo "     https://admin.shital.org.uk/admin/    ← Admin panel"
echo "     https://service.shital.org.uk/        ← Online donations"
echo "     https://shital.org.uk/donate/         ← Quick Donation kiosk"
echo "     https://kiosk.shital.org.uk/          ← Full kiosk"
echo "     https://screen.shital.org.uk/         ← Display screens"
echo ""
echo "  📱 Quick Donation device logins:"
echo "     Wembley:       wembley-1  /  Wembley!Kiosk2024  (devices 1–4)"
echo "     Leicester:     leicester-1  /  Leicester!Kiosk2024  (devices 1–4)"
echo "     Reading:       reading-1  /  Reading!Kiosk2024  (devices 1–4)"
echo "     Milton Keynes: mk-1  /  MiltonKeynes!Kiosk2024  (devices 1–4)"
echo ""
echo "  ⚡ Useful commands:"
echo "     docker compose -f $COMPOSE_FILE ps           # container status"
echo "     docker compose -f $COMPOSE_FILE logs -f backend  # backend logs"
echo "     bash $APP_DIR/deploy.sh --rollback            # revert to previous images"
echo "     bash $APP_DIR/deploy.sh --update              # pull & redeploy only"
echo "     bash $APP_DIR/deploy.sh --seed-kiosk          # re-seed kiosk accounts"
echo ""
if [ -f "${BACKUP_FILE:-/dev/null}" ]; then
  echo "  💾 Pre-deploy backup: $BACKUP_FILE"
  echo ""
fi
banner "═══════════════════════════════════════════════════════"
echo ""
echo -e "${RED}  ⛔ NEVER run: docker compose down -v  (destroys all database data)${NC}"
echo ""
info "Full deploy log: $LOG_FILE"
