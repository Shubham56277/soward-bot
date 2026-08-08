#!/usr/bin/env bash
# Soward Bot — Fresh Linux Server Setup (Ubuntu/Debian)
# Safe to run multiple times. Stops on real errors.
# Usage: bash scripts/setup-linux.sh
set -Eeuo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()   { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
error() { echo -e "${RED}[setup]${NC} $*" >&2; }
die()   { error "$*"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log "═══════════════════════════════════════════════════════════"
log "Soward Bot — Linux Server Setup"
log "Working directory: $ROOT"
log "═══════════════════════════════════════════════════════════"
echo ""

# ─── Check we're on Linux ────────────────────────────────────────────────────
[[ "$(uname -s)" == "Linux" ]] || die "This script only runs on Linux."

# ─── System packages ─────────────────────────────────────────────────────────
log "Step 1: System packages"
if command -v apt-get &>/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq git curl build-essential ca-certificates ffmpeg redis-server postgresql postgresql-client
  log "System packages installed."
else
  die "apt-get not found. This script supports Ubuntu/Debian."
fi

# ─── Node.js ─────────────────────────────────────────────────────────────────
log "Step 2: Node.js"
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VER" -eq 22 ]]; then
    log "Node.js $(node --version) already installed."
  else
    warn "Node.js v$NODE_VER found; Node.js 22 is required. Installing v22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
    sudo apt-get install -y -qq nodejs
  fi
else
  log "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
  sudo apt-get install -y -qq nodejs
fi
log "Node: $(node --version)"

# ─── Corepack & Yarn ─────────────────────────────────────────────────────────
log "Step 3: Yarn"
sudo corepack enable 2>/dev/null || sudo npm install -g corepack
corepack prepare yarn@1.22.22 --activate 2>/dev/null || true
log "Yarn: $(yarn --version 2>/dev/null || echo 'available')"

# ─── PM2 ─────────────────────────────────────────────────────────────────────
log "Step 4: PM2"
if command -v pm2 &>/dev/null; then
  log "PM2 already installed: $(pm2 --version)"
else
  sudo npm install -g pm2
  log "PM2 installed: $(pm2 --version)"
fi

# ─── Redis ───────────────────────────────────────────────────────────────────
log "Step 5: Redis"
sudo systemctl enable redis-server 2>/dev/null || true
sudo systemctl start redis-server 2>/dev/null || true
if redis-cli PING 2>/dev/null | grep -q PONG; then
  log "Redis is running."
else
  warn "Redis did not respond. Check: sudo systemctl status redis-server"
fi

# ─── PostgreSQL ──────────────────────────────────────────────────────────────
log "Step 6: PostgreSQL"
sudo systemctl enable postgresql 2>/dev/null || true
sudo systemctl start postgresql 2>/dev/null || true
if sudo -u postgres psql -c "SELECT 1" &>/dev/null; then
  log "PostgreSQL is running."
else
  warn "PostgreSQL did not respond. Check: sudo systemctl status postgresql"
fi

# ─── Environment file ────────────────────────────────────────────────────────
log "Step 7: Environment"
if [[ -f "$ROOT/.env" ]]; then
  log ".env exists. Not overwriting."
else
  if [[ -f "$ROOT/.env.example" ]]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    warn ".env created from .env.example. EDIT IT with your real credentials:"
    warn "  nano $ROOT/.env"
  else
    die ".env and .env.example both missing. Cannot continue."
  fi
fi
chmod 600 "$ROOT/.env"

# ─── Log directory ───────────────────────────────────────────────────────────
mkdir -p "$ROOT/logs"
log "Log directory ready."

# ─── Install dependencies ────────────────────────────────────────────────────
log "Step 8: Dependencies"
yarn install --frozen-lockfile
log "Dependencies installed."

# ─── Build ───────────────────────────────────────────────────────────────────
log "Step 9: Build"
yarn build
if [[ -f "$ROOT/apps/bot/dist/index.js" ]]; then
  log "Build successful."
else
  die "Build failed: apps/bot/dist/index.js not found."
fi

# ─── Database migrations ─────────────────────────────────────────────────────
log "Step 10: Database migrations"
yarn db:migrate && log "Migrations applied." || warn "Migrations failed. Check DATABASE_URI in .env"

# ─── PM2 startup ─────────────────────────────────────────────────────────────
log "Step 11: PM2 startup configuration"
pm2 startup 2>/dev/null || true

# ─── Start bot ───────────────────────────────────────────────────────────────
log "Step 12: Starting bot"
pm2 stop soward-bot 2>/dev/null || true
pm2 delete soward-bot 2>/dev/null || true
pm2 start "$ROOT/ecosystem.config.js" --env production
pm2 save

sleep 4
if pm2 list | grep -q "online"; then
  log "Bot is ONLINE!"
else
  error "Bot may have failed to start. Check: pm2 logs soward-bot"
fi

echo ""
log "═══════════════════════════════════════════════════════════"
log "Setup complete!"
log ""
log "Commands:"
log "  yarn dashboard        — Open management dashboard"
log "  pm2 logs soward-bot   — View live logs"
log "  pm2 status            — Check process status"
log "  pm2 restart soward-bot — Restart bot"
log "═══════════════════════════════════════════════════════════"
