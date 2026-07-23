# Soward Lavalink - Standalone

Run this on any VPS/server separately from the bot.

## Quick Start

```bash
# Upload this folder to your server, then:
sudo bash setup.sh
```

## After First Start

Check logs for YouTube OAuth prompt:
```bash
docker logs lavalink | grep -i "oauth\|device\|code"
```

If you see a code, go to https://www.google.com/device and enter it with a burner Google account.

## Connect Your Bot

Update your bot's NODES env variable:
```
NODES=[{"id":"Lavalink","host":"YOUR_SERVER_IP","port":2333,"authorization":"SowardLavalink2025","secure":false}]
```

## Commands

```bash
docker logs lavalink --tail 20     # view logs
docker restart lavalink            # restart
docker compose down                # stop
docker compose up -d               # start
```

## Ports

Make sure port `2333` is open in your firewall/security group (TCP inbound).

## Notes

- Use a VPS with a residential IP (DigitalOcean, Hetzner, OVH) for best YouTube results
- AWS/GCP IPs are often blocked by YouTube
- The OAuth token persists across restarts once authorized
