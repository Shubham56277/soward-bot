# Soward / Elfaria Bot

## Requirements

- Node.js v22+
- Yarn 1.22+
- Git
- PM2 (production process manager)
- PostgreSQL
- Redis

---

## Quick Start (Fresh Linux Server)

```bash
git clone <your-repo-url> ~/soward-bot
cd ~/soward-bot
cp .env.example .env
nano .env  # Fill in your credentials
bash scripts/setup-linux.sh
```

This installs everything, builds, and starts the bot via PM2.

---

## Dashboard

The dashboard is a terminal-based CLI for managing the bot in production.

```bash
yarn dashboard
```

### Dashboard Options

| # | Action | Description |
|---|--------|-------------|
| 1 | Status | Bot PID, uptime, CPU, RAM, Redis, PostgreSQL, Git info |
| 2 | Start Bot | Start via PM2 (no watchers) |
| 3 | Stop Bot | Graceful stop |
| 4 | Restart Bot | Restart existing process |
| 5 | Git Pull | Check status, stash changes, pull safely |
| 6 | Build & Restart | Install deps → build packages → build bot → stop → start |
| 7 | View Logs | Bot output, errors, dashboard logs, live follow, clear |
| 8 | Health Check | Full system validation |
| 9 | System Info | CPU, RAM, OS, load average |
| 10 | DB Migrate | Run Drizzle migrations |
| 11 | Doctor | Preflight checks (env, Redis, PostgreSQL, migrations) |
| 12 | PM2 Setup | Install PM2, configure startup, save process list |

---

## Git Pull Workflow

From the dashboard (option 5) or manually:

```bash
cd ~/soward-bot
git status          # Check for local changes
git pull            # Pull latest
```

This does NOT build or restart. Use "Build & Restart" (option 6) after pulling.

---

## Build & Restart Workflow

From the dashboard (option 6) or manually:

```bash
cd ~/soward-bot
yarn install --frozen-lockfile
yarn workspace @repo/env build
yarn workspace @repo/db build
yarn workspace bot build
pm2 stop soward-bot
pm2 delete soward-bot
pm2 start ecosystem.config.js --env production
pm2 save
```

---

## PM2 Commands

```bash
pm2 status                    # Process list
pm2 logs soward-bot           # Live logs
pm2 logs soward-bot --err     # Error logs only
pm2 restart soward-bot        # Restart
pm2 stop soward-bot           # Stop
pm2 start ecosystem.config.js # Start fresh
pm2 save                      # Save for reboot
pm2 startup                   # Auto-start on boot
```

---

## Log Locations

| Log | Path |
|-----|------|
| Bot stdout | `logs/bot-out.log` |
| Bot stderr | `logs/bot-err.log` |
| Dashboard | `logs/dashboard.log` |
| PM2 logs | `~/.pm2/logs/` |

---

## Redis & PostgreSQL Checks

```bash
redis-cli PING                           # Should return PONG
sudo systemctl status redis-server       # Service status
sudo systemctl status postgresql         # PostgreSQL status
sudo -u postgres psql -c "SELECT 1"      # Test connection
```

---

## Migration from Old Server

1. On the new server:
```bash
git clone <repo-url> ~/soward-bot
cd ~/soward-bot
```

2. Copy `.env` from old server:
```bash
scp user@old-server:~/soward-bot/.env ~/soward-bot/.env
```

3. Run setup:
```bash
bash scripts/setup-linux.sh
```

4. Verify:
```bash
bash scripts/health-check.sh
```

---

## Backup & Rollback

```bash
# Before pulling, note current commit:
git log -1 --format="%H %s"

# If something breaks after pull + build:
git reset --hard <previous-commit>
yarn build
pm2 restart soward-bot
```

---

## Common Errors & Fixes

| Error | Fix |
|-------|-----|
| `EnvironmentValidationError: OPENROUTER_API_KEYS must contain valid JSON` | Fix the JSON syntax in `.env` |
| `Cannot find module` | Run `yarn install && yarn build` |
| `ECONNREFUSED 127.0.0.1:6379` | Start Redis: `sudo systemctl start redis-server` |
| `ECONNREFUSED` PostgreSQL | Start PostgreSQL: `sudo systemctl start postgresql` |
| Bot exits immediately | Check `pm2 logs soward-bot --err` for the actual error |
| Multiple instances | `pm2 delete all && pm2 start ecosystem.config.js` |
| PM2 not restarting on reboot | Run `pm2 startup` and execute the printed command |
| Build fails | Check Node version (`node --version` needs 18+) |

---

## Configuration

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
nano .env
```

Verify with:

```bash
yarn doctor
```

---

## Premium AI

Configure provider keys in `.env`. The router tries Groq → Gemini → OpenRouter → Hugging Face.

Commands: `/ai ask`, `/ai start`, `/ai stop`, `/ai status`, `/ai reset`, `@Bot <question>`
