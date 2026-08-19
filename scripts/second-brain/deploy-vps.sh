#!/usr/bin/env bash
# Deployment is owned by the journalled Second Brain stable updater.
# Usage: deploy-vps.sh --bundle /absolute/path/to/verified/immutable/build
# Requires a matching attended approval; the actual cutover runs in systemd.
set -euo pipefail
if [[ "$#" != 2 || "$1" != --bundle ]]; then
  echo "usage: deploy-vps.sh --bundle <verified immutable build>" >&2
  exit 2
fi
exec /usr/bin/python3 "$HOME/.local/lib/second-brain/t3-stable-updater/current/t3_stable_update.py" \
  --policy "$HOME/.config/second-brain/t3-stable-policy.json" queue --bundle "$2"
