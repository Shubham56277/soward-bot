#!/usr/bin/env bash
# Soward Bot - Server Diagnostics Script
# Reports system state without exposing secrets.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_PATH:-/opt/soward-bot}"
SERVICE_NAME="soward-bot"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT:-9090}/health"

echo "═══════════════════════════════════════════════════════════════"
echo "  SOWARD BOT - SERVER DIAGNOSTICS"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── System Info ─────────────────────────────────────────────────────────────
echo "── System ──────────────────────────────────────────────────────"
echo "Hostname:       $(hostname)"
echo "OS:             $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || echo 'unknown')"
echo "Kernel:         $(uname -r)"
echo "Uptime:         $(uptime -p 2>/dev/null || uptime)"
echo "Load Average:   $(cat /proc/loadavg 2>/dev/null | cut -d' ' -f1-3 || echo 'N/A')"
echo ""

# ─── CPU ─────────────────────────────────────────────────────────────────────
echo "── CPU ─────────────────────────────────────────────────────────"
echo "Cores:          $(nproc 2>/dev/null || echo 'N/A')"
echo "CPU Model:      $(grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo 'N/A')"
echo ""

# ─── Memory ──────────────────────────────────────────────────────────────────
echo "── Memory ──────────────────────────────────────────────────────"
free -h 2>/dev/null || echo "free command not available"
echo ""

# ─── Disk ────────────────────────────────────────────────────────────────────
echo "── Disk ────────────────────────────────────────────────────────"
df -h "$DEPLOY_DIR" 2>/dev/null || df -h / 2>/dev/null || echo "N/A"
echo ""

# ─── Node.js ─────────────────────────────────────────────────────────────────
echo "── Node.js ─────────────────────────────────────────────────────"
echo "Node:           $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Yarn:           $(yarn --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "npm:            $(npm --version 2>/dev/null || echo 'NOT INSTALLED')"
echo ""

# ─── Git ─────────────────────────────────────────────────────────────────────
echo "── Git ─────────────────────────────────────────────────────────"
if [[ -d "$DEPLOY_DIR/.git" ]]; then
    cd "$DEPLOY_DIR"
    echo "Branch:         $(git branch --show-current 2>/dev/null || echo 'N/A')"
    echo "Commit:         $(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')"
    echo "Full SHA:       $(git rev-parse HEAD 2>/dev/null || echo 'N/A')"
    echo "Last commit:    $(git log -1 --format='%s (%cr)' 2>/dev/null || echo 'N/A')"
else
    echo "No git repository at $DEPLOY_DIR"
fi
echo ""

# ─── Service Status ──────────────────────────────────────────────────────────
echo "── Service ─────────────────────────────────────────────────────"
systemctl status "$SERVICE_NAME" --no-pager -l 2>/dev/null | head -20 || echo "Service not found"
echo ""

# ─── Bot Processes ───────────────────────────────────────────────────────────
echo "── Bot Processes ─────────────────────────────────────────────────"
BOT_PROCS=$(pgrep -fa "node.*dist/index.js" 2>/dev/null || true)
if [[ -n "$BOT_PROCS" ]]; then
    echo "$BOT_PROCS"
    echo "Count: $(echo "$BOT_PROCS" | wc -l)"
else
    echo "No bot processes found."
fi
echo ""

# ─── Health Endpoint ─────────────────────────────────────────────────────────
echo "── Health Check ────────────────────────────────────────────────"
HEALTH_RESPONSE=$(curl -sf --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "UNAVAILABLE")
if [[ "$HEALTH_RESPONSE" != "UNAVAILABLE" ]]; then
    echo "$HEALTH_RESPONSE" | jq . 2>/dev/null || echo "$HEALTH_RESPONSE"
else
    echo "Health endpoint not responding at $HEALTH_URL"
fi
echo ""

# ─── Docker / Lavalink ───────────────────────────────────────────────────────
echo "── Docker / Lavalink ─────────────────────────────────────────────"
if command -v docker &>/dev/null; then
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker not running"
else
    echo "Docker not installed"
fi
echo ""

# ─── Network ─────────────────────────────────────────────────────────────────
echo "── Network ─────────────────────────────────────────────────────"
echo "Listening ports (Node/Lavalink):"
ss -tlnp 2>/dev/null | grep -E "(node|java|2333|9090|5173)" || echo "  None found"
echo ""

# ─── DNS Check ───────────────────────────────────────────────────────────────
echo "── DNS Resolution ────────────────────────────────────────────────"
echo -n "gateway.discord.gg: "
timeout 5 bash -c 'echo $(dig +short gateway.discord.gg 2>/dev/null || nslookup gateway.discord.gg 2>/dev/null | grep Address | tail -1 | awk "{print \$2}" || echo "FAILED")' 2>/dev/null || echo "TIMEOUT"
echo ""

# ─── Recent Logs ─────────────────────────────────────────────────────────────
echo "── Recent Logs (last 15 lines) ──────────────────────────────────"
journalctl -u "$SERVICE_NAME" --no-pager -n 15 --output=short-iso 2>/dev/null || echo "No logs available"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  Diagnostics complete."
echo "═══════════════════════════════════════════════════════════════"
