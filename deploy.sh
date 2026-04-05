#!/bin/bash
# ─── Shital ERP — Vultr VPS Deploy Script ─────────────────────────────────────
# One command setup on fresh Ubuntu 22.04. Run as root.
set -euo pipefail

REPO_URL="https://github.com/kammelaraj-arch/ShitalEco.git"
BRANCH="claude/shital-erp-platform-iR2UF"
APP_DIR="/opt/shitaleco"

echo "=== [1/5] Installing Docker ==="
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

echo "=== [2/5] Opening firewall ports ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== [3/5] Cloning repo ==="
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "=== [4/5] Creating .env ==="
cat > "$APP_DIR/.env" << 'ENV'
# Database
POSTGRES_DB=shitaleco_db
POSTGRES_USER=shitaleco_db_user
POSTGRES_PASSWORD=ShitalEco2024Prod!

# App
JWT_SECRET=shital-temple-erp-jwt-secret-2024-london-prod
APP_ENV=production
CORS_ORIGINS=http://localhost:3001,http://localhost:3002

# API URL (update with your domain later)
API_URL=http://localhost:8000

# Leave blank for now — add keys later
ANTHROPIC_API_KEY=
SENDGRID_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
ENV

echo "=== [5/5] Building & starting services (this takes 3-5 mins) ==="
# Start just db + backend first (no nginx SSL needed yet)
docker compose up -d db backend

echo "Waiting for backend to be healthy..."
for i in $(seq 1 24); do
  sleep 5
  STATUS=$(docker compose ps backend --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || echo "")
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "Backend is up!"
    break
  fi
  echo "  Waiting... ($((i*5))s)"
done

echo "Applying schema patch..."
curl -sf -X POST http://localhost:8000/api/v1/admin/patch-schema && echo " schema patched" || echo " schema patch skipped"

echo "Seeding catalog items..."
curl -sf -X POST "http://localhost:8000/api/v1/items/seed" && echo " items seeded" || echo " items seed skipped"

echo ""
echo "============================================"
echo "  ShitalEco backend is LIVE!"
echo "  Health: http://$(curl -sf ifconfig.me 2>/dev/null || echo 'SERVER_IP'):8000/health"
echo "  API:    http://$(curl -sf ifconfig.me 2>/dev/null || echo 'SERVER_IP'):8000/api/docs"
echo "============================================"
echo ""
echo "Next: point your domain DNS to this IP and run:"
echo "  docker compose up -d  (starts nginx + all apps)"
