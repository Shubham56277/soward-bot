# Soward Lavalink - Railway Deployment

## Deploy to Railway

1. Push this folder as a separate GitHub repo (or use Railway's GitHub integration)
2. Railway auto-detects the `Dockerfile`
3. Add these Railway Variables:
   - `PORT` = `2333`
   - `_JAVA_OPTIONS` = `-Xms128M -Xmx768M`
4. Generate a domain in: Service → Settings → Networking → Generate Domain (target port: 2333)

## Connect Your Bot

After deployment, update your bot's `.env`:

```
NODES=[{"id":"railway","host":"YOUR-APP.up.railway.app","port":443,"authorization":"SowardLavalink2025","secure":true}]
```

## YouTube OAuth

After first deploy, check Railway logs for a Google OAuth device code.
Go to https://www.google.com/device and enter the code with a burner Google account.

The token will persist until the container restarts. For permanent persistence,
add the refresh token as a Railway Variable and update application.yml to read it.

## Files

- `Dockerfile` — Railway uses this to build the image
- `application.yml` — Lavalink configuration
- `docker-compose.yml` — For local testing only (Railway ignores this)
- `README.md` — This file
