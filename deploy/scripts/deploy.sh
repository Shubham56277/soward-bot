#!/usr/bin/env bash
# Soward Bot - Production Deployment Script
# This script safely deploys the latest code from the production branch.
# Usage: bash deploy/scripts/deploy.sh [branch]
set -Eeuo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
DEPLOY_DIR="${DEPLOY_PATH:-/opt/soward-bot}"
BRANCH="${1:-main}"
SERVICE_NAME="soward-bot"
LOCK_FILE="/tmp/soward-deploy.lock"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT:-9090}/health"
HEALTH_TIMEOUT=60
LOG_FILE="/var/log/soward-deploy.log"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[deploy]${NC} $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[deploy] $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[deploy] $*"; }
error() { echo -e "${RED}[deploy]${NC} $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[deploy] $*"; }

cleanup() {
    rm -f "$LOCK_FILE"
}
trap cleanup EXIT

# ─── Acquire Lock ────────────────────────────────────────────────────────────
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
    error "Another deployment is already running (lock: $LOCK_FILE)"
    exit 1
fi

log "═══════════════════════════════════════════════════════════════"
log "Deployment started at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
log "═══════════════════════════════════════════════════════════════"

# ─── Validate Deployment Directory ───────────────────────────────────────────
if [[ ! -d "$DEPLOY_DIR" ]]; then
    error "Deployment directory does not exist: $DEPLOY_DIR"
    exit 1
fi

cd "$DEPLOY_DIR"

if [[ ! -d ".git" ]]; then
    error "Not a Git repository: $DEPLOY_DIR"
    exit 1
fi

# ─── Validate .env exists ────────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
    error "Missing .env file at $DEPLOY_DIR/.env"
    exit 1
fi

# ─── Record Current Commit for Rollback ──────────────────────────────────────
PREVIOUS_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
log "Current commit: $PREVIOUS_COMMIT"

# ─── Fetch and Reset to Remote ───────────────────────────────────────────────
log "Fetching latest from origin/$BRANCH..."
git fetch origin "$BRANCH" --prune

NEW_COMMIT=$(git rev-parse "origin/$BRANCH")
if [[ "$PREVIOUS_COMMIT" == "$NEW_COMMIT" ]]; then
    log "Already at latest commit ($NEW_COMMIT). Redeploying anyway."
fi

log "Resetting to origin/$BRANCH ($NEW_COMMIT)..."
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

log "New commit: $NEW_COMMIT"

# ─── Detect Package Manager ─────────────────────────────────────────────────
detect_package_manager() {
    if [[ -f "yarn.lock" ]]; then
        echo "yarn"
    elif [[ -f "pnpm-lock.yaml" ]]; then
        echo "pnpm"
    elif [[ -f "package-lock.json" ]]; then
        echo "npm"
    else
        echo "yarn"  # Default based on project config
    fi
}

PKG_MANAGER=$(detect_package_manager)
log "Detected package manager: $PKG_MANAGER"

# ─── Install Dependencies ────────────────────────────────────────────────────
log "Installing dependencies..."
case "$PKG_MANAGER" in
    yarn)
        yarn install --frozen-lockfile --production=false
        ;;
    pnpm)
        pnpm install --frozen-lockfile
        ;;
    npm)
        npm ci
        ;;
esac

# ─── Build ───────────────────────────────────────────────────────────────────
log "Building project..."
yarn build

# ─── Validate Build Output ───────────────────────────────────────────────────
BOT_ENTRY="$DEPLOY_DIR/apps/bot/dist/index.js"
if [[ ! -f "$BOT_ENTRY" ]]; then
    error "Build validation failed: $BOT_ENTRY does not exist"
    error "Rolling back to $PREVIOUS_COMMIT..."
    git reset --hard "$PREVIOUS_COMMIT"
    exit 1
fi

log "Build validated: $BOT_ENTRY exists"

# ─── Run Database Migrations ─────────────────────────────────────────────────
if [[ -d "packages/db/drizzle" ]]; then
    log "Running database migrations..."
    yarn workspace @repo/db push || {
        warn "Database migration failed, but continuing (may already be up to date)"
    }
fi

# ─── Restart Service ─────────────────────────────────────────────────────────
log "Restarting $SERVICE_NAME service..."
sudo systemctl restart "$SERVICE_NAME"

# ─── Health Check ────────────────────────────────────────────────────────────
log "Waiting for health check (timeout: ${HEALTH_TIMEOUT}s)..."
HEALTH_OK=false
ELAPSED=0
SLEEP_INTERVAL=3

# Give the service time to start
sleep 5

while [[ $ELAPSED -lt $HEALTH_TIMEOUT ]]; do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    sleep "$SLEEP_INTERVAL"
    ELAPSED=$((ELAPSED + SLEEP_INTERVAL))
done

if [[ "$HEALTH_OK" == "true" ]]; then
    log "Health check passed after ${ELAPSED}s"
else
    warn "Health check did not respond within ${HEALTH_TIMEOUT}s"
    warn "Checking if service is at least running..."
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        warn "Service is running but health endpoint not responding yet. Continuing."
    else
        error "Service is NOT running. Rolling back..."
        git reset --hard "$PREVIOUS_COMMIT"
        case "$PKG_MANAGER" in
            yarn) yarn install --frozen-lockfile --production=false ;;
            pnpm) pnpm install --frozen-lockfile ;;
            npm) npm ci ;;
        esac
        yarn build
        sudo systemctl restart "$SERVICE_NAME"
        error "Rolled back to $PREVIOUS_COMMIT and restarted."
        exit 1
    fi
fi

# ─── Verify Service Status ──────────────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE_NAME"; then
    log "Service $SERVICE_NAME is active."
else
    error "Service $SERVICE_NAME is NOT active after restart."
    exit 1
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
log "═══════════════════════════════════════════════════════════════"
log "Deployment completed successfully!"
log "Previous commit: $PREVIOUS_COMMIT"
log "Current commit:  $NEW_COMMIT"
log "Branch:          $BRANCH"
log "Service:         $SERVICE_NAME (active)"
log "Time:            $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
log "═══════════════════════════════════════════════════════════════"
