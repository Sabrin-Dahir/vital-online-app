#!/usr/bin/env bash
# Run ON the VPS after step 7 (backend/.env exists).
# Steps 8–12: test API → PM2 → build web → Nginx → verify
set -euo pipefail

APP_DIR="/var/www/vital-fitness-online"
ENV_FILE="$APP_DIR/backend/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — finish step 7 first."
  exit 1
fi

echo "==> Step 8: Quick backend test (5s)"
cd "$APP_DIR/backend"
timeout 5 node src/server.js &
PID=$!
sleep 3
if curl -sf http://127.0.0.1:5050/api/health | grep -q connected; then
  echo "Backend OK (MongoDB connected)"
else
  echo "WARN: health check failed — check MONGO_URI and Atlas IP whitelist (169.58.179.28/32)"
fi
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true

echo "==> Step 9: PM2"
pm2 delete vital-api 2>/dev/null || true
pm2 start src/server.js --name vital-api
pm2 save

echo "==> Step 10: Build frontend"
cd "$APP_DIR/frontend"
cat > .env.production <<'EOF'
VITE_API_URL=http://169.58.179.28/api
VITE_SOCKET_URL=http://169.58.179.28
EOF
npm ci
npm run build

echo "==> Step 11: Nginx"
cat > /etc/nginx/sites-available/vital <<'NGINX'
server {
    listen 80;
    server_name 169.58.179.28;

    root /var/www/vital-fitness-online/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5050/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:5050/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/vital /etc/nginx/sites-enabled/vital
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Step 12: Verify"
curl -sf http://127.0.0.1/api/health && echo
echo "Open in browser: http://169.58.179.28"
echo "Done."
