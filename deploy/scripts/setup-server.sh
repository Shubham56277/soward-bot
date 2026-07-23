#!/usr/bin/env bash
# Soward Bot - Initial Server Setup Script
# Idempotent: safe to run multiple times.
# Usage: bash deploy/scripts/setup-server.sh
set -Eeuo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
DEPLOY_DIR="${DEPLOY_PATH:-/opt/soward-bot}"
SERVICE_USER="soward"
NODE_VERSION="22"
REPO_URL="${GITHUB_REPOSITORY_URL:-}"
BRANCH="${PRODUCTION_BRANCH:-main}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
error() { echo -e "${RED}[setup]${NC} $*"; }

# ─── Check Root ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root (use sudo)."
    exit 1
fi

# ─── Check Ubuntu ────────────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    log "OS: $PRETTY_NAME"
else
    warn "Cannot detect OS version. Proceeding anyway."
fi

# ─── Update Package Metadata ─────────────────────────────────────────────────
log "Updating package lists..."
apt-get update -qq

# ─── Install System Dependencies ─────────────────────────────────────────────
log "Installing system dependencies..."
apt-get install -y -qq \
    curl \
    git \
    build-essential \
    ca-certificates \
    gnupg \
    unzip \
    jq \
    htop \
    flock \
    fontconfig \
    libfontconfig1 \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    python3

# ─── Install Node.js (via NodeSource) ────────────────────────────────────────
if command -v node &>/dev/null; then
    CURRENT_NODE=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$CURRENT_NODE" -ge "$NODE_VERSION" ]]; then
        log "Node.js $(node --version) already installed."
    else
        warn "Node.js $CURRENT_NODE found but need $NODE_VERSION+. Upgrading..."
        INSTALL_NODE=true
    fi
else
    INSTALL_NODE=true
fi

if [[ "${INSTALL_NODE:-}" == "true" ]]; then
    log "Installing Node.js $NODE_VERSION..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y -qq nodejs
    log "Node.js $(node --version) installed."
fi

# ─── Enable Corepack (for Yarn) ──────────────────────────────────────────────
log "Enabling Corepack..."
corepack enable || npm install -g corepack
corepack prepare yarn@1.22.22 --activate 2>/dev/null || true
log "Yarn version: $(yarn --version 2>/dev/null || echo 'not yet available')"

# ─── Install Docker (for Lavalink) ───────────────────────────────────────────
if command -v docker &>/dev/null; then
    log "Docker already installed: $(docker --version)"
else
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
    log "Docker installed: $(docker --version)"
fi

# Install Docker Compose plugin if missing
if ! docker compose version &>/dev/null; then
    log "Installing Docker Compose plugin..."
    apt-get install -y -qq docker-compose-plugin
fi

# ─── Create Service User ─────────────────────────────────────────────────────
if id "$SERVICE_USER" &>/dev/null; then
    log "User '$SERVICE_USER' already exists."
else
    log "Creating user '$SERVICE_USER'..."
    useradd --system --shell /bin/bash --home-dir "$DEPLOY_DIR" --create-home "$SERVICE_USER"
fi

# Add user to docker group
usermod -aG docker "$SERVICE_USER" 2>/dev/null || true

# ─── Create Deployment Directory ─────────────────────────────────────────────
if [[ -d "$DEPLOY_DIR/.git" ]]; then
    log "Repository already cloned at $DEPLOY_DIR"
else
    if [[ -z "$REPO_URL" ]]; then
        error "GITHUB_REPOSITORY_URL is not set. Please provide it:"
        error "  GITHUB_REPOSITORY_URL=git@github.com:user/repo.git bash setup-server.sh"
        exit 1
    fi
    log "Cloning repository to $DEPLOY_DIR..."
    if [[ -d "$DEPLOY_DIR" ]]; then
        # Directory exists but isn't a git repo - back up and clone
        mv "$DEPLOY_DIR" "${DEPLOY_DIR}.bak.$(date +%s)"
    fi
    git clone --branch "$BRANCH" "$REPO_URL" "$DEPLOY_DIR"
fi

# ─── Set Ownership ───────────────────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$DEPLOY_DIR"

# ─── Create logs directory ───────────────────────────────────────────────────
mkdir -p "$DEPLOY_DIR/logs"
chown "$SERVICE_USER:$SERVICE_USER" "$DEPLOY_DIR/logs"

