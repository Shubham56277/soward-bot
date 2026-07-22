# AWS Deployment Guide

## Recommended stack

- EC2 Ubuntu 22.04
- `pm2` for process management
- `Session Manager` for access, or SSH if you prefer
- GitHub Actions for auto-deploys
- Managed PostgreSQL and Redis if possible

## Server setup

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn pm2
```

## Clone the repo

```bash
git clone https://github.com/YOUR_USER/Soward-main.git
cd Soward-main
cp .env.example .env
```

Edit `.env` and set at least:

- `DISCORD_APP_TOKEN`
- `DISCORD_APP_CLIENT_ID`
- `DATABASE_URI`
- `REDIS_URL`
- `DEVELOPER_IDS`

## Start the bot

```bash
bash scripts/start-bot.sh
```

## PM2 startup

```bash
pm2 save
pm2 startup
```

## GitHub Actions secrets

Set these in your GitHub repo:

- `AWS_HOST`
- `AWS_USER`
- `AWS_SSH_KEY`

## Update flow

When you push to `main`, the workflow will:

1. build the project
2. connect to EC2
3. pull the latest code
4. install dependencies
5. rebuild
6. restart the bot
