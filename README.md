# Chimera — Local AI That Earns When Idle

A standalone QVAC inference node running `@localchimera/sdk` inside a hardened Docker container. Each device (desktop, mobile) is its own autonomous node — no centralized router, no relay server.

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

The mobile app is a Capacitor-wrapped web app that runs `@localchimera/sdk` natively on device. Each phone is a standalone node — no relay, no desktop dependency.

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

## Integrate Chimera Into Your Own App or Website

You don't have to use the Chimera app generator to add Chimera to a project. Both SDKs are published to npm and can be integrated directly.

**Websites and browser apps**

Install the browser SDK and start a lightweight relay node in one line:

```bash
npm install @localchimera/browser-sdk
```

```js
import { quickStart } from '@localchimera/browser-sdk';

// Relay mode — no wallet required
await quickStart();
```

For wallet-connected modes, pass the provider, public key, and account hash:

```js
await quickStart(provider, publicKeyHex, accountHash, {
  onStatus: (status) => console.log(status),
});
```

**Downloaded/device apps (React, React Native, Tauri, Electron, desktop, tablet, mobile)**

Install the app SDK and drop in the self-contained button:

```bash
npm install @localchimera/sdk
```

```jsx
import { ChimeraButton } from '@localchimera/sdk';

function App() {
  return <ChimeraButton appDeveloperEVM="0xYourPayoutAddress" />;
}
```

`ChimeraButton` handles wallet connection, mining enable/disable, earnings display, and all network adapters automatically. It is self-contained and requires no external CSS or wrapping providers.

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
- **Chimera SDK** — `@localchimera/sdk` powers all inference (QVAK).
- **Standalone** — Each device is its own node. No InferenceRouter, no relay.
- **Hardened** — Docker container runs as non-root with minimal deps.
- **P2P** — Pear P2P swarm sync for wiki pages across devices.
- **Mining** — BTT AI, Golem, Anyone Protocol, Mysterium, BTFS (walletless storage), Sentinel, Spheron, Crust, Infernet miners. Resources are paid for via the frontend using Web3Auth + on-chain escrow; the protocol auto-converts payments to the resource's native token.
- **Fleet** — Commander/worker orchestration for distributed tasks.

### New: Enhanced Inference & Security Modules

