#!/usr/bin/env bash
# Soward Bot — Quick Health Check
# Usage: bash scripts/health-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISSUES=0

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${G}[✓]${NC} $*"; }
fail() { echo -e "  ${R}[✗]${NC} $*"; ISSUES=$((ISSUES + 1)); }
warn() { echo -e "  ${Y}[!]${NC} $*"; }

echo ""
echo "  Soward Bot — Health Check"
echo "  ─────────────────────────"
echo ""

# Bot process running
if pm2 jlist 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const l=JSON.parse(d);
    const p=l.find(x=>x.name==='soward-bot');
    if(p&&p.pm2_env.status==='online'){console.log('OK');process.exit(0)}
    process.exit(1)
  })" 2>/dev/null | grep -q OK; then
  pass "Bot process: online"
else
  fail "Bot process: not running"
fi

# Single instance
COUNT=$(pm2 jlist 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const l=JSON.parse(d);
    console.log(l.filter(x=>x.name==='soward-bot').length)
  })" 2>/dev/null || echo 0)
if [[ "$COUNT" == "1" ]]; then
  pass "Single instance: yes"
elif [[ "$COUNT" == "0" ]]; then
  fail "No instances found"
else
  fail "Multiple instances: $COUNT (should be 1)"
fi

# Redis
if redis-cli PING 2>/dev/null | grep -q PONG; then
  pass "Redis: responding"
else
  fail "Redis: not responding"
fi

# PostgreSQL
if sudo -u postgres psql -c "SELECT 1" &>/dev/null 2>&1; then
  pass "PostgreSQL: responding"
elif PGPASSWORD="" psql -h localhost -U postgres -c "SELECT 1" &>/dev/null 2>&1; then
  pass "PostgreSQL: responding"
else
  fail "PostgreSQL: not responding"
fi

# Build exists
if [[ -f "$ROOT/apps/bot/dist/index.js" ]]; then
  pass "Build: exists"
else
  fail "Build: dist/index.js missing"
fi

# Logs writable
if [[ -w "$ROOT/logs" ]]; then
  pass "Log directory: writable"
else
  fail "Log directory: not writable"
fi

# PM2 startup configured
if pm2 startup 2>&1 | grep -qi "already"; then
  pass "PM2 startup: configured"
else
  warn "PM2 startup: may not be configured (run: pm2 startup)"
fi

# Port 9090 (health endpoint)
if command -v curl &>/dev/null && curl -sf --max-time 3 http://127.0.0.1:9090/health &>/dev/null; then
  pass "Health endpoint: responding"
else
  warn "Health endpoint: not responding (bot may still be starting)"
fi

echo ""
if [[ $ISSUES -eq 0 ]]; then
  echo -e "  ${G}All checks passed.${NC}"
else
  echo -e "  ${R}$ISSUES issue(s) found.${NC}"
fi
echo ""
exit $ISSUES
