#!/bin/bash
set -euo pipefail

echo "=== Soward Lavalink Standalone Setup ==="

mkdir -p plugins logs
chmod 777 plugins logs

if ! command -v docker &>/dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
fi

if ! docker compose version &>/dev/null; then
    echo "Installing Docker Compose plugin..."
    apt-get install -y docker-compose-plugin
fi

echo "Starting Lavalink..."
docker compose down 2>/dev/null || true
docker compose up -d

echo "Waiting for Lavalink to start..."
sleep 30

echo "=== Lavalink Logs ==="
docker logs lavalink --tail 10

echo ""
echo "=== Setup Complete ==="
echo "Lavalink is running on port 2333"
echo "Password: SowardLavalink2025"
echo ""
echo "Connect your bot with:"
echo "  host: YOUR_SERVER_IP"
echo "  port: 2333"
echo "  authorization: SowardLavalink2025"
echo "  secure: false"
echo ""
echo "IMPORTANT: After first start, check logs for OAuth prompt:"
echo "  docker logs lavalink | grep -i oauth"
echo ""
echo "If you see a Google device code, go to https://www.google.com/device"
echo "and enter the code with a BURNER Google account."
