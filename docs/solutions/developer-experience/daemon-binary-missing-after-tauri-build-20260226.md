---
module: CodexMonitor Build
date: 2026-02-26
problem_type: developer_experience
component: tooling
symptoms:
  - "codex_monitor_daemon missing from Codex Monitor.app/Contents/MacOS/ after npm run tauri:build"
  - "App launches but daemon cannot be found; resolve_daemon_binary_path() fails silently"
root_cause: missing_workflow_step
resolution_type: tooling_addition
severity: high
tags: [tauri, daemon, build, macos, bundling]
---

# Troubleshooting: Daemon Binary Missing from App Bundle After tauri:build

## Problem

`npm run tauri:build` builds the main app (`codex-monitor`) but does NOT automatically copy `codex_monitor_daemon` into `Codex Monitor.app/Contents/MacOS/`. The app starts but cannot find or launch the daemon.

## Environment

- Module: CodexMonitor Build
- Affected Component: `src-tauri/src/daemon_binary.rs`, `scripts/install-macos.sh`
- Date: 2026-02-26

## Symptoms

- After `npm run tauri:build`, `ls "Codex Monitor.app/Contents/MacOS/"` shows only `codex-monitor` and `codex_monitor_daemonctl` — no `codex_monitor_daemon`
- App launches but daemon fails to start; no `daemon_started` event in `daemon.log`
- `resolve_daemon_binary_path()` in `daemon_binary.rs` exhausts all search dirs and returns `Err`

## What Didn't Work

**Attempted Solution 1:** Assumed `tauri:build` bundles all Rust binaries automatically.
- **Why it failed:** Tauri only bundles the binary specified as `[package] name` in `Cargo.toml` (i.e., `codex-monitor`). The daemon is a separate `[[bin]]` entry and must be explicitly copied.

## Solution

1. Build as normal:
```bash
npm run tauri:build
```

2. Copy daemon binary into the app bundle:
```bash
cp src-tauri/target/release/codex_monitor_daemon \
  "src-tauri/target/release/bundle/macos/Codex Monitor.app/Contents/MacOS/codex_monitor_daemon"
```

3. Or use the dedicated install script (which does all three steps):
```bash
./scripts/install-macos.sh
```

The `install-macos.sh` script:
- Runs `npm run tauri:build`
- Copies `codex_monitor_daemon` into the bundle
- Also updates `/Applications/CodexMonitor.app` (old bundle path the app uses on startup)
- Installs `Codex Monitor.app` to `/Applications/`

## Why This Works

Tauri's build system only knows about the primary binary (`codex-monitor`). The daemon is a separate Rust binary (`[[bin]] name = "codex_monitor_daemon"`) that Cargo builds alongside but Tauri doesn't include in its bundling step.

`daemon_binary.rs` searches for the daemon in:
1. `Contents/MacOS/` (same dir as app) — primary
2. `Contents/Resources/` — fallback
3. `/opt/homebrew/bin`, `/usr/local/bin` — system fallback
4. `CODEX_MONITOR_DAEMON_PATH` env var — override

So placing the binary in `Contents/MacOS/` satisfies the primary search path.

## Prevention

- **Always use `./scripts/install-macos.sh`** instead of `npm run tauri:build` directly for local macOS installs.
- CI handles this with an explicit `cargo build --release --bin codex_monitor_daemon` step followed by copying (see `.github/workflows/release.yml`).
- After any upstream sync that includes changes to `daemon_binary.rs` search paths, verify the binary is still found correctly.

## Related Issues

No related issues documented yet.
