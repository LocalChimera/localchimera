#!/bin/bash
set -e

# update-upstream.sh — Check and update upstream dependencies across all packages.
#
# Usage:
#   ./scripts/update-upstream.sh check    # Show outdated packages
#   ./scripts/update-upstream.sh update   # Update to latest compatible versions
#   ./scripts/update-upstream.sh install  # Reinstall all lockfiles
#
# This covers npm dependencies only. For Rust/Cargo deps in src-tauri,
# run `cargo update` manually in apps/desktop/src-tauri/.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES=("qvac" "qvac/frontend" "apps/desktop" "sdk")

log() { echo "[update-upstream] $*"; }

check_outdated() {
    log "Checking for outdated packages..."
    for pkg in "${PACKAGES[@]}"; do
        if [ -f "$ROOT_DIR/$pkg/package.json" ]; then
            log "--- $pkg ---"
            (cd "$ROOT_DIR/$pkg" && npm outdated 2>/dev/null || true)
        fi
    done
    log "Done. Run './scripts/update-upstream.sh update' to bump versions."
}

update_deps() {
    log "Updating npm dependencies to latest compatible versions..."
    for pkg in "${PACKAGES[@]}"; do
        if [ -f "$ROOT_DIR/$pkg/package.json" ]; then
            log "Updating $pkg..."
            (cd "$ROOT_DIR/$pkg" && npm update)
        fi
    done
    log "Done. Review changes, test, then commit."
}

reinstall_lockfiles() {
    log "Reinstalling lockfiles from scratch..."
    for pkg in "${PACKAGES[@]}"; do
        if [ -f "$ROOT_DIR/$pkg/package.json" ]; then
            log "Reinstalling $pkg..."
            (cd "$ROOT_DIR/$pkg" && rm -rf node_modules package-lock.json && npm install)
        fi
    done
    log "Done. Review changes, test, then commit."
}

case "${1:-check}" in
    check)
        check_outdated
        ;;
    update)
        update_deps
        ;;
    install)
        reinstall_lockfiles
        ;;
    *)
        echo "Usage: $0 {check|update|install}"
        exit 1
        ;;
esac
