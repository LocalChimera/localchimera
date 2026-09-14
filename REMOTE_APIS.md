# Remote APIs & External Dependencies

This document lists every remote API, RPC endpoint, and external service the Chimera codebase depends on, categorized by component.

---

## 1. Website (Static HTML)

| Endpoint | Method | Purpose | CORS | Auth |
|----------|--------|---------|------|------|
| `https://api.github.com/repos/TerexitariusStomp/localchimera/releases/latest` | GET | Fetch latest release info, version tag, and download assets for the auto-detect download button. Cached in `sessionStorage` for 5 minutes. | No (public API) | None |
| `https://localchimera.com/*` | — | SEO metadata (Open Graph, Twitter cards, JSON-LD). Site domain referenced in `<meta property="og:url">` and structured data. | — | — |
| `https://x.com/LocalChimera` | — | Social media link in footer. | — | — |
| `https://schema.org` | — | JSON-LD vocabulary namespace for SoftwareApplication and Organization structured data. | — | — |

**Notes:**
- The GitHub API call is unauthenticated (60 requests/hour per IP). The response is cached client-side.
- All other website links are simple `<a href>` navigations to docs (Tauri, Capacitor, Pear P2P) or GitHub.

---

## 2. Earnings Dashboard (`website/earnings.html`)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `http://localhost:3002/api/payout/users` | GET | Fetch registered machine owners by EVM address. | None (local) |
| `http://localhost:3002/api/payout/apps` | GET | Fetch registered apps by developer EVM address. | None (local) |
| `http://localhost:3002/api/payout/orders` | GET | Fetch payout orders for a given month. | None (local) |

**Notes:**
- In a browser context the page falls back to same-origin `/api/*`.
- These endpoints read from the local PayoutRouter store (JSON files on disk). They do not call any external blockchain API directly.

---

## 3. QVAC Node Backend (`qvac/src/`)

### 3.1 Payout Router — EVM

| Endpoint | Protocol | Purpose | Auth |
|----------|----------|---------|------|
| `https://arb1.arbitrum.io/rpc` | JSON-RPC over HTTPS | Read EVM multisig balance and send payout transactions via `ethers.js`. | None (public RPC) |

**Environment override:** `RPC_URL` env var can point to a private RPC (e.g., Alchemy, Infura).

### 3.2 Resource Payments

Payments for tasking resources (Golem compute, BTFS storage, etc.) are handled through the static frontend using the user's EVM wallet via Web3Auth. Request Network creates an on-chain payment request, and the protocol converts the received funds to the resource's native token off-chain.

### 3.3 Robinhood Chain Escrow Bridge

| Endpoint | Protocol | Purpose | Auth |
|----------|----------|---------|------|
| `https://rpc.mainnet.chain.robinhood.com` | JSON-RPC over HTTPS | Read provider account balance and submit on-chain transactions for the escrow marketplace. | None (public RPC) |

**Environment overrides:**
- `CHIMERA_RPC_URL` — override RPC endpoint
- `CHIMERA_CHAIN_NAME` — override chain name

### 3.4 GitHub (Installer Fetch)

No tasking-network installers are downloaded by Localchimera. The remaining miners are Docker-based or protocol-native and do not require a separate GitHub installer fetch.

---

## 4. Inference Backend (`inference-backend/`)

| Config Key | Protocol | Purpose | Auth |
|------------|----------|---------|------|
| `CHIMERA_RPC_URL` | JSON-RPC over HTTPS | EVM chain RPC for on-chain inference job and payment verification. | None (public or private RPC) |
| `COORDINATOR_WS_URL` | WebSocket (`wss://`) | Real-time connection to Chimera coordinator for job distribution. | None (peer networking) |
| `COORDINATOR_HTTP_URL` | HTTPS | Fallback HTTP API for coordinator job polling. | None |
| `PRIVATE_KEY` | — | **Local** EVM private key (hex, 64 chars) used to sign inference transactions. Loaded from environment, never committed. | — |
| `PYTHON_INFERENCE_URL` | HTTP | Optional Python bridge for ONNX/WASM inference backend. | None (local) |

**Notes:**
- The inference backend defaults to `INFERENCE_BACKEND=mock` if no Python service is running.
- `PRIVATE_KEY` is validated by a Zod schema (`/^0x[0-9a-fA-F]{64}$/`) and the process exits with code 1 if missing or malformed.

---

## 5. Mobile Expo App (`apps/mobile-expo/`)

| Dependency | Purpose |
|------------|---------|
| `@localchimera/sdk` (npm) | On-device LLM inference via QVAK (Metal/Vulkan). Loaded at runtime, no remote API calls. |

**Notes:**
- The mobile app loads the frontend from bundled assets (`./assets/frontend/index.html`) and runs inference locally. No cloud inference API is contacted.

---

## 6. Docker / Infrastructure

| Service | Protocol | Purpose |
|---------|----------|---------|
| `http://127.0.0.1:1933` (OpenViking) | HTTP | Local Python inference bridge inside the Docker container. Health-checked at startup. |
| `http://localhost:3002/health` | HTTP | Docker HEALTHCHECK and load-balancer liveness probe. Instant, no subsystem queries. |

---

## 7. P2P Networking

| Technology | Protocol | Purpose |
|------------|----------|---------|
| Pear P2P | Hyperswarm / Noise-secret-stream | Peer discovery and direct message relay for wiki sync and fleet orchestration. |
| Hypercore | Noise-secret-stream | Append-only log replication for wiki page history and miner task logs. |

---

## 8. Rate Limits & Resilience

| API | Rate Limit | Retry Strategy |
|-----|-----------|----------------|
| GitHub API (unauthenticated) | 60 req/hour | Cached in `sessionStorage` for 5 min |
| Arbitrum public RPC | ~10 req/sec | 3 retries with 1s backoff in PayoutRouter |
| Robinhood Chain RPC | Varies by provider | No retry (transaction failures are logged) |

---

## 9. Adding a New Remote API

When adding a new upstream miner or service:

1. **Never hardcode credentials** — use environment variables (e.g., `MINERNAME_API_KEY`).
2. **Document the endpoint here** — add a row to the relevant table.
3. **Add an example in `.env.example`** — show the env var name with an empty value.
4. **Add to `config.example.json`** — show the placeholder structure.
5. **Add test coverage** — if the endpoint is critical, add an integration test in `qvac/tests/`.
