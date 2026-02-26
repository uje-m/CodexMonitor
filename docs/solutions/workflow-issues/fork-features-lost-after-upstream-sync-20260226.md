---
module: CodexMonitor Fork
date: 2026-02-26
problem_type: workflow_issue
component: development_workflow
symptoms:
  - "Custom fork commits overwritten when upstream advances main and uje-fork/main is reset"
  - "Features built on fork/main disappear after git pull or upstream force-push sync"
  - "uje-fork/main loses custom features after pulling upstream version bump"
root_cause: missing_workflow_step
resolution_type: tooling_addition
severity: high
tags: [git, fork, upstream-sync, rebase, feature-branch, tauri]
---

# Troubleshooting: Custom Fork Features Lost After Upstream Sync

## Problem

When syncing a personal fork of CodexMonitor with upstream (`Dimillian/CodexMonitor`), custom commits on `uje-fork/main` get overwritten or lost because `main` is used both as an upstream tracking branch and as the integration point for custom features.

## Environment

- Module: CodexMonitor Fork (`uje-m/CodexMonitor`)
- Upstream: `Dimillian/CodexMonitor`
- Date: 2026-02-26

## Symptoms

- After `git pull origin main` or force-push to `uje-fork/main`, custom commits like `feat: add file-based logging to codex-monitor-daemon` disappear from `main`
- `git log origin/main..uje-fork/main` returns empty — fork is identical to upstream
- Features work locally but aren't in the fork's `main` branch

## What Didn't Work

**Attempted Solution 1:** Commit custom features directly to `main` and rebase on upstream when needed.
- **Why it failed:** When upstream force-pushes or when CI resets `main` to upstream, all custom commits are lost. Rebasing `main` onto upstream also becomes complex when many commits are mixed.

**Attempted Solution 2:** Use feature branches but merge them into upstream `main`.
- **Why it failed:** `uje-fork/main` tracks `origin/main` (upstream). Merging into it and then pulling upstream creates divergence that requires force-push, which is error-prone.

## Solution

**3-branch model:**

```
origin/main          → upstream mirror (never commit here)
feat/daemon-logging  → isolated feature branch (rebases cleanly onto upstream)
feat/ios-remote-picker → isolated feature branch
fork/main            → integration: origin/main + all feature branches merged
                       (this is what uje-fork/main points to)
```

**Setup (one-time):**
```bash
# Create feature branches from upstream
git checkout origin/main -b feat/my-feature
# ... do work, commit ...

# Build integration branch
git checkout origin/main -b fork/main
git merge --no-ff feat/daemon-logging -m "merge: feat/daemon-logging"
git merge --no-ff feat/my-feature -m "merge: feat/my-feature"

# Push
git push uje-fork fork/main:main
```

**Daily sync (after upstream advances):**
```bash
./scripts/sync-fork.sh          # dry-run: shows new upstream commits + conflict preview
./scripts/sync-fork.sh --apply  # rebase features onto new upstream + rebuild fork/main + push
```

**Adding a new feature:**
```bash
git checkout origin/main -b feat/new-feature
# ... commit work ...
# Add "feat/new-feature" to FEATURE_BRANCHES in scripts/sync-fork.sh
./scripts/sync-fork.sh --apply
```

**`scripts/sync-fork.sh` key behavior:**
1. Fetches `origin` (upstream)
2. Auto-stashes dirty working tree
3. Rebases each feature branch onto `origin/main`
4. Rebuilds `fork/main` from scratch (origin/main + merge each feature)
5. Force-pushes feature branches + `fork/main:main` to `uje-fork`
6. Restores stash

## Why This Works

Feature branches are isolated (each contains only its own commits) so `git rebase origin/main` on them is scoped to a small set of known files. When upstream changes overlap with a feature branch, conflicts are localized and identifiable.

`fork/main` is a **derived branch** — never committed to directly, always rebuilt by `sync-fork.sh`. This means it's always a clean merge of upstream + features, with no drift.

## Prevention

- **Never commit directly to `fork/main`** — it gets force-rebuilt by `sync-fork.sh`.
- **Never commit directly to `origin/main`** — it's a read-only upstream mirror.
- When upstream merges a feature similar to yours (as happened with `1c76683`), resolve the rebase conflict on the feature branch, then re-sync. The feature branch retains any unique additions.
- After resolving rebase conflicts, commit the fix to the feature branch before re-running `sync-fork.sh --apply`.
- Add `FEATURE_BRANCHES` entry in `sync-fork.sh` for every new custom feature.

## Related Issues

- See also: [daemon-binary-missing-after-tauri-build-20260226.md](../developer-experience/daemon-binary-missing-after-tauri-build-20260226.md)
