#!/bin/bash
# ═════════════════════════════════════════════════════════════════════════════
#  Neuron Master Platform — Independent Deploy
#
#  This script ONLY touches the Neuron stack. It never restarts, pulls,
#  or otherwise mutates any ShitalEco service. The only "shared" action
#  is a SIGHUP to the existing nginx (graceful reload, no downtime, no
#  restart) — and only when nginx is actually present on this host.
#
#  Usage:
#    bash neuron-platform/deploy.sh                 # full deploy
#    bash neuron-platform/deploy.sh --no-pull       # skip git pull
#    bash neuron-platform/deploy.sh --no-nginx      # skip nginx reload
#    bash neuron-platform/deploy.sh --logs          # tail container logs
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# Resolve script dir → neuron-platform absolute path.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
NEURON_DIR="$SCRIPT_DIR"
COMPOSE="$NEURON_DIR/master_platform/docker-compose.yml"

# nginx is shared. We only ask it to reload its config; we never restart
# its container or touch its compose. Override with --nginx-compose to
# point elsewhere, or --no-nginx to skip the reload entirely.
NGINX_COMPOSE="${NGINX_COMPOSE:-/opt/shitaleco/docker-compose.prod.yml}"
NGINX_SERVICE="${NGINX_SERVICE:-nginx}"

DO_PULL=1
DO_NGINX=1
LOGS_AFTER=0
for arg in "$@"; do
  case $arg in
    --no-pull)  DO_PULL=0 ;;
    --no-nginx) DO_NGINX=0 ;;
    --logs)     LOGS_AFTER=1 ;;
    --nginx-compose=*) NGINX_COMPOSE="${arg#*=}" ;;
    -h|--help)
      sed -n '2,16p' "$0"; exit 0 ;;
  esac
done

R="\033[0;31m"; G="\033[0;32m"; Y="\033[1;33m"; B="\033[1m"; N="\033[0m"
ok()   { echo -e "${G}  ✓ $*${N}"; }
warn() { echo -e "${Y}  ⚠ $*${N}"; }
err()  { echo -e "${R}  ✗ $*${N}"; }
step() { echo -e "\n${B}▶ $*${N}"; }

step "Neuron Master Platform — independent deploy"
echo "  compose:        $COMPOSE"
echo "  nginx compose:  $NGINX_COMPOSE (reload only, never restart)"
echo "  pull:           $([ $DO_PULL -eq 1 ] && echo yes || echo no)"
echo "  nginx reload:   $([ $DO_NGINX -eq 1 ] && echo yes || echo no)"

# ─── 1. Sync repo (only if asked) ────────────────────────────────────────────
if [ "$DO_PULL" -eq 1 ]; then
  step "[1/5] Syncing repo"
  REPO_ROOT="$( cd -- "$NEURON_DIR/.." &> /dev/null && pwd )"
  cd "$REPO_ROOT"
  if [ -d .git ]; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git fetch origin "$BRANCH" --quiet
    git reset --hard "origin/$BRANCH"
    ok "Updated to $(git rev-parse --short HEAD) ($BRANCH)"
  else
    warn "Not a git checkout — skipping pull"
  fi
fi

# ─── 2. Build the Neuron image ───────────────────────────────────────────────
step "[2/5] Building neuron-master image"
cd "$NEURON_DIR/master_platform"
docker compose -f "$COMPOSE" build neuron-master
ok "Image built"

# ─── 3. Up only neuron-master (its own compose, own network, own volumes) ──
step "[3/5] Starting neuron-master"
docker compose -f "$COMPOSE" up -d --no-deps neuron-master
ok "Container started"

# ─── 4. Health check ────────────────────────────────────────────────────────
step "[4/5] Waiting for /healthz"
for i in $(seq 1 24); do
  if docker compose -f "$COMPOSE" exec -T neuron-master \
      python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8088/healthz').status==200 else 1)" \
      > /dev/null 2>&1; then
    ok "neuron-master healthy (${i}×2s)"
    HEALTHY=1; break
  fi
  printf "."
  sleep 2
done
echo ""
if [ -z "${HEALTHY:-}" ]; then
  err "neuron-master did NOT become healthy in 48 s"
  echo ""
  warn "Last 30 lines of container logs:"
  docker compose -f "$COMPOSE" logs --tail=30 neuron-master || true
  exit 1
fi

# ─── 5. Reload the shared nginx (no restart, no downtime) ───────────────────
if [ "$DO_NGINX" -eq 1 ]; then
  step "[5/5] Reloading shared nginx (SIGHUP, never restart)"
  if docker compose -f "$NGINX_COMPOSE" exec -T "$NGINX_SERVICE" nginx -s reload >/dev/null 2>&1; then
    ok "Nginx config reloaded"
  else
    warn "Could not reload nginx via $NGINX_COMPOSE — is the file present?"
    warn "If you run nginx differently, reload it manually with: nginx -s reload"
  fi
else
  step "[5/5] Skipping nginx reload (--no-nginx)"
fi

# ─── First-time bootstrap key hint ──────────────────────────────────────────
if docker compose -f "$COMPOSE" exec -T neuron-master \
   test -f master_platform/data/bootstrap_admin.txt 2>/dev/null; then
  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo " First-time setup detected. Copy the bootstrap admin key:"
  echo ""
  echo "   docker compose -f $COMPOSE exec neuron-master \\"
  echo "     cat master_platform/data/bootstrap_admin.txt"
  echo ""
  echo " then sign in at https://neuron.shital.org.uk/login and DELETE"
  echo " the file:"
  echo ""
  echo "   docker compose -f $COMPOSE exec neuron-master \\"
  echo "     rm master_platform/data/bootstrap_admin.txt"
  echo "─────────────────────────────────────────────────────────────"
fi

if [ "$LOGS_AFTER" -eq 1 ]; then
  docker compose -f "$COMPOSE" logs -f neuron-master
fi

echo ""
echo -e "${B}✅ Deploy complete${N} — https://neuron.shital.org.uk"
