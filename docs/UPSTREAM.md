# Upstream Projects

This repo integrates and extends several open-source projects. This document tracks where each comes from, how it is consumed, and how to update it.

## Dependency Matrix

| Project | Upstream Repo | How We Consume | Current Version | Last Checked |
|---|---|---|---|---|
| **QVAC SDK** | `npm:@qvac/sdk` | npm dependency | `^0.13.2` | 2026-06-18 |
| **Pear Runtime** | `npm:pear-runtime` | npm dependency | `^1.0.0` | 2026-06-18 |
| **Hyperswarm** | `npm:hyperswarm` | npm dependency | `^4.0.0` | 2026-06-18 |
| **Hypercore** | `npm:hypercore` | npm dependency | `^10.0.0` | 2026-06-18 |
| **Tauri** | `github:tauri-apps/tauri` | npm + GitHub Actions | `^2.0.0` | 2026-06-18 |
| **Capacitor** | `github:ionic-team/capacitor` | npm + mobile projects | `^7.0.0` | 2026-06-18 |
| **LLMwiki** | `github:lucasastorian/llmwiki` | Concept + custom bridge | N/A | 2026-06-18 |
| **Openviking** | N/A (internal) | Search/indexing concept | N/A | 2026-06-18 |
| **OtterWiki** | `github:red-kite/otterwiki` | Concept reference | N/A | 2026-06-18 |

## Updating npm Dependencies

```bash
# Check all packages for outdated dependencies
./scripts/update-upstream.sh check

# Update all packages to latest compatible versions
./scripts/update-upstream.sh update

# Update lockfiles after manual edits
./scripts/update-upstream.sh install
```

## Updating QVAC SDK

The QVAC SDK (`@qvac/sdk`) powers all inference. To update:

```bash
cd qvac
npm update @qvac/sdk
# Test inference layer
cd ../sdk
npm test
```

Breaking changes in the SDK may require updates to `qvac/src/inference/QVACSDKWrapper.js`.

## Updating Pear / P2P Stack

The Pear P2P stack (`pear-runtime`, `hyperswarm`, `hypercore`) is managed as npm dependencies:

```bash
cd qvac
npm update pear-runtime hyperswarm hypercore @hyperswarm/secret-stream
# Restart the node and verify P2P connections
npm start
```

Breaking changes in Pear may require updates to `qvac/src/p2p/PearP2P.js`.

## Updating Tauri

Tauri is consumed in two places:
1. `apps/desktop/package.json` (npm deps)
2. `apps/desktop/src-tauri/Cargo.toml` (Rust deps)

```bash
cd apps/desktop
npm update @tauri-apps/api @tauri-apps/cli
# Also update Rust deps
cd src-tauri
cargo update
```

## Updating Capacitor (Mobile)

```bash
cd qvac/frontend
npm update @capacitor/core @capacitor/ios @capacitor/android
npx cap sync
```

## LLMwiki / Openviking Concepts

These are **conceptual influences**, not vendored code. The LLM Wiki implementation in `qvac/src/llmwiki/` and `qvac/src/web/` is custom code built around the ideas from:
- LLMwiki (github.com/lucasastorian/llmwiki) — wiki generation from AI prompts
- Openviking-style indexing — in-memory markdown index + graph queries

To incorporate upstream improvements, compare the upstream repos against our custom implementations and port changes manually.

## Automated Upstream Checks

A GitHub Action runs weekly to check for new upstream releases and opens an issue if any are found. See `.github/workflows/check-upstream.yml`.
