#!/usr/bin/env bash
# One-time: point the VPS clone at Sabrin-Dahir and create SSH keys for GitHub Actions.
# Run on the VPS after the GitHub repo exists.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/production.env"

mkdir -p /root/.ssh
chmod 700 /root/.ssh

ACTIONS_KEY="/root/.ssh/github_actions_vps"
PULL_KEY="/root/.ssh/github_vps_pull"

if [ ! -f "$ACTIONS_KEY" ]; then
  ssh-keygen -t ed25519 -f "$ACTIONS_KEY" -N "" -C "github-actions-vital"
fi
grep -qF "$(cat "${ACTIONS_KEY}.pub")" /root/.ssh/authorized_keys 2>/dev/null \
  || cat "${ACTIONS_KEY}.pub" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

if [ ! -f "$PULL_KEY" ]; then
  ssh-keygen -t ed25519 -f "$PULL_KEY" -N "" -C "vps-pull-vital"
fi

GIT_SSH_HOST="github.com-vital"
cat > /root/.ssh/config <<EOF
Host ${GIT_SSH_HOST}
  HostName github.com
  User git
  IdentityFile ${PULL_KEY}
  IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config

SSH_REPO="git@${GIT_SSH_HOST}:Sabrin-Dahir/vital-online-app.git"
cd "$APP_DIR"
if [ ! -d .git ]; then
  git clone "$GITHUB_REPO" "$APP_DIR" || true
fi
git remote set-url origin "$SSH_REPO" 2>/dev/null || git remote add origin "$SSH_REPO"

echo
echo "========== GitHub setup (do this once) =========="
echo
echo "1) Create repo if missing: https://github.com/new"
echo "   Owner: Sabrin-Dahir   Name: vital-online-app"
echo
echo "2) GitHub → repo → Settings → Deploy keys → Add key (Allow write? NO)"
echo "   Title: contabo-vps-pull"
echo "   Key:"
cat "${PULL_KEY}.pub"
echo
echo "3) GitHub → repo → Settings → Secrets and variables → Actions → New repository secret"
echo "   Name: VPS_SSH_KEY"
echo "   Value (private key below — copy ALL lines including BEGIN/END):"
echo
cat "$ACTIONS_KEY"
echo
echo "Also add secrets:"
echo "   VPS_HOST = ${VPS_IP}"
echo "   VPS_USER = root"
echo
echo "Then from your Mac: git remote set-url origin ${GITHUB_REPO}"
echo "                    git push -u origin main"
echo "================================================="
