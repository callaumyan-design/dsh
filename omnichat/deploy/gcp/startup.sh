#!/usr/bin/env bash
# Google Compute Engine startup script for OmniChat. Compute Engine runs it as root on every boot,
# so it both installs the app on first boot and updates it on later boots.
#
# Optional instance metadata (gcloud ... --metadata=key=value):
#   domain  chat.example.com -> HTTPS for that hostname (its DNS A record must point at this VM)
#           auto             -> HTTPS on <external-ip>.sslip.io, no domain needed
#           (unset)          -> plain HTTP on port 80
#   branch  git branch to deploy (default: main)
#   repo    git repository URL (default: this project's repository)
set -euo pipefail

meta() {
  curl -fs -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/$1" || true
}

REPO="$(meta attributes/repo)"
REPO="${REPO:-https://github.com/callaumyan-design/dsh.git}"
BRANCH="$(meta attributes/branch)"
BRANCH="${BRANCH:-main}"
DOMAIN="$(meta attributes/domain)"
SRC_DIR=/opt/omnichat-src
export OMNICHAT_DATA=/var/lib/omnichat

if [ "$DOMAIN" = "auto" ]; then
  ip="$(meta network-interfaces/0/access-configs/0/external-ip)"
  DOMAIN="${ip//./-}.sslip.io"
fi
export DOMAIN="${DOMAIN:-:80}"

# e2-micro has 1 GB of RAM; building the web app needs more, so add 2 GB of swap once.
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

cd "$SRC_DIR/omnichat"
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
docker image prune -f > /dev/null
if [ "$DOMAIN" = ":80" ]; then
  echo "OmniChat is running at http://$(meta network-interfaces/0/access-configs/0/external-ip)"
else
  echo "OmniChat is running at https://$DOMAIN"
fi
