#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_DIR="$ROOT_DIR/apps/bot"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Missing .env at repo root."
  exit 1
fi

if [[ ! -d "$BOT_DIR" ]]; then
  echo "Bot app not found at $BOT_DIR"
  exit 1
fi

cd "$ROOT_DIR"

echo "Installing dependencies..."
yarn install --frozen-lockfile

echo "Building bot..."
yarn workspace bot build

if command -v pm2 >/dev/null 2>&1; then
  echo "Starting bot with pm2..."
  pm2 startOrReload "$BOT_DIR/ecosystem.config.js" --env production
  pm2 save
else
  echo "pm2 not found, starting directly..."
  node "$BOT_DIR/dist/index.js"
fi
