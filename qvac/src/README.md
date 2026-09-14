# qvac/src

Node.js source for the QVAC backend node.

## Subdirectories

- `api/` — HTTP API route handlers
- `auth/` — Authentication and session management
- `cli/` — Command-line tools and entry points
- `core/` — NodeManager, WalletManager, AuditLogger, ContentAddress, DeploymentLifecycle
- `inference/` — QVAC inference engine, prompt guard, token metering, voice pipeline, agent loop
- `llmwiki/` — Upstream bridges: OtterWiki, OpenViking, LLMwiki
- `miners/` — Tasking network miners (BTT AI, Golem, Anyone, Mysterium, BTFS, Sentinel, Spheron, Crust, Infernet, Botchain)
- `orchestrator/` — Fleet commander/worker orchestration
- `p2p/` — Pear P2P networking, capability manifests, content pinning
- `payout/` — Protocol payout and sweep logic
- `scheduler/` — Task monitor and scheduling
- `storage/` — Hypercore store, encrypted vault, local persistence
- `web/` — HTTP server setup and file conversion endpoints

## Entry Points

- `index.js` — Main QVAC node entry
- `init.js` — Initialization helpers
