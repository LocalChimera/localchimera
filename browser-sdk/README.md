# Chimera Browser SDK

Run a tasker network node entirely in the browser. No download required.

## What it does

The user connects their Web3Auth (EVM) wallet, presses Start, and the browser:

1. **Registers** as a provider on all 4 escrow market contracts (Inference, Storage, Compute, Bandwidth) on Robinhood Chain
2. **Polls** for pending/auto-assigned jobs
3. **Processes** them in-browser using open-source libraries:
   - Inference: `@mlc-ai/web-llm` (WebGPU LLM) + `@huggingface/transformers` (fallback)
   - Storage: `helia` + `@helia/unixfs` (IPFS in browser)
   - Compute: `@wasmer/sdk` (WASI sandboxed execution)
   - Bandwidth: native WebRTC API
4. **Submits** results on-chain via the wallet
5. **Monitors** settlement and claims payment

All heavy libraries are dynamically imported — they don't bloat the initial page load.

## Push dispatch (volunteer coordinator)

Instead of polling the blockchain for jobs, the browser node can connect to the protocol's volunteer coordinator. The coordinator pushes matching jobs to the node via WebSocket; the node executes them and returns the result, and the orchestrator submits the on-chain result.

Set the environment or window variable before starting:

```typescript
// Via build-time env or runtime window object
process.env.COORDINATOR_URL = 'wss://coordinator.localchimera.com';
process.env.COORDINATOR_TOKEN = 'your-coordinator-token';

await node.start();
```

When `COORDINATOR_URL` is set, `BrowserNode` automatically connects to the coordinator after registering and starting its network adapters. The node still falls back to blockchain polling if the coordinator is not configured.

## Install

```bash
npm install @localchimera/browser-sdk
```

## Quick Start

```typescript
import { BrowserNode } from '@localchimera/browser-sdk';

const node = new BrowserNode({ evmProvider, evmAddress });

node.onStatusUpdate((status) => {
  console.log('Running:', status.running);
  console.log('Jobs processed:', status.jobsProcessed);
  console.log('Capabilities:', status.capabilities);
  console.log('Logs:', status.logs);
});

await node.start();
// ...later
await node.stop();
```

### Web3Auth (EVM / Botchain)

```typescript
import { BrowserNode, connectWeb3Auth } from '@localchimera/browser-sdk';

const { provider, address } = await connectWeb3Auth({
  clientId: process.env.WEB3AUTH_CLIENT_ID,
});

const node = new BrowserNode({
  evmProvider: provider,
  evmAddress: address,
  coordinatorContract: process.env.BOTCHAIN_COORDINATOR_ADDRESS,
});
node.onStatusUpdate((status) => console.log(status));
await node.start();
```

Both modes register the provider on-chain, poll for jobs, execute them in the browser, and submit results. EVM mode targets the Botchain escrow vault / compute registry.

## React Example

```tsx
import { useEffect, useRef, useState } from 'react';
import { BrowserNode, type BrowserNodeStatus } from '@localchimera/browser-sdk';

function BrowserNodePanel({ provider, publicKeyHex, accountHash }) {
  const [status, setStatus] = useState<BrowserNodeStatus | null>(null);
  const nodeRef = useRef<BrowserNode | null>(null);

  const handleStart = async () => {
    const node = new BrowserNode(provider, publicKeyHex, accountHash);
    node.onStatusUpdate(setStatus);
    nodeRef.current = node;
    await node.start();
  };

  const handleStop = async () => {
    await nodeRef.current?.stop();
  };

  return (
    <div>
      <button onClick={handleStart}>Start Browser Node</button>
      <button onClick={handleStop}>Stop</button>
      <pre>{JSON.stringify(status, null, 2)}</pre>
    </div>
  );
}
```

## API

### `BrowserNode`

```typescript
new BrowserNode({ evmProvider, evmAddress }: BrowserNodeOptions)
```

EVM/Web3Auth mode requires `evmProvider` and `evmAddress`. Full job processing is implemented for EVM/Botchain.

| Method | Returns | Description |
|--------|---------|-------------|
| `onStatusUpdate(cb)` | `void` | Register a status callback |
| `start()` | `Promise<void>` | Start the node (detects capabilities, registers, polls) |
| `stop()` | `Promise<void>` | Stop the node and clean up resources |
| `getStatus()` | `BrowserNodeStatus` | Get current status snapshot |
| `detectCapabilities()` | `Promise<BrowserCapabilities>` | Detect browser capabilities (CPU, GPU, WebGPU, etc.) |

### `BrowserNodeStatus`

| Field | Type | Description |
|-------|------|-------------|
| `running` | `boolean` | Node is active and polling |
| `registered` | `boolean` | Registered on escrow contract |
| `registering` | `boolean` | Registration in progress |
| `jobsProcessed` | `number` | Total jobs completed |
| `jobsFailed` | `number` | Total jobs failed |
| `earningsMotes` | `string` | Total earnings in motes |
| `currentJob` | `string \| null` | Current job ID being processed |
| `pollCount` | `number` | Total poll cycles |
| `capabilities` | `BrowserCapabilities` | Device capabilities |
| `logs` | `LogEntry[]` | Recent log entries |
| `providerAccountHash` | `string` | Provider account hash |
| `marketRegistrations` | `Record<string, string>` | Per-market registration status |
| `fingerprint` | `string \| null` | Device fingerprint |
| `deviceTrustScore` | `number` | Trust score (0-1) |
| `walletMode` | `'evm' \| null` | Active wallet mode |
| `evmAddress` | `string \| null` | EVM address when in EVM mode |

## RPC Proxy

The SDK expects an EVM RPC proxy at `/api/rpc` on the same origin. If you're hosting on Cloudflare Pages, use a Functions worker:

```js
// functions/api/rpc/[[path]].js
export async function onRequest(context) {
  const url = 'https://rpc.mainnet.chain.robinhood.com';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await context.request.text(),
  });
  return new Response(response.body, {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

## Optional Peer Dependencies

These are dynamically imported only when needed. Install the ones you want to support:

| Package | Task Type | Notes |
|---------|-----------|-------|
| `@mlc-ai/web-llm` | Inference | WebGPU-accelerated LLM inference |
| `@huggingface/transformers` | Inference | WASM/WebGPU fallback inference |
| `helia` + `@helia/unixfs` | Storage | IPFS node in browser |
| `@wasmer/sdk` | Compute | WASI sandboxed execution |
| `multiformats` | Storage | CID parsing for IPFS retrieval |

If a library is not installed, the node falls back to proof-of-processing hashes.

## License

MIT
