#!/usr/bin/env bash
# Run ON the Contabo VPS as root after: ssh root@169.58.179.28
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/production.env"

echo "==> Install Node 20, git, nginx, pm2 (if missing)"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get update
apt-get install -y git nginx ufw
command -v pm2 >/dev/null || npm install -g pm2

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable || true

echo "==> Clone or update repo"
mkdir -p /var/www
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  git clone "$GITHUB_REPO" "$APP_DIR"
fi

echo "==> Backend .env (upload deploy/contabo.env from your Mac first if missing)"
if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "ERROR: Copy deploy/contabo.env to $APP_DIR/backend/.env before re-running."
  echo "  From Mac: scp deploy/contabo.env root@169.58.179.28:$APP_DIR/backend/.env"
  exit 1
fi

echo "==> Install backend"
cd "$APP_DIR/backend"
npm ci --omit=dev

echo "==> Build frontend"
cd "$APP_DIR/frontend"
cat > .env.production <<EOF
VITE_API_URL=https://${DOMAIN}/api
VITE_SOCKET_URL=https://${DOMAIN}
EOF
npm ci
npm run build

echo "==> PM2 API"
cd "$APP_DIR/backend"
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start src/server.js --name "$PM2_NAME"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true
pm2 save

echo "==> Nginx"
cp "$APP_DIR/deploy/nginx-vital.conf" /etc/nginx/sites-available/vital
ln -sf /etc/nginx/sites-available/vital /etc/nginx/sites-enabled/vital
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Done. Next: bash $APP_DIR/deploy/enable-https.sh"
echo "  curl http://${DOMAIN}/api/health"
