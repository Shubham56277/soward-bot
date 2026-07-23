#!/usr/bin/env bash
# Discord Latency Diagnostic Script
# Tests connectivity to Discord gateway and REST API from this server.
# Usage: bash deploy/scripts/discord-latency-test.sh
set -euo pipefail

echo "═══════════════════════════════════════════════════════════════"
echo "  DISCORD LATENCY DIAGNOSTICS"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── DNS Resolution ──────────────────────────────────────────────────────────
echo "── DNS Resolution ────────────────────────────────────────────────"
echo -n "gateway.discord.gg: "
dig +short gateway.discord.gg 2>/dev/null || echo "FAILED"
echo -n "discord.com: "
dig +short discord.com 2>/dev/null || echo "FAILED"
echo -n "cdn.discordapp.com: "
dig +short cdn.discordapp.com 2>/dev/null || echo "FAILED"
echo ""

# ─── ICMP Ping ───────────────────────────────────────────────────────────────
echo "── ICMP Ping (5 packets) ─────────────────────────────────────────"
echo "discord.com:"
ping -c 5 -W 3 discord.com 2>/dev/null | tail -3 || echo "  ICMP blocked or host unreachable"
echo ""
echo "gateway.discord.gg:"
ping -c 5 -W 3 gateway.discord.gg 2>/dev/null | tail -3 || echo "  ICMP blocked or host unreachable"
echo ""

# ─── HTTPS/TLS Connection Timing ─────────────────────────────────────────────
echo "── HTTPS Connection to Discord REST API ──────────────────────────"
echo "Testing https://discord.com/api/v10/gateway ..."
for i in 1 2 3 4 5; do
    TIMING=$(curl -so /dev/null -w "dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s" \
        "https://discord.com/api/v10/gateway" 2>/dev/null || echo "FAILED")
    echo "  Attempt $i: $TIMING"
    sleep 0.5
done
echo ""

# ─── WebSocket Gateway Endpoint ──────────────────────────────────────────────
echo "── Discord Gateway URL ───────────────────────────────────────────"
GATEWAY_URL=$(curl -sf "https://discord.com/api/v10/gateway" 2>/dev/null | jq -r '.url' 2>/dev/null || echo "FAILED")
echo "Gateway: $GATEWAY_URL"
echo ""

# ─── TCP Connection Test (port 443) ──────────────────────────────────────────
echo "── TCP Connection Tests ──────────────────────────────────────────"
echo -n "discord.com:443 - "
timeout 5 bash -c 'echo > /dev/tcp/discord.com/443' 2>/dev/null && echo "OK" || echo "FAILED"
echo -n "gateway.discord.gg:443 - "
timeout 5 bash -c 'echo > /dev/tcp/gateway.discord.gg/443' 2>/dev/null && echo "OK" || echo "FAILED"
echo ""

# ─── AWS Region Detection ────────────────────────────────────────────────────
echo "── Server Location ───────────────────────────────────────────────"
echo -n "AWS Region: "
TOKEN=$(curl -sf --max-time 2 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null || true)
if [[ -n "$TOKEN" ]]; then
    curl -sf --max-time 2 -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/placement/region" 2>/dev/null || echo "unknown"
else
    curl -sf --max-time 2 "http://169.254.169.254/latest/meta-data/placement/region" 2>/dev/null || echo "Not on AWS or metadata unavailable"
fi
echo ""
echo -n "Availability Zone: "
if [[ -n "$TOKEN" ]]; then
    curl -sf --max-time 2 -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/placement/availability-zone" 2>/dev/null || echo "unknown"
else
    curl -sf --max-time 2 "http://169.254.169.254/latest/meta-data/placement/availability-zone" 2>/dev/null || echo "unknown"
fi
echo ""
echo -n "Instance Type: "
if [[ -n "$TOKEN" ]]; then
    curl -sf --max-time 2 -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/instance-type" 2>/dev/null || echo "unknown"
else
    curl -sf --max-time 2 "http://169.254.169.254/latest/meta-data/instance-type" 2>/dev/null || echo "unknown"
fi
echo ""
echo ""

# ─── Explanation ─────────────────────────────────────────────────────────────
echo "── Understanding Discord Latency ─────────────────────────────────"
echo ""
echo "IMPORTANT: Discord WebSocket gateway ping is NOT the same as ICMP ping."
echo ""
echo "Discord gateway latency includes:"
echo "  - Physical distance to Discord's gateway servers (US-East/US-Central)"
echo "  - TLS handshake and WebSocket overhead"
echo "  - Discord's internal routing"
echo "  - Bot event-loop delays"
echo ""
echo "Expected ranges based on AWS region:"
echo "  us-east-1 (Virginia):    60-120ms gateway ping"
echo "  us-west-2 (Oregon):      80-150ms gateway ping"
echo "  eu-west-1 (Ireland):     100-180ms gateway ping"
echo "  ap-south-1 (Mumbai):     200-350ms gateway ping"
echo "  ap-southeast-1 (Singapore): 180-280ms gateway ping"
echo ""
echo "A stable 80-150ms gateway ping is NORMAL for most regions."
echo "The goal is stability and low jitter, not achieving 1-2ms."
echo ""
echo "═══════════════════════════════════════════════════════════════"
