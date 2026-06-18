# Chimera — Local AI That Earns When Idle

A standalone QVAC inference node running `@qvac/sdk` inside a hardened Docker container. Each device (desktop, mobile) is its own autonomous node — no centralized router, no relay server.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Desktop: Tauri Shell + WebView                     │
│  - Bundled frontend (Wiki-first, auto-save)       │
│  - Native Start/Stop Supervisor controls            │
│  - IPC → Go sidecar → Docker container             │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Docker Container (Hardened)                        │
│  - Non-root user (chimera)                          │
│  - @qvac/sdk (llama.cpp + Metal/Vulkan)             │
│  - Node.js backend: miners, P2P, wiki API             │
│  - LLM Wiki with auto-save (2s debounce)             │
│  - Hypercore + Pear P2P swarm sync                 │
└─────────────────────────────────────────────────────┘
```

## Platforms

| Platform | Install | Status |
|---|---|---|
| **Linux (.deb)** | `sudo dpkg -i chimera-desktop/src-tauri/target/release/bundle/deb/Chimera_1.0.0_amd64.deb` | Ready |
| **Linux (.rpm)** | `sudo rpm -i chimera-desktop/src-tauri/target/release/bundle/rpm/Chimera-1.0.0-1.x86_64.rpm` | Ready |
| **Linux (binary)** | `./chimera-desktop/src-tauri/target/release/chimera-desktop` | Ready |
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
sudo dpkg -i chimera-desktop/src-tauri/target/release/bundle/deb/Chimera_1.0.0_amd64.deb

# Or run binary directly
./chimera-desktop/src-tauri/target/release/chimera-desktop
```

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
cd chimera-desktop
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
- **QVAC SDK** — `@qvac/sdk` powers all inference (llama.cpp).
- **Standalone** — Each device is its own node. No InferenceRouter, no relay.
- **Hardened** — Docker container runs as non-root with minimal deps.
- **P2P** — Pear P2P swarm sync for wiki pages across devices.
- **Mining** — Cortensor, Chutes, Fortytwo, Earnidle, Routstr miners.
- **Fleet** — Commander/worker orchestration for distributed tasks.

## Project Structure

```
qvac-chimera/
├── qvac/                     # Backend + frontend (Wiki)
│   ├── src/                  # Node.js backend
│   │   ├── core/             # NodeManager, WalletManager
│   │   ├── inference/        # QVACInferenceLayer (@qvac/sdk)
│   │   ├── miners/           # Cortensor, Chutes, etc.
│   │   ├── p2p/              # Pear P2P networking
│   │   ├── web/              # HTTP server + API routes
│   │   └── scheduler/        # TaskMonitor
│   ├── frontend/             # React app (WikiPage only)
│   ├── Dockerfile            # Hardened container
│   └── docker-compose.yml    # One-command deploy
├── chimera-desktop/          # Tauri desktop shell
│   ├── src/                  # React + Tauri commands
│   ├── src-tauri/            # Rust core + sidecar
│   └── dist/                 # Copied from qvac/frontend/dist
└── README.md
```

