# Chimera SDK

Integrate local AI mining into your application. Your users earn revenue from idle inference tasks. You earn a percentage as the app integrator.

## How payouts work

All tasking network providers mine directly into the **Chimera protocol multisig** (`0x7eB4A545F875FC1Da252661d31a3e28e67bf723f`) — providers never use individual wallet addresses. EVM only.

1. **Mining** — user's device completes tasks on tasking networks (Golem, Mysterium, Anyone Protocol, BTFS, BTT AI, Casper). All rewards flow to the protocol multisig.
2. **Monthly sweep** — the protocol multisig distributes funds to:
   - **Machine owner** wallet (user's Widespread wallet or Logos payout identity)
   - **App developer** wallet (your address, set in SDK options)
   - Split based on `revenueSplit` config (default 70/30)

In the Widespread integration the browser node runs **provider-less** — no
botchain/RH Chain escrow writes — and attributes work to the user's Logos
payout identity. Settlement and coordination use Logos; the legacy
botchain escrow path below applies only to the deprecated `sendTask`
EVM fallback.

Individual wallets are **never used by providers directly** — they only receive funds via the monthly sweep from the protocol multisig.

## What the SDK gives your app

- **Consent prompt** — users opt in before any mining starts
- **Start / Stop controls** — one-click mining controls
- **Miner status** — real-time view of which miners are active
- **Inference API** — OpenAI-compatible `/v1/chat/completions` endpoint (container mode) or in-browser WebGPU/WASM inference (browser mode)
- **SDK auto-update** — checks for newer versions and notifies your app via `sdkUpdate` in the hook

### Two runtime modes

| Mode | When | How it works | Inference |
|------|------|-------------|-----------|
| **Container mode** | Backend / desktop app with Docker | Providers run inside a hardened Docker container with `CHIMERA_PRIVACY_MODE=true` | vLLM/SGLang via container's OpenAI-compatible API |
| **Browser mode** | Website with no backend | `BrowserNode` runs entirely in-browser — WebGPU inference, IPFS storage, WebRTC bandwidth, WASI compute | WebLLM (WebGPU) or transformers.js (WASM) — no API key needed |

The hook auto-detects which mode to use by checking if the backend API is reachable.

Wallet setup, earnings tracking, and revenue distribution are handled on the **Chimera landing page**, not in your app.

## Install

```bash
npm install @localchimera/sdk
```

Or copy the `sdk/` folder into your project.

## Quick Start

### React — with Widespread wallet (default)

The default wallet backend is **Widespread** — a client-side vault wallet
(extension or `widespread.fyi` embed popup). Users authenticate with their
own keys; the SDK receives an offline-verifiable ES256K JWT + EIP-1193
provider. No Web3Auth config, no server-side verify endpoint, no shared
client ID. Resource-sharing earnings settle on **Logos**, not botchain —
the browser node runs provider-less and attributes work to the user's
payout identity.

```jsx
import { ChimeraWeb3AuthProvider, useChimera } from '@localchimera/sdk';

// The provider supplies the shared wagmi/query context the hook needs
// (name is historical — the widespread path never touches Web3Auth).
function Root() {
  return (
    <ChimeraWeb3AuthProvider>
      <App />
    </ChimeraWeb3AuthProvider>
  );
}

function App() {
  const chimera = useChimera({
    wallet: 'widespread', // default — 'web3auth' keeps the legacy MPC path
    appDeveloperEVM: '0xYourEvmWalletAddressHere',
    revenueSplit: { machineOwner: 0.70, appDeveloper: 0.30 },
  });

  return (
    <div>
      {!chimera.walletConnected && (
        <button onClick={chimera.connectWallet}>Connect Wallet</button>
      )}
      {chimera.walletConnected && !chimera.consentGiven && (
        <button onClick={chimera.giveConsent}>Enable Mining</button>
      )}
      {chimera.consentGiven && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={chimera.start} disabled={chimera.status.running}>Start</button>
          <button onClick={chimera.stop} disabled={!chimera.status.running}>Stop</button>
          <button onClick={chimera.revokeConsent}>Revoke</button>
        </div>
      )}
    </div>
  );
}
```

`connectWallet()` opens the Widespread popup (or uses the installed
extension's injected provider) — no Web3Auth config, client ID, or
server-side verify endpoint involved.

### React — with Web3Auth wallet integration (legacy)

The SDK ships with `ChimeraWeb3AuthProvider` — a pre-configured Web3Auth provider. It enables social login (Google, email, guest) and auto-generates embedded wallets on login. Wrap your app and call the hook:

```jsx
import { ChimeraWeb3AuthProvider, useChimera } from '@localchimera/sdk';

// App root — ChimeraWeb3AuthProvider handles Web3Auth config automatically
function Root() {
  return (
    <ChimeraWeb3AuthProvider>
      <App />
    </ChimeraWeb3AuthProvider>
  );
}

// Inside App — use the hook
function App() {
  const chimera = useChimera({
    appDeveloperEVM: '0xYourEvmWalletAddressHere',
    revenueSplit: { machineOwner: 0.70, appDeveloper: 0.30 },
  });

  return (
    <div>
      {!chimera.walletConnected && (
        <button onClick={chimera.connectWallet}>Connect Wallet</button>
      )}
      {chimera.walletConnected && !chimera.consentGiven && (
        <button onClick={chimera.giveConsent}>Enable Mining</button>
      )}
      {chimera.consentGiven && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={chimera.start} disabled={chimera.status.running}>Start</button>
          <button onClick={chimera.stop} disabled={!chimera.status.running}>Stop</button>
          <button onClick={chimera.revokeConsent}>Revoke</button>
        </div>
      )}
    </div>
  );
}
```

> **Deprecated.** The Web3Auth path requires a shared client ID, a
> server-side `/web3auth/verify` endpoint, and auto-creates a custodial MPC
> wallet on login — none of which apply to the Widespread path. Kept for
> backward compatibility only; new integrations should use
> `wallet: 'widespread'` (the default).

**Social login (legacy):** `connectWallet()` triggers Web3Auth's free PnP modal with Google, email, and guest options. An embedded wallet is auto-created on first login — no browser extension required.

**Protocol keys (legacy):** The SDK uses a shared Web3Auth Client ID. You can override it with the `VITE_WEB3AUTH_CLIENT_ID` environment variable.

**Third-party domains (legacy):** Web3Auth works on any domain automatically via the configured Client ID.

That's it. Your app does **not** collect wallet addresses, show earnings, or handle revenue splits — the Chimera dashboard handles all of that.

### Backend (optional, for server-side control)

```javascript
import { ChimeraSDK } from '@localchimera/sdk';

const sdk = new ChimeraSDK({
  appName: 'MyApp',
  appDeveloperEVM: '0xYourEvmWalletAddressHere'
});

await sdk.init();
sdk.giveConsent();
await sdk.start();
```

## What your app should NOT do

| ❌ Don't | ✅ Do instead |
|---|---|
| Ask users for wallet addresses | Show only consent + start/stop |
| Display earnings or revenue splits | Link users to the Chimera dashboard |
| Configure per-chain addresses | Pass only `appDeveloperEVM` — EVM only |
| Handle fund sweeping or distribution | Let the protocol handle it |

## `useChimera` options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appDeveloperEVM` | string | `null` | Your EVM payout address |
| `revenueSplit` | object | `{ machineOwner: 0.70, appDeveloper: 0.30 }` | Override split (protocol-level) |

## Task dispatch policy

`useChimera().sendTask(task)` creates an on-chain job through the `ChimeraCoordinator` contract and lets you choose who can execute it.

> **Legacy EVM escrow.** `sendTask` writes escrow to the botchain
> coordinator contract and requires the caller's wallet to be connected to
> that chain. The Widespread integration settles on **Logos** instead —
> `sendTask` remains available for backward compatibility with existing
> deployments, but new integrations should route task payment through the
> Logos-native path rather than `sendTask` escrow.

| Policy | Constant | Default | Escrow / dispute | Fallback |
|--------|----------|---------|------------------|----------|
| Hybrid | `TASK_POLICY.HYBRID` | Yes | Chimera volunteers first; tasking networks if no volunteer | Enabled |
| First-party only | `TASK_POLICY.FIRST_PARTY_ONLY` | No | Full escrow and dispute features | Disabled — no tasking network fallback |
| Second-party only | `TASK_POLICY.SECOND_PARTY_ONLY` | No | Not available | Directly routed to tasking networks |

```jsx
import { useChimera, TASK_POLICY, TASK_TYPE_BOTCHAIN } from '@localchimera/sdk';

const chimera = useChimera();

const result = await chimera.sendTask({
  taskType: TASK_TYPE_BOTCHAIN.INFERENCE, // 4
  escrow: '0.1', // BOT
  policy: TASK_POLICY.HYBRID, // default
  payload: { messages: [{ role: 'user', content: 'Hello' }] },
});
```

Set the coordinator address with the `VITE_CHIMERA_COORDINATOR_ADDRESS` environment variable or the `coordinator` option.

### On-chain fallback via Li.Fi

For **hybrid** and **second-party-only** tasks, the coordinator can execute the fallback bridge on-chain through `ChimeraBridgeDispatcher`:

- Second-party-only tasks are bridged automatically during `sendTask`.
- Hybrid tasks hold the full amount in the coordinator. If no volunteer completes within `fallbackTimeout`, the held amount is bridged to the tasking network by the automated fallback keeper.
- Set the bridge dispatcher with `VITE_CHIMERA_BRIDGE_DISPATCHER_ADDRESS` and configure the bridge route per task type via `coordinator.setBridgeData()`.
- Configure the refund bridge via `coordinator.setRefundBridgeData()` so that unfulfilled tasking-network jobs can be refunded to the origin chain. The default `refundTimeout` is 1 hour.
- Automation is handled by **Reactive Network**: a `ChimeraReactive` contract on Reactive Network periodically calls `coordinator.processExpiredJobs()` on the origin chain. This triggers both fallback for unpaid hybrid jobs and refunds for bridged jobs that exceed `refundTimeout` without `markFallbackComplete()` being called. The coordinator also exposes `checkUpkeep`/`performUpkeep` for Chainlink Automation or Gelato as a fallback.

### External miners

The SDK can run external DePIN miners as volunteer providers (`sdk/src/miners/index.js`). All reward-bearing providers default to the protocol payout address (`CHIMERA_PROTOCOL_PAYOUT_ADDRESS`, default `0x7eB4A545F875FC1Da252661d31a3e28e67bf723f`) and never ask for or store a private key:

- `BttAiMinerProvider` — BTT AI Labs inference miner (payout address in status)
- `GolemProvider` — Golem compute provider (yagna wallet managed separately; earnings should be swept to the protocol address)
- `MysteriumProvider` — Mysterium bandwidth provider (`MYSTERIUM_PAYOUT_ADDRESS` env)
- `BtfsStorageProvider` — BTFS storage provider (walletless by design; no on-chain private key in the SDK)
- `StorjProvider` — Storj storage node provider (`--operator.wallet` set to the protocol address)
- `AnyoneProtocolProvider` — Anyone Protocol onion-routing relay provider (`--reward-address` set to the protocol address)
- `CasperProvider` — Casper node provider (relay-only; rejects any PEM private key)

Run them via the SDK's miner runner or import the provider classes directly. The fallback router can also use the optional providers. GPU tasks are routed to Akash because Golem is CPU-only:

- Inference: BTT AI (default) or Akash (`INFERENCE_PROVIDER=akash`); GPU tasks default to Akash (`requiresGpu` / `FALLBACK_REQUIRES_GPU`)
- Storage: Storj (default) or BTFS (`STORAGE_PROVIDER=btfs`)
- Compute: Golem (default, CPU-only) or Akash (`COMPUTE_PROVIDER=akash`); GPU tasks default to Akash (`requiresGpu` / `FALLBACK_REQUIRES_GPU`)
- Bandwidth: Mysterium (default) or Anyone Protocol (`BANDWIDTH_PROVIDER=anyone`)

## `ChimeraSDK` options (backend)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appName` | string | `'unknown-app'` | Identifier for logs |
| `appDeveloperEVM` | string | `null` | Your EVM payout address |
| `machineOwnerEVM` | string | `null` | User's EVM payout address |
| `configPath` | string | `./config.json` | Path to provider config |
| `containerImage` | string | `'chimera:latest'` | Docker image for the hardened privacy container |
| `containerPort` | number | `3002` | Host port to expose the container API |

## Hardened Privacy Container (Required)

The SDK runs **exclusively** inside a hardened privacy container. Docker is required — there is no inline mode. The container ensures the host machine identity is never visible:

- **Random hostname and MAC address** — network identity changes on every start
- **Bridge networking only** — no host network mode
- **All capabilities dropped** (`--cap-drop ALL`) and `no-new-privileges`
- **Named Docker volumes** — no host bind mounts that could leak paths
- **Config mounted read-only** — the container cannot modify its own config
- **`CHIMERA_PRIVACY_MODE=true`** — all providers run inline as processes (no Docker-in-Docker):
  - Anonymous node ID in logs and status
  - No orchestrator registration (no host IP/hostname exposed)
  - No device profiling (no CPU/RAM specs sent to external contracts)
  - Masks EVM addresses in log output
  - Disables P2P swarm

`init()` throws if Docker is not available. The `PrivacyContainer` class is exported for advanced use cases.

## Provider Testing

Test all providers after init:

```javascript
const results = await sdk.testProviders();
// { tested: 7, active: 5, results: [{ provider: 'golem', running: true, latency: 12 }, ...] }
```

## Inference API Keys

The hardened container exposes an **OpenAI-compatible** inference endpoint at `/v1/chat/completions`. You can create API keys that let other apps or users call inference without exposing the machine's identity.

### Creating a key

```javascript
const { key, id, keyPrefix } = await sdk.createInferenceKey({
  name: 'my-app-key',
  rateLimitRpm: 60,             // optional: 60 requests per minute
  modelAllowList: ['chimera-local'], // optional: restrict to specific models
});
// key = 'chim_<random-token>' — share this with the consumer app
// The key contains NO machine identity, NO personal info, NO embedded metadata
```

### Using the key for inference

The key works as a standard Bearer token with any OpenAI-compatible client:

```javascript
const res = await fetch('http://localhost:3002/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  },
  body: JSON.stringify({
    model: 'chimera-local',
    messages: [{ role: 'user', content: 'Hello!' }],
  }),
});
const data = await res.json();
```

Or using the SDK directly:

```javascript
const result = await sdk.infer({
  messages: [{ role: 'user', content: 'Hello!' }],
  apiKey: key,
});
```

### Managing keys

```javascript
await sdk.listInferenceKeys();      // list active keys (metadata only)
await sdk.revokeInferenceKey(id);   // revoke a key by ID
sdk.getInferenceEndpoint();         // get endpoint URL + usage info
```

### Paid inference access

Purchase temporary credits without sharing API keys:

```javascript
const access = await sdk.purchaseInferenceAccess({
  amountUSDT: 5.00,
  ttlSeconds: 3600,
  buyerAddress: '0x...',
});
// { token: 'chim_access_...', sessionId, credit, pricePerToken, expiresAt }

await sdk.getAccessPricing();              // current pricing
await sdk.getAccessStatus(sessionId);      // check session status
await sdk.revokeAccessSession(sessionId);  // revoke early
```

### Privacy guarantees

- API keys are **opaque random tokens** (`chim_` + 32 bytes) — no machine ID, hostname, IP, or user info embedded
- Keys are stored as **SHA-256 hashes** — the raw key is only returned once at creation time
- The inference endpoint returns only model output — **no host info, no device profile, no node ID**
- All requests are proxied through the hardened container — the host machine is never directly exposed

## Architecture

```
┌─────────────────┐
│  Your App       │  ← consent checkbox + start/stop buttons
│  (React, etc.)  │
└────────┬────────┘
         │ useChimera()
┌────────▼────────┐
│  Chimera SDK    │  ← manages consent, forwards EVM address
│  (@localchimera/sdk) │    requires hardened container (Docker)
└────────┬────────┘
         │
┌────────▼────────┐
│  Privacy        │  ← Docker container: random hostname/MAC,
│  Container      │    bridge network, cap-drop ALL, no-new-privileges,
│  (Docker)       │    named volumes, CHIMERA_PRIVACY_MODE=true
└────────┬────────┘
         │
┌────────▼────────┐
│  Tasking        │  ← Golem, Mysterium, Anyone Protocol, BTFS, BTT AI,
│  Providers      │    Casper (relay) — all inline, no Docker-in-Docker
└────────┬────────┘
         │
┌────────▼────────┐
│  Protocol       │  ← monthly sweep → machine owner + app developer
│  Multisig       │    payout wallets (Logos-settled in Widespread mode)
└─────────────────┘
```

## Security: Private Key Handling

**The SDK never stores or exposes private keys.**

| Provider | Untrusted Hardware | Key Storage | SDK Access | App Can Steal? |
|----------|-------------------|-------------|------------|----------------|
| **Golem** | ✅ Safe | Yagna daemon manages keys inside container | Container API only | ❌ No |
| **Mysterium** | ✅ Safe | Node manages identity inside container | Container API only | ❌ No |
| **Anyone Protocol** | ✅ Safe | No keys required — relay uses EVM reward address | Container API only | ❌ No |
| **BTFS** | ✅ Safe | Walletless mode — unfunded daemon, no mnemonic | Container API only | ❌ No |
| **BTT AI** | ✅ Safe | No keys required — miner-cli runs inline | Container API only | ❌ No |
| **Casper** | ✅ Safe (relay mode) | Provider key lives on relay; worker never sees PEM | Relay URL + token only | ❌ No |

**Apps using the SDK cannot extract funds** because they never receive the actual key material — only references to OS-level secure storage.

**Removed from the codebase** — providers that require a private key, wallet mnemonic, account credentials, or self-managed config on the local machine are not included in Localchimera because they cannot safely run on untrusted hardware and their upstream protocols do not support a relay/worker split. The old list (BTT AI, Golem, Mysterium, Anyone Protocol, BTFS, CESS, Akash, Targon, ZCN, Income Generator, CashPilot, Salad, Heurist, Lium, Nosana, ByteLeap) and the per-network analysis is archived in `docs/RELAY_COMPATIBILITY.md` for reference.

## Full example

See `examples/basic-react/` for a complete working integration.

## License

MIT
