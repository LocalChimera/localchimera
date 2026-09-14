#!/bin/bash
set -e

DIST_DIR="./dist"

# Restructure dist/ so the landing page is at root and the SPA is at /app/
# 1. Create dist/app/ and move Vite-built SPA files there
mkdir -p "$DIST_DIR/app"
mv "$DIST_DIR/index.html" "$DIST_DIR/app/index.html"
mv "$DIST_DIR/assets" "$DIST_DIR/app/assets" 2>/dev/null || true
for f in deploy-escrow.html compute_registry.wasm; do
  [ -f "$DIST_DIR/$f" ] && mv "$DIST_DIR/$f" "$DIST_DIR/app/$f"
done

# 2. Copy landing page to dist/index.html (root)
cp "$DIST_DIR/landing.html" "$DIST_DIR/index.html"

# 3. Ensure dashboard assets are copied (Vite may skip nested public dirs)
mkdir -p "$DIST_DIR/dashboard/assets"
cp -r public/dashboard/assets/* "$DIST_DIR/dashboard/assets/" 2>/dev/null || true
cp public/dashboard/index.html "$DIST_DIR/dashboard/index.html" 2>/dev/null || true

echo "Post-build: landing page at /, SPA at /app/, dashboard at /dashboard/"
