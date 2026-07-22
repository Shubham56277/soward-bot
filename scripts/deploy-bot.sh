#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_DIR="$ROOT_DIR/apps/bot"

cd "$ROOT_DIR"

echo "Pulling latest changes..."
git pull --rebase

echo "Installing dependencies..."
yarn install --frozen-lockfile

echo "Building bot..."
yarn workspace bot build

if command -v pm2 >/dev/null 2>&1; then
  echo "Restarting bot with pm2..."
  pm2 startOrReload "$BOT_DIR/ecosystem.config.js" --env production
  pm2 save
else
  echo "pm2 not found, starting directly..."
  node "$BOT_DIR/dist/index.js"
fi
