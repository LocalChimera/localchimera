/**
 * CoordinatorDO — the whole automated volunteer pipeline in one Durable
 * Object:
 *
 *   ws pool  →  DO alarm polls JobCreated on Base  →  dispatch to a
 *   volunteer  →  JOB_RESULT  →  completeJob on-chain (task-only key,
 *   funds release to the contract's settlement address)  →  per-volunteer
 *   ledger for monthly Logos settlement.
 *
 * Wire protocol is byte-identical to upstream
 * resource-provisioner/coordinator/server.js so browser-sdk's
 * CoordinatorClient works unchanged: REGISTER/REGISTERED, HEARTBEAT,
 * JOB_DISPATCH → JOB_RESULT | JOB_REJECTED.
 *
 * Persistence layout (state.storage):
 *   handled:<jobId>   → 1 | 'expired' | 'oversize' | 'reverted:<err>' | 'lint:<name>' | 'invalid-result'
 *   pending:<jobId>   → PendingJob
 *   assigned:<jobId>  → { volunteerId, at }
 *   result:<jobId>    → { volunteerId, result, at, source }
 *   ledger:<volId>    → { totalWei, jobs, settledWei }
 *   ledger:site:<s>   → site host share (10%, additive)
 *   ledger:project:<p>→ project pool share (10%, additive)
 *   ref:<volId>       → { referrer, project, at } — record-only in P1
 *   lastBlock         → bigint cursor for getLogs
 * Volunteer state lives on ws attachments (hibernation-safe) + the
 * in-memory registry rebuilt from them on wake.
 */

import type { VolunteerMeta } from './registry'
import { normalizeTaskTypes, stripSwarmClaims, selectVolunteer, validateJobResult, PROJECT, CANONICAL } from './registry'
import { lintPayload, lintPayloadDeep, classificationOk, redactPayload, parseSealed, stripInstructions, leaksSealed } from './lint'
import { ESCROW_ABI, USDC_EIP3009_ABI, decodeEip3009Payment, makeClients, resultHash, signDispatch } from './chain'
import { verifyMessage, verifyTypedData } from 'viem'
import type { Hex } from 'viem'
import { verifyDidKey, decodeSig, contentHashToCid } from './didkey'
import { hasPrivateToken, verifyPrivateToken } from './privacypass'

/** Base mainnet USDC — the default x402 payment asset. */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

interface Env {
  COORDINATOR: DurableObjectNamespace
  BASE_RPC_URL: string
  ESCROW_CONTRACT: string
  VOLUNTEER_TOKEN: string
  COORDINATOR_PRIVATE_KEY?: string
  DISPATCH_AUTH_TOKEN?: string
  /** Per-project dispatch tokens: JSON {"<slug>": "<token>"}. A project
   *  token may only submit jobs for its own slug — cross-project forgery
   *  is impossible without the global DISPATCH_AUTH_TOKEN. */
  PROJECT_TOKENS?: string
  /** JSON {"<taskType>": "<microUSDC>"} — default price when amountWei absent */
  PRICE_TABLE?: string
  /** JSON {"<slug>": "<wei>"} — per-project spend budgets; breach pauses the pool */
  PROJECT_BUDGETS?: string
  /** JSON {"<name>": "<value>"} — sealed values redacted from payloads pre-dispatch */
  SEALED_VALUES?: string
  /** Anonymous (no-DID) lifetime payout cap in wei; excess converts to rep */
  ANON_CAP_WEI?: string
  /** Dust→rep threshold at settle (default 0 = disabled) */
  MIN_PAYOUT_WEI?: string
  /** Referral rep cap — jobs per referred node that earn rep (default 50) */
  REFERRAL_JOB_CAP?: string
  /** Optional webhook — rep events POSTed fire-and-forget (delta-git bridge) */
  REP_WEBHOOK_URL?: string
  /** Comma-separated RPC list; rotates on transport failure */
  BASE_RPC_URLS?: string
  /** Honesty-canary cadence (default 30 min) */
  CANARY_INTERVAL_MS?: string
  /** JSON {"<domain>": <multiplier×100>} — lane premiums on PRICE_TABLE defaults */
  LANE_PREMIUMS?: string
  /** Per-identity daily job cap (0/unset = unlimited) */
  AGENT_DAILY_QUOTA?: string
  /** Net cross-project draw allowed before zero-price submissions 429
   *  (free-rider floor; unset = unenforced). Micro-USDC wei. */
  RECIP_FLOOR_WEI?: string
  /** % bonus on amountWei for rep-holding nodes (0/unset = no premium) */
  REP_PREMIUM_PCT?: string
  /** Base URL for /weights/* redirects — R2 public bucket or CDN origin */
  WEIGHTS_MIRROR_URL?: string
  /** IPFS gateway for ENS contenthash resolution (e.g. https://ipfs.io) */
  IPFS_GATEWAY_URL?: string
  /** Cloudflare Turnstile secret — when set, anonymous /jobs submissions
   *  must carry a `cf-turnstile-response` in the body (anti-abuse gate). */
  TURNSTILE_SECRET?: string
  /** Privacy Pass (RFC 9578) — base64 SPKI of the trusted token issuer.
   *  When set, `Authorization: PrivateToken token=…` redeems for one
   *  anonymous /jobs submission (replay-protected via pptoken:<hash>). */
  PRIVACYPASS_ISSUER_KEY?: string
  /** Origin name bound into Privacy Pass token challenges. */
  PRIVACYPASS_ORIGIN?: string
  /** Hashcash-style PoW gate on /jobs — sha256(payload:nonce) needs this many
   *  leading zero hex digits when >0. Set only if submissions get abused. */
  POW_DIFFICULTY?: string
  /** x402 payee address — when set, priced jobs (PRICE_TABLE>0, no amountWei)
   *  return 402 with an accepts spec until X-PAYMENT verifies (EIP-3009) */
  X402_PAYEE?: string
  /** USDC contract for x402 verification (default = Base USDC) */
  X402_USDC?: string
  /** x402 facilitator base URL — when set, verified EIP-3009 authorizations
   *  are POSTed to <facilitator>/settle for on-chain settlement. Without it
   *  payments are signature-verified only (a credit promise, not settled). */
  X402_FACILITATOR?: string
  /** Execution-prover endpoint (opML/zkVM adapter) — when set, completed
   *  results are POSTed for proving; the returned proofRef attaches to the
   *  result record and surfaces in /verify as execProof. */
  PROVER_URL?: string
  /** Bounded jury quorum — siblings needed before adjudication (default 3).
   *  Also the legacy committee quorum for roster-less motions. */
  JURY_QUORUM?: string
  /** Comma-separated peer replica URLs — when set, committee proposals and
   *  ballots are gossiped so each deployment reaches an independent commit
   *  (multi-deployment BFT: quorum = >2/3 of the proposal's roster weight). */
  COMMITTEE_PEERS?: string
  /** Shared secret authenticating /committee/replicate + /committee/ballot
   *  between federated deployments. Required for peer ingress. */
  FEDERATION_TOKEN?: string
  /** Max committee roster size — top-N rep-holders at proposal time
   *  (default 21). Bounds quorum to active weight, like a validator set. */
  COMMITTEE_SIZE?: string
  /** Rep points slashed from the losing side of a /challenge dispute
   *  (default 10). */
  CHALLENGE_SLASH?: string
  /** Optional mainnet RPC for ENS content-hash resolution */
  ENS_RPC?: string
  /** Pending-job TTL — an undispatchable job (no volunteer claims its
   *  taskType) expires as 'no-capacity' instead of sitting forever
   *  (default 1h). */
  PENDING_TTL_MS?: string
  /** % of STORAGE-pin results re-dispatched to a second node for CID
   *  spot-checking — verifier-hook groundwork (default 0 = off). */
  VERIFY_RATE_PCT?: string
  /** Referral landing target for /r/<volunteerId> redirects. */
  REFERRAL_TARGET?: string
  ADMIN_TOKEN?: string
  POLL_INTERVAL_MS?: string
  JOB_RESULT_TIMEOUT_MS?: string
  MAX_PAYLOAD_BYTES?: string
  MAX_VOLUNTEERS?: string
}

interface PendingJob {
  taskType: number
  payload: string
  amountWei: string
  source: 'chain' | 'direct'
  consumer?: string
  site?: string            // wp-cloud site tag — prefer that site's own visitors
  project?: string         // project:<slug> pool — prefer that pool's supporters
  classification?: string  // 'PUBLIC' (default) or 'INTERNAL' (durable+DID-only dispatch)
  difficulty?: number      // >=2 prefers high-capability nodes
  domain?: string          // specialization lane hint
  modelClass?: string      // 'instruct' | 'embedding' | ...
  priority?: 'interactive' | 'batch'  // interactive dispatches ahead of batch under contention
  group?: string           // redundant-dispatch group id — sibling jobs share it
  resultToken?: string     // bearer token for /results/<id>?token= — lets batch consumers read their own result without ADMIN_TOKEN
  verifyOf?: string        // set on spot-check replica jobs — result compared against the original
  deadline?: number // unix seconds; 0/undefined = none
  since: number
}

interface JobEnvelope {
  type: string
  volunteerId?: string
  jobId?: string
  address?: string
  taskTypes?: unknown
  capabilities?: Record<string, unknown>
  networks?: string[]
  site?: string
  project?: string
  referrer?: string
  did?: string
  sig?: string
  durable?: boolean
  shardCapacity?: number
  status?: string
  result?: string
  resultSig?: string
  reason?: string
}

interface DirectJobBody {
  payload?: string
  taskType?: number
  amountWei?: string
  site?: string
  project?: string
  classification?: string
  difficulty?: number
  domain?: string
  modelClass?: string
  priority?: string
  group?: string           // set internally for jury-redundant siblings
  redundant?: number       // N sibling dispatches in one group (consumer aggregates)
  verifyOf?: string        // set internally on spot-check replica jobs
}

const MAX_RESULT_BYTES = 256 * 1024

// ── Federated committee (multi-deployment BFT) ──
// A SignedBallot is portable evidence: any replica — or any external
// verifier reading GET /committee/:id — can re-verify the signature
// against the roster DID and recount the weighted tally.
interface SignedBallot {
  voter: string
  approve: boolean
  sig: string
  phase: 'prevote' | 'precommit'
}

interface CommitteeMotion {
  motion: string
  at: number
  phase: 'prevote' | 'precommit' | 'committed' | 'failed'
  yes: number
  no: number
  /** voter → signed weight (current phase tally boxes, kept for compat) */
  prevotes: Record<string, number>
  precommits: Record<string, number>
  /** voter → ballot, per phase — the exportable quorum certificate */
  ballots: { prevote: Record<string, SignedBallot>; precommit: Record<string, SignedBallot> }
  /** future-phase ballots received early (gossip reordering) */
  pending: Record<string, SignedBallot>
  /** roster snapshot — deterministic weight/DID source across replicas */
  roster?: Record<string, { did: string; weight: number }>
  quorum?: number
  /** voter → the two conflicting signed ballots (Byzantine evidence) */
  equivocators?: Record<string, { a: SignedBallot; b: SignedBallot }>
  closed?: boolean
  /** legacy field from the pre-phase implementation */
  votes?: Record<string, number>
}