- **Proof-of-Inference Receipts** — Every inference answer is hashed into a Merkle chain and signed (secp256k1), producing portable, independently verifiable receipts. (`qvac/src/inference/ProofOfInference.js`)
- **Inference Serialization Queue** — Requests queue through a promise chain to prevent concurrent model collisions on single-GPU/CPU devices. (`qvac/src/inference/InferenceQueue.js`)
- **Prompt Injection Defense** — Untrusted content (documents, RAG context) is fenced in `<document>` tags with a guard preamble. Injection heuristics detect re-instruction attempts. (`qvac/src/inference/PromptGuard.js`)
- **Prompt Budgeting** — Character-budgeted prompt construction against `ctx_size` with answer reserve, document ratio, and history ratio. (`qvac/src/inference/PromptBudgeter.js`)
- **Pay-Per-Token USDT Settlement** — Per-session token metering with USDT spend caps and on-chain settlement tracking. (`qvac/src/inference/TokenMeter.js`)
- **Voice Transcription Pipeline** — On-device Whisper STT → Llama summary + action items → GTE embeddings → RAG ingest. Models loaded one at a time (load → infer → unload). (`qvac/src/inference/VoicePipeline.js`)
- **Agent Tool-Calling Loop** — On-device agent that calls tools (search_memory, list_todos, calculator, local_time, search_wiki) with streaming citations. Hardened via PromptGuard + PromptBudgeter. (`qvac/src/inference/AgentLoop.js`)
- **Document Chunking + Citations** — Semantic paragraph/sentence chunking with stable IDs (DOC-XX-NN) and a citation registry for grounded answers. (`qvac/src/inference/DocumentChunker.js`)
- **Content-Addressed Verification** — SHA-256 content hashes for wiki pages, inference receipts, and RAG documents. Merkle proof construction and verification. (`qvac/src/core/ContentAddress.js`)
- **Signed Capability Manifests** — Peers advertise model inventory, dataset opt-ins, and provider availability via signed manifests over P2P. Enables intelligent inference delegation. (`qvac/src/p2p/CapabilityManifest.js`)
- **Deployment Lifecycle + SSE** — Phase-based deployment tracking (uploaded → prepared → submitted → matching → matched → ack → env-set → started → model_loading → model_ready) with live progress streamed over Server-Sent Events. (`qvac/src/core/DeploymentLifecycle.js`)
- **Peer Reputation / Trust Scoring** — Peers scored by success rate, latency, and uptime. Scores feed into weighted device selection in InferenceRouter. Decays toward neutral over time (forgiveness). (`qvac/src/p2p/PeerReputation.js`)
- **Circuit Breaker** — If a device/peer fails N times consecutively, the circuit trips and blocks routing for a cooldown. Half-open probe tests recovery before full reset. (`qvac/src/inference/CircuitBreaker.js`)
- **TTFT Measurement** — Time-To-First-Token is measured during streaming inference and logged in audit records alongside tokensPerSec. (`qvac/src/inference/QVACInferenceLayer.js`)
- **Model Hot-Swapping** — Switch between models (e.g., Llama for text, Whisper for voice) without restarting the inference layer. LRU cache with configurable max cached models. (`qvac/src/inference/QVACInferenceLayer.js`)
- **On-chain PoI Verification** — Solidity contract that verifies secp256k1-signed inference receipts on-chain via ecrecover, enabling trustless USDT settlement. (`contracts/ProofOfInferenceVerifier.sol`)
- **Memory Compaction** — When PromptBudgeter would drop old history, MemoryCompactor summarizes it into a compact context message instead of truncating. LLM-based with extractive fallback. (`qvac/src/inference/MemoryCompactor.js`)
- **Knowledge Graph** — Entity-relationship store for transcripts and documents. Supports fuzzy search, subgraph traversal (BFS), and source-filtered queries. Integrates with VoicePipeline entity extraction. (`qvac/src/inference/KnowledgeGraph.js`)
- **Encrypted Document Storage** — Per-workspace AES-256-GCM encryption for sensitive RAG documents. HKDF-derived workspace keys from a master key. Transparent encrypt/decrypt for HypercoreStore. (`qvac/src/storage/CryptoVault.js`)
- **Peer Receipt Cross-Verification** — P2P gossip protocol where peers independently verify inference receipts and broadcast results. Community verification threshold enables trustless verification without gas. (`qvac/src/inference/ReceiptGossip.js`)
- **Dynamic Pricing** — Demand-based token pricing that adjusts per-token cost based on queue depth (demand) and available peers (supply). Bounded by min/max price limits. (`qvac/src/inference/ReceiptGossip.js`)
- **Model Registry** — Catalog of available models with metadata (context length, quantization, type, load status). Integrates with hot-swapping and capability manifests. (`qvac/src/inference/ModelRegistry.js`)
- **Tool Result Cache** — Caches agent tool call results with TTL and content-aware invalidation. Avoids redundant computation for repeated tool calls. (`qvac/src/inference/ToolResultCache.js`)
- **Semantic Deduplication** — Detects near-duplicate documents via cosine similarity before RAG ingestion. Prevents duplicate content from polluting search results. (`qvac/src/inference/SemanticDedup.js`)
- **SLA Enforcement** — Per-request timeout with SLA levels (standard/priority/batch). Aborts hung requests and triggers refunds. Tracks timeout rates and avg duration. (`qvac/src/inference/SLAEnforcer.js`)
- **Content Pinning** — Replicates important content (receipts, wiki pages) to N peers via P2P for durability. Encrypted pinning with CryptoVault integration. (`qvac/src/p2p/ContentPinner.js`)
- **Deployment Rollback** — Automatic rollback to last known-good phase on deployment failure. Manual rollback via API. Tracks rollback history. (`qvac/src/core/DeploymentLifecycle.js`)
- **Task Decomposition** — Breaks complex inference requests into sub-tasks for parallel execution across peers. LLM-based and heuristic decomposition with result synthesis. (`qvac/src/inference/TaskDecomposer.js`)
- **Conversation Branching** — Tree-based conversation model with branching from any message. Explore alternative responses without losing the original thread. (`qvac/src/inference/ConversationBrancher.js`)
- **Model Benchmarking CLI** — Standalone CLI tool for benchmarking models: TTFT, tokens/sec, latency across multiple prompts with comparison tables. (`qvac/src/cli/benchmark.js`)
- **Auto-Tagging** — Automatically tags documents and transcripts using taxonomy matching, keyword extraction, entity lookup, and optional LLM-based tagging. (`qvac/src/inference/AutoTagger.js`)
- **Conversation Export** — Export branched conversations as JSON, Markdown, plain text, OpenAI-compatible format, or CSV. Full tree or active-path-only export. (`qvac/src/inference/ConversationExporter.js`)
- **Confidence Router** — Self-consistency check: samples the local model k times, measures answer stability via embedding cosine similarity, and decides whether to answer locally for free or escalate to a paid peer. (`qvac/src/inference/ConfidenceRouter.js`)
- **Spend Policy** — Per-call cap, session budget, daily and monthly budget enforcement. If declined, the buyer keeps the free local draft. (`qvac/src/inference/SpendPolicy.js`)
- **Escrow Channel** — On-chain deposit + off-chain EIP-712 voucher settlement. One deposit opens a channel, then each inference settles off-chain with signed vouchers. (`qvac/src/inference/EscrowChannel.js`)
- **Memory Manager** — Cognitive memory system with importance ranking, consolidation (merge related memories), expiration (TTL decay), and memory type taxonomy (semantic/episodic/procedural). (`qvac/src/inference/MemoryManager.js`)
- **Hybrid Retriever** — Multi-method RAG retrieval: BM25 lexical + embedding vector search with reciprocal rank fusion, optional LLM re-ranking, fuzzy search, and regex search. (`qvac/src/inference/HybridRetriever.js`)
- **Enrichment Queue** — Two-phase save pipeline: instant heuristic classification + background FIFO queue for LLM enrichment (classify, embed, tag, caption). Graceful degradation to heuristics on failure. (`qvac/src/inference/EnrichmentQueue.js`)
- **Link Metadata Cache** — Fetches and caches oEmbed/OpenGraph metadata (title, description, thumbnail) for URLs. Local thumbnail caching with TTL-based invalidation. (`qvac/src/inference/LinkMetadataCache.js`)
- **Vision Captioner** — Generates text captions for images using vision models (Qwen3-VL). Model loads on demand and unloads when idle. Makes screenshots searchable in RAG. (`qvac/src/inference/VisionCaptioner.js`)
- **Evidence Exporter** — Structured audit evidence for compliance: privacy scan, network boundary, RAG quality, API audit, benchmark scope, runtime contract, guardrails, vault snapshot, reviewer questions. (`qvac/src/inference/EvidenceExporter.js`)
- **MCP Client** — Model Context Protocol JSON-RPC client for tool calling. Connects to MCP servers via stdio or HTTP, discovers tools, and invokes them. (`qvac/src/inference/MCPClient.js`)
- **Auto Linker** — Auto-connects related notes/documents via vector similarity. Builds bidirectional link graph, finds clusters, and integrates with KnowledgeGraph. (`qvac/src/inference/AutoLinker.js`)
- **Capability Prober** — Auto-detects hardware (GPU/Metal/CPU, RAM, VRAM), benchmarks each model tier (0.6B → 7B), measures TTFT + TPS, and determines the sellable offer tier. Writes `bench-profile.json`. (`qvac/src/inference/CapabilityProber.js`)
- **Marketplace Broadcaster** — P2P offer advertising and discovery on Hyperswarm DHT. Sellers broadcast offers (model + price + TPS), buyers discover sellers, request quotes, and accept quotes. (`qvac/src/inference/MarketplaceBroadcaster.js`)
- **Memory Extractor** — LLM-based extraction of structured entities, relationships, and facts from raw text. Deduplicates against KnowledgeGraph, stores as graph triplets and semantic memories. (`qvac/src/inference/MemoryExtractor.js`)