# ─── Environment File ────────────────────────────────────────────────────────
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
    if [[ -f "$DEPLOY_DIR/deploy/env/.env.production.example" ]]; then
        cp "$DEPLOY_DIR/deploy/env/.env.production.example" "$DEPLOY_DIR/.env"
        warn ".env created from template. You MUST edit it with real credentials:"
        warn "  sudo -u $SERVICE_USER nano $DEPLOY_DIR/.env"
    else
        warn "No .env file found. Create one at: $DEPLOY_DIR/.env"
    fi
fi
chmod 600 "$DEPLOY_DIR/.env"
chown "$SERVICE_USER:$SERVICE_USER" "$DEPLOY_DIR/.env"

# ─── Install Dependencies & Build ────────────────────────────────────────────
log "Installing dependencies..."
cd "$DEPLOY_DIR"
sudo -u "$SERVICE_USER" bash -c "cd $DEPLOY_DIR && yarn install --frozen-lockfile --production=false"

log "Building project..."
sudo -u "$SERVICE_USER" bash -c "cd $DEPLOY_DIR && yarn build"

# ─── Validate Build ──────────────────────────────────────────────────────────
if [[ ! -f "$DEPLOY_DIR/apps/bot/dist/index.js" ]]; then
    error "Build failed: apps/bot/dist/index.js not found."
    exit 1
fi
log "Build validated."

# ─── Install systemd Service ─────────────────────────────────────────────────
log "Installing systemd service..."
cp "$DEPLOY_DIR/deploy/systemd/soward-bot.service" /etc/systemd/system/soward-bot.service
cp "$DEPLOY_DIR/deploy/systemd/soward-bot-health.service" /etc/systemd/system/soward-bot-health.service
cp "$DEPLOY_DIR/deploy/systemd/soward-bot-health.timer" /etc/systemd/system/soward-bot-health.timer

systemctl daemon-reload
systemctl enable soward-bot
systemctl enable soward-bot-health.timer

# ─── Make Deploy Scripts Executable ──────────────────────────────────────────
chmod +x "$DEPLOY_DIR/deploy/scripts/"*.sh

# ─── Allow Service User to Restart Bot (sudoers) ─────────────────────────────
SUDOERS_FILE="/etc/sudoers.d/soward-bot"
if [[ ! -f "$SUDOERS_FILE" ]]; then
    log "Adding sudoers rule for $SERVICE_USER..."
    cat > "$SUDOERS_FILE" <<EOF
# Allow soward user to manage the bot service
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart soward-bot
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop soward-bot
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start soward-bot
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl status soward-bot
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
EOF
    chmod 440 "$SUDOERS_FILE"
fi

# ─── Start Lavalink ──────────────────────────────────────────────────────────
if [[ -f "$DEPLOY_DIR/lavalink/docker-compose.yml" ]]; then
    log "Starting Lavalink container..."
    cd "$DEPLOY_DIR/lavalink"
    docker compose up -d
    cd "$DEPLOY_DIR"
fi

# ─── Start Bot ───────────────────────────────────────────────────────────────
log "Starting soward-bot service..."
systemctl start soward-bot
systemctl start soward-bot-health.timer

# ─── Verify ──────────────────────────────────────────────────────────────────
sleep 5
if systemctl is-active --quiet soward-bot; then
    log "Service is running!"
else
    warn "Service may still be starting. Check with:"
    warn "  sudo journalctl -u soward-bot -f"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
log "═══════════════════════════════════════════════════════════════"
log "Server setup complete!"
log ""
log "Next steps:"
log "  1. Edit .env with real credentials:"
log "     sudo -u $SERVICE_USER nano $DEPLOY_DIR/.env"
log ""
log "  2. Restart after editing .env:"
log "     sudo systemctl restart soward-bot"
log ""
log "  3. View logs:"
log "     sudo journalctl -u soward-bot -f"
log ""
log "  4. Check health:"
log "     curl http://127.0.0.1:9090/health"
log ""
log "  5. Run diagnostics:"
log "     bash $DEPLOY_DIR/deploy/scripts/diagnose-server.sh"
log "═══════════════════════════════════════════════════════════════"
