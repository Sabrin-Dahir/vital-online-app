#!/usr/bin/env bash
# One-time HTTPS on the VPS: Let's Encrypt + CORS URLs + frontend rebuild.
# Usage (on the server): bash /var/www/vital-fitness-online/deploy/enable-https.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/production.env"

ENV_FILE="$APP_DIR/backend/.env"
WEBROOT="/var/www/letsencrypt"
SITE="/etc/nginx/sites-available/vital"

apt-get update
apt-get install -y certbot python3-certbot-nginx

mkdir -p "$WEBROOT"
ufw allow 80
ufw allow 443

cp "$SCRIPT_DIR/nginx-vital.conf" "$SITE"
sed -i "s/server_name .*/server_name ${VPS_IP} ${DOMAIN};/" "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/vital
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot --nginx -d "$DOMAIN" \
  --non-interactive --agree-tos --register-unsafely-without-email --redirect

if [ -f "$ENV_FILE" ]; then
  sed -i "s|^CLIENT_URL=.*|CLIENT_URL=https://${DOMAIN}|" "$ENV_FILE"
  sed -i "s|^PUBLIC_WEB_URL=.*|PUBLIC_WEB_URL=https://${DOMAIN}|" "$ENV_FILE"
fi

cd "$APP_DIR/frontend"
cat > .env.production <<EOF
VITE_API_URL=https://${DOMAIN}/api
VITE_SOCKET_URL=https://${DOMAIN}
EOF
npm ci
npm run build

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
fi
systemctl reload nginx

echo
echo "HTTPS is live: https://${DOMAIN}"
echo "API health:    https://${DOMAIN}/api/health"
curl -sf "https://${DOMAIN}/api/health" || true
echo