## Project Structure

```
localchimera/
├── website/                  # Marketing site + demo wiki + earnings
├── website-new/              # Next-generation marketing site
├── apps/                     # Desktop/mobile apps
│   ├── desktop/              # Tauri desktop app (Linux, macOS, Windows)
│   ├── macos/                # Native macOS app
│   ├── mobile/               # Capacitor mobile app
│   └── mobile-expo/          # Expo mobile variant
├── qvac/                     # Backend node + LLM Wiki frontend
│   ├── src/                  # Node.js backend
│   │   ├── core/             # NodeManager, WalletManager, AuditLogger, ContentAddress, DeploymentLifecycle
│   │   ├── inference/        # QVACInferenceLayer, ProofOfInference, InferenceQueue, PromptGuard, etc.
│   │   ├── llmwiki/          # Upstream bridges (OtterWiki, OpenViking, LLMwiki)
│   │   ├── miners/           # BTT AI, Golem, Anyone, Mysterium, BTFS, Sentinel, Spheron, Crust, Infernet
│   │   ├── p2p/              # Pear P2P networking + CapabilityManifest
│   │   ├── web/              # HTTP server + API routes
│   │   └── scheduler/        # TaskMonitor
│   ├── frontend/             # React app (LLM Wiki)
│   ├── Dockerfile            # Hardened container
│   └── docker-compose.yml    # One-command deploy
├── sdk/                      # @localchimera/sdk — build your own app
│   ├── src/                  # Provider implementations
│   └── examples/             # Integration examples
├── inference-backend/        # Encrypted inference backend (FHE/SEAL experiments)
├── inference-config/         # Network deployment configs
├── contracts/                # EVM smart contracts
├── providers/                # Provider setup/lifecycle scripts
├── scripts/                  # Automation, deployment, and utility scripts
├── docs/                     # Documentation (UPSTREAM.md, RELAY_COMPATIBILITY.md, etc.)
├── cashu/                    # Cashu ecash integration
├── brand-assets/             # Logos and brand assets
├── releases/                 # Release notes and artifacts
├── upstream/                 # Git submodules for upstream forks and dependencies
├── workers/                  # Background workers and cron jobs
│   └── resource-provisioner/ # On-chain escrow → Golem/BTFS/Mysterium/Anyone/BTT/Sentinel/Spheron/Crust/Infernet
├── lib/                      # Foundry libraries (fhevm, forge-std, etc.)
└── README.md
```

