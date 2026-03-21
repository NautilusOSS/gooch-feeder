#!/usr/bin/env bash
# Sync this repo to the systemd deployment tree, rebuild, and restart gooch-feeder.service.
# Defaults match docs/UBUNTU_SERVICE_INSTALLATION.md (WorkingDirectory=/opt/gooch-feeder).
# Usage: from repo root — ./scripts/update-service.sh
#        or: npm run deploy:service
# Requires: rsync, npm, systemctl; re-invokes with sudo when not root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET="${TARGET:-/opt/gooch-feeder}"
SERVICE="${SERVICE_NAME:-gooch-feeder.service}"
RUN_AS="${GOOCH_FEEDER_USER:-gooch-feeder}"

if [[ "${EUID:-0}" -ne 0 ]]; then
  exec sudo bash "$SCRIPT_DIR/update-service.sh" "$@"
fi

if [[ ! -d "$TARGET" ]]; then
  echo "error: deployment directory not found: $TARGET" >&2
  exit 1
fi

if ! id "$RUN_AS" &>/dev/null; then
  echo "error: system user not found: $RUN_AS" >&2
  exit 1
fi

echo "Syncing $REPO_ROOT -> $TARGET ..."
rsync -av --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude .env \
  "$REPO_ROOT/" "$TARGET/"

chown -R "$RUN_AS:$RUN_AS" "$TARGET"

echo "Building as $RUN_AS ..."
sudo -u "$RUN_AS" bash -c "cd \"$TARGET\" && npm run build"

echo "Restarting $SERVICE ..."
systemctl restart "$SERVICE"
systemctl --no-pager status "$SERVICE"

echo "Done."