export class CoordinatorDO implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private registry = new Map<string, VolunteerMeta>()
  /** jobId → resolve — in-memory; the alarm's flushTimeouts redispatches
   *  anything still pending after a hibernate/wake cycle. */
  private awaiting = new Map<string, { resolve: (ok: boolean) => void }>()
  /** Multi-RPC rotation cursor — advances on transport failure. */
  private rpcIdx = 0
  private migrated = false

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    // Rehydrate ws<->volunteer mapping from attachments after hibernation.
    for (const ws of state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as VolunteerMeta | null
      if (meta) this.registry.set(meta.id, meta)
    }
    void this.ensureAlarm()
  }

  // ── HTTP entry (called via the worker's stub.fetch) ──

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/' && req.headers.get('Upgrade') === 'websocket') {
      return this.handleWsUpgrade(url)
    }
    if (url.pathname.startsWith('/weights/')) {
      // Weight mirror — model assets are served from an external mirror
      // (R2 public bucket / CDN), not through the DO. The coordinator only
      // knows the base so nodes have one canonical discovery point; the
      // redirect keeps bytes off worker CPU billing.
      const base = this.env.WEIGHTS_MIRROR_URL
      if (!base) return this.json({ error: 'no weight mirror configured' }, 404)
      const rel = url.pathname.slice('/weights/'.length)
      if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.includes('..')) {
        return this.json({ error: 'bad path' }, 400)
      }
      return Response.redirect(`${base.replace(/\/$/, '')}/${rel}`, 302)
    }
    if (url.pathname === '/pubkey') {
      // Coordinator identity for node-side JOB_DISPATCH verification —
      // sigs are EIP-191 over `chimera-job:<jobId>` by this account.
      const { account } = makeClients(this.env, this.rpcIdx)
      return this.json({ address: account?.address ?? null, scheme: 'eip191:chimera-job:<jobId>' })
    }
    if (url.pathname === '/status') {
      // ?project=<slug> → counts for just that pool (power-card surfaces
      // poll this — cheaper than shipping byProject for every pool).
      const proj = url.searchParams.get('project')
      const pool = proj ? [...this.registry.values()].filter((v) => v.project === proj) : null
      return this.json({
        volunteers: pool ? pool.length : this.registry.size,
        idle: (pool ?? [...this.registry.values()]).filter((v) => v.status === 'idle').length,
        byTaskType: this.countByTaskType(pool ?? undefined),
        byProject: this.countByProject(),
        pendingJobs: (await this.keys('pending:')).length,
      })
    }
    if (url.pathname === '/earnings' && url.searchParams.get('project')) {
      const led = (await this.state.storage.get(`ledger:project:${url.searchParams.get('project')}`)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined
      return this.json(led ?? { totalWei: '0', jobs: 0, settledWei: '0' })
    }
    if (url.pathname === '/earnings' && url.searchParams.get('site')) {
      const led = (await this.state.storage.get(`ledger:site:${url.searchParams.get('site')}`)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined
      return this.json(led ?? { totalWei: '0', jobs: 0, settledWei: '0' })
    }
    if (url.pathname === '/earnings' && url.searchParams.get('id')) {
      const led = (await this.state.storage.get(`ledger:${url.searchParams.get('id')}`)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined
      return this.json(led ?? { totalWei: '0', jobs: 0, settledWei: '0' })
    }
    if (url.pathname.startsWith('/r/')) {
      // Referral redirect — /r/<volunteerId> lands on REFERRAL_TARGET with
      // ?ref=<id>; the target page's visitor-node picks it into REGISTER.
      const ref = url.pathname.slice(3).slice(0, 64)
      const target = this.env.REFERRAL_TARGET || '/'
      const u = new URL(target, 'https://x.invalid')
      u.searchParams.set('ref', ref)
      await this.audit('referral.click', { ref })
      return new Response(null, { status: 302, headers: { location: u.pathname + u.search } })
    }
    if (url.pathname.startsWith('/badge/')) {
      // Live badge feed — delta-git power-cards and shields.io endpoint
      // badges poll this. Public, cheap, no auth.
      const project = url.pathname.slice(7)
      const pool = [...this.registry.values()].filter((v) => v.project === project)
      const led = (await this.state.storage.get(`ledger:project:${project}`)) as
        | { totalWei: string; jobs: number } | undefined
      return this.json({
        project,
        supporters: pool.length,
        idle: pool.filter((v) => v.status === 'idle').length,
        jobsSettled: led?.jobs ?? 0,
        earnedWei: led?.totalWei ?? '0',
        paused: !!(await this.state.storage.get(`paused:project:${project}`)),
      })
    }
    if (url.pathname === '/leaderboard') {
      // Top rep holders, optionally scoped to a project lane. Public.
      const project = url.searchParams.get('project')
      const prefix = project ? `rep:lane:${project}:` : 'rep:'
      const rows: { id: string; rep: number }[] = []
      for (const [k, v] of await this.state.storage.list({ prefix, limit: 500 })) {
        const rec = v as { points?: number } | undefined
        // skip lane keys when listing global rep — they contain two extra
        // ':' segments and would double-count ids
        const id = k.slice(prefix.length)
        if (!project && id.includes(':')) continue
        if (typeof rec?.points === 'number') rows.push({ id, rep: rec.points })
      }
      rows.sort((a, b) => b.rep - a.rep)
      return this.json({ project: project ?? null, top: rows.slice(0, 50) })
    }
    if (url.pathname === '/rep' && url.searchParams.get('id')) {
      const id = url.searchParams.get('id')!
      const rep = (await this.state.storage.get(`rep:${id}`)) as
        | { points: number; jobs: number; referrals: number } | undefined
      const trust = (await this.state.storage.get(`trust:${id}`)) as number | undefined
      return this.json({ id, ...(rep ?? { points: 0, jobs: 0, referrals: 0 }), trust: trust ?? 0 })
    }
    if (url.pathname === '/operator' && url.searchParams.get('did')) {
      // Operator rollup — the human DID is the principal; volunteerIds
      // (tabs, extensions, daemons) are instruments. This aggregates every
      // node bound to the DID into one operator-level view: total rep
      // (performed + provisioned), jobs, and ledger balance. `didbind:` is
      // persisted at REGISTER so offline nodes still roll up.
      const did = url.searchParams.get('did')!
      const binds = await this.state.storage.list({ prefix: 'didbind:', limit: 5000 })
      const ids = [...binds.entries()].filter(([, v]) => v === did).map(([k]) => k.slice(8))
      let points = 0, jobs = 0, totalWei = 0n
      const nodes: { id: string; points: number; jobs: number; online: boolean }[] = []
      for (const id of ids) {
        const rep = (await this.state.storage.get(`rep:${id}`)) as
          | { points?: number; jobs?: number } | undefined
        const led = (await this.state.storage.get(`ledger:${id}`)) as
          | { totalWei?: string } | undefined
        const online = this.registry.has(id)
        const p = rep?.points ?? 0, j = rep?.jobs ?? 0
        points += p; jobs += j
        totalWei += BigInt(led?.totalWei || '0')
        nodes.push({ id, points: p, jobs: j, online })
      }
      return this.json({ did, nodes, totalPoints: points, totalJobs: jobs, totalWei: totalWei.toString() })
    }
    if (url.pathname === '/drill') {
      // Disaster-recovery drill — recomputes the hash-chained audit log and
      // cross-checks ledger totals against recorded job credits. Admin only.
      // Answers "is the log intact" and "do the ledgers match the event
      // stream" without a redeploy.
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      const entries = await this.state.storage.list({ prefix: 'audit:', limit: 5000 })
      entries.delete('audit:last')
      const sorted = [...entries.entries()].sort((a, b) => Number(a[0].slice(6)) - Number(b[0].slice(6)))
      let prev = '0'
      let broken: number | null = null
      let checked = 0
      for (const [key, v] of sorted) {
        const e = v as { seq: number; prev: string; event: string; data: unknown; at: number; hash: string }
        if (e.prev !== prev) { broken = e.seq; break }
        const rehash = await this.sha256Hex(JSON.stringify({ seq: e.seq, prev: e.prev, event: e.event, data: e.data, at: e.at }))
        if (rehash !== e.hash) { broken = e.seq; break }
        prev = e.hash
        checked++
      }
      const last = (await this.state.storage.get('audit:last')) as { seq?: number } | undefined
      const chainOk = broken === null && (checked === 0 || (last?.seq ?? 0) === checked)
      // Ledger sanity — every ledger:<id> should have totalWei >= settledWei.
      const badLedgers: string[] = []
      for (const key of await this.keys('ledger:')) {
        const l = (await this.state.storage.get(key)) as { totalWei?: string; settledWei?: string } | undefined
        if (!l) continue
        if (BigInt(l.settledWei || '0') > BigInt(l.totalWei || '0')) badLedgers.push(key)
      }
      return this.json({
        auditChain: { entries: checked, intact: chainOk, brokenAt: broken },
        ledgers: { checked: (await this.keys('ledger:')).length, inconsistent: badLedgers },
        pendingJobs: (await this.keys('pending:')).length,
        assignments: (await this.keys('assigned:')).length,
      })
    }
    if (url.pathname === '/audit') {
      // Hash-chained audit export — admin only.
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      const last = (await this.state.storage.get('audit:last')) as
        | { seq: number; hash: string } | undefined
      const events = await this.state.storage.list({ prefix: 'audit:', limit: 5000 })
      events.delete('audit:last')
      return this.json({ head: last ?? null, events: [...events.values()] })
    }
    if (url.pathname === '/reciprocity') {
      // Cross-project co-op ledger — recip:A:B = wei earned by A-supporters
      // serving B-jobs. Directional: the pair entry is A→B, not a balance.
      const a = url.searchParams.get('a')
      const b = url.searchParams.get('b')
      if (a && b) {
        const fwd = (await this.state.storage.get(`recip:${a}:${b}`)) as string | undefined
        const rev = (await this.state.storage.get(`recip:${b}:${a}`)) as string | undefined
        return this.json({ a, b, aToB: fwd ?? '0', bToA: rev ?? '0' })
      }
      const all = await this.state.storage.list({ prefix: 'recip:', limit: 500 })
      return this.json({ balances: Object.fromEntries(all) })
    }
    if (url.pathname === '/jobs' && req.method === 'POST') {
      const auth = await this.jobAuth(req)
      if (!auth.ok) {
        // Anonymous submission paths — the submitter must present EITHER a
        // Privacy Pass token (RFC 9578, Authorization: PrivateToken) OR a
        // solved Turnstile token in the body. Both are anonymous
        // attestation: Privacy Pass for attester-issued tokens, Turnstile
        // for browser challenges. Anonymous jobs land in the global pool
        // under anonymous quotas — never project budgets (unscoped).
        const ppKey = this.env.PRIVACYPASS_ISSUER_KEY
        const authz = req.headers.get('authorization')
        if (hasPrivateToken(authz)) {
          if (!ppKey) return this.json({ error: 'privacy pass not configured' }, 401)
          const tokenHash = await verifyPrivateToken(authz!, {
            issuerKey: ppKey, originName: this.env.PRIVACYPASS_ORIGIN,
          })
          if (!tokenHash) return this.json({ error: 'invalid private token' }, 403)
          if (await this.state.storage.get(`pptoken:${tokenHash}`)) {
            return this.json({ error: 'token already redeemed' }, 409)
          }
          await this.state.storage.put(`pptoken:${tokenHash}`, Date.now())
          await this.audit('jobs.anon-privacypass', { tokenHash })
          return this.handleDirectJob(req, undefined)
        }
        const ts = this.env.TURNSTILE_SECRET
        if (!ts) return this.json({ error: 'unauthorized' }, 401)
        const probe = (await req.clone().json().catch(() => null)) as
          | Record<string, unknown> | null
        const tok = probe?.['cf-turnstile-response']
        if (typeof tok !== 'string' || !(await this.verifyTurnstile(tok))) {
          return this.json({ error: 'turnstile verification required' }, 403)
        }
        return this.handleDirectJob(req, undefined)
      }
      return this.handleDirectJob(req, auth.project)
    }
    if (url.pathname === '/jobs/batch' && req.method === 'POST') {
      const auth = await this.jobAuth(req)
      if (!auth.ok) return this.json({ error: 'unauthorized' }, 401)
      return this.handleBatchJob(req, auth.project)
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const auth = await this.jobAuth(req)
      if (!auth.ok) return this.json({ error: 'unauthorized' }, 401)
      return this.handleChatCompletions(req, auth.project)
    }
    if (url.pathname === '/patronage' && req.method === 'POST') {
      // Direct micro-donations → ledger credit + provisioned rep.
      const auth = await this.jobAuth(req)
      if (!auth.ok) return this.json({ error: 'unauthorized' }, 401)
      return this.handlePatronage(req, auth.project)
    }
    if (url.pathname === '/pools/unpause' && req.method === 'POST') {
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      const body = (await req.json().catch(() => ({}))) as { project?: string }
      if (!body.project) return this.json({ error: 'project required' }, 400)
      await this.state.storage.delete(`paused:project:${body.project}`)
      await this.state.storage.delete(`spend:project:${body.project}`)
      await this.audit('pool.unpaused', { project: body.project })
      return this.json({ ok: true })
    }
    if (url.pathname === '/admin/tokens') {
      // Per-project dispatch tokens in DO storage — new pools self-serve
      // without a redeploy. {slug, token} set; {slug} delete. List redacts.
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      const body = (await req.json().catch(() => ({}))) as { slug?: string; token?: string }
      if (!body.slug || body.slug.length > 64) return this.json({ error: 'slug required' }, 400)
      if (req.method === 'DELETE') {
        await this.state.storage.delete(`dtok:${body.slug}`)
        await this.audit('token.deleted', { project: body.slug })
        return this.json({ ok: true })
      }
      if (req.method !== 'POST') return this.json({ error: 'method not allowed' }, 405)
      if (!body.token || body.token.length < 16) return this.json({ error: 'token >=16 chars required' }, 400)
      await this.state.storage.put(`dtok:${body.slug}`, body.token)
      await this.audit('token.created', { project: body.slug })
      return this.json({ ok: true, slug: body.slug })
    }
    if (url.pathname === '/settle' && req.method === 'POST') {
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      return this.handleSettle(req)
    }
    if (url.pathname === '/metrics') {
      // Prometheus exposition — VictoriaMetrics/Prometheus scrape target
      // (no Grafana dependency; AGPL rejected by the license bar anyway).
      const lines = [
        `# HELP chimera_volunteers Registered volunteers`,
        `chimera_volunteers ${this.registry.size}`,
        `chimera_idle ${[...this.registry.values()].filter((v) => v.status === 'idle').length}`,
        `chimera_durable ${[...this.registry.values()].filter((v) => v.durable).length}`,
        `chimera_pending_jobs ${(await this.keys('pending:')).length}`,
      ]
      for (const [tt, n] of Object.entries(this.countByTaskType()))
        lines.push(`chimera_volunteers_by_task{taskType="${tt}"} ${n}`)
      for (const [p, n] of Object.entries(this.countByProject()))
        lines.push(`chimera_supporters{project="${p}"} ${n}`)
      for (const p of await this.pausedProjects())
        lines.push(`chimera_pool_paused{project="${p}"} 1`)
      return new Response(lines.join('\n') + '\n', {
        headers: { 'content-type': 'text/plain; version=0.0.4' },
      })
    }
    if (url.pathname === '/.well-known/agent.json') {
      // ERC-8004-style agent card — pool agents/services are discoverable
      // here without a registry contract call.
      const { account } = makeClients(this.env, this.rpcIdx)
      return this.json({
        name: 'chimera-coordinator',
        version: 1,
        operator: account?.address ?? null,
        capabilities: {
          jobs: ['/jobs', '/jobs/batch'],
          openaiCompat: '/v1/chat/completions',
          mcp: '/mcp',
          payment: this.env.X402_PAYEE ? ['x402'] : [],
        },
        taskTypes: { canonical: [0, 1, 2, 3], wpcloud: [100, 101, 102, 103], project: [200, 201, 202, 203, 204, 205], swarmReserved: [300, 301] },
        endpoints: { status: '/status', badge: '/badge/:project', leaderboard: '/leaderboard' },
      })
    }
    if (url.pathname === '/passport' && url.searchParams.get('id')) {
      // Signed rep attestation — a self-certifying passport the holder can
      // present anywhere; ATProto PDS publication is a later transport.
      const id = url.searchParams.get('id')!
      const rep = (await this.state.storage.get(`rep:${id}`)) as
        | { points: number; jobs: number; referrals: number } | undefined
      const meta = this.registry.get(id)
      const attestation = {
        subject: id, did: meta?.did ?? null, project: meta?.project ?? null,
        rep: rep ?? { points: 0, jobs: 0, referrals: 0 }, at: Date.now(),
      }
      const { account } = makeClients(this.env, this.rpcIdx)
      let sig: string | null = null
      if (account) {
        try { sig = await account.signMessage({ message: `chimera-passport:${JSON.stringify(attestation)}` }) } catch {}
      }
      return this.json({ attestation, issuer: account?.address ?? null, sig })
    }
    if (url.pathname.startsWith('/verify/')) {
      // Provenance bundle — everything a consumer needs to verify a job's
      // chain of custody offline: the coordinator's dispatch sig (EIP-191
      // over chimera-job:<id>), the result hash, and the producing node's
      // signature over chimera-result:<id>:<hash> when it presented one.
      const jobId = url.pathname.slice(8)
      const [job, result] = await Promise.all([
        this.state.storage.get(`pending:${jobId}`),
        this.state.storage.get(`result:${jobId}`),
      ])
      const handled = await this.state.storage.get(`handled:${jobId}`)
      if (!job && !result) return this.json({ error: 'not found' }, 404)
      const { account } = makeClients(this.env, this.rpcIdx)
      let dispatchSig: string | null = null
      if (account) {
        try { dispatchSig = await signDispatch(account, jobId) } catch {}
      }
      return this.json({
        jobId, handled: handled ?? null, job, result,
        coordinator: account?.address ?? null,
        dispatchSig,
        resultHash: result && typeof (result as { result?: string }).result === 'string'
          ? await this.sha256Hex((result as { result: string }).result)
          : null,
        schemes: {
          dispatch: 'eip191:chimera-job:<jobId>',
          result: 'eip191|ed25519:chimera-result:<jobId>:<sha256(result)>',
        },
      })
    }
    if (url.pathname === '/mcp/tools' || url.pathname === '/mcp') {
      // Minimal MCP-style tool catalog — a real MCP server transport can
      // wrap these; swarm work is exposed as tools.
      return this.json({ tools: [
        { name: 'chimera_infer', description: 'Run an instruct-model job on the visitor pool', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, project: { type: 'string' } }, required: ['prompt'] } },
        { name: 'chimera_fetch', description: 'Fetch a public URL via a visitor node (hash-verified)', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
      ]})
    }
    if (url.pathname === '/mcp/call' && req.method === 'POST') {
      const auth = await this.jobAuth(req)
      if (!auth.ok) return this.json({ error: 'unauthorized' }, 401)
      const body = (await req.json().catch(() => null)) as
        | { name?: string; arguments?: Record<string, unknown> } | null
      const a = body?.arguments ?? {}
      const taskType = body?.name === 'chimera_fetch' ? 205 : 200
      const payload = body?.name === 'chimera_fetch'
        ? JSON.stringify({ url: String(a.url ?? '') })
        : JSON.stringify({ prompt: String(a.prompt ?? '') })
      const out = await this.prepareJob(
        { payload, taskType, project: typeof a.project === 'string' ? a.project : auth.project, priority: 'interactive' },
        auth.project,
      )
      if (out instanceof Response) return out
      const accepted = await this.dispatch(out.jobId)
      const stored = accepted ? await this.state.storage.get(`result:${out.jobId}`) : null
      const text = (stored as { result?: string } | null)?.result ?? ''
      return this.json({ content: [{ type: 'text', text }], isError: !accepted })
    }
    if (url.pathname === '/proxy/fetch' && req.method === 'POST') {
      return this.handleProxyFetch(req)
    }
    if (url.pathname === '/committee/propose' && req.method === 'POST') {
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      const body = (await req.json().catch(() => ({}))) as { motion?: string }
      if (!body.motion) return this.json({ error: 'motion required' }, 400)
      const id = crypto.randomUUID()
      // Roster snapshot — every federated replica must weight ballots
      // identically, so the proposal carries {voter: {did, weight}} rather
      // than letting each replica consult its own rep table. Peers verify
      // ballot signatures against the roster DIDs, so a replica needs no
      // local rep state to reach an independent commit.
      const roster = await this.committeeRoster()
      const totalWeight = Object.values(roster).reduce((s, r) => s + r.weight, 0)
      if (totalWeight <= 0) return this.json({ error: 'no rep-weighted voters bound' }, 400)
      const motion: CommitteeMotion = {
        motion: body.motion.slice(0, 500), at: Date.now(),
        phase: 'prevote',
        yes: 0, no: 0, prevotes: {}, precommits: {},
        ballots: { prevote: {}, precommit: {} }, pending: {},
        roster, quorum: Math.floor((2 * totalWeight) / 3) + 1,
      }
      await this.state.storage.put(`committee:${id}`, motion)
      // Replicate proposal to peer deployments (best-effort; peers that
      // miss it still accept client-fanned ballots only after replicate).
      this.gossipPeers('/committee/replicate', { id, ...motion })
      return this.json({ id, quorum: motion.quorum, rosterWeight: totalWeight, peers: this.committeePeers().length })
    }
    if (url.pathname === '/committee/replicate' && req.method === 'POST') {
      // Federation ingress — peer deployments share FEDERATION_TOKEN;
      // membership in the replica set is operator-configured (COMMITTEE_PEERS).
      if (!this.env.FEDERATION_TOKEN || !this.bearerOk(req, this.env.FEDERATION_TOKEN)) {
        return this.json({ error: 'unauthorized' }, 401)
      }
      const p = (await req.json().catch(() => ({}))) as ({ id?: string } & Partial<CommitteeMotion>) | null
      if (!p?.id || !p.motion || !p.roster || !p.quorum) return this.json({ error: 'bad proposal' }, 400)
      const existing = await this.state.storage.get(`committee:${p.id}`) as CommitteeMotion | undefined
      if (existing) return this.json({ ok: true, dedup: true, phase: existing.phase })
      const motion: CommitteeMotion = {
        motion: p.motion.slice(0, 500), at: p.at ?? Date.now(), phase: 'prevote',
        yes: 0, no: 0, prevotes: {}, precommits: {},
        ballots: { prevote: {}, precommit: {} }, pending: {},
        roster: p.roster, quorum: p.quorum,
      }
      await this.state.storage.put(`committee:${p.id}`, motion)
      await this.audit('committee.replicated', { motion: p.id, voters: Object.keys(p.roster).length })
      // Drain ballots that arrived before the proposal (gossip races).
      const buf = (await this.state.storage.get(`ballotbuf:${p.id}`)) as SignedBallot[] | undefined
      if (buf?.length) {
        await this.state.storage.delete(`ballotbuf:${p.id}`)
        for (const b of buf) await this.tallyBallot(p.id, b, false)
      }
      return this.json({ ok: true, id: p.id })
    }
    if (url.pathname === '/committee/vote' && req.method === 'POST') {
      // 2-phase BFT, federated: a motion commits only after a prevote
      // quorum AND a precommit quorum. With a roster snapshot the quorum is
      // >2/3 of total roster weight (classic BFT supermajority); legacy
      // roster-less motions keep JURY_QUORUM. Ballots sign
      // `chimera-vote:<id>:<phase>:<yes|no>` — phase-bound, replay-safe.
      // Each replica tallies independently and exports its QC (the signed
      // ballot set) via GET /committee/:id — no replica is a trust root.
      const body = (await req.json().catch(() => ({}))) as
        | { id?: string; voter?: string; approve?: boolean; sig?: string; phase?: 'prevote' | 'precommit' } | null
      if (!body?.id || !body.voter) return this.json({ error: 'id + voter required' }, 400)
      if (body.approve === undefined || !body.sig) {
        return this.json({ error: 'signed ballot required: sign chimera-vote:<id>:<phase>:<yes|no>' }, 400)
      }
      const ballot: SignedBallot = { voter: body.voter, approve: !!body.approve, sig: body.sig, phase: body.phase ?? 'prevote' }
      const res = await this.tallyBallot(body.id, ballot, true)
      return this.json(res.body, res.status)
    }
    if (url.pathname === '/committee/ballot' && req.method === 'POST') {
      // Gossiped ballot ingress from peer replicas — same verification,
      // no re-gossip (the client fan-out is the primary delivery path).
      if (!this.env.FEDERATION_TOKEN || !this.bearerOk(req, this.env.FEDERATION_TOKEN)) {
        return this.json({ error: 'unauthorized' }, 401)
      }
      const b = (await req.json().catch(() => ({}))) as ({ id?: string } & Partial<SignedBallot>) | null
      if (!b?.id || !b.voter || b.approve === undefined || !b.sig || !b.phase) {
        return this.json({ error: 'bad ballot' }, 400)
      }
      const res = await this.tallyBallot(b.id, { voter: b.voter, approve: b.approve, sig: b.sig, phase: b.phase }, false)
      return this.json(res.body, res.status)
    }
    if (url.pathname.startsWith('/committee/') && req.method === 'GET') {
      // Quorum-certificate export — the full signed ballot set + roster so
      // ANY observer (not just replicas) can re-verify the decision.
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      const id = url.pathname.slice('/committee/'.length)
      const m = await this.state.storage.get(`committee:${id}`) as CommitteeMotion | undefined
      if (!m) return this.json({ error: 'not found' }, 404)
      return this.json({ id, ...m })
    }
    if (url.pathname === '/.well-known/ens' && url.searchParams.get('name')) {
      if (!this.env.ENS_RPC) return this.json({ error: 'ENS not configured' }, 501)
      return this.handleEns(url.searchParams.get('name')!)
    }
    if (url.pathname.startsWith('/results/')) {
      // Results are admin-gated, EXCEPT for holders of the job's resultToken
      // — /jobs and /jobs/batch issue one per job so batch consumers can
      // fetch their own results without admin access.
      const jobId = url.pathname.slice(9)
      const r = await this.state.storage.get(`result:${jobId}`) as
        | { resultToken?: string } | undefined
      const token = url.searchParams.get('token')
      const tokenOk = token && r?.resultToken && token === r.resultToken
      if (!tokenOk && !this.bearerOk(req, this.env.ADMIN_TOKEN)) {
        return this.json({ error: 'unauthorized' }, 401)
      }
      if (r && r.resultToken) delete (r as Record<string, unknown>).resultToken
      return r ? this.json(r) : this.json({ error: 'not found' }, 404)
    }
    if (url.pathname === '/challenge' && req.method === 'POST') {
      // Optimistic-verification dispute game (opML pattern): results are
      // accepted optimistically; a DID-bound node may challenge by signing
      // `chimera-challenge:<jobId>:<counterHash>` where counterHash is the
      // sha256 of the result it computed. The coordinator asks the prover
      // to deterministically re-execute; the losing side is slashed.
      const body = (await req.json().catch(() => ({}))) as
        | { jobId?: string; challenger?: string; counterHash?: string; sig?: string } | null
      if (!body?.jobId || !body.challenger || !body.counterHash || !body.sig) {
        return this.json({ error: 'jobId + challenger + counterHash + sig required' }, 400)
      }
      const r = await this.state.storage.get(`result:${body.jobId}`) as
        | { volunteerId?: string; result?: string; resultToken?: string; taskType?: number
            payload?: string; disputed?: boolean; proof?: { did?: string } } | undefined
      if (!r) return this.json({ error: 'result not found' }, 404)
      if (r.disputed) return this.json({ error: 'already challenged' }, 409)
      if (!this.env.PROVER_URL) return this.json({ error: 'no prover configured — disputes unresolvable' }, 501)
      const challengerDid = (await this.state.storage.get(`didbind:${body.challenger}`)) as string | undefined
      if (!challengerDid) return this.json({ error: 'challenger has no DID binding' }, 403)
      // Challenger must have skin in the game — a zero-rep DID could spam
      // disputes at no cost while each one triggers a paid re-execution.
      const challengerRep = (await this.state.storage.get(`rep:${body.challenger}`)) as { points?: number } | undefined
      if ((challengerRep?.points ?? 0) <= 0) return this.json({ error: 'challenger holds no rep — nothing to slash' }, 403)
      const msg = `chimera-challenge:${body.jobId}:${body.counterHash}`
      let ok = false
      try {
        if (challengerDid.startsWith('did:key:')) {
          const sb = decodeSig(body.sig)
          if (sb) ok = await verifyDidKey(challengerDid, msg, sb)
        } else {
          ok = await verifyMessage({ address: challengerDid as Hex, message: msg, signature: body.sig as Hex })
        }
      } catch { ok = false }
      if (!ok) {
        await this.audit('challenge.bad-sig', { jobId: body.jobId, challenger: body.challenger })
        return this.json({ error: 'invalid challenge signature' }, 403)
      }
      // Re-prove: the prover re-executes and its signed verdict resolves.
      const ref = (await this.requestExecProof(
        body.jobId, r.taskType ?? 0, r.payload ?? '', r.result ?? '',
        r.proof?.did ?? null, r.resultToken,
      ).catch(() => null)) as { reproduced?: boolean; outputHash?: string; recomputedOutputHash?: string } | null
      const recomputedHash = ref?.recomputedOutputHash ?? ref?.outputHash
      if (!ref || (typeof recomputedHash !== 'string' && ref.reproduced === undefined)) {
        return this.json({ error: 'prover could not adjudicate this task type' }, 422)
      }
      // Verdict: byte-exact match when deterministic (checked locally), else
      // the prover's field-level verdict with the diff recorded as evidence.
      const resultStands =
        recomputedHash === await this.sha256Hex(r.result ?? '') || ref.reproduced === true
      const loser = resultStands ? body.challenger : (r.volunteerId ?? '')
      // Slash: rep penalty (floor 0) — the dishonest side pays.
      if (loser) {
        const rep = (await this.state.storage.get(`rep:${loser}`)) as { points?: number; jobs?: number } | undefined
        const penalty = Number(this.env.CHALLENGE_SLASH || '10')
        await this.state.storage.put(`rep:${loser}`, {
          ...(rep ?? {}), points: Math.max(0, (rep?.points ?? 0) - penalty),
        })
      }
      await this.state.storage.put(`result:${body.jobId}`, {
        ...(r as object), disputed: true,
        challenge: { challenger: body.challenger, counterHash: body.counterHash, resolved: resultStands ? 'result-stands' : 'challenger-wins', proof: ref },
      })
      await this.audit('challenge.resolved', {
        jobId: body.jobId, challenger: body.challenger,
        originalBy: r.volunteerId, outcome: resultStands ? 'result-stands' : 'challenger-wins', slashed: loser,
      })
      return this.json({ ok: true, outcome: resultStands ? 'result-stands' : 'challenger-wins', slashed: loser, proof: ref })
    }
    return this.json({ error: 'not found' }, 404)
  }

  // ── WebSocket protocol ──

  private handleWsUpgrade(url: URL): Response {
    const token = url.searchParams.get('token')
    if (this.env.VOLUNTEER_TOKEN && token !== this.env.VOLUNTEER_TOKEN) {
      return new Response('invalid token', { status: 401 })
    }
    const max = Number(this.env.MAX_VOLUNTEERS || '5000')
    if (this.registry.size >= max) return new Response('pool full', { status: 503 })

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.state.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** The ws attachment is the authoritative identity — a client can never
   *  self-report someone else's volunteerId. */
  private metaFor(ws: WebSocket): VolunteerMeta | null {
    return ws.deserializeAttachment() as VolunteerMeta | null
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    let env: JobEnvelope
    try {
      env = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
    } catch {
      ws.send(JSON.stringify({ type: 'ERROR', error: 'invalid message' }))
      return
    }

    switch (env.type) {
      case 'REGISTER': {
        const id = env.volunteerId || crypto.randomUUID()
        const existing = this.registry.get(id)
        if (existing && this.wsFor(existing.id) !== ws) {
          // Id is live on another connection — don't let a newcomer shadow
          // an active volunteer's dispatch stream.
          ws.send(JSON.stringify({ type: 'ERROR', error: 'volunteer id in use' }))
          ws.close(4009, 'id in use')
          return
        }
        // DID binding — two schemes, same trust tier:
        //  • EOA (0x…) — EIP-191 over `chimera-bind:<volunteerId>`
        //  • did:key:z… — raw ed25519 over the same message (did:key's key
        //    material is self-contained; no resolver call needed)
        // DID-bound nodes get full payouts and rep events; anonymous nodes
        // are payout-capped.
        let did: string | undefined
        if (typeof env.did === 'string' && typeof env.sig === 'string') {
          try {
            let ok = false
            if (env.did.startsWith('did:key:')) {
              const sigBytes = decodeSig(env.sig)
              if (sigBytes) ok = await verifyDidKey(env.did, `chimera-bind:${id}`, sigBytes)
            } else {
              ok = await verifyMessage({
                address: env.did as Hex,
                message: `chimera-bind:${id}`,
                signature: env.sig as Hex,
              })
            }
            if (ok) did = env.did
            else console.warn(`[coordinator] ${id} presented invalid DID sig`)
          } catch {
            console.warn(`[coordinator] ${id} DID verify failed`)
          }
        }
        // Persist the DID binding — the live registry is volatile (drops on
        // disconnect), but committee votes and proof verification need the
        // DID even when the node is offline.
        if (did) await this.state.storage.put(`didbind:${id}`, did)
        const meta: VolunteerMeta = {
          id,
          address: env.address || '',
          taskTypes: stripSwarmClaims(normalizeTaskTypes(env.taskTypes), env.durable === true),
          capabilities: env.capabilities || {},
          networks: env.networks?.length ? env.networks : ['base'],
          site: typeof env.site === 'string' ? env.site.slice(0, 64) : undefined,
          project: typeof env.project === 'string' ? env.project.slice(0, 64) : undefined,
          referrer: typeof env.referrer === 'string' ? env.referrer.slice(0, 64) : undefined,
          did,
          durable: env.durable === true || undefined,
          shardCapacity: typeof env.shardCapacity === 'number' ? Math.max(0, Math.round(env.shardCapacity)) : undefined,
          status: 'idle',
          registeredAt: Date.now(),
          lastHeartbeat: Date.now(),
        }
        // Referral attribution — record-only in P1 (rep accrual + self-
        // referral caps land in P4/P5). First claim wins so a later
        // REGISTER can't reattribute an existing node.
        if (meta.referrer && meta.referrer !== meta.id) {
          const rkey = `ref:${meta.id}`
          if (!(await this.state.storage.get(rkey))) {
            await this.state.storage.put(rkey, { referrer: meta.referrer, project: meta.project, at: Date.now() })
          }
        }
        this.registry.set(meta.id, meta)
        ws.serializeAttachment(meta)
        ws.send(JSON.stringify({ type: 'REGISTERED', volunteerId: meta.id }))
        break
      }
      case 'HEARTBEAT': {
        const v = this.metaFor(ws)
        if (v) {
          v.lastHeartbeat = Date.now()
          // env.status is ignored — upstream heartbeats always claim 'idle',
          // which would clobber 'busy' mid-job. The DO owns busy/idle via the
          // assignment lifecycle.
          if (env.taskTypes) v.taskTypes = stripSwarmClaims(normalizeTaskTypes(env.taskTypes), v.durable)
          if (env.capabilities) v.capabilities = env.capabilities
          ws.serializeAttachment(v)
        }
        break
      }
      case 'JOB_RESULT': {
        const meta = this.metaFor(ws)
        if (env.jobId && typeof env.result === 'string' && meta) {
          void this.onJobResult(
            env.jobId, meta.id, env.result.slice(0, MAX_RESULT_BYTES),
            typeof env.resultSig === 'string' ? env.resultSig : undefined)
        }
        break
      }
      case 'JOB_REJECTED': {
        const meta = this.metaFor(ws)
        if (env.jobId && meta) void this.onJobRejected(env.jobId, meta.id, env.reason)
        break
      }
      case 'EXIT': {
        // Honest exit — a draining node announces departure; its in-flight
        // assignments release immediately for re-dispatch rather than dying
        // on the result timeout. Then close cleanly.
        const meta = this.metaFor(ws)
        if (meta) {
          void this.releaseVolunteerAssignments(meta.id)
          this.registry.delete(meta.id)
        }
        try { ws.close(1000, 'exit') } catch { /* already closed */ }
        break
      }
      default:
        ws.send(JSON.stringify({ type: 'ERROR', error: 'unknown type' }))
    }
  }

  async webSocketClose(ws: WebSocket) {
    const meta = this.metaFor(ws)
    if (meta) {
      // Unannounced drop — same release path as honest EXIT so a crashed
      // node's jobs re-dispatch promptly rather than waiting out
      // JOB_RESULT_TIMEOUT_MS.
      await this.releaseVolunteerAssignments(meta.id)
      this.registry.delete(meta.id)
    }
    try { ws.close() } catch { /* already closed */ }
  }

  /** Release every job still assigned to a departing volunteer back to
   *  pending. In-flight RESULTs that arrive later are ignored because the
   *  assignment row is gone — correct: only the current assignee may resolve. */
  private async releaseVolunteerAssignments(volunteerId: string) {
    for (const key of await this.keys('assigned:')) {
      const a = (await this.state.storage.get(key)) as { volunteerId?: string } | undefined
      if (a?.volunteerId === volunteerId) await this.releaseAssignment(key.slice(9))
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }

  private wsFor(volunteerId: string): WebSocket | undefined {
    return this.state
      .getWebSockets()
      .find((w) => this.metaFor(w)?.id === volunteerId)
  }

  // ── Automated job loop (DO alarm — replaces upstream setInterval) ──

  private async ensureAlarm() {
    const existing = await this.state.storage.getAlarm()
    if (existing === null) {
      await this.state.storage.setAlarm(Date.now() + Number(this.env.POLL_INTERVAL_MS || '15000'))
    }
  }

  async alarm() {
    // Always reschedule first — a crash must not stall the pipeline.
    await this.state.storage.setAlarm(Date.now() + Number(this.env.POLL_INTERVAL_MS || '15000'))
    try {
      await this.migrate()
      await this.pollChain()
      await this.flushPending()
      await this.canaryTick()
    } catch (e) {
      console.error('[coordinator] alarm error:', e)
    }
  }

  /** DO storage schema versioning — bump CURRENT and add a step when the
   *  persistence layout changes. Runs once per wake via `migrated`. */
  private static readonly SCHEMA_VERSION = 1
  private async migrate() {
    if (this.migrated) return
    this.migrated = true
    const v = (await this.state.storage.get<number>('schema:v')) ?? 0
    if (v < CoordinatorDO.SCHEMA_VERSION) {
      // v0→v1: no layout change yet — stamp only.
      await this.state.storage.put('schema:v', CoordinatorDO.SCHEMA_VERSION)
      await this.audit('schema.migrated', { from: v, to: CoordinatorDO.SCHEMA_VERSION })
    }
  }

  /** Honesty canary — periodically dispatch a CANARY job (echo-the-nonce) to
   *  a random volunteer. A node that returns anything but the nonce is
   *  fabricating results; onJobResult applies the trust penalty. */
  private async canaryTick() {
    const interval = Number(this.env.CANARY_INTERVAL_MS || '1800000')
    const last = (await this.state.storage.get<number>('canary:last')) ?? 0
    if (Date.now() - last < interval) return
    const idle = [...this.registry.values()].filter((v) => v.status === 'idle' && v.taskTypes.includes(PROJECT.CANARY))
    if (!idle.length) return
    await this.state.storage.put('canary:last', Date.now())
    const nonce = crypto.randomUUID()
    const jobId = `canary-${crypto.randomUUID()}`
    await this.state.storage.put(`canary:${jobId}`, nonce)
    await this.state.storage.put<PendingJob>(`pending:${jobId}`, {
      taskType: PROJECT.CANARY,
      payload: JSON.stringify({ nonce }),
      amountWei: '0',
      source: 'direct',
      priority: 'batch',
      since: Date.now(),
    })
    void this.dispatch(jobId)
  }

  private async pollChain() {
    if (!this.env.COORDINATOR_PRIVATE_KEY) return
    if (this.env.ESCROW_CONTRACT === '0x0000000000000000000000000000000000000000') return
    const { pub, contract, url, urlCount } = makeClients(this.env, this.rpcIdx)

    let head: bigint
    try {
      head = await pub.getBlockNumber()
    } catch (e) {
      // Transport failure — rotate to the next configured RPC. The next
      // alarm tick resumes on the new endpoint at the same block cursor.
      if (urlCount > 1) {
        this.rpcIdx = (this.rpcIdx + 1) % urlCount
        await this.audit('rpc.failover', { from: url, toIdx: this.rpcIdx })
      }
      console.error('[coordinator] RPC error:', e)
      return
    }

    const last = (await this.state.storage.get<bigint>('lastBlock')) ?? 0n
    if (last === 0n) {
      // First run: start at head — don't replay history.
      await this.state.storage.put('lastBlock', head)
      return
    }
    if (head <= last) return

    const logs = await pub.getLogs({
      address: contract,
      event: ESCROW_ABI[0],
      fromBlock: last + 1n,
      toBlock: head,
    })
    // Advance unconditionally — otherwise the scan range grows without
    // bound and eventually trips the RPC's log-range limit, stalling polling.
    await this.state.storage.put('lastBlock', head)

    const sealed = parseSealed(this.env.SEALED_VALUES)
    for (const log of logs) {
      const jobId = log.args.jobId as Hex
      if (await this.state.storage.get(`handled:${jobId}`)) continue
      if (await this.state.storage.get(`pending:${jobId}`)) continue
      let payload = String(log.args.payload ?? '')
      if (new TextEncoder().encode(payload).length > Number(this.env.MAX_PAYLOAD_BYTES || '8192')) {
        await this.state.storage.put(`handled:${jobId}`, 'oversize')
        continue
      }
      const lintHit = lintPayload(payload) ?? await lintPayloadDeep(payload)
      if (lintHit) {
        await this.state.storage.put(`handled:${jobId}`, `lint:${lintHit}`)
        continue
      }
      const red = redactPayload(payload, sealed)
      if (red.redacted.length) {
        payload = red.payload
        await this.audit('job.redacted', { jobId, names: red.redacted })
      }
      await this.state.storage.put<PendingJob>(`pending:${jobId}`, {
        taskType: Number(log.args.taskType) || 0,
        payload,
        amountWei: String(log.args.amount ?? 0n),
        source: 'chain',
        consumer: log.args.consumer,
        deadline: Number(log.args.deadline ?? 0) || undefined,
        since: Date.now(),
      })
    }
    await this.flushPending()
  }

  /** Dispatch a pending job to the best available volunteer. Resolves true
   *  once a result arrived (or false on timeout/reject). */
  private async dispatch(jobId: string): Promise<boolean> {
    const job = await this.state.storage.get<PendingJob>(`pending:${jobId}`)
    if (!job) return false
    if (await this.state.storage.get(`assigned:${jobId}`)) return true

    if (job.deadline && job.deadline * 1000 < Date.now()) {
      // Past deadline — consumer can refund; completing would revert anyway.
      await this.state.storage.delete(`pending:${jobId}`)
      await this.state.storage.put(`handled:${jobId}`, 'expired')
      return false
    }

    // Preference cascade: project-pooled volunteers → the job's own site
    // visitors → global pool. No network filter: volunteers self-report
    // upstream labels like 'botchain'; dispatch is jobId-keyed so the
    // network tag is advisory.
    const volunteer = selectVolunteer(
      this.registry.values(), job.taskType, [], Date.now(),
      job.site, job.project, job.difficulty, job.classification,
    )
    if (!volunteer) return false

    const ws = this.wsFor(volunteer.id)
    if (!ws) { this.registry.delete(volunteer.id); return false }

    volunteer.status = 'busy'
    ws.serializeAttachment(volunteer)
    await this.state.storage.put(`assigned:${jobId}`, { volunteerId: volunteer.id, at: Date.now() })
    // Signed dispatch — nodes can verify job provenance against the
    // coordinator address exposed at /status. Unsigned when no key is set
    // (dev mode); verification is opt-in node-side.
    const { account } = makeClients(this.env, this.rpcIdx)
    let sig: string | undefined
    if (account) {
      try { sig = await signDispatch(account, jobId) } catch { /* non-fatal */ }
    }
    ws.send(JSON.stringify({
      type: 'JOB_DISPATCH',
      jobId,
      network: 'base',
      taskType: job.taskType,
      requestHash: job.payload,
      amount: job.amountWei,
      ...(job.project ? { project: job.project } : {}),
      ...(job.difficulty !== undefined ? { difficulty: job.difficulty } : {}),
      ...(job.domain ? { domain: job.domain } : {}),
      ...(job.modelClass ? { modelClass: job.modelClass } : {}),
      ...(job.priority ? { priority: job.priority } : {}),
      ...(job.group ? { group: job.group } : {}),
      ...(sig ? { sig } : {}),
    }))
    void this.audit('job.dispatch', { jobId, volunteerId: volunteer.id, taskType: job.taskType })

    const timeoutMs = Number(this.env.JOB_RESULT_TIMEOUT_MS || '60000')
    return new Promise<boolean>((resolve) => {
      this.awaiting.set(jobId, { resolve })
      setTimeout(() => {
        const a = this.awaiting.get(jobId)
        if (a) {
          this.awaiting.delete(jobId)
          a.resolve(false)
          // Free the assignment so the next alarm redispatches elsewhere.
          void this.state.storage.delete(`assigned:${jobId}`).then(() => {
            const v = this.registry.get(volunteer.id)
            if (v) { v.status = 'idle'; this.wsFor(v.id)?.serializeAttachment(v) }
          })
        }
      }, timeoutMs)
    })
  }

  private async releaseAssignment(jobId: string) {
    await this.state.storage.delete(`assigned:${jobId}`)
  }

  private async onJobResult(jobId: string, volunteerId: string, result: string, resultSig?: string) {
    const assignment = (await this.state.storage.get(`assigned:${jobId}`)) as
      | { volunteerId: string; at: number }
      | undefined
    // Only the volunteer the job was dispatched to may resolve it — otherwise
    // anyone could claim credit for a jobId they saw on-chain or in transit.
    if (!assignment || assignment.volunteerId !== volunteerId) return

    // Result dedup — a replayed JOB_RESULT for an already-stored job is a
    // no-op (idempotent), not a second credit.
    if (await this.state.storage.get(`result:${jobId}`)) {
      const pending = this.awaiting.get(jobId)
      if (pending) { this.awaiting.delete(jobId); pending.resolve(true) }
      return
    }

    const job = await this.state.storage.get<PendingJob>(`pending:${jobId}`)
    if (!job) {
      await this.releaseAssignment(jobId)
      const pending = this.awaiting.get(jobId)
      if (pending) { this.awaiting.delete(jobId); pending.resolve(true) }
      return
    }

    // Schema-gate typed results before credit or chain completion — a
    // malformed result is stored (for audit) but earns nothing and is not
    // retried (handled flag stops the redispatch loop).
    if (!validateJobResult(job.taskType, result)) {
      await this.state.storage.delete(`pending:${jobId}`)
      await this.state.storage.delete(`assigned:${jobId}`)
      await this.state.storage.put(`handled:${jobId}`, 'invalid-result')
      await this.state.storage.put(`result:${jobId}`, {
        volunteerId, result, at: Date.now(), source: job.source, invalid: true,
      })
      const v0 = this.registry.get(volunteerId)
      if (v0) { v0.status = 'idle'; this.wsFor(v0.id)?.serializeAttachment(v0) }
      const pending = this.awaiting.get(jobId)
      if (pending) { this.awaiting.delete(jobId); pending.resolve(true) }
      return
    }

    // Honesty canary — CANARY jobs carry a coordinator-generated nonce the
    // node must echo verbatim. Anything else = fabricated result → trust
    // penalty slides the node down the dispatch order. Never credited,
    // never retried. (A timed-out canary is just an offline node — no
    // penalty; only a wrong answer trips it.)
    const canaryNonce = await this.state.storage.get<string>(`canary:${jobId}`)
    if (canaryNonce !== undefined) {
      const passed = result === canaryNonce
      await this.state.storage.delete(`pending:${jobId}`)
      await this.state.storage.delete(`assigned:${jobId}`)
      await this.state.storage.delete(`canary:${jobId}`)
      await this.state.storage.put(`handled:${jobId}`, passed ? 1 : 'canary-fail')
      await this.state.storage.put(`result:${jobId}`, {
        volunteerId, result, at: Date.now(), source: job.source, canary: true, passed,
      })
      const v0 = this.registry.get(volunteerId)
      if (v0) {
        v0.status = 'idle'
        if (!passed) v0.trust = (v0.trust ?? 0) - 5
        this.wsFor(v0.id)?.serializeAttachment(v0)
      }
      await this.audit(passed ? 'canary.pass' : 'canary.fail', { jobId, volunteerId })
      const pending = this.awaiting.get(jobId)
      if (pending) { this.awaiting.delete(jobId); pending.resolve(passed) }
      return
    }

    // Seal-leak killswitch — a result containing a sealed value means the
    // node saw material it should never have had (leak through the payload
    // path, or the node scans its own environment). No credit, the node is
    // banned outright (trust pinned below the exclusion floor), and the
    // event is audit-logged — this is the CanaryTrip analog on the result
    // side of the boundary.
    const sealHit = leaksSealed(result, parseSealed(this.env.SEALED_VALUES))
    if (sealHit) {
      await this.state.storage.delete(`pending:${jobId}`)
      await this.state.storage.delete(`assigned:${jobId}`)
      await this.state.storage.put(`handled:${jobId}`, `seal-leak:${sealHit}`)
      await this.state.storage.put(`result:${jobId}`, {
        volunteerId, result: '[redacted:seal-leak]', at: Date.now(),
        source: job.source, sealLeak: true,
      })
      const v0 = this.registry.get(volunteerId)
      if (v0) {
        v0.status = 'idle'
        v0.trust = -1000
        this.wsFor(v0.id)?.serializeAttachment(v0)
        try { this.wsFor(v0.id)?.close(4000, 'seal-leak') } catch { /* gone */ }
      }
      await this.audit('seal.leak', { jobId, volunteerId, name: sealHit })
      const pending = this.awaiting.get(jobId)
      if (pending) { this.awaiting.delete(jobId); pending.resolve(true) }
      return
    }

    // Instruction-strip — node results are untrusted content; lines shaped
    // like prompt-injection payloads are removed before the result is
    // stored (consumers still quote-embed, never raw-concat).
    const clean = stripInstructions(result)
    if (clean.stripped > 0) {
      await this.audit('result.stripped', { jobId, volunteerId, lines: clean.stripped })
      result = clean.text
    }

    if (job.source === 'chain') {
      const { wallet, contract } = makeClients(this.env)
      if (!wallet) return
      try {
        await wallet.writeContract({
          address: contract,
          abi: ESCROW_ABI,
          functionName: 'completeJob',
          args: [jobId as Hex, resultHash(result), volunteerId],
        })
      } catch (e) {
        const msg = String(e)
        // Deterministic contract reverts are terminal — the job was refunded,
        // expired-resolved elsewhere, or never existed. Don't retry forever.
        if (/JobAlreadyResolved|JobNotFound|revert/i.test(msg)) {
          await this.state.storage.delete(`pending:${jobId}`)
          await this.state.storage.put(`handled:${jobId}`, `reverted:${msg.slice(0, 120)}`)
          await this.releaseAssignment(jobId)
          return
        }
        console.error(`[coordinator] completeJob failed for ${jobId}:`, e)
        await this.releaseAssignment(jobId) // retry with a fresh dispatch
        return
      }
    }

    await this.state.storage.delete(`pending:${jobId}`)
    await this.state.storage.delete(`assigned:${jobId}`)
    await this.state.storage.put(`handled:${jobId}`, 1)
    // Result records are data, not instructions — consumers must treat them
    // as quoted, untrusted content (result-sandboxing contract). `estWh` is
    // a rough watt-hour estimate: wall-clock × assumed node draw.
    const assignmentAt = assignment.at ?? Date.now()
    const durMs = Math.max(0, Date.now() - assignmentAt)
    const cores = Number(this.registry.get(volunteerId)?.capabilities?.cpuCores ?? 2)
    const estWh = Number((((cores * 4 + 5) * durMs) / 3_600_000).toFixed(4))
    // Result proof — a DID-bound node signs `chimera-result:<jobId>:<hash>`
    // so a consumer can prove *this registered node* produced *this result*.
    // Verified eagerly; an invalid sig is stored as unproven, not trusted.
    let proof: { did: string; sig: string; verified: boolean } | undefined
    const nodeDid = this.registry.get(volunteerId)?.did
    if (resultSig && nodeDid) {
      const msg = `chimera-result:${jobId}:${await this.sha256Hex(result)}`
      let verified = false
      try {
        if (nodeDid.startsWith('did:key:')) {
          const sigBytes = decodeSig(resultSig)
          if (sigBytes) verified = await verifyDidKey(nodeDid, msg, sigBytes)
        } else {
          verified = await verifyMessage({ address: nodeDid as Hex, message: msg, signature: resultSig as Hex })
        }
      } catch { /* malformed sig → unproven */ }
      proof = { did: nodeDid, sig: resultSig.slice(0, 512), verified }
      if (!verified) await this.audit('result.bad-sig', { jobId, volunteerId })
    }
    await this.state.storage.put(`result:${jobId}`, {
      volunteerId, result, at: Date.now(), source: job.source,
      taskType: job.taskType, payload: job.payload,
      sandbox: 'quoted', estWh, group: job.group, resultToken: job.resultToken,
      ...(proof ? { proof } : {}),
    })

    // Execution-proof hook — when PROVER_URL is configured (an opML/zkVM
    // prover service), the job is submitted for proving: {jobId, taskType,
    // payloadHash, resultHash, nodeDid}. The returned reference is stored
    // on the result record and surfaces in /verify as `execProof`. Without
    // a prover the signature proof above is attribution, not correctness —
    // this hook is where real proofs attach.
    if (this.env.PROVER_URL) {
      // waitUntil — the DO isolate must stay alive until the prover returns
      // and the execProof lands on the result record.
      this.state.waitUntil(
        this.requestExecProof(jobId, job.taskType, job.payload, result, nodeDid ?? null, job.resultToken)
          .then(async (ref) => {
            if (!ref) return
            const r = await this.state.storage.get(`result:${jobId}`)
            if (r) await this.state.storage.put(`result:${jobId}`, { ...(r as object), execProof: ref })
          })
          .catch(() => this.audit('prover.error', { jobId }))
      )
    }

    // Spot-check adjudication — a replica job (verifyOf set) is compared to
    // the original result. Only meaningful for deterministic jobs (pin CIDs);
    // a mismatch can't identify the liar with one replica, so both sides get
    // flagged for the jury rather than punished.
    if (job.verifyOf) {
      const orig = await this.state.storage.get(`result:${job.verifyOf}`) as
        | { volunteerId?: string; result?: string } | undefined
      const match = orig?.result === result
      await this.audit(match ? 'verify.match' : 'verify.mismatch', {
        jobId, original: job.verifyOf, replicaBy: volunteerId,
      })
      if (!match) {
        await this.state.storage.put(`dispute:${job.verifyOf}`, {
          original: job.verifyOf, replica: jobId,
          volunteers: [orig?.volunteerId, volunteerId], at: Date.now(),
        })
      }
    } else if (job.taskType === CANONICAL.STORAGE && this.env.VERIFY_RATE_PCT) {
      // Verifier hook — with probability VERIFY_RATE_PCT re-run the pin on a
      // second node and compare CIDs. Groundwork for opML/zkVM proofs: same
      // replay slot, different check.
      const rate = Math.min(Math.max(Number(this.env.VERIFY_RATE_PCT), 0), 100)
      if (Math.random() * 100 < rate) {
        void this.prepareJob({
          taskType: job.taskType, payload: job.payload, amountWei: job.amountWei,
          site: job.site, project: job.project, domain: job.domain,
          verifyOf: jobId,
        }, undefined)
          .then((out) => { if (!(out instanceof Response)) void this.dispatch(out.jobId) })
      }
    }
    // Content-hash dedup — anti-farming, NOT anti-consensus. Flagged only
    // when the SAME volunteer returns an identical result for a DIFFERENT
    // input: that's a canned replay. Identical output for the same input is
    // expected from deterministic execution (and two distinct volunteers
    // agreeing is what jury redundancy wants), so neither is penalized.
    // The result still lands on result:<jobId> so the submitter's await
    // resolves normally either way.
    const resHash = await this.sha256Hex(result)
    const seenKey = `seen:${volunteerId}:${job.taskType}:${resHash}`
    const seen = (await this.state.storage.get(seenKey)) as
      | { jobId: string; inputHash: string; at: number }
      | undefined
    if (seen && seen.inputHash !== job.payload) {
      await this.audit('result.duplicate', { jobId, volunteerId })
    } else {
      await this.state.storage.put(seenKey, {
        jobId, inputHash: String(job.payload ?? ''), at: Date.now(),
      })
      await this.credit(
        volunteerId, job.amountWei, job.site,
        this.registry.get(volunteerId)?.site === job.site,
        job.project,
        this.registry.get(volunteerId)?.project === job.project,
        job.domain,
      )
    }
    // Jury adjudication — redundant siblings accumulate under group:<id>;
    // once a quorum of results lands, majority-result jurors gain rep and
    // dissenters lose it (rep-staked validation lite).
    if (job.group) await this.tallyGroup(job.group, jobId, volunteerId, result)
    const v = this.registry.get(volunteerId)
    if (v) { v.status = 'idle'; this.wsFor(v.id)?.serializeAttachment(v) }
    // Resolve last — POST /jobs reads result:<jobId> once dispatch resolves.
    const pending = this.awaiting.get(jobId)
    if (pending) { this.awaiting.delete(jobId); pending.resolve(true) }
  }

  /** Tally a redundant-dispatch group. Majority = most common exact result
   *  among siblings. Jurors in the majority earn +1 rep; dissenters -2.
   *  Recorded under group:<id>.verdict for consumers to read. */
  private async tallyGroup(group: string, jobId: string, volunteerId: string, result: string) {
    const gkey = `group:${group}`
    const g = ((await this.state.storage.get(gkey)) as
      | { results: Record<string, { volunteerId: string; result: string }>; verdict?: string }
      | undefined) ?? { results: {} }
    if (g.verdict) return // already adjudicated — late sibling is informational
    g.results[jobId] = { volunteerId, result }
    const quorum = Number(this.env.JURY_QUORUM || '3')
    if (Object.keys(g.results).length < quorum) {
      await this.state.storage.put(gkey, g)
      return
    }
    // Rep-weighted majority — each sibling's vote weighs their accrued rep
    // (min 1 so a zero-rep juror still counts once). A sybil cluster of
    // fresh nodes can't outvote one high-rep juror.
    const counts = new Map<string, number>()
    for (const r of Object.values(g.results)) {
      const rep = (await this.state.storage.get(`rep:${r.volunteerId}`)) as
        | { points?: number } | undefined
      const w = Math.max(1, rep?.points ?? 0)
      counts.set(r.result, (counts.get(r.result) ?? 0) + w)
    }
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    for (const r of Object.values(g.results)) {
      await this.addRep(r.volunteerId, r.result === majority ? 1 : -2, 'jury')
    }
    g.verdict = majority
    await this.state.storage.put(gkey, g)
    await this.audit('jury.verdict', {
      group, majority: majority.slice(0, 120), jurors: Object.keys(g.results).length,
      weights: Object.fromEntries([...counts.entries()].map(([r, w]) => [r.slice(0, 60), w])),
    })
    // Eval-corpus accrual — verdicts become benchmark data for the eval
    // harness (P7) to gate policy/prompt versions against.
    const corpusSeq = Number(await this.state.storage.get('corpus:seq') ?? 0) + 1
    await this.state.storage.put('corpus:seq', corpusSeq)
    await this.state.storage.put(`corpus:${corpusSeq}`, {
      group, verdict: majority.slice(0, 500), jurors: Object.keys(g.results).length, at: Date.now(),
    })
  }

  private async onJobRejected(jobId: string, volunteerId: string, reason?: string) {
    const assignment = (await this.state.storage.get(`assigned:${jobId}`)) as
      | { volunteerId: string }
      | undefined
    if (assignment?.volunteerId !== volunteerId) return
    const pending = this.awaiting.get(jobId)
    if (pending) { this.awaiting.delete(jobId); pending.resolve(false) }
    console.warn(`[coordinator] ${volunteerId} rejected ${jobId}: ${reason || 'n/a'}`)
    await this.releaseAssignment(jobId)
    const v = this.registry.get(volunteerId)
    if (v) { v.status = 'idle'; this.wsFor(v.id)?.serializeAttachment(v) }
  }

  /** Re-dispatch pending jobs that have no live assignment, and expire
   *  assignments whose result timeout clearly elapsed (e.g. across a
   *  hibernate/wake where the in-memory timer was lost). */
  private async flushPending() {
    const timeoutMs = Number(this.env.JOB_RESULT_TIMEOUT_MS || '60000')
    // Interactive-first ordering: read each pending job once so interactive
    // jobs jump the queue ahead of batch backlog. One extra storage get per
    // key — acceptable at pending-job scale.
    const pending = await Promise.all(
      (await this.keys('pending:')).map(async (key) => ({
        jobId: key.slice(8),
        job: await this.state.storage.get<PendingJob>(key),
      })),
    )
    pending.sort((a, b) =>
      (a.job?.priority === 'interactive' ? 0 : 1) - (b.job?.priority === 'interactive' ? 0 : 1))
    // Pending TTL — a job no volunteer can serve would otherwise sit in
    // storage forever. Expire unassigned old jobs as 'no-capacity'.
    const ttlMs = Number(this.env.PENDING_TTL_MS || '3600000')
    for (const { jobId, job } of pending) {
      if (!job || Date.now() - job.since <= ttlMs) continue
      if (await this.state.storage.get(`assigned:${jobId}`)) continue
      await this.state.storage.delete(`pending:${jobId}`)
      await this.state.storage.put(`handled:${jobId}`, 'no-capacity')
      await this.audit('job.expired', { jobId, taskType: job.taskType })
    }
    for (const { jobId } of pending) {
      const a = (await this.state.storage.get(`assigned:${jobId}`)) as
        | { volunteerId: string; at: number }
        | undefined
      if (a) {
        if (Date.now() - a.at > timeoutMs * 2 && !this.awaiting.has(jobId)) {
          await this.releaseAssignment(jobId)
          const v = this.registry.get(a.volunteerId)
          if (v) { v.status = 'idle'; this.wsFor(v.id)?.serializeAttachment(v) }
        } else {
          continue
        }
      }
      void this.dispatch(jobId)
    }
  }

  // ── Direct job injection + settlement endpoints ──

  /** Direct-job auth: the global DISPATCH_AUTH_TOKEN accepts anything;
   *  a PROJECT_TOKENS project token restricts submissions to that slug. */
  private async jobAuth(req: Request): Promise<{ ok: boolean; project?: string }> {
    if (this.bearerOk(req, this.env.DISPATCH_AUTH_TOKEN)) return { ok: true }
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (this.env.PROJECT_TOKENS) {
      try {
        const tokens = JSON.parse(this.env.PROJECT_TOKENS) as Record<string, string>
        for (const [slug, t] of Object.entries(tokens)) {
          if (t && token && t === token) return { ok: true, project: slug }
        }
      } catch {
        /* malformed PROJECT_TOKENS — global auth already failed, deny */
      }
    }
    // DO-storage tokens — provisioned at runtime via /admin/tokens so new
    // projects don't need a redeploy. dtok:<slug> = token.
    if (token) {
      const entries = await this.state.storage.list({ prefix: 'dtok:', limit: 500 })
      for (const [key, t] of entries) {
        if (t === token) return { ok: true, project: key.slice(5) }
      }
    }
    return { ok: false }
  }

  /** Validate + persist one direct job. Returns jobId or an error Response. */
  private async prepareJob(body: DirectJobBody, authProject?: string): Promise<{ jobId: string; resultToken: string } | Response> {
    const project = typeof body.project === 'string' ? body.project.slice(0, 64) : undefined
    if (authProject && project !== authProject) {
      return this.json({ error: `project token may only submit jobs for "${authProject}"` }, 403)
    }
    if (!body?.payload) return this.json({ error: 'payload required' }, 400)
    const maxBytes = Number(this.env.MAX_PAYLOAD_BYTES || '8192')
    if (new TextEncoder().encode(body.payload).length > maxBytes) {
      return this.json({ error: `payload exceeds ${maxBytes} bytes` }, 413)
    }
    if (!classificationOk(body.classification)) {
      return this.json({ error: 'only PUBLIC/INTERNAL classifications are accepted' }, 400)
    }
    // Circuit breaker — a project whose spend breached its PROJECT_BUDGETS
    // cap refuses new work until /pools/unpause (admin) resets it.
    if (project && (await this.state.storage.get(`paused:project:${project}`))) {
      return this.json({ error: `project "${project}" is paused (budget breach)` }, 503)
    }
    // Free-rider floor — a project that draws cross-project compute without
    // its supporters serving anyone else is capped at RECIP_FLOOR_WEI of net
    // draw. Net = drawn (recip:*:project) - banked (recip:project:*); the
    // default floor of 0 still permits paid jobs, it only throttles
    // zero-price free rides.
    if (project && this.env.RECIP_FLOOR_WEI !== undefined) {
      const floor = BigInt(this.env.RECIP_FLOOR_WEI || '0')
      const drawn = await this.state.storage.list({ prefix: 'recip:' })
      let net = 0n
      for (const [k, v] of drawn) {
        const [, a, b] = k.split(':')
        if (b === project) net += BigInt(String(v))
        else if (a === project) net -= BigInt(String(v))
      }
      if (net > floor && !body.amountWei) {
        return this.json({ error: `project "${project}" over reciprocity floor — supporters must serve other pools or jobs must carry amountWei` }, 429)
      }
    }
    const lintHit = lintPayload(body.payload) ?? (await lintPayloadDeep(body.payload))
    if (lintHit) {
      return this.json({ error: `payload rejected by lint: ${lintHit}` }, 400)
    }

    // Per-identity daily quota — keyed on the project token slug (or
    // 'global' for the master token). Best-effort anti-abuse: a misbehaving
    // submitter can still spread across slugs, which is why the real brake
    // is per-pool PROJECT_BUDGETS.
    const quota = Number(this.env.AGENT_DAILY_QUOTA || '0')
    if (quota > 0) {
      const day = new Date().toISOString().slice(0, 10)
      const qkey = `quota:${day}:${authProject ?? 'global'}`
      const used = Number(await this.state.storage.get(qkey) ?? 0)
      if (used >= quota) return this.json({ error: 'daily quota exceeded' }, 429)
      await this.state.storage.put(qkey, used + 1)
    }
    // PoW gate (opt-in via POW_DIFFICULTY>0) — hashcash-style: sha256(
    // payload:nonce) must carry N leading zero hex digits. A cheap brake on
    // automated /jobs spam that costs the submitter real CPU, not us.
    const powDiff = Number(this.env.POW_DIFFICULTY || '0')
    if (powDiff > 0) {
      const nonce = (body as Record<string, unknown>).pow
      if (typeof nonce !== 'string' || nonce.length > 64) {
        return this.json({ error: 'pow nonce required', difficulty: powDiff }, 403)
      }
      const h = await this.sha256Hex(`${body.payload}:${nonce}`)
      if (!h.startsWith('0'.repeat(powDiff))) {
        return this.json({ error: 'insufficient pow', difficulty: powDiff }, 403)
      }
    }
    // Redaction gate — sealed values are replaced with [SEALED:name] before
    // storage, so they provably never reach a node.
    const sealed = parseSealed(this.env.SEALED_VALUES)
    let payload = body.payload
    const red = redactPayload(payload, sealed)
    if (red.redacted.length) {
      payload = red.payload
      void this.audit('job.redacted', { names: red.redacted, project })
    }
    // Price-table default — callers that omit amountWei get the lane's
    // configured price (micro-USDC); absent table = zero-price job.
    // LANE_PREMIUMS scales the lane price for tagged domains.
    let amountWei = body.amountWei
    if (!amountWei && this.env.PRICE_TABLE) {
      try {
        const table = JSON.parse(this.env.PRICE_TABLE) as Record<string, string>
        let price = BigInt(table[String(Number(body.taskType) || 0)] ?? '0')
        if (price > 0n && body.domain && this.env.LANE_PREMIUMS) {
          const prem = (JSON.parse(this.env.LANE_PREMIUMS) as Record<string, number>)[body.domain]
          if (prem) price = (price * BigInt(Math.round(prem))) / 100n
        }
        if (price > 0n) amountWei = price.toString()
      } catch { /* malformed PRICE_TABLE — zero-price */ }
    }
    const jobId = `direct-${crypto.randomUUID()}`
    const resultToken = crypto.randomUUID()
    await this.state.storage.put<PendingJob>(`pending:${jobId}`, {
      taskType: Number(body.taskType) || 0,
      payload,
      amountWei: amountWei || '0',
      source: 'direct',
      site: typeof body.site === 'string' ? body.site.slice(0, 64) : undefined,
      project,
      // INTERNAL payloads dispatch only to durable DID-bound nodes (the
      // eligibleInternal gate in selectVolunteer) — everything else is
      // treated PUBLIC regardless of what the submitter claimed.
      classification: body.classification === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
      difficulty: typeof body.difficulty === 'number' ? Math.min(Math.max(Math.round(body.difficulty), 0), 3) : undefined,
      domain: typeof body.domain === 'string' ? body.domain.slice(0, 32) : undefined,
      modelClass: typeof body.modelClass === 'string' ? body.modelClass.slice(0, 32) : undefined,
      priority: body.priority === 'interactive' ? 'interactive' : 'batch',
      group: typeof body.group === 'string' ? body.group.slice(0, 64) : undefined,
      resultToken,
      verifyOf: typeof body.verifyOf === 'string' ? body.verifyOf.slice(0, 64) : undefined,
      since: Date.now(),
    })
    void this.audit('job.submit', { jobId, project, taskType: Number(body.taskType) || 0, amountWei: amountWei || '0' })
    return { jobId, resultToken }
  }

  private async handleDirectJob(req: Request, authProject?: string): Promise<Response> {
    const body = (await req.json().catch(() => null)) as DirectJobBody | null
    // x402 — when a payee is configured and the caller didn't supply
    // amountWei, priced submissions carry an X-PAYMENT (EIP-3009
    // TransferWithAuthorization). We verify the signature and record the
    // intent; broadcast/settlement stays with the facilitator/ops path.
    const paidWei = await this.checkPayment(req, body)
    if (paidWei instanceof Response) return paidWei
    const jobBody: DirectJobBody = body ?? {}
    if (paidWei) jobBody.amountWei = paidWei
    const redundant = Math.min(Math.max(Math.round(jobBody.redundant ?? 1), 1), 5)
    if (redundant > 1) {
      // Jury-redundant dispatch — N sibling jobs in one group; onJobResult
      // tallies them (tallyGroup) once a quorum lands.
      const group = crypto.randomUUID()
      const jobs: Array<{ jobId: string; resultToken: string } | { error: string }> = []
      for (let i = 0; i < redundant; i++) {
        const out = await this.prepareJob({ ...jobBody, group }, authProject)
        jobs.push(out instanceof Response ? { error: (await out.json() as { error: string }).error } : out)
      }
      for (const j of jobs) if ('jobId' in j) void this.dispatch(j.jobId)
      return this.json({ jobIds: jobs.map((j) => 'jobId' in j ? j.jobId : j), jobs, group })
    }
    const out = await this.prepareJob(jobBody, authProject)
    if (out instanceof Response) return out
    const accepted = await this.dispatch(out.jobId)
    const result = accepted
      ? await this.state.storage.get(`result:${out.jobId}`)
      : null
    return this.json({ jobId: out.jobId, resultToken: out.resultToken, accepted, result })
  }

  /** /jobs/batch — up to 50 jobs per call. Per-item failures don't fail the
   *  batch; results map index → jobId | error. Unlike /jobs, dispatch is
   *  fire-and-forget (a batch holding 50 result promises would blow the
   *  request budget). */
  private async handleBatchJob(req: Request, authProject?: string): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { jobs?: DirectJobBody[] } | null
    if (!Array.isArray(body?.jobs) || !body.jobs.length || body.jobs.length > 50) {
      return this.json({ error: 'jobs must be a non-empty array of at most 50' }, 400)
    }
    const results: Array<{ jobId?: string; error?: string }> = []
    for (const item of body.jobs) {
      const out = await this.prepareJob(item, authProject)
      if (out instanceof Response) {
        results.push({ error: (await out.json() as { error: string }).error })
      } else {
        void this.dispatch(out.jobId)
        results.push(out)
      }
    }
    return this.json({ results })
  }

  /** OpenAI-compatible shim — /v1/chat/completions → AGENT_INFER pool job →
   *  OpenAI-shaped response. Makes the swarm a drop-in backend for any
   *  agent framework that speaks chat-completions (ElizaOS, LangChain, …).
   *  Auth = the same dispatch tokens as /jobs (a project token pins the job
   *  to that pool). Streaming is not supported yet — `stream:true` requests
   *  get a normal non-streamed body. */
  private async handleChatCompletions(req: Request, authProject?: string): Promise<Response> {
    const body = (await req.json().catch(() => null)) as
      | { model?: string; messages?: { role?: string; content?: string }[]; max_tokens?: number
          project?: string; stream?: boolean; classification?: string }
      | null
    if (!body?.messages?.length) {
      return this.json({ error: { message: 'messages required', type: 'invalid_request_error' } }, 400)
    }
    // Flatten the chat into a single prompt — pool nodes run instruct models.
    const prompt = body.messages
      .map((m) => `${(m.role || 'user').toUpperCase()}: ${m.content ?? ''}`)
      .join('\n')
    const out = await this.prepareJob(
      {
        payload: JSON.stringify({ prompt }),
        taskType: PROJECT.AGENT_INFER,
        project: body.project,
        // INTERNAL callers (e.g. delta-git org-internal repos) restrict
        // dispatch to durable+DID-bound nodes; default stays PUBLIC.
        classification: body.classification === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
        priority: 'interactive',
      },
      authProject,
    )
    if (out instanceof Response) return out
    const accepted = await this.dispatch(out.jobId)
    const stored = accepted ? await this.state.storage.get(`result:${out.jobId}`) : null
    const text = stored && typeof (stored as { result?: unknown }).result === 'string'
      ? (stored as { result: string }).result
      : null
    if (!accepted || text === null) {
      // Pool empty / timed out — 503 so callers fall back (e.g. Workers AI floor).
      return this.json(
        { error: { message: 'no volunteer capacity — try again or use a fallback provider', type: 'server_error' } },
        503,
      )
    }
    if (body.stream) {
      // stream:true client-compat — nodes return whole results, so we replay
      // the completed text as SSE deltas (not real token streaming; keeps
      // OpenAI clients functional against the pool).
      const enc = new TextEncoder()
      const model = body.model || 'swarm'
      const id = `chatcmpl-${out.jobId}`
      const created = Math.floor(Date.now() / 1000)
      const chunks: string[] = []
      for (let i = 0; i < text.length; i += 128) chunks.push(text.slice(i, i + 128))
      const stream = new ReadableStream({
        start(controller) {
          for (const c of chunks) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({
              id, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: { content: c }, finish_reason: null }],
            })}\n\n`))
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({
            id, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`))
          controller.enqueue(enc.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    }
    return this.json({
      id: `chatcmpl-${out.jobId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'swarm',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
      // Token counts are unknowable without the node's tokenizer — report
      // character-based estimates and mark them as such.
      usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(text.length / 4), total_tokens: 0 },
    })
  }

  /** x402 payment gate — challenge when a payee is configured and the caller
   *  brought no amountWei. Verified EIP-3009 intent returns the paid value
   *  (used as the job's amountWei); null = no gate; Response = 402/error. */
  private async checkPayment(req: Request, body: DirectJobBody | null): Promise<string | Response | null> {
    const payee = this.env.X402_PAYEE
    if (!payee || body?.amountWei) return null
    const xpay = req.headers.get('x-payment')
    if (!xpay) {
      return this.json({
        accepts: [{
          scheme: 'exact', network: 'base', asset: this.env.X402_USDC || USDC_BASE,
          payee, description: 'chimera compute job',
        }],
      }, 402)
    }
    const value = await this.verifyX402(xpay, payee)
    if (!value) return this.json({ error: 'invalid x-payment' }, 400)
    // Settlement — prefer a configured facilitator (it pays gas); otherwise
    // the coordinator wallet broadcasts the EIP-3009 transfer itself when
    // funded. With neither, the signature is only *verified* (accounting
    // treats it as a credit promise — honest about the distinction).
    if (this.env.X402_FACILITATOR) {
      const settled = await this.settleX402(xpay, payee, value)
      if (!settled) return this.json({ error: 'x402 settlement failed' }, 402)
      await this.audit('x402.settled', { payee, value, tx: settled })
    } else if (this.env.COORDINATOR_PRIVATE_KEY) {
      const tx = await this.settleX402Direct(xpay)
      if (tx) {
        await this.audit('x402.settled', { payee, value, tx, direct: true })
      } else {
        await this.audit('x402.payment', { payee, value, settled: false })
      }
    } else {
      await this.audit('x402.payment', { payee, value, settled: false })
    }
    return value
  }

  /** Direct EIP-3009 settlement — broadcast the verified authorization via
   *  the coordinator wallet. Returns the tx hash or null (reverts on replayed
   *  nonce / expired window — the signature was already verified upstream). */
  private async settleX402Direct(xpay: string): Promise<string | null> {
    const decoded = decodeEip3009Payment(xpay)
    if (!decoded) return null
    const { auth, v, r, s } = decoded
    const { wallet } = makeClients(this.env, this.rpcIdx)
    if (!wallet) return null
    try {
      return await wallet.writeContract({
        address: (this.env.X402_USDC || USDC_BASE) as Hex,
        abi: USDC_EIP3009_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          auth.from as Hex, auth.to as Hex, BigInt(auth.value),
          BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce as Hex,
          v, r, s,
        ],
      })
    } catch {
      return null
    }
  }

  /** x402 facilitator adapter — POST {x402Version, paymentHeader,
   *  paymentRequirements} to <facilitator>/settle; returns the on-chain tx
   *  hash or null. Compatible with the reference x402 facilitator shape. */
  private async settleX402(xpay: string, payee: string, value: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.env.X402_FACILITATOR!.replace(/\/$/, '')}/settle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          x402Version: 1,
          paymentHeader: xpay,
          paymentRequirements: {
            scheme: 'exact', network: 'base',
            maxAmountRequired: value,
            asset: this.env.X402_USDC || USDC_BASE,
            payTo: payee,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return null
      const j = (await res.json()) as { success?: boolean; txHash?: string; transaction?: string }
      return j.success === false ? null : (j.txHash ?? j.transaction ?? 'settled')
    } catch {
      return null
    }
  }

  /** Verify an x402 'exact' payment: base64 JSON carrying an EIP-3009
   *  TransferWithAuthorization signature over Base USDC. Signature validity
   *  only — settlement/broadcast is a facilitator concern, not ours. */
  private async verifyX402(xpay: string, payee: string): Promise<string | null> {
    try {
      const p = JSON.parse(atob(xpay)) as {
        payload?: { signature?: string; authorization?: {
          from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string } }
      }
      const auth = p.payload?.authorization
      const sig = p.payload?.signature
      if (!auth || !sig) return null
      if (auth.to.toLowerCase() !== payee.toLowerCase()) return null
      const now = BigInt(Math.floor(Date.now() / 1000))
      if (now < BigInt(auth.validAfter) || now > BigInt(auth.validBefore)) return null
      const ok = await verifyTypedData({
        address: auth.from as Hex,
        domain: {
          name: 'USD Coin', version: '2', chainId: 8453,
          verifyingContract: (this.env.X402_USDC || USDC_BASE) as Hex,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: auth.from as Hex, to: auth.to as Hex, value: BigInt(auth.value),
          validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore),
          nonce: auth.nonce as Hex,
        },
        signature: sig as Hex,
      })
      return ok ? auth.value : null
    } catch {
      return null
    }
  }

  /** Secrets-broker outbound injection — a node running a WEB_FETCH job that
   *  declares `inject` headers calls here instead of fetching directly. The
   *  coordinator attaches the sealed values to outbound request headers, so
   *  secrets authenticate the upstream call without ever appearing in the
   *  payload or on the node. The job's own (linted) payload defines url +
   *  inject — the node can only trigger it, not retarget it. */
  private async handleProxyFetch(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as
      | { jobId?: string; volunteerId?: string } | null
    if (!body?.jobId || !body.volunteerId) return this.json({ error: 'jobId + volunteerId required' }, 400)
    const a = (await this.state.storage.get(`assigned:${body.jobId}`)) as
      | { volunteerId: string } | undefined
    if (!a || a.volunteerId !== body.volunteerId) return this.json({ error: 'not assigned' }, 403)
    const job = await this.state.storage.get<PendingJob>(`pending:${body.jobId}`)
    if (!job || job.taskType !== PROJECT.WEB_FETCH) return this.json({ error: 'not a fetch job' }, 400)
    // Per-node rate limit — 30 proxied calls/minute.
    const rk = `proxyRate:${body.volunteerId}:${Math.floor(Date.now() / 60_000)}`
    const hits = Number(await this.state.storage.get(rk) ?? 0)
    if (hits >= 30) return this.json({ error: 'proxy rate limited' }, 429)
    await this.state.storage.put(rk, hits + 1)
    try {
      const spec = JSON.parse(job.payload) as { url?: string; inject?: Record<string, string>; headers?: Record<string, string> }
      const u = new URL(String(spec.url ?? ''))
      if (u.protocol !== 'https:') return this.json({ error: 'https-only' }, 400)
      const headers: Record<string, string> = { ...(spec.headers ?? {}) }
      const sealed = parseSealed(this.env.SEALED_VALUES)
      const injected: string[] = []
      for (const [header, sealName] of Object.entries(spec.inject ?? {})) {
        if (sealed[sealName]) { headers[header] = sealed[sealName]; injected.push(sealName) }
      }
      const res = await fetch(u, { headers, signal: AbortSignal.timeout(15_000) })
      const buf = await res.arrayBuffer()
      if (buf.byteLength > 1_048_576) return this.json({ error: 'body >1MB' }, 502)
      const hash = await this.sha256HexBuf(buf)
      await this.audit('proxy.fetch', { jobId: body.jobId, volunteerId: body.volunteerId, url: u.host + u.pathname, injected, status: res.status })
      const text = new TextDecoder().decode(buf)
      return this.json({ status: res.status, bodyHash: hash, bytes: buf.byteLength, body: text.slice(0, 262_144) })
    } catch (e) {
      return this.json({ error: `upstream fetch failed: ${String(e).slice(0, 120)}` }, 502)
    }
  }

  /** Pending-job TTL — an undispatchable job (no volunteer claims its
   *  taskType) expires instead of sitting forever (default 1h). */
  PENDING_TTL_MS?: string
  /** % of hash-verifiable results (fetch/pin) re-dispatched to a second node
   *  for spot-checking — verifier-hook groundwork (default 0 = off). */
  VERIFY_RATE_PCT?: string
  /** Referral landing target for /r/<volunteerId> redirects. */
  REFERRAL_TARGET?: string
  /** ENS content-hash resolution — `/.well-known/ens?name=x.eth` returns the
   *  address + contenthash so swarm-pinned project sites can be discovered
   *  through ENS naming. Requires ENS_RPC (mainnet). */
  private async handleEns(name: string): Promise<Response> {
    try {
      const { createPublicClient, http, namehash } = await import('viem')
      const { mainnet } = await import('viem/chains')
      const pub = createPublicClient({ chain: mainnet, transport: http(this.env.ENS_RPC) })
      const node = namehash(name)
      const [address, url, resolverAddr] = await Promise.all([
        pub.getEnsAddress({ name: name as never }).catch(() => null),
        pub.getEnsText({ name: name as never, key: 'url' }).catch(() => null),
        pub.getEnsResolver({ name: name as never }).catch(() => null),
      ])
      // EIP-1577 contenthash — read contenthash(node) off the name's
      // resolver. Returns raw multicodec bytes; we decode the common IPFS
      // shape (e3 01 = ipfs-ns, followed by the CIDv1 binary).
      let contentHash: string | null = null
      let cid: string | null = null
      if (resolverAddr) {
        const raw = await pub.readContract({
          address: resolverAddr, functionName: 'contenthash', args: [node],
          abi: [{ name: 'contenthash', type: 'function', stateMutability: 'view',
                  inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bytes' }] }],
        }).catch(() => null)
        if (typeof raw === 'string' && raw.length > 8 && raw !== '0x') {
          contentHash = raw
          cid = contentHashToCid(raw)
        }
      }
      return this.json({
        name, address, url, contentHash, cid,
        gatewayUrl: cid && this.env.IPFS_GATEWAY_URL
          ? `${this.env.IPFS_GATEWAY_URL.replace(/\/$/, '')}/ipfs/${cid}/`
          : null,
      })
    } catch (e) {
      return this.json({ error: `ens lookup failed: ${String(e).slice(0, 120)}` }, 502)
    }
  }

  /** Marks ledger balances settled — used by the monthly Logos payout
   *  runbook. Balances under MIN_PAYOUT_WEI convert to rep points instead
   *  of a payout (dust→rep: sub-dust balances aren't worth gas/admin). */
  private async handleSettle(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; project?: string }
    const dust = BigInt(this.env.MIN_PAYOUT_WEI || '0')
    // Per-project statement: settle only ledgers of volunteers registered
    // into the project pool, and include the pool's own host-share ledger.
    const projectIds = body.project
      ? new Set(
          [...this.registry.values()].filter((v) => v.project === body.project).map((v) => v.id),
        )
      : null
    const out: Record<string, unknown> = {}
    for (const key of await this.keys('ledger:')) {
      const id = key.slice(7)
      if (projectIds && id !== `project:${body.project}` && !projectIds.has(id)) continue
      if (!projectIds && body.ids?.length && !body.ids.includes(id)) continue
      const led = (await this.state.storage.get(key)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined
      if (!led) continue
      const unpaid = BigInt(led.totalWei) - BigInt(led.settledWei || '0')
      if (dust > 0n && unpaid > 0n && unpaid < dust) {
        // Dust → rep: mark settled, convert to rep points (1 point per micro-USDC).
        led.settledWei = led.totalWei
        await this.state.storage.put(key, led)
        await this.addRep(id, Math.max(1, Math.floor(Number(unpaid / 1_000_000n))), 'dust-conversion', undefined, 'provisioned')
        out[id] = { settledWei: '0', dustToRep: unpaid.toString() }
        continue
      }
      led.settledWei = led.totalWei
      await this.state.storage.put(key, led)
      out[id] = { settledWei: unpaid.toString() }
    }
    await this.audit('settle', { ledgers: Object.keys(out).length, project: body.project })
    return this.json({ settled: out, project: body.project })
  }

  /** Direct micro-donations → provisioned rep + ledger credit. A patronage
   *  can target a volunteerId (tip) or a project slug (pool funding). */
  private async handlePatronage(req: Request, authProject?: string): Promise<Response> {
    const body = (await req.json().catch(() => null)) as
      | { volunteerId?: string; project?: string; amountWei?: string; note?: string; patron?: string }
      | null
    if (!body?.amountWei || !/^\d+$/.test(body.amountWei)) {
      return this.json({ error: 'amountWei (integer wei) required' }, 400)
    }
    if (!body.volunteerId && !body.project) {
      return this.json({ error: 'volunteerId or project required' }, 400)
    }
    if (authProject && body.project && body.project !== authProject) {
      return this.json({ error: `project token may only fund "${authProject}"` }, 403)
    }
    const amount = BigInt(body.amountWei)
    if (body.volunteerId) {
      const key = `ledger:${body.volunteerId}`
      const led = ((await this.state.storage.get(key)) as
        | { totalWei: string; jobs: number; settledWei: string } | undefined)
        ?? { totalWei: '0', jobs: 0, settledWei: '0' }
      led.totalWei = (BigInt(led.totalWei) + amount).toString()
      await this.state.storage.put(key, led)
    }
    if (body.project) {
      const key = `ledger:project:${body.project}`
      const led = ((await this.state.storage.get(key)) as
        | { totalWei: string; jobs: number; settledWei: string } | undefined)
        ?? { totalWei: '0', jobs: 0, settledWei: '0' }
      led.totalWei = (BigInt(led.totalWei) + amount).toString()
      await this.state.storage.put(key, led)
    }
    // Patronage accrues provisioned rep for the donor when identified —
    // "can't run a node? fund one" is the third participation channel.
    // 1 rep point per micro-USDC, same scale as dust conversion.
    if (body.patron) {
      await this.addRep(body.patron.slice(0, 128), Math.max(1, Math.floor(Number(amount / 1_000_000n))), 'patronage', undefined, 'provisioned')
    }
    await this.audit('patronage', {
      volunteerId: body.volunteerId, project: body.project,
      amountWei: amount.toString(), note: body.note?.slice(0, 120),
    })
    return this.json({ ok: true })
  }

  private async credit(
    volunteerId: string,
    amountWei: string,
    site?: string,
    ownVisitor = false,
    project?: string,
    ownSupporter = false,
    domain?: string,
  ) {
    const key = `ledger:${volunteerId}`
    const led = ((await this.state.storage.get(key)) as
      | { totalWei: string; jobs: number; settledWei: string }
      | undefined) ?? { totalWei: '0', jobs: 0, settledWei: '0' }
    // Sybil-tiered payout: DID-bound nodes earn the full amount; anonymous
    // nodes are capped at ANON_CAP_WEI lifetime — the excess converts to
    // rep points instead of wei, so farming fresh volunteerIds can't mint
    // money past the cap.
    let amount = BigInt(amountWei || '0')
    const meta = this.registry.get(volunteerId)
    const anonCap = BigInt(this.env.ANON_CAP_WEI || '0')
    if (!meta?.did && anonCap > 0n) {
      const headroom = anonCap - BigInt(led.totalWei)
      if (headroom < amount) {
        const capped = headroom > 0n ? headroom : 0n
        const excess = amount - capped
        amount = capped
        if (excess > 0n) await this.addRep(volunteerId, Math.floor(Number(excess / 1_000_000n)), 'anon-cap-conversion', undefined, 'provisioned')
      }
    }
    // Rep-tier premium — nodes with accrued points earn REP_PREMIUM_PCT on
    // top of the job amount. The premium is paid from the same ledger, so
    // sybil identities can't reach it: rep only accrues from real work.
    const premPct = Number(this.env.REP_PREMIUM_PCT || '0')
    if (premPct > 0 && amount > 0n) {
      const rep = (await this.state.storage.get(`rep:${volunteerId}`)) as { points?: number } | undefined
      if ((rep?.points ?? 0) >= 10) amount += (amount * BigInt(premPct)) / 100n
    }
    led.totalWei = (BigInt(led.totalWei) + amount).toString()
    led.jobs += 1
    await this.state.storage.put(key, led)

    // Rep accrual — 1 point per completed job (lane-scoped too when the job
    // carried a domain, so rep in a lane is earned in that lane); referral
    // rep to the recruiter is capped per referred node.
    await this.addRep(volunteerId, 1, 'job', domain)
    const ref = (await this.state.storage.get(`ref:${volunteerId}`)) as
      | { referrer: string; jobs?: number } | undefined
    const refCap = Number(this.env.REFERRAL_JOB_CAP || '50')
    if (ref && (ref.jobs ?? 0) < refCap && ref.referrer !== volunteerId) {
      ref.jobs = (ref.jobs ?? 0) + 1
      await this.state.storage.put(`ref:${volunteerId}`, ref)
      await this.addRep(ref.referrer, 1, 'referral', undefined, 'provisioned')
    }

    // Reciprocity — cross-project compute co-op ledger: when a supporter of
    // project A serves a job for project B, bank it under recip:A:B.
    if (meta?.project && project && meta.project !== project) {
      const rkey = `recip:${meta.project}:${project}`
      const bal = BigInt(String(await this.state.storage.get(rkey) ?? '0'))
      await this.state.storage.put(rkey, (bal + amount).toString())
    }

    // Pool budget + circuit breaker — once spend exceeds the configured
    // cap the pool pauses (new submissions 503) until an admin unpauses.
    if (project && this.env.PROJECT_BUDGETS) {
      try {
        const budgets = JSON.parse(this.env.PROJECT_BUDGETS) as Record<string, string>
        const cap = budgets[project]
        if (cap) {
          const skey = `spend:project:${project}`
          const spend = BigInt(String(await this.state.storage.get(skey) ?? '0')) + amount
          await this.state.storage.put(skey, spend.toString())
          if (spend > BigInt(cap)) {
            await this.state.storage.put(`paused:project:${project}`, 1)
            await this.audit('pool.paused', { project, spend: spend.toString(), cap })
          }
        }
      } catch { /* malformed PROJECT_BUDGETS — no cap enforced */ }
    }

    // Rep bridge — fire-and-forget event webhook (delta-git consumes these).
    if (this.env.REP_WEBHOOK_URL) {
      const hook = this.env.REP_WEBHOOK_URL
      void fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'job.credit', volunteerId, did: meta?.did, project, amountWei: amount.toString(), at: Date.now() }),
      }).catch(() => {})
    }
    await this.audit('credit', { volunteerId, amount: amount.toString(), project })

    // Host revenue share: when a site/project's own supporter completes its
    // job, the host earns a 10% share — the incentive that makes hosts
    // promote supporter nodes. Site and project shares can both apply when
    // a pooled node serves a site job.
    if (site && ownVisitor) {
      const skey = `ledger:site:${site}`
      const s = ((await this.state.storage.get(skey)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined) ?? { totalWei: '0', jobs: 0, settledWei: '0' }
      s.totalWei = (BigInt(s.totalWei) + (BigInt(amountWei || '0') / 10n)).toString()
      s.jobs += 1
      await this.state.storage.put(skey, s)
    }
    if (project && ownSupporter) {
      const pkey = `ledger:project:${project}`
      const p = ((await this.state.storage.get(pkey)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined) ?? { totalWei: '0', jobs: 0, settledWei: '0' }
      p.totalWei = (BigInt(p.totalWei) + (BigInt(amountWei || '0') / 10n)).toString()
      p.jobs += 1
      await this.state.storage.put(pkey, p)
    }
  }

  // ── helpers ──

  private async keys(prefix: string): Promise<string[]> {
    const m = await this.state.storage.list({ prefix })
    return [...m.keys()]
  }

  private countByTaskType(pool?: VolunteerMeta[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const v of pool ?? this.registry.values())
      for (const tt of v.taskTypes) counts[tt] = (counts[tt] || 0) + 1
    return counts
  }

  private countByProject(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const v of this.registry.values())
      if (v.project) counts[v.project] = (counts[v.project] || 0) + 1
    return counts
  }

  private bearerOk(req: Request, secret?: string): boolean {
    if (!secret) return false
    return req.headers.get('authorization') === `Bearer ${secret}`
  }

  /** Rep ledger — rep:<id> → { points, jobs, referrals }, plus lane-scoped
   *  rep:lane:<domain>:<id> when a domain is set (jury weight is in-lane rep
   *  only — rep in research doesn't qualify a juror for code lanes).
   *  Points are non-transferable reputation; they gate premium dispatch
   *  lanes and durable-tier admission in later phases. Negative points
   *  (jury dissents, cap conversions) subtract — floor is 0. */
  private async addRep(
    id: string,
    points: number,
    reason: string,
    lane?: string,
    channel: 'performed' | 'provisioned' = 'performed',
  ) {
    if (!points) return
    const apply = async (key: string) => {
      const rep = ((await this.state.storage.get(key)) as
        | { points: number; jobs: number; referrals: number } | undefined)
        ?? { points: 0, jobs: 0, referrals: 0 }
      rep.points = Math.max(0, rep.points + points)
      if (reason === 'job') rep.jobs += 1
      if (reason === 'referral') rep.referrals += 1
      await this.state.storage.put(key, rep)
    }
    await apply(`rep:${id}`)
    // Two-channel rep: 'performed' = the device did the labor (full weight),
    // 'provisioned' = the operator's fleet/patronage enabled it (diminished
    // weight). Consumers weight rep:ch:provisioned:* at a discount — capital
    // can't buy performed standing.
    await apply(`rep:ch:${channel}:${id}`)
    if (lane) await apply(`rep:lane:${lane.slice(0, 32)}:${id}`)
  }

  // ── Federated committee helpers ──

  /** Peer replica base URLs — operators of federated deployments each set
   *  COMMITTEE_PEERS to the other members' coordinator URLs. Membership is
   *  out-of-band (like a Tendermint validator set); FEDERATION_TOKEN is the
   *  shared peer secret for /committee/replicate + /committee/ballot. */
  private committeePeers(): string[] {
    return (this.env.COMMITTEE_PEERS || '')
      .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
  }

  /** Best-effort fan-out to peer replicas — runs after the response. */
  private gossipPeers(path: string, body: Record<string, unknown>) {
    const peers = this.committeePeers()
    if (!peers.length || !this.env.FEDERATION_TOKEN) return
    const fetches = peers.map((p) =>
      fetch(`${p}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.FEDERATION_TOKEN}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => console.error(`[committee] gossip to ${p} failed:`, e))
    )
    this.state.waitUntil(Promise.all(fetches))
  }

  /** Committee roster snapshot — top COMMITTEE_SIZE DID-bound volunteers
   *  by rep weight (bounded committee, like a Tendermint validator set;
   *  ghost rep can't inflate the quorum). Frozen into the proposal so every
   *  replica weights ballots identically. */
  private async committeeRoster(): Promise<Record<string, { did: string; weight: number }>> {
    const size = Math.max(1, Number(this.env.COMMITTEE_SIZE || '21'))
    const binds = await this.state.storage.list({ prefix: 'didbind:', limit: 5000 })
    const candidates: { voter: string; did: string; weight: number }[] = []
    for (const [k, v] of binds) {
      const voter = k.slice('didbind:'.length)
      const rep = (await this.state.storage.get(`rep:${voter}`)) as { points?: number } | undefined
      const weight = rep?.points ?? 0
      if (weight > 0 && typeof v === 'string') candidates.push({ voter, did: v, weight })
    }
    candidates.sort((a, b) => b.weight - a.weight)
    const roster: Record<string, { did: string; weight: number }> = {}
    for (const c of candidates.slice(0, size)) roster[c.voter] = { did: c.did, weight: c.weight }
    return roster
  }

  /** Verify one signed ballot against the motion's roster (or the live
   *  rep/didbind tables for legacy roster-less motions). */
  private async verifyBallot(
    id: string, m: CommitteeMotion, b: SignedBallot,
  ): Promise<{ ok: boolean; weight: number; did?: string; status?: number; error?: string }> {
    let weight: number, voterDid: string | undefined
    if (m.roster) {
      const entry = m.roster[b.voter]
      if (!entry) return { ok: false, weight: 0, status: 403, error: 'voter not in committee roster' }
      weight = entry.weight; voterDid = entry.did
    } else {
      const rep = (await this.state.storage.get(`rep:${b.voter}`)) as { points?: number } | undefined
      weight = rep?.points ?? 0
      if (weight <= 0) return { ok: false, weight: 0, status: 403, error: 'voter holds no rep' }
      voterDid = (await this.state.storage.get(`didbind:${b.voter}`)) as string | undefined
      if (!voterDid) return { ok: false, weight: 0, status: 403, error: 'voter has no DID binding' }
    }
    const msg = `chimera-vote:${id}:${b.phase}:${b.approve ? 'yes' : 'no'}`
    let ok = false
    try {
      if (voterDid.startsWith('did:key:')) {
        const sigBytes = decodeSig(b.sig)
        if (sigBytes) ok = await verifyDidKey(voterDid, msg, sigBytes)
      } else {
        ok = await verifyMessage({ address: voterDid as Hex, message: msg, signature: b.sig as Hex })
      }
    } catch { ok = false }
    if (!ok) return { ok: false, weight, did: voterDid, status: 403, error: 'invalid ballot signature' }
    return { ok: true, weight, did: voterDid }
  }

  /** Recount the current phase's tally box into m.yes/m.no — used after an
   *  equivocation purge, which removes weight mid-flight. */
  private recountMotion(m: CommitteeMotion) {
    const box = m.phase === 'precommit' ? m.precommits : m.prevotes
    let yes = 0, no = 0
    for (const w of Object.values(box)) { if (w > 0) yes += w; else no -= w }
    m.yes = yes; m.no = no
  }

  /** Mark a voter equivocated — Byzantine evidence (two conflicting signed
   *  ballots for the same motion+phase) is stored for export, the voter's
   *  ballot is purged from both phase boxes, and pending entries dropped. */
  private markEquivocator(m: CommitteeMotion, voter: string, a: SignedBallot, b: SignedBallot) {
    m.equivocators ??= {}
    if (!m.equivocators[voter]) m.equivocators[voter] = { a, b }
    delete m.prevotes[voter]; delete m.precommits[voter]
    delete m.ballots.prevote[voter]; delete m.ballots.precommit[voter]
    for (const k of Object.keys(m.pending)) if (k.endsWith(`:${voter}`)) delete m.pending[k]
  }

  /** Shared ballot path for /committee/vote (gossip=true) and
   *  /committee/ballot (gossip=false). Verifies the signature, detects
   *  equivocation, buffers future-phase ballots, advances phases on quorum,
   *  drains buffered ballots, and gossips accepted ballots to peers. */
  private async tallyBallot(
    id: string, ballot: SignedBallot, gossip: boolean,
  ): Promise<{ body: Record<string, unknown>; status: number }> {
    const m = (await this.state.storage.get(`committee:${id}`)) as CommitteeMotion | undefined
    if (!m) {
      if (!gossip) {
        // Ballot arrived before the proposal — buffer it (cap 200) for the
        // replicate handler to drain.
        const key = `ballotbuf:${id}`
        const buf = ((await this.state.storage.get(key)) as SignedBallot[] | undefined) ?? []
        if (buf.length < 200) { buf.push(ballot); await this.state.storage.put(key, buf) }
      }
      return { body: { error: 'motion not found/closed' }, status: 404 }
    }
    if (m.closed) {
      // Decisions are final — the QC stands. But a conflicting signed
      // ballot arriving late is still slashable equivocation evidence.
      m.ballots ??= { prevote: {}, precommit: {} }
      const prior = m.ballots[ballot.phase]?.[ballot.voter]
      if (prior && prior.approve !== ballot.approve) {
        const v = await this.verifyBallot(id, m, ballot)
        if (v.ok) {
          this.markEquivocator(m, ballot.voter, prior, ballot)
          await this.state.storage.put(`committee:${id}`, m)
          await this.audit('committee.equivocation', { motion: id, voter: ballot.voter, phase: ballot.phase, postCommit: true })
          if (gossip) this.gossipPeers('/committee/ballot', { id, ...ballot })
          return { body: { error: 'equivocation detected — evidence recorded' }, status: 409 }
        }
      }
      return { body: { error: 'motion not found/closed' }, status: 404 }
    }
    m.phase ??= 'prevote'
    m.prevotes ??= m.votes ?? {}; m.precommits ??= {}
    m.ballots ??= { prevote: {}, precommit: {} }; m.pending ??= {}
    const order: Record<string, number> = { prevote: 0, precommit: 1, committed: 2, failed: 2 }
    // Signature first — a *validly signed* conflicting ballot is equivocation
    // evidence regardless of which phase the motion is in now. Checking
    // stale-phase before the sig check would let a Byzantine voter's second
    // ballot slip through unrecorded once the phase moved on.
    const v = await this.verifyBallot(id, m, ballot)
    if (!v.ok) {
      await this.audit('committee.bad-sig', { motion: id, voter: ballot.voter, phase: ballot.phase })
      return { body: { error: v.error }, status: v.status ?? 403 }
    }
    // Gossip every signature-valid ballot on receipt — INCLUDING ones this
    // replica rejects locally (stale-phase, equivocating). The ballots are
    // the evidence; a replica that detects an equivocation must still forward
    // the conflicting ballot so EVERY peer can convict. Gossip-ingress
    // ballots (gossip=false) aren't re-forwarded — bounded fan-out.
    if (gossip) this.gossipPeers('/committee/ballot', { id, ...ballot })
    const priorSamePhase = m.ballots[ballot.phase]?.[ballot.voter]
    if (priorSamePhase && priorSamePhase.approve !== ballot.approve) {
      this.markEquivocator(m, ballot.voter, priorSamePhase, ballot)
      this.recountMotion(m)
      await this.state.storage.put(`committee:${id}`, m)
      await this.audit('committee.equivocation', { motion: id, voter: ballot.voter, phase: ballot.phase })
      return { body: { error: 'equivocation detected — excluded' }, status: 409 }
    }
    if (m.equivocators?.[ballot.voter]) {
      return { body: { error: 'voter equivocated — excluded' }, status: 409 }
    }
    if (order[ballot.phase] < order[m.phase]) {
      return { body: { error: `motion is past ${ballot.phase}` }, status: 409 }
    }
    if (priorSamePhase) {
      return { body: { error: 'already voted this phase' }, status: 409 }
    }
    if (order[ballot.phase] > order[m.phase]) {
      // Future phase — buffer it (Tendermint-style). A conflicting ballot
      // already pending for the same voter+phase is equivocation evidence.
      const key = `${ballot.phase}:${ballot.voter}`
      const prior = m.pending[key]
      if (prior && prior.approve !== ballot.approve) {
        this.markEquivocator(m, ballot.voter, prior, ballot)
        this.recountMotion(m)
        await this.state.storage.put(`committee:${id}`, m)
        await this.audit('committee.equivocation', { motion: id, voter: ballot.voter, phase: ballot.phase })
        return { body: { error: 'equivocation detected — excluded' }, status: 409 }
      }
      m.pending[key] = ballot
      await this.state.storage.put(`committee:${id}`, m)
      return { body: { ok: true, buffered: true, phase: m.phase }, status: 202 }
    }
    m.ballots[ballot.phase][ballot.voter] = ballot
    const box = ballot.phase === 'prevote' ? m.prevotes : m.precommits
    box[ballot.voter] = ballot.approve ? v.weight : -v.weight
    // Tally + advance; draining buffered ballots can cascade phases.
    const quorum = m.quorum ?? Number(this.env.JURY_QUORUM || '3')
    let phaseYes = 0, phaseNo = 0, progressed = true
    while (progressed) {
      progressed = false
      const cur = m.phase === 'prevote' ? m.prevotes : m.phase === 'precommit' ? m.precommits : null
      if (!cur) break
      phaseYes = 0; phaseNo = 0
      for (const w of Object.values(cur)) { if (w > 0) phaseYes += w; else phaseNo -= w }
      if (phaseNo >= quorum) { m.phase = 'failed'; m.closed = true; break }
      if (m.phase === 'prevote' && phaseYes >= quorum && phaseYes > 2 * phaseNo) {
        m.phase = 'precommit'; progressed = true
      } else if (m.phase === 'precommit' && phaseYes >= quorum) {
        m.phase = 'committed'; m.closed = true; break
      }
      if (progressed) {
        // Drain ballots buffered for the phase we just entered.
        for (const [k, pb] of Object.entries(m.pending)) {
          if (pb.phase !== m.phase) continue
          delete m.pending[k]
          if (m.equivocators?.[pb.voter]) continue
          const pv = await this.verifyBallot(id, m, pb)
          if (!pv.ok) continue
          m.ballots[pb.phase][pb.voter] = pb
          const pbBox = pb.phase === 'prevote' ? m.prevotes : m.precommits
          pbBox[pb.voter] = pb.approve ? pv.weight : -pv.weight
        }
      }
    }
    m.yes = phaseYes; m.no = phaseNo
    await this.state.storage.put(`committee:${id}`, m)
    await this.audit('committee.vote', { motion: id, voter: ballot.voter, weight: v.weight, approve: ballot.approve, phase: ballot.phase })
    return { body: { ok: true, phase: m.phase, yes: phaseYes, no: phaseNo, closed: !!m.closed }, status: 200 }
  }

  /** Tamper-evident audit chain — each entry carries the previous entry's
   *  hash, so a forged gap breaks the chain. Storage is append-only;
   *  `audit:last` holds the head. Exported via GET /audit (admin). */
  private async audit(event: string, data: Record<string, unknown>) {
    try {
      const last = ((await this.state.storage.get('audit:last')) as
        | { seq: number; hash: string } | undefined) ?? { seq: 0, hash: '0' }
      const seq = last.seq + 1
      const at = Date.now()
      const entry = { seq, prev: last.hash, event, data, at }
      const hash = await this.sha256Hex(JSON.stringify(entry))
      await this.state.storage.put(`audit:${seq}`, { ...entry, hash })
      await this.state.storage.put('audit:last', { seq, hash })
    } catch (e) {
      // Audit must never break the job path — log and continue.
      console.error('[coordinator] audit write failed:', e)
    }
  }

  /** Execution-prover adapter — POSTs the job's I/O hashes to PROVER_URL.
   *  Includes `jobUrl`: a resultToken-gated path the prover GETs to fetch
   *  {taskType, payload, result} for deterministic re-execution — hashes
   *  alone are unprovable claims. The token scopes read to this one job;
   *  the prover still only sees jobs it's asked to prove. */
  private async requestExecProof(
    jobId: string, taskType: number, payload: string, result: string,
    nodeDid: string | null, resultToken?: string,
  ): Promise<unknown | null> {
    const res = await fetch(`${this.env.PROVER_URL!.replace(/\/$/, '')}/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId, taskType,
        inputHash: await this.sha256Hex(payload),
        outputHash: await this.sha256Hex(result),
        nodeDid,
        ...(resultToken ? { jobUrl: `/results/${jobId}?token=${resultToken}` } : {}),
      }),
      // Re-execution can take a while — first-run model downloads for
      // inference jobs exceed 30s. Generous bound; this runs off-request.
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) return null
    return res.json().catch(() => ({ accepted: true }))
  }

  private async verifyTurnstile(token: string): Promise<boolean> {
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.env.TURNSTILE_SECRET!, response: token }),
        signal: AbortSignal.timeout(10_000),
      })
      const body = (await res.json()) as { success?: boolean }
      return body.success === true
    } catch {
      return false
    }
  }

  private async sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private async sha256HexBuf(buf: ArrayBuffer): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private async pausedProjects(): Promise<string[]> {
    const keys = await this.keys('paused:project:')
    return keys.map((k) => k.slice('paused:project:'.length))
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
