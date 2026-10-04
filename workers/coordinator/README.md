# chimera-coordinator

The volunteer coordinator as a Cloudflare Worker + Durable Object — fully
automated pipeline, no external orchestrator:

```
VolunteerEscrow (Base)          CoordinatorDO                    browser volunteers
  JobCreated ──poll(alarm)──▶   select volunteer ──ws JOB_DISPATCH▶  browser-sdk node
                                 │                                     │ executes
                                 │ ◀────────────── JOB_RESULT ─────────┘
  completeJob ◀──(task key)──────┤
  → pays SETTLEMENT_ADDRESS      └─▶ ledger[<wsp id>] += amount
```

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /` (ws upgrade) | `?token=VOLUNTEER_TOKEN` (public sentinel) | volunteer connect — speaks the upstream REGISTER/HEARTBEAT/JOB_DISPATCH protocol |
| `GET /status` | none | volunteer counts + pending jobs |
| `GET /earnings?id=wsp:…` | none | per-volunteer ledger |
| `GET /results/:jobId` | `ADMIN_TOKEN` | stored job result (may contain consumer data) |
| `POST /jobs` | `DISPATCH_AUTH_TOKEN` | inject a job directly (ledger-only settlement); result returns inline |
| `POST /settle` | `ADMIN_TOKEN` | mark ledger entries paid — monthly runbook |

## Protocol notes

- Job ownership is enforced: `JOB_RESULT`/`JOB_REJECTED` only count when the
  sender's ws attachment matches the recorded `assigned:` volunteer. Results
  for foreign or unassigned jobIds are dropped.
- The ws attachment is the identity — a client cannot self-report another
  volunteerId. REGISTER with an id that's live on another connection is
  rejected (`id in use`).
- `payload` in `JobCreated` is passed to the node as the job spec verbatim
  (`_processJob` accepts raw prompt text, JSON, or `INFERENCE:`/`COMPUTE:`/
  `STORAGE:`/`BANDWIDTH:`-prefixed specs). Keep payloads ≤ `MAX_PAYLOAD_BYTES`
  (8 KB) — oversize chain jobs are marked handled and skipped.
- Past-deadline jobs are never dispatched; deterministic completeJob reverts
  mark the job handled instead of retrying forever.
- Duplicate/replayed results are no-ops (`handled:` markers + assignment
  checks).

## Deploy

```bash
pnpm install
wrangler deploy          # security gate runs scanners automatically
wrangler secret put COORDINATOR_PRIVATE_KEY   # COORDINATOR_ROLE, gas only
wrangler secret put DISPATCH_AUTH_TOKEN
wrangler secret put ADMIN_TOKEN
```

Set `ESCROW_CONTRACT` to the deployed proxy address (see
`scripts/deploy/DeployVolunteerEscrow.s.sol`). For Base Sepolia testing set
`BASE_RPC_URL = https://sepolia.base.org` and a Sepolia escrow address.

## Key model

`COORDINATOR_PRIVATE_KEY` holds only `COORDINATOR_ROLE` — it can mark jobs
complete but escrowed funds always release to the settlement address baked
into the contract, so a leaked key cannot steal payments. Worst case: bogus
completions on pending jobs. Contract upgrades and settlement-address changes
require the cold `DEFAULT_ADMIN` key.

## Monthly settlement runbook

1. `curl https://coordinator.widespread.fyi/earnings?id=wsp:<acct>` per
   volunteer (or export all via `POST /settle` with a dry run)
2. Pay volunteers on Logos according to the ledger
3. `POST /settle` (admin token) to mark entries settled
4. Top up the task key's Base gas if needed