## Upstream Projects

Chimera builds on several open-source projects. See [docs/UPSTREAM.md](docs/UPSTREAM.md) for:
- Full catalog of upstream dependencies (Chimera SDK, Pear, Tauri, Capacitor, LLMwiki, Openviking, OtterWiki)
- How to check for and apply updates
- Version tracking matrix

Quick check:
```bash
./scripts/update-upstream.sh check
```

## Production Architecture

The decentralized application platform is built on the tasking networks and supporting infrastructure:

- **Golem** — compute, deployments, rentals, and AI inference.
- **BTFS** — decentralized file storage.
- **Mysterium** — ingress tunnels to Golem activities.
- **Edge Network** — CDN for static assets and media; `@edge/link` for control-plane messaging.
- **Streamr** — real-time telemetry, scaling events, and deployment state events.
- **Namesilo** — domain registration and DNS for user-owned domains.
- **Robinhood Chain** — on-chain escrow, payments, and identity.
- **On-chain escrow with ERC-8184 vouchers** — payment requests and token conversion.

See `docs/PRODUCTION_TASKING_ARCHITECTURE.md` for the full design and deployment instructions.

## New API Endpoints

### Proof of Inference
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/proof/status` | PoI chain status (receipt count, public key) |
| `POST` | `/api/proof/verify` | Verify a receipt independently |

### Prompt Guard
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompt-guard/status` | PromptGuard stats (injection count, enabled) |
| `POST` | `/api/prompt-guard/check` | Check text for injection patterns |

### Token Meter
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/meter/status` | Metering status (total metered, settled) |
| `GET` | `/api/meter/sessions` | List all metering sessions + settlements |
| `POST` | `/api/meter/settle` | Record a USDT settlement (txHash, amount) |

### Voice Pipeline
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/voice/transcribe` | Process audio file (transcribe → summarize → embed) |
| `GET` | `/api/voice/status` | VoicePipeline status |

### Agent Loop
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/agent/query` | Run agent query with tool-calling |
| `GET` | `/api/agent/tools` | List available agent tools |

### Document Chunker
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chunk` | Chunk documents into semantic pieces with IDs |

