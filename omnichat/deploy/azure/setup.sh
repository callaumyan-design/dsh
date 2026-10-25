#!/usr/bin/env bash
# OmniChat setup for an Azure Linux VM (Ubuntu). Pass this file as custom data
# (az vm create ... --custom-data setup.sh): cloud-init runs it once on first boot, and it installs
# itself as /usr/local/sbin/omnichat-update plus a boot-time service, so the app is updated to the
# latest code on every later boot, or on demand with `sudo omnichat-update`.
#
# Optional VM tags (az vm create ... --tags key=value, or az vm update --set tags.key=value):
#   domain  myname.japaneast.cloudapp.azure.com or chat.example.com -> HTTPS for that hostname
#           (unset) -> plain HTTP on port 80
#   branch  git branch to deploy (default: main)
#   repo    git repository URL (default: this project's repository)
#   backup  Azure Blob container URL for off-site backups; the app reads it itself through the
#           instance metadata service and uploads with the VM's managed identity (see README)
set -euo pipefail

SELF=/usr/local/sbin/omnichat-update
if [ "$(readlink -f "$0")" != "$SELF" ]; then
  install -m 755 "$0" "$SELF"
  cat > /etc/systemd/system/omnichat-update.service <<UNIT
[Unit]
Description=Update and start OmniChat
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=$SELF

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable omnichat-update.service
fi

# Azure Instance Metadata Service; tags come back as "key1:value1;key2:value2".
TAGS="$(curl -fs --noproxy '*' -H 'Metadata: true' \
  'http://169.254.169.254/metadata/instance/compute/tags?api-version=2021-02-01&format=text' || true)"
tag() {
  printf '%s' "$TAGS" | tr ';' '\n' | sed -n "s/^$1://p" | head -n 1
}

REPO="$(tag repo)"
REPO="${REPO:-https://github.com/callaumyan-design/dsh.git}"
BRANCH="$(tag branch)"
BRANCH="${BRANCH:-main}"
DOMAIN="$(tag domain)"
export DOMAIN="${DOMAIN:-:80}"
SRC_DIR=/opt/omnichat-src
export OMNICHAT_DATA=/var/lib/omnichat

# B1s has 1 GB of RAM; building the web app needs more, so add 2 GB of swap once.
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v git > /dev/null; then
  apt-get update -y
  apt-get install -y git
fi
command -v docker > /dev/null || curl -fsSL https://get.docker.com | sh

# The database lives outside the checkout, so updating the code never touches it.
mkdir -p "$OMNICHAT_DATA"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$SRC_DIR"
fi

# Keep this script current: later runs use the version from the checked-out code.
if ! cmp -s "$SRC_DIR/omnichat/deploy/azure/setup.sh" "$SELF"; then
  install -m 755 "$SRC_DIR/omnichat/deploy/azure/setup.sh" "$SELF"
fi

cd "$SRC_DIR/omnichat"
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
docker image prune -f > /dev/null
if [ "$DOMAIN" = ":80" ]; then
  echo "OmniChat is running on port 80 (http://<public-ip>)"
else
  echo "OmniChat is running at https://$DOMAIN"
fi
