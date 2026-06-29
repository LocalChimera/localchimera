# Localchimera

> A local AI node that earns when idle. Your device is its own autonomous node — no centralized router, no relay server required.

This document is the end-to-end guide to the Localchimera codebase. It explains what the project is, how it is organized, how to run it, and how the pieces fit together.

---

## 1. What Localchimera Is

Localchimera is a standalone QVAC inference node that runs inside a hardened Docker container. Every device (desktop, mobile, or server) can be its own autonomous node:

- **LLM Wiki** opens directly in the browser with auto-save every 2 seconds.
- **QVAC inference** runs locally on the device for private, offline-capable AI generation.
- **Mining/Tasking** uses the device's idle capacity to complete tasks on untrusted-hardware-safe networks.
- **P2P sync** replicates wiki pages and receipts across devices over Pear P2P swarms.

The app is bundled as a Tauri desktop app, Capacitor/Expo mobile apps, and a web marketing site.

---

## 2. Core Design Principles

### 2.1 Untrusted-Hardware Safety

The whole architecture is built so the device running Localchimera does **not** need to hold private keys, wallet mnemonics, or provider credentials. Networks are only included if they support one of these patterns:

- **Relay/worker split**: a trusted relay holds the key material; the worker just reports an endpoint or receives signed tasks.
- **No keys required**: the provider only needs a payout address or public reference.
- **Docker-based**: the node identity lives inside a container, not in the SDK.
- **Walletless storage**: storage jobs are assigned through an on-chain escrow contract, so the device stores no wallet.

Networks that require local keys or self-managed credentials have been removed. The archived analysis is in `docs/RELAY_COMPATIBILITY.md`.

### 2.2 Upstream-First

Localchimera vendors upstream projects as git submodules under `upstream/` and uses them as directly as possible. This minimizes custom code and keeps forks up to date. See `docs/UPSTREAM.md` for the full catalog and update instructions.

Key upstream projects include:

- **LLMwiki**, **OpenViking**, **OtterWiki** for the wiki / memory layer
- **repo-to-markdown**, **markitdown** for file conversion
- **BTT AI**, **Golem**, **Anyone Protocol**, **Mysterium**, **BTFS** for tasking networks
- **Zama Concrete** and **fhEVM** for future encrypted on-chain inference

---

## 3. Project Structure

```
localchimera/
├── website/                  # Marketing site + demo wiki + earnings
├── website-new/              # Next-generation marketing site
├── apps/                     # Desktop/mobile apps
│   ├── desktop/              # Tauri desktop app (Linux, macOS, Windows)
│   ├── macos/                # Native macOS app bundle
│   ├── mobile/               # Capacitor mobile app
│   ├── mobile-expo/          # Expo mobile app with Bare worker
│   └── install/              # Installers and build scripts
├── qvac/                     # Backend node + LLM Wiki frontend
│   ├── src/                  # Node.js backend
│   │   ├── core/             # NodeManager, WalletManager, AuditLogger, ContentAddress, DeploymentLifecycle
│   │   ├── inference/        # QVACInferenceLayer, ProofOfInference, PromptGuard, TokenMeter, VoicePipeline, AgentLoop
│   │   ├── llmwiki/          # Bridges for OtterWiki, OpenViking, LLMwiki
│   │   ├── miners/           # Chutes, Routstr, Earnidle, BTT AI, Golem, Anyone, Mysterium, BTFS, Casper
│   │   ├── p2p/              # Pear P2P networking, CapabilityManifest, ContentPinner
│   │   ├── web/              # HTTP server + API routes
│   │   └── scheduler/        # TaskMonitor
│   ├── frontend/             # React app (LLM Wiki)
│   ├── app/                  # Legacy Python app layer
│   ├── backend/              # Language-specific backend subprojects (Rust, Earnidle runtime, smart contracts)
│   ├── config/               # QVAC configuration files
│   └── examples/             # AI Writer integration examples
├── sdk/                      # @chimera/sdk — build your own app
│   ├── src/                  # Provider implementations
│   └── examples/             # Integration examples
├── inference-backend/        # Encrypted inference backend (FHE/SEAL experiments)
├── inference-config/           # Network deployment configs
├── contracts/                # EVM smart contracts (ProofOfInferenceVerifier, FHEInferenceMarket)
├── contracts-casper/         # Casper Network smart contracts (escrow vault, provider registry)
├── providers/                # Provider setup/lifecycle scripts
├── scripts/                  # Automation, deployment, and utility scripts
│   ├── deploy/               # Contract and infrastructure deployment
│   ├── register/             # Node registration
│   ├── testing/              # BrowserStack / LambdaTest / TestingBot smoke tests
│   ├── debug/                # One-off debugging scripts
│   └── utils/                # Key cleanup, balance checks, wallet generation, WASM patching
├── docs/                     # Documentation (UPSTREAM.md, RELAY_COMPATIBILITY.md, etc.)
├── cashu/                    # Cashu ecash integration
├── routstr/                  # Nostr/Cashu inference routing
├── brand-assets/             # Logos and brand assets
├── releases/                 # Release notes and installers
├── upstream/                 # Git submodules for upstream forks and dependencies
└── lib/                      # Foundry libraries (fhevm, forge-std)
```

Each directory has a `README.md` explaining its contents.

---

## 4. Quick Start

### 4.1 Docker (Recommended)

```bash
cd qvac
docker-compose up -d
# Open http://localhost:3002
```

### 4.2 Desktop (Linux)

```bash
cd apps/desktop
npm install
npm run tauri:build
# Install from src-tauri/target/release/bundle/
```

### 4.3 Mobile