### Content Address
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/content/status` | ContentAddress stats |
| `POST` | `/api/content/register` | Register data, get content hash |
| `POST` | `/api/content/verify` | Verify data against expected hash |

### Capability Manifest
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/capability/status` | Manifest status (peer count, providers) |
| `POST` | `/api/capability/create` | Create and sign our capability manifest |
| `GET` | `/api/capability/peers` | List peer manifests |

### Deployment Lifecycle
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/deployment/create` | Create a new deployment |
| `GET` | `/api/deployment/list` | List all deployments |
| `GET` | `/api/deployment/:id` | Get deployment by ID (with ETA) |
| `GET` | `/api/deployment/:id/events` | SSE stream of deployment phase changes |

### Circuit Breaker
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/circuit/status` | Circuit breaker stats (open/closed/half-open counts) |
| `GET` | `/api/circuit/list` | List all circuits with state |
| `POST` | `/api/circuit/reset` | Reset a circuit (by targetId or all) |

### Peer Reputation
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reputation/status` | Reputation system stats |
| `GET` | `/api/reputation/peers` | List all peer reputation scores |

### Model Hot-Swap
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/model/switch` | Hot-swap to a different model |
| `GET` | `/api/model/current` | Get currently loaded model |

### Memory Compactor
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/memory/status` | Compaction stats (total compactions, cache size) |

### Knowledge Graph
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/kg/status` | Graph stats (entities, relationships, sources) |
| `GET` | `/api/kg/search?q=...` | Fuzzy search entities by name |
| `GET` | `/api/kg/entity?name=...` | Get entity with relationships |
| `GET` | `/api/kg/subgraph?name=...&depth=2` | BFS subgraph from entity |
| `POST` | `/api/kg/ingest` | Ingest entities + edges from a source |

### Crypto Vault
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/vault/status` | Vault stats (encrypted/decrypted counts) |
| `POST` | `/api/vault/encrypt` | Encrypt plaintext for a workspace |
| `POST` | `/api/vault/decrypt` | Decrypt ciphertext from a workspace |

### Receipt Gossip
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/gossip/status` | Gossip stats (gossiped, verified, community-verified) |
| `GET` | `/api/gossip/receipts` | List community-verified receipts |
| `POST` | `/api/gossip/broadcast` | Broadcast a receipt for peer verification |

### Dynamic Pricing
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pricing/status` | Current price + config |
| `GET` | `/api/pricing/history` | Price adjustment history |

### Model Registry
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/registry/status` | Registry stats (total, loaded, by type) |
| `GET` | `/api/registry/list?type=...` | List models (optionally by type) |
| `POST` | `/api/registry/register` | Register a new model |

### Tool Result Cache
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tool-cache/status` | Cache stats (hits, misses, hit rate) |
| `POST` | `/api/tool-cache/invalidate` | Invalidate cache (by tool or all) |

### Semantic Dedup
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dedup/status` | Dedup stats (checked, duplicates, skipped) |

### SLA Enforcer
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sla/status` | SLA stats (timeouts, avg duration, breach rate) |

### Content Pinner
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pinning/status` | Pinning stats (local, remote, fully pinned) |
| `POST` | `/api/pinning/pin` | Pin content to peers |
| `POST` | `/api/pinning/unpin` | Unpin content from peers |
| `GET` | `/api/pinning/status/:hash` | Check pin status for a content hash |

### Deployment Rollback
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/deployment/rollback` | Rollback a deployment to previous phase |

### Task Decomposer
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/decompose/status` | Decomposer stats |
| `POST` | `/api/decompose/run` | Decompose and execute a complex request |

### Conversation Branching
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/conversation/list` | List all conversations |
| `POST` | `/api/conversation/create` | Create a new conversation |
| `POST` | `/api/conversation/message` | Add a message to active path |
| `POST` | `/api/conversation/branch` | Branch from a specific message |
| `POST` | `/api/conversation/switch` | Switch to a different branch |
| `GET` | `/api/conversation/:id/tree` | Get full conversation tree |
| `GET` | `/api/conversation/:id/history` | Get active path history |
| `DELETE` | `/api/conversation/:id` | Delete a conversation |

### Auto-Tagging
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tagger/status` | Tagger stats |
| `POST` | `/api/tagger/tag` | Auto-tag a single document |
| `POST` | `/api/tagger/batch` | Auto-tag multiple documents |

