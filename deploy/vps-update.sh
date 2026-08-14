#!/usr/bin/env bash
# Pull latest main, rebuild frontend, restart API. Run on the VPS (also used by GitHub Actions).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/production.env"

cd "$APP_DIR"

mkdir -p /root/.ssh
touch /root/.ssh/known_hosts
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null || true

# Public HTTPS clone — avoids GitHub SSH host-key failures on first deploy.
git remote set-url origin "$GITHUB_REPO"
git fetch origin main
git checkout main
git reset --hard origin/main

cd "$APP_DIR/backend"
npm ci --omit=dev

cd "$APP_DIR/frontend"
cat > .env.production <<EOF
VITE_API_URL=https://${DOMAIN}/api
VITE_SOCKET_URL=https://${DOMAIN}
EOF
npm ci
npm run build

cd "$APP_DIR/backend"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start src/server.js --name "$PM2_NAME"
fi
pm2 save

nginx -t
systemctl reload nginx

echo "Deployed $(git -C "$APP_DIR" rev-parse --short HEAD) → https://${DOMAIN}"
curl -sf "https://${DOMAIN}/api/health" || curl -sf "http://127.0.0.1:5050/api/health" || true
echo
