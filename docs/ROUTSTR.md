# Routstr Network Integration

## Overview

Routstr is a decentralized AI inference router that uses **Nostr** for censorship-resistant discovery and **Cashu / Bitcoin Lightning** for private, instant payments.

This integration is **fully self-hosted**:
1. **Inference** — Chimera's local QVAC inference handles all AI requests (no external API keys)
2. **Payments** — Self-hosted Cashu eCash mint for private Bitcoin payments (no KYC)
3. **Discovery** — Nostr relay announcements make your node visible to clients

## Where Your Node Appears

Your node announces itself on Nostr relays. Clients discover it there.

- **Routstr frontend:** https://routstr.com
- **Dashboard (local):** http://localhost:8000
- **Nostr relays:** wss://relay.damus.io, wss://relay.nostr.band, wss://nos.lol

## Setup Steps

### Step 1 — Prerequisites

- Docker + Docker Compose installed
- Chimera node already set up and running (for local inference)

### Step 2 — Start Chimera Node

```bash
cd qvac && node src/index.js
```

This starts:
- **Chimera web server** on port 3002 (includes OpenAI-compatible `/v1/chat/completions`)
- **RoutstrMiner** auto-starts the Routstr container on port 8000
- **Cashu mint** (when configured) on port 3338

### Step 3 — Configure Cashu Mint for real Bitcoin

Edit `cashu/orchard.toml` and set your Lightning backend:

```toml
[lightning]
backend = "greenlight"

[greenlight]
device_cert_path = "/app/greenlight/device.crt"
device_key_path  = "/app/greenlight/device-key.pem"
```

Sign up at https://greenlight.blockstream.com, download your credentials, and place them in `cashu/greenlight/`.

Start the mint:
```bash
cd cashu && docker compose up -d
```

### Step 4 — Verify via Dashboard

Open http://localhost:8000 and log in with the admin password from `~/.routstr/.env`.

In the dashboard:
- Confirm the upstream provider is pointing to `http://host.docker.internal:3002/v1`
- Set your profit margin
- Verify Nostr relay announcements

### Step 5 — Create a Cashu Wallet

Any Cashu wallet app can connect to your mint:

**Mint URL:** `http://localhost:3338`

Recommended wallets:
- **Nutstash** (Web): https://nutstash.app
- **eNuts** (iOS/Android)
- **Cashu.me** (Web)

1. Open the wallet app
2. Add mint: `http://localhost:3338`
3. Deposit real sats via Lightning
4. Your wallet balance is stored locally in the app as eCash tokens

## Architecture

```
┌──────────┐   Nostr   ┌──────────────────┐   HTTP    ┌──────────────────┐
│  Client  │ ────────> │  Routstr :8000   │ ────────> │ Chimera :3002  │
│  Wallet  │           │                  │           │  (QVAC local)    │
└──────────┘           │  - discovery     │           └──────────────────┘
                       │  - billing       │
                       │  - proxy         │   Cashu   ┌──────────────────┐
                       └──────────────────┘ <───────> │  Cashu Mint      │
                                                     │  :3338           │
                                                     └──────────────────┘
```

## API Reference

| Endpoint | Description |
|---|---|
| `GET /v1/info` | Node info and status |
| `GET /v1/models` | Available models |
| `POST /v1/chat/completions` | Chat completion proxy (→ Chimera local) |
| `GET /admin/api/settings` | Admin settings (requires auth) |
| `PATCH /admin/api/settings` | Update settings |

## Chimera OpenAI-Compatible Proxy

Chimera exposes an OpenAI-compatible endpoint that Routstr uses as its upstream provider:

```bash
curl http://localhost:3002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chimera-local",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

This runs inference through the local QVAC SDK — no external API calls.

## Troubleshooting

| Issue | Fix |
|---|---|
| `docker not available` | Install Docker Desktop or Docker Engine |
| `Compose dir missing` | Ensure `routstr/docker-compose.yml` exists |
| `Inference not working` | Make sure Chimera node is running on port 3002 |
| `No earnings` | Configure Greenlight in `cashu/orchard.toml` and set `RECEIVE_LN_ADDRESS` |
| `Not in discovery` | Check Nostr relay connections in dashboard |
| `Cannot reach Chimera from Routstr` | Verify `host.docker.internal` resolves in container |

## Config Fields

```json
"routstr": {
  "enabled": true,
  "config": {
    "nsec": "nsec1...",           // Nostr private key
    "npub": "npub1...",           // Nostr public key
    "name": "My Node",
    "description": "...",
    "receiveLnAddress": "...",     // Lightning address for payouts (optional)
    "adminPassword": "...",
    "apiPort": 8000
  }
}
```