### Conversation Export
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/export/formats` | List supported export formats |
| `POST` | `/api/export/conversation` | Export a conversation (json/md/txt/openai/csv) |

### Confidence Router
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/confidence/status` | Router stats (local rate, avg confidence) |
| `POST` | `/api/confidence/route` | Route a prompt: local answer or escalate |

### Spend Policy
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/spend/status` | Budget status (daily, monthly, sessions) |
| `POST` | `/api/spend/session/start` | Start a new spending session |
| `POST` | `/api/spend/session/end` | End a session |
| `GET` | `/api/spend/session?sessionId=` | Get session status |

### Escrow Channel
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/escrow/status` | Escrow stats |
| `POST` | `/api/escrow/open` | Open a channel with deposit |
| `POST` | `/api/escrow/voucher` | Create a signed voucher |
| `POST` | `/api/escrow/settle` | Settle a channel on-chain |
| `POST` | `/api/escrow/close` | Close a channel |
| `GET` | `/api/escrow/list?status=` | List channels |

### Memory Manager
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/memory/status` | Memory stats (by type, consolidation) |
| `POST` | `/api/memory/add` | Add a memory |
| `GET` | `/api/memory/search` | Search memories |
| `POST` | `/api/memory/update` | Update a memory |
| `DELETE` | `/api/memory/delete` | Delete a memory |
| `GET` | `/api/memory/types` | Get memory type taxonomy |

### Hybrid Retriever
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/hybrid/status` | Retriever stats |
| `POST` | `/api/hybrid/search` | Hybrid search (BM25 + embedding + rerank) |

### Enrichment Queue
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/enrichment/status` | Queue stats |
| `POST` | `/api/enrichment/save` | Save item with heuristic + queue enrichment |

### Link Metadata
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/link-meta/status` | Cache stats |
| `POST` | `/api/link-meta/fetch` | Fetch metadata for a URL |

### Vision Captioner
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/vision/status` | Captioner stats |
| `POST` | `/api/vision/caption` | Caption an image |

### Evidence Exporter
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/evidence/types` | List evidence types |
| `POST` | `/api/evidence/export` | Export a specific evidence type |
| `POST` | `/api/evidence/export-all` | Export all evidence types |

### MCP Client
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/mcp/status` | MCP client stats |
| `GET` | `/api/mcp/servers` | List connected servers |
| `GET` | `/api/mcp/tools` | List all discovered tools |
| `POST` | `/api/mcp/connect` | Connect to an MCP server |
| `POST` | `/api/mcp/call` | Call a tool on a server |
| `POST` | `/api/mcp/disconnect` | Disconnect from a server |

### Auto Linker
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auto-link/status` | Linker stats |
| `POST` | `/api/auto-link/build` | Build links for a workspace |
| `GET` | `/api/auto-link/related?workspace=&docId=` | Get related documents |
| `GET` | `/api/auto-link/graph?workspace=` | Get full link graph |
| `GET` | `/api/auto-link/clusters?workspace=` | Find document clusters |

### Capability Prober
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/probe/status` | Prober stats (backend, sellable, offer) |
| `POST` | `/api/probe/run` | Run a full capability probe |
| `GET` | `/api/probe/profile` | Get the current capability profile |
| `GET` | `/api/probe/offer` | Get the sellable offer (tier, model, TPS) |

### Marketplace Broadcaster
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/market/status` | Marketplace stats (offers, quotes) |
| `POST` | `/api/market/start` | Start broadcasting offers |
| `POST` | `/api/market/stop` | Stop broadcasting |
| `GET` | `/api/market/sellers` | Discover active seller offers |
| `POST` | `/api/market/quote` | Request a quote from a seller |
| `POST` | `/api/market/quote/accept` | Accept a quote |
| `GET` | `/api/market/quote?quoteId=` | Get quote status |
| `GET` | `/api/market/offer` | Get our current offer |

### Memory Extractor
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/extract/status` | Extractor stats |
| `POST` | `/api/extract/run` | Extract entities/relations/facts from text |
| `POST` | `/api/extract/batch` | Extract from multiple texts (merged) |

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (or later).