```bash
cd qvac/frontend
npm install && npm run build
npx cap sync
npx cap open ios     # or android
```

---

## 5. Mining and Tasking Networks

Localchimera supports the following networks, all chosen because they are safe to run on untrusted hardware:

| Network | Role | Integration | Key Safety |
|---|---|---|---|
| **Chutes** | AI inference | Protocol integration in `qvac/src/miners/ChutesMiner.js` | Relay holds hotkey |
| **Routstr** | AI inference routing | Nostr/Cashu | No local keys |
| **BTT AI** | AI inference | Docker / GPU miner via `sdk/src/miners/BttAiMinerProvider.js` | Proxy mode |
| **Golem** | Compute | Docker provider via `sdk/src/miners/GolemProvider.js` | Payout address only |
| **Anyone Protocol** | Bandwidth | Docker relay via `sdk/src/miners/AnyoneProtocolProvider.js` | No keys required |
| **Mysterium** | Bandwidth (VPN) | Docker VPN node via `sdk/src/miners/MysteriumProvider.js` | No keys required |
| **BTFS** | Storage | Walletless storage via `sdk/src/miners/BtfsStorageProvider.js` | No BTT wallet on device |
| **Casper** | Settlement / relay | Relay-mode bridge | Provider key on relay only |
| **Earnidle** | Idle compute | Public Solana address only | No private key |

### 5.1 How Providers Are Tracked

Each provider is vendored as a git submodule under `upstream/`:

- `upstream/btt-ai-miner`
- `upstream/golem`
- `upstream/anyone-protocol`
- `upstream/mysterium`
- `upstream/btfs`

To keep forks up to date:

```bash
./scripts/fork-upstream.sh <your-github-username>
./scripts/update-tasking-forks.sh
```

### 5.2 Starting Providers

Use the provider scripts:

```bash
./providers/start-all.sh
./providers/status.sh
```

Individual setup is in `providers/setup-*.sh`.

---

## 6. The SDK

`@chimera/sdk` lets third-party apps add Localchimera mining with a single consent prompt and start/stop buttons. The app never handles wallets, earnings, or revenue splits.

```jsx
import { useChimera } from '@chimera/sdk';

function MiningPanel() {
  const { status, consentGiven, giveConsent, start, stop } = useChimera({
    appDeveloperEVM: '0xYourEvmWalletAddressHere'
  });
  // ... consent + start/stop UI
}
```

See `sdk/README.md` for the full API and security model.

---

## 7. Wiki and Knowledge Layer

The LLM Wiki is the default landing experience. It auto-saves every 2 seconds and stores pages in three ways:

1. **Local file storage** in `qvac/llmwiki-data/wiki/` for the local indexer and Hypercore.
2. **OtterWiki** via `qvac/src/llmwiki/otterwiki_bridge.py` for git-backed wiki storage.
3. **OpenViking** via `qvac/src/llmwiki/openviking_bridge.py` for session-based memory.

The server (`qvac/src/web/server.js`) exposes HTTP routes for search, save, delete, and status, merging results from the local indexer and the upstream bridges.

---

## 8. Encrypted Inference (FHE)

The `inference-backend/` directory contains experiments in encrypted, decentralized inference:

- **Microsoft SEAL** via `node-seal` for portable WebAssembly FHE in browser and Node.js.
- **Zama fhEVM** and **Concrete** submodules are tracked for future migration to on-chain encrypted inference jobs.
- **Contracts**: `contracts/FHEInferenceMarket.sol` and `contracts/ProofOfInferenceVerifier.sol` handle on-chain market and receipt verification.
- **Configs**: `inference-config/` holds network-specific deployment configs.

This area is under active development. See `inference-README.md` for the high-level architecture.

---

## 9. Payments and Settlement

Mining rewards flow through Chimera protocol multisigs:

1. **Mining** — device completes tasks on safe networks.
2. **Weekly sweep** — all funds are swept into the Chimera EVM collection multisig.
3. **Monthly distribution** — funds are split between the machine owner and the app developer.

Apps only pass an EVM address. The Chimera landing page handles wallet setup, earnings tracking, and revenue distribution.

---

## 10. Development and Scripts

### 10.1 Keeping Up to Date

```bash
# Check npm dependencies
./scripts/update-upstream.sh check

# Update forked tasking submodules
./scripts/update-tasking-forks.sh

# Update all upstream submodules
./scripts/update-upstream.sh update
```

### 10.2 Deployment

```bash
# Deploy contracts
forge script scripts/deploy/DeployChimera.s.sol:DeployChimera --rpc-url $RPC_URL --broadcast

# Deploy inference infrastructure
./scripts/deploy/deploy-inference.sh
```

### 10.3 Testing

```bash
cd qvac
npm test
# or
npx vitest
```

---

## 11. Security Summary

- The SDK never stores or exposes private keys.
- Apps cannot extract funds because they only receive references to OS-level secure storage, not key material.
- Docker containers run as a non-root user with minimal dependencies.
- Removed networks (Cortensor, Fortytwo, CESS, Akash, Targon, ZCN, Income Generator, CashPilot, Salad, Heurist, Lium, Nosana, ByteLeap) are archived in `docs/RELAY_COMPATIBILITY.md`.

---

## 12. Where to Go Next

- `README.md` — root overview and feature list
- `sdk/README.md` — how to integrate `@chimera/sdk` into your app
- `docs/UPSTREAM.md` — full upstream catalog and update instructions
- `docs/RELAY_COMPATIBILITY.md` — archived provider compatibility analysis
- `inference-README.md` — encrypted inference design
- `providers/README.md` — provider setup scripts
- `qvac/src/README.md` — backend source layout
- `apps/README.md` — desktop/mobile apps
