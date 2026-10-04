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
 *   handled:<jobId>   → 1 | 'expired' | 'oversize' | 'reverted:<err>'
 *   pending:<jobId>   → PendingJob
 *   assigned:<jobId>  → { volunteerId, at }
 *   result:<jobId>    → { volunteerId, result, at, source }
 *   ledger:<volId>    → { totalWei, jobs, settledWei }
 *   lastBlock         → bigint cursor for getLogs
 * Volunteer state lives on ws attachments (hibernation-safe) + the
 * in-memory registry rebuilt from them on wake.
 */

import type { VolunteerMeta } from './registry'
import { normalizeTaskTypes, selectVolunteer } from './registry'
import { ESCROW_ABI, makeClients, resultHash } from './chain'
import type { Hex } from 'viem'

interface Env {
  COORDINATOR: DurableObjectNamespace
  BASE_RPC_URL: string
  ESCROW_CONTRACT: string
  VOLUNTEER_TOKEN: string
  COORDINATOR_PRIVATE_KEY?: string
  DISPATCH_AUTH_TOKEN?: string
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
  status?: string
  result?: string
  reason?: string
}

const MAX_RESULT_BYTES = 256 * 1024

export class CoordinatorDO implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private registry = new Map<string, VolunteerMeta>()
  /** jobId → resolve — in-memory; the alarm's flushTimeouts redispatches
   *  anything still pending after a hibernate/wake cycle. */
  private awaiting = new Map<string, { resolve: (ok: boolean) => void }>()

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
    if (url.pathname === '/status') {
      return this.json({
        volunteers: this.registry.size,
        idle: [...this.registry.values()].filter((v) => v.status === 'idle').length,
        byTaskType: this.countByTaskType(),
        pendingJobs: (await this.keys('pending:')).length,
      })
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
    if (url.pathname === '/jobs' && req.method === 'POST') {
      if (!this.bearerOk(req, this.env.DISPATCH_AUTH_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      return this.handleDirectJob(req)
    }
    if (url.pathname === '/settle' && req.method === 'POST') {
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      return this.handleSettle(req)
    }
    if (url.pathname.startsWith('/results/')) {
      // Results can contain consumer data — admin only. Direct-job callers
      // get their result inline in the POST /jobs response instead.
      if (!this.bearerOk(req, this.env.ADMIN_TOKEN)) return this.json({ error: 'unauthorized' }, 401)
      const r = await this.state.storage.get(`result:${url.pathname.slice(9)}`)
      return r ? this.json(r) : this.json({ error: 'not found' }, 404)
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
        const meta: VolunteerMeta = {
          id,
          address: env.address || '',
          taskTypes: normalizeTaskTypes(env.taskTypes),
          capabilities: env.capabilities || {},
          networks: env.networks?.length ? env.networks : ['base'],
          site: typeof env.site === 'string' ? env.site.slice(0, 64) : undefined,
          status: 'idle',
          registeredAt: Date.now(),
          lastHeartbeat: Date.now(),
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
          if (env.taskTypes) v.taskTypes = normalizeTaskTypes(env.taskTypes)
          if (env.capabilities) v.capabilities = env.capabilities
          ws.serializeAttachment(v)
        }
        break
      }
      case 'JOB_RESULT': {
        const meta = this.metaFor(ws)
        if (env.jobId && typeof env.result === 'string' && meta) {
          void this.onJobResult(env.jobId, meta.id, env.result.slice(0, MAX_RESULT_BYTES))
        }
        break
      }
      case 'JOB_REJECTED': {
        const meta = this.metaFor(ws)
        if (env.jobId && meta) void this.onJobRejected(env.jobId, meta.id, env.reason)
        break
      }
      default:
        ws.send(JSON.stringify({ type: 'ERROR', error: 'unknown type' }))
    }
  }

  async webSocketClose(ws: WebSocket) {
    const meta = this.metaFor(ws)
    if (meta) this.registry.delete(meta.id)
    try { ws.close() } catch { /* already closed */ }
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
      await this.pollChain()
      await this.flushPending()
    } catch (e) {
      console.error('[coordinator] alarm error:', e)
    }
  }

  private async pollChain() {
    if (!this.env.COORDINATOR_PRIVATE_KEY) return
    if (this.env.ESCROW_CONTRACT === '0x0000000000000000000000000000000000000000') return
    const { pub, contract } = makeClients(this.env)

    const last = (await this.state.storage.get<bigint>('lastBlock')) ?? 0n
    const head = await pub.getBlockNumber()
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

    for (const log of logs) {
      const jobId = log.args.jobId as Hex
      if (await this.state.storage.get(`handled:${jobId}`)) continue
      if (await this.state.storage.get(`pending:${jobId}`)) continue
      const payload = String(log.args.payload ?? '')
      if (new TextEncoder().encode(payload).length > Number(this.env.MAX_PAYLOAD_BYTES || '8192')) {
        await this.state.storage.put(`handled:${jobId}`, 'oversize')
        continue
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

    // Site-scoped jobs prefer the site's own visitors (job.site → v.site),
    // spilling to the global pool when the site's traffic is idle/offline.
    // No network filter: volunteers self-report upstream labels like
    // 'botchain'; dispatch is jobId-keyed so the network tag is advisory.
    const volunteer = selectVolunteer(this.registry.values(), job.taskType, [], Date.now(), job.site)
    if (!volunteer) return false

    const ws = this.wsFor(volunteer.id)
    if (!ws) { this.registry.delete(volunteer.id); return false }

    volunteer.status = 'busy'
    ws.serializeAttachment(volunteer)
    await this.state.storage.put(`assigned:${jobId}`, { volunteerId: volunteer.id, at: Date.now() })
    ws.send(JSON.stringify({
      type: 'JOB_DISPATCH',
      jobId,
      network: 'base',
      taskType: job.taskType,
      requestHash: job.payload,
      amount: job.amountWei,
    }))

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

  private async onJobResult(jobId: string, volunteerId: string, result: string) {
    const assignment = (await this.state.storage.get(`assigned:${jobId}`)) as
      | { volunteerId: string; at: number }
      | undefined
    // Only the volunteer the job was dispatched to may resolve it — otherwise
    // anyone could claim credit for a jobId they saw on-chain or in transit.
    if (!assignment || assignment.volunteerId !== volunteerId) return

    const job = await this.state.storage.get<PendingJob>(`pending:${jobId}`)
    if (!job) {
      await this.releaseAssignment(jobId)
      const pending = this.awaiting.get(jobId)
      if (pending) { this.awaiting.delete(jobId); pending.resolve(true) }
      return
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
    await this.state.storage.put(`result:${jobId}`, {
      volunteerId, result, at: Date.now(), source: job.source,
    })
    await this.credit(volunteerId, job.amountWei, job.site, this.registry.get(volunteerId)?.site === job.site)
    const v = this.registry.get(volunteerId)
    if (v) { v.status = 'idle'; this.wsFor(v.id)?.serializeAttachment(v) }
    // Resolve last — POST /jobs reads result:<jobId> once dispatch resolves.
    const pending = this.awaiting.get(jobId)
    if (pending) { this.awaiting.delete(jobId); pending.resolve(true) }
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
    for (const key of await this.keys('pending:')) {
      const jobId = key.slice(8)
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

  private async handleDirectJob(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as
      | { payload?: string; taskType?: number; amountWei?: string; site?: string }
      | null
    if (!body?.payload) return this.json({ error: 'payload required' }, 400)
    const maxBytes = Number(this.env.MAX_PAYLOAD_BYTES || '8192')
    if (new TextEncoder().encode(body.payload).length > maxBytes) {
      return this.json({ error: `payload exceeds ${maxBytes} bytes` }, 413)
    }
    const jobId = `direct-${crypto.randomUUID()}`
    await this.state.storage.put<PendingJob>(`pending:${jobId}`, {
      taskType: Number(body.taskType) || 0,
      payload: body.payload,
      amountWei: body.amountWei || '0',
      source: 'direct',
      site: typeof body.site === 'string' ? body.site.slice(0, 64) : undefined,
      since: Date.now(),
    })
    const accepted = await this.dispatch(jobId)
    const result = accepted
      ? await this.state.storage.get(`result:${jobId}`)
      : null
    return this.json({ jobId, accepted, result })
  }

  /** Marks ledger balances settled — used by the monthly Logos payout runbook. */
  private async handleSettle(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
    const out: Record<string, unknown> = {}
    for (const key of await this.keys('ledger:')) {
      const id = key.slice(7)
      if (body.ids?.length && !body.ids.includes(id)) continue
      const led = (await this.state.storage.get(key)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined
      if (!led) continue
      const unpaid = BigInt(led.totalWei) - BigInt(led.settledWei || '0')
      led.settledWei = led.totalWei
      await this.state.storage.put(key, led)
      out[id] = { settledWei: unpaid.toString() }
    }
    return this.json({ settled: out })
  }

  private async credit(volunteerId: string, amountWei: string, site?: string, ownVisitor = false) {
    const key = `ledger:${volunteerId}`
    const led = ((await this.state.storage.get(key)) as
      | { totalWei: string; jobs: number; settledWei: string }
      | undefined) ?? { totalWei: '0', jobs: 0, settledWei: '0' }
    led.totalWei = (BigInt(led.totalWei) + BigInt(amountWei || '0')).toString()
    led.jobs += 1
    await this.state.storage.put(key, led)
    // Site-owner revenue share: when a site's own visitor completes that
    // site's job, the site earns a 10% host share — the incentive that makes
    // site owners promote visitor nodes.
    if (site && ownVisitor) {
      const skey = `ledger:site:${site}`
      const s = ((await this.state.storage.get(skey)) as
        | { totalWei: string; jobs: number; settledWei: string }
        | undefined) ?? { totalWei: '0', jobs: 0, settledWei: '0' }
      s.totalWei = (BigInt(s.totalWei) + (BigInt(amountWei || '0') / 10n)).toString()
      s.jobs += 1
      await this.state.storage.put(skey, s)
    }
  }

  // ── helpers ──

  private async keys(prefix: string): Promise<string[]> {
    const m = await this.state.storage.list({ prefix })
    return [...m.keys()]
  }

  private countByTaskType(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const v of this.registry.values())
      for (const tt of v.taskTypes) counts[tt] = (counts[tt] || 0) + 1
    return counts
  }

  private bearerOk(req: Request, secret?: string): boolean {
    if (!secret) return false
    return req.headers.get('authorization') === `Bearer ${secret}`
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
