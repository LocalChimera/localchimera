/**
 * chimera-coordinator — worker entry. Everything forwards to the single
 * global CoordinatorDO (the pool must be one instance so dispatch and the
 * chain poll share one registry).
 */
import { CoordinatorDO } from './coordinator-do'
export { CoordinatorDO }

interface Env {
  COORDINATOR: DurableObjectNamespace
  /** Coordinator sharding groundwork — unset means the single 'global'
   *  shard. When volunteer count outgrows one DO, deploy additional workers
   *  with distinct SHARD_KEYs (e.g. per project-range) and point each
   *  deployment's ingress at its shard. Ledgers are per-shard; settle
   *  aggregates across deployments. */
  SHARD_KEY?: string
}

// Cheap connect-rate limiting — the DO is the real boundary, this just keeps
// garbage connects from spinning it up. Per-worker-isolate, best-effort.
const connects = new Map<string, number[]>()
const CONNECT_WINDOW_MS = 60_000
const CONNECT_MAX = 20

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/' && req.headers.get('Upgrade') === 'websocket') {
      const ip = req.headers.get('cf-connecting-ip') || 'unknown'
      const now = Date.now()
      const hits = (connects.get(ip) || []).filter((t) => now - t < CONNECT_WINDOW_MS)
      if (hits.length >= CONNECT_MAX) return new Response('rate limited', { status: 429 })
      hits.push(now)
      connects.set(ip, hits)
    }
    return env.COORDINATOR.get(env.COORDINATOR.idFromName(env.SHARD_KEY || 'global')).fetch(req)
  },
}
