#!/usr/bin/env bash
# Legacy deploy script - redirects to new deployment system.
# Use deploy/scripts/deploy.sh for production deployments.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/deploy/scripts/deploy.sh" ]]; then
    exec bash "$ROOT_DIR/deploy/scripts/deploy.sh" "${1:-main}"
fi

# Fallback: original behavior
cd "$ROOT_DIR"

echo "Pulling latest changes..."
git fetch origin main
git reset --hard origin/main

echo "Installing dependencies..."
yarn install --frozen-lockfile

echo "Building bot..."
yarn workspace bot build

if [[ ! -f "$ROOT_DIR/apps/bot/dist/index.js" ]]; then
    echo "ERROR: Build failed - dist/index.js not found"
    exit 1
fi

if systemctl is-active --quiet soward-bot 2>/dev/null; then
    echo "Restarting bot via systemd..."
    sudo systemctl restart soward-bot
elif command -v pm2 >/dev/null 2>&1; then
    echo "Restarting bot with pm2..."
    pm2 startOrReload "$ROOT_DIR/apps/bot/ecosystem.config.js" --env production
    pm2 save
else
    echo "pm2 and systemd not available, starting directly..."
    node "$ROOT_DIR/apps/bot/dist/index.js"
fi
