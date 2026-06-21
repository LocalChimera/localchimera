# Chimera — Local AI That Earns When Idle

A standalone QVAC inference node running `@chimera/sdk` inside a hardened Docker container. Each device (desktop, mobile) is its own autonomous node — no centralized router, no relay server.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Desktop: Tauri Shell + WebView                     │
│  - Bundled frontend (Wiki-first, auto-save)         │
│  - Native Start/Stop controls                       │
│  - IPC → Rust backend → Docker (or direct Node.js)│
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Hardened Docker Container (preferred)              │
│  - Non-root user (chimera)                          │
│  - Multi-stage build, health checks               │
│  - Node.js backend: miners, P2P, wiki API          │
│  - LLM Wiki with auto-save (2s debounce)           │
└─────────────────────────────────────────────────────┘
         or (fallback when Docker unavailable)
┌─────────────────────────────────────────────────────┐
│  Direct Node.js Process                             │
│  - Same codebase, no container isolation            │
│  - start-auto.sh handles deps + build              │
└─────────────────────────────────────────────────────┘
```

## Platforms

| Platform | Install | Status |
|---|---|---|
| **Linux (.deb)** | `sudo dpkg -i apps/desktop/src-tauri/target/release/bundle/deb/Chimera_1.0.0_amd64.deb` | Ready |
| **Linux (.rpm)** | `sudo rpm -i apps/desktop/src-tauri/target/release/bundle/rpm/Chimera-1.0.0-1.x86_64.rpm` | Ready |
| **Linux (binary)** | `./apps/desktop/src-tauri/target/release/chimera-desktop` | Ready |
| **macOS** | Build from source (see below) | Source |
| **Windows** | Build from source (see below) | Source |
| **iOS** | App Store submission pending | Capacitor configured |
| **Android** | Play Store submission pending | Capacitor configured |
| **Docker** | `cd qvac && docker-compose up -d` | Ready |

## Quick Start (Docker)

```bash
cd qvac
docker-compose up -d
# Open http://localhost:3002 — wiki loads immediately
```

## Quick Start (Desktop — Linux)

```bash
# Install .deb
sudo dpkg -i apps/desktop/src-tauri/target/release/bundle/deb/Chimera_1.0.0_amd64.deb

# Or run binary directly
./apps/desktop/src-tauri/target/release/chimera-desktop
```

## Quick Start (Mobile — iOS/Android)

The mobile app is a Capacitor-wrapped web app that runs `@chimera/sdk` natively on device. Each phone is a standalone node — no relay, no desktop dependency.

```bash
cd qvac/frontend
npm install && npm run build
npx cap sync

# iOS → Xcode → Archive → App Store
npx cap open ios

# Android → Android Studio → Generate Signed Bundle → Play Store
npx cap open android
```

All platforms open directly to the LLM Wiki with auto-save.

## Build from Source

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Rust (for Tauri desktop)

### 1. Backend (Docker)
```bash
cd qvac
npm install
cd frontend && npm install && npm run build && cd ..
docker-compose up --build -d
```

### 2. Desktop App (Tauri)
```bash
cd apps/desktop
npm install
npm run tauri:build
# Output: src-tauri/target/release/bundle/
```

### 3. Mobile (Capacitor)
```bash
cd qvac/frontend
npm install && npm run build
npx cap sync
npx cap open ios      # Xcode → Archive → App Store
npx cap open android  # Android Studio → Generate Signed Bundle
```

## Key Features

- **LLM Wiki** — Opens directly, no landing page. Auto-saves every 2s.
- **Time-ago indicator** — "Last saved 12s ago" beside Delete button.
- **QVAC SDK** — `@chimera/sdk` powers all inference (QVAK).
- **Standalone** — Each device is its own node. No InferenceRouter, no relay.
- **Hardened** — Docker container runs as non-root with minimal deps.
- **P2P** — Pear P2P swarm sync for wiki pages across devices.
- **Mining** — Cortensor, Chutes, Fortytwo, Earnidle, Routstr miners.
- **Fleet** — Commander/worker orchestration for distributed tasks.

## Project Structure

```
qvac-chimera/
├── website/                  # Marketing site + demo wiki + earnings
│   ├── index.html            # Landing page
│   ├── demo-wiki.html        # Read-only LLM Wiki demo
│   └── earnings.html         # Earnings dashboard
├── apps/
│   └── desktop/              # Tauri desktop app (Linux, macOS, Windows)
│       ├── src/              # React frontend
│       ├── src-tauri/        # Rust shell + Go sidecar
│       └── dist/             # Copied from qvac/frontend/dist
├── qvac/                     # Backend node + LLM Wiki frontend
│   ├── src/                  # Node.js backend
│   │   ├── core/             # NodeManager, WalletManager
│   │   ├── inference/        # QVACInferenceLayer
│   │   ├── miners/           # Cortensor, Chutes, etc.
│   │   ├── p2p/              # Pear P2P networking
│   │   ├── web/              # HTTP server + API routes
│   │   └── scheduler/        # TaskMonitor
│   ├── frontend/             # React app (LLM Wiki)
│   ├── Dockerfile            # Hardened container
│   └── docker-compose.yml    # One-command deploy
├── sdk/                      # @chimera/sdk — build your own app
│   ├── src/
│   └── examples/
└── README.md
```

## Upstream Projects

Chimera builds on several open-source projects. See [docs/UPSTREAM.md](docs/UPSTREAM.md) for:
- Full catalog of upstream dependencies (QVAC SDK, Pear, Tauri, Capacitor, LLMwiki, Openviking, OtterWiki)
- How to check for and apply updates
- Version tracking matrix

Quick check:
```bash
./scripts/update-upstream.sh check
```

