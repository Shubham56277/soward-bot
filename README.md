# Required tools

- Node.js v22 or higher
- Yarn
- Git
- pm2

# Database

- PostgreSQL
- Redis


# Installation

```bash
yarn install
```

# Configuration

Copy `.env.example` to `.env`

```bash

cp .env.example .env

```

# Verify configuration and services

Before building or migrating, run the secret-safe preflight:

```bash
yarn doctor
```

It validates `.env` JSON, PostgreSQL authentication, Redis connectivity, Docker/container state when Docker is installed, and Drizzle migration integrity without printing credential values. Fix every reported failure before continuing.

For a fresh clone that uses an existing PostgreSQL database:

```bash
yarn install
yarn doctor
yarn db:migrate
yarn build
yarn bot:start
```

For an optional local Docker PostgreSQL database, run `yarn db:local` once after creating `.env`; it generates non-default local credentials and writes a matching URL-encoded `DATABASE_URI`.

# Running

```bash
yarn bot:start
```

# Premium AI

Configure at least one server-side provider key in `.env`. The router tries Groq, Gemini, OpenRouter, then Hugging Face. With `AI_RACE_MODE=false`, it only calls the next provider after a timeout or failure. Race mode calls Groq and Gemini together and therefore uses more quota.

Commands:

```text
/ai ask question:<text>
/ai start
/ai stop
/ai status
/ai reset
@Bot <question>
@Bot start
@Bot stop
```

AI access is premium. Conversation state, bounded history, distributed request locks, rate limits, provider cooldowns, and repeated one-off answer caching use Redis. API keys are never sent to Discord or stored in Redis.

# Scaling

The bot already uses automatic Discord sharding and shared Redis state, so multiple bot processes can handle different shards consistently. For larger deployments:

- Run Redis and PostgreSQL as managed services with backups and private networking.
- Run multiple cluster processes under PM2 or a container orchestrator.
- Keep `AI_MAX_CONCURRENCY` conservative per process and set limits that match paid provider quotas.
- Use sequential provider fallback for normal traffic; reserve race mode for latency-sensitive paid plans.
- Add queue workers for slow background work, but keep interactive AI replies on the request path to avoid extra queue latency.
