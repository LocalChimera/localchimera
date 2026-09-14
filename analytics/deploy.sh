#!/bin/bash
# Deploy chimera-analytics worker
# Usage: ./deploy.sh [localchimera|terexmaps]

set -e

ACCOUNT="${1:-localchimera}"
WRANGLER_CONFIG="/home/terex/.wrangler/config/default.toml"
LOCALCHIMERA_CONFIG="/home/terex/.wrangler/config/localchimera.toml"
TEREXMAPS_CONFIG="/home/terex/.wrangler/config/terexmaps.toml"

cd "$(dirname "$0")"

if [ "$ACCOUNT" = "localchimera" ]; then
  echo "Deploying to localchimera.com account (hardwoodstablecoin)..."
  cp "$LOCALCHIMERA_CONFIG" "$WRANGLER_CONFIG"
  # Build tracker + dashboard before deploy
  npm run tracker:build
  npm run dashboard:build
  npx wrangler deploy
elif [ "$ACCOUNT" = "terexmaps" ]; then
  echo "Deploying to terexmaps account..."
  cp "$TEREXMAPS_CONFIG" "$WRANGLER_CONFIG"
  npm run tracker:build
  npm run dashboard:build
  npx wrangler deploy
else
  echo "Unknown account: $ACCOUNT"
  echo "Usage: $0 [localchimera|terexmaps]"
  exit 1
fi
