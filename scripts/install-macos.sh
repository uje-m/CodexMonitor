#!/usr/bin/env bash
# scripts/install-macos.sh
#
# Builds the full macOS app, copies the daemon binary into the bundle,
# and installs to /Applications.
#
# Usage:
#   ./scripts/install-macos.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; RED='\033[0;31m'; RESET='\033[0m'
info()    { echo -e "${BLUE}▶${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

# ── Build ────────────────────────────────────────────────────────────────────
info "Building macOS app (npm run tauri:build)..."
npm run tauri:build 2>&1 | grep -E "Finished|Bundling|Built application|error\[|^error" || true

BUNDLE_DIR="src-tauri/target/release/bundle/macos/Codex Monitor.app"
DAEMON_BIN="src-tauri/target/release/codex_monitor_daemon"

[[ -d "$BUNDLE_DIR" ]] || error "Bundle not found: $BUNDLE_DIR"
[[ -f "$DAEMON_BIN" ]] || error "Daemon binary not found: $DAEMON_BIN"

# ── Copy daemon into bundle ───────────────────────────────────────────────────
info "Copying daemon binary into app bundle..."
cp "$DAEMON_BIN" "$BUNDLE_DIR/Contents/MacOS/codex_monitor_daemon"
success "Daemon binary added to bundle"

# ── Install to /Applications ──────────────────────────────────────────────────
info "Installing to /Applications..."

# Also update the old CodexMonitor.app bundle if it exists (launched by app on startup)
if [[ -d "/Applications/CodexMonitor.app/Contents/MacOS" ]]; then
    cp "$DAEMON_BIN" "/Applications/CodexMonitor.app/Contents/MacOS/codex_monitor_daemon"
    success "Updated daemon in /Applications/CodexMonitor.app"
fi

rm -rf "/Applications/Codex Monitor.app"
cp -R "$BUNDLE_DIR" "/Applications/"
success "Installed Codex Monitor.app v$(grep '"version"' src-tauri/tauri.conf.json | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
