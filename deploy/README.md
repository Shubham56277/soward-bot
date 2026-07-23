# Soward Bot - Production Deployment Guide

## Architecture

```
GitHub (push to main)
    → GitHub Actions (build verification)
        → SSH to EC2 (deploy.sh)
            → git fetch + reset
            → yarn install --frozen-lockfile
            → yarn build
            → validate build artifacts
            → systemctl restart soward-bot
            → health check
            → rollback on failure
```

## Prerequisites

- Ubuntu 22.04+ EC2 instance
- Node.js 22+
- Yarn 1.22+
- Docker (for Lavalink)
- PostgreSQL
- Redis
- Git

## Quick Setup (One-Time)

```bash
# On the EC2 instance as root:
export GITHUB_REPOSITORY_URL="git@github.com:YOUR_USER/Soward-main.git"
export PRODUCTION_BRANCH="main"
export DEPLOY_PATH="/opt/soward-bot"

curl -fsSL https://raw.githubusercontent.com/YOUR_USER/Soward-main/main/deploy/scripts/setup-server.sh | bash
```

Or clone first and run locally:

```bash
sudo GITHUB_REPOSITORY_URL="git@github.com:YOUR_USER/Soward-main.git" \
     bash /opt/soward-bot/deploy/scripts/setup-server.sh
```

## GitHub Actions Secrets Required

| Secret | Description |
|--------|-------------|
| `EC2_HOST` | EC2 public IP or hostname |
| `EC2_USER` | SSH user (typically `soward` or `ubuntu`) |
| `EC2_SSH_PRIVATE_KEY` | Private SSH key for EC2 access |
| `EC2_SSH_PORT` | SSH port (default: 22) |
| `DEPLOY_PATH` | Deployment path (default: `/opt/soward-bot`) |
| `HEALTH_PORT` | Health server port (default: `9090`) |

## AWS Security Group Rules

### Required Inbound Rules

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP / GitHub Actions IPs | SSH access |

### Required Outbound Rules

| Port | Protocol | Destination | Purpose |
|------|----------|-------------|---------|
| 443 | TCP | 0.0.0.0/0 | Discord API, Gateway, npm registry |
| 5432 | TCP | DB host | PostgreSQL |
| 6380 | TCP | Redis host | Redis |
| 80 | TCP | 0.0.0.0/0 | Package downloads |

### Ports That Must NOT Be Publicly Exposed

| Port | Service |
|------|---------|
| 9090 | Health server (localhost only) |
| 2333 | Lavalink (localhost/Docker only) |
| 5173 | API server (internal) |
| 5432 | PostgreSQL |
| 6380 | Redis |

## Operations Commands

```bash
# Check bot status
sudo systemctl status soward-bot

# View live logs
sudo journalctl -u soward-bot -f

# View recent logs
sudo journalctl -u soward-bot --since "30 minutes ago"

# Restart the bot
sudo systemctl restart soward-bot

# Stop the bot
sudo systemctl stop soward-bot

# Start the bot
sudo systemctl start soward-bot

# Check health endpoint
curl http://127.0.0.1:9090/health | jq .

# Check readiness
curl http://127.0.0.1:9090/ready

# Check metrics
curl http://127.0.0.1:9090/metrics | jq .

# Check deployed commit
cd /opt/soward-bot && git rev-parse --short HEAD

# Run diagnostics
bash /opt/soward-bot/deploy/scripts/diagnose-server.sh

# Test Discord latency
bash /opt/soward-bot/deploy/scripts/discord-latency-test.sh

# Manual deployment
cd /opt/soward-bot && bash deploy/scripts/deploy.sh main

# Check Lavalink
docker ps | grep lavalink
docker logs lavalink --tail 20

# Rollback to previous commit (manual)
cd /opt/soward-bot
git log --oneline -5  # find the commit to roll back to
git reset --hard <commit-sha>
yarn install --frozen-lockfile && yarn build
sudo systemctl restart soward-bot
```

## Environment Variables

See `deploy/env/.env.production.example` for the complete list.

Critical variables:
- `DISCORD_APP_TOKEN` - Bot token
- `DISCORD_APP_CLIENT_ID` - Application client ID
- `DATABASE_URI` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `NODES` - Lavalink node configuration (JSON)
- `NODE_ENV` - Must be `production`
- `HEALTH_PORT` - Health server port (default: 9090)

## File Permissions

```bash
# .env must be readable only by the service user
chmod 600 /opt/soward-bot/.env
chown soward:soward /opt/soward-bot/.env
```

## Monitoring

The bot exposes a health server on `127.0.0.1:9090` (localhost only) with:

- `GET /health` - Full health status JSON
- `GET /ready` - Simple readiness probe
- `GET /metrics` - Detailed metrics

A systemd timer checks health every 60 seconds and restarts after 3 consecutive failures.

## Troubleshooting

### Bot won't start
```bash
sudo journalctl -u soward-bot --since "5 minutes ago" --no-pager
```

### "Missing .env" error
```bash
sudo -u soward cp /opt/soward-bot/deploy/env/.env.production.example /opt/soward-bot/.env
sudo -u soward nano /opt/soward-bot/.env
chmod 600 /opt/soward-bot/.env
```

### Multiple bot processes
```bash
pgrep -fa "node.*dist/index.js"
# If duplicates exist:
sudo systemctl stop soward-bot
pkill -f "node.*dist/index.js"
sudo systemctl start soward-bot
```

### High gateway latency
Run the diagnostic script:
```bash
bash /opt/soward-bot/deploy/scripts/discord-latency-test.sh
```

### Lavalink not connecting
```bash
docker compose -f /opt/soward-bot/lavalink/docker-compose.yml logs --tail 50
docker compose -f /opt/soward-bot/lavalink/docker-compose.yml restart
```
