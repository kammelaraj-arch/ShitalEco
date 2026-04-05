#!/bin/bash
# ─── Shital ERP — Vultr VPS Deploy Script ─────────────────────────────────────
# Run this once on a fresh Ubuntu 22.04 Vultr instance as root.
# Usage: bash deploy.sh
set -euo pipefail

REPO_URL="https://github.com/kammelaraj-arch/ShitalEco.git"
BRANCH="claude/shital-erp-platform-iR2UF"
APP_DIR="/opt/shitaleco"
DOMAIN_API="api.shital.org"
DOMAIN_ADMIN="admin.shital.org"
DOMAIN_DONATE="donate.shital.org"

echo "=== [1/6] Installing Docker ==="
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
echo "Docker $(docker --version) installed."

echo "=== [2/6] Cloning repo ==="
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "=== [3/6] Creating .env ==="
if [ ! -f "$APP_DIR/.env" ]; then
  echo "ERROR: Copy .env.example to .env and fill in values first:"
  echo "  cp $APP_DIR/.env.example $APP_DIR/.env"
  echo "  nano $APP_DIR/.env"
  echo ""
  echo "Required vars: POSTGRES_PASSWORD, JWT_SECRET"
  echo "Then re-run: bash $APP_DIR/deploy.sh"
  exit 1
fi
# Ensure production vars are set
grep -q "POSTGRES_DB" .env || echo "POSTGRES_DB=shitaleco_db" >> .env
grep -q "POSTGRES_USER" .env || echo "POSTGRES_USER=shitaleco_db_user" >> .env

echo "=== [4/6] Issuing SSL certificates ==="
# First run nginx on port 80 only (before HTTPS)
docker compose up -d nginx
sleep 3
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --non-interactive --agree-tos --email admin@shital.org \
  -d "$DOMAIN_API" -d "$DOMAIN_ADMIN" -d "$DOMAIN_DONATE" || true

echo "=== [5/6] Building & starting all services ==="
docker compose up -d --build

echo "=== [6/6] Running DB migrations and seed ==="
sleep 15  # wait for backend to be healthy
curl -s -X POST "http://localhost/api/v1/admin/patch-schema" && echo " ✓ Schema patched"
curl -s -X POST "http://localhost/api/v1/items/seed" && echo " ✓ Items seeded"

echo ""
echo "=== Deploy complete ==="
echo "  API:    https://$DOMAIN_API/health"
echo "  Admin:  https://$DOMAIN_ADMIN"
echo "  Donate: https://$DOMAIN_DONATE"
