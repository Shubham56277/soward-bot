#!/usr/bin/env bash
# Soward Bot - Health Check Script (used by systemd timer)
# Checks if the bot is healthy and restarts if necessary.
set -euo pipefail

SERVICE_NAME="soward-bot"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT:-9090}/health"
LOCK_FILE="/tmp/soward-deploy.lock"
MAX_FAILURES=3
STATE_FILE="/tmp/soward-health-failures"

# Don't interfere with active deployments
if [[ -d "$LOCK_FILE" ]]; then
    echo "[health] Deployment in progress, skipping health check."
    exit 0
fi

# Don't restart too frequently
if [[ -f "/tmp/soward-health-restart-cooldown" ]]; then
    LAST_RESTART=$(cat /tmp/soward-health-restart-cooldown)
    NOW=$(date +%s)
    DIFF=$((NOW - LAST_RESTART))
    if [[ $DIFF -lt 300 ]]; then
        echo "[health] Restart cooldown active (${DIFF}s since last restart). Skipping."
        exit 0
    fi
fi

# Check if service is supposed to be running
if ! systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "[health] Service is not enabled. Skipping."
    exit 0
fi

# Check health endpoint
if curl -sf --max-time 10 "$HEALTH_URL" > /dev/null 2>&1; then
    # Reset failure counter on success
    rm -f "$STATE_FILE"
    exit 0
fi

# Health check failed
FAILURES=0
if [[ -f "$STATE_FILE" ]]; then
    FAILURES=$(cat "$STATE_FILE")
fi
FAILURES=$((FAILURES + 1))
echo "$FAILURES" > "$STATE_FILE"

echo "[health] Health check failed ($FAILURES/$MAX_FAILURES)"

if [[ $FAILURES -ge $MAX_FAILURES ]]; then
    echo "[health] Max failures reached. Restarting $SERVICE_NAME..."
    sudo systemctl restart "$SERVICE_NAME"
    rm -f "$STATE_FILE"
    date +%s > /tmp/soward-health-restart-cooldown
    echo "[health] Service restarted at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
fi
