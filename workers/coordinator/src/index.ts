/**
 * chimera-coordinator — worker entry. Requests route to a CoordinatorDO
 * shard: project-tagged traffic lands on a deterministic per-project-range
 * shard (SHARD_COUNT pools), everything else on the 'global' shard. Ledgers
 * are per-shard; settle aggregates across shards.
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
  /** Number of project-range shards — project-tagged requests hash into
   *  `project-<n>` shards. Default 0 = everything on 'global'. */
  SHARD_COUNT?: string
}

// Cheap connect-rate limiting — the DO is the real boundary, this just keeps
// garbage connects from spinning it up. Per-worker-isolate, best-effort.
const connects = new Map<string, number[]>()
const CONNECT_WINDOW_MS = 60_000
const CONNECT_MAX = 20

/** FNV-1a over the slug — deterministic, so a given project always lands on
 *  the same shard no matter which isolate picks up the request. */
function shardFor(project: string | undefined, count: number): string {
  if (!project || count <= 0) return 'global'
  let h = 0x811c9dc5
  for (let i = 0; i < project.length; i++) {
    h = Math.imul(h ^ project.charCodeAt(i), 0x01000193)
  }
  return `project-${(h >>> 0) % count}`
}

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
    const count = Number(env.SHARD_COUNT || '0')
    // Project may arrive via query (?project=) or — for WS register — as the
    // client's pool claim; the DO scopes it anyway, this just picks the shard.
    const project = url.searchParams.get('project') ?? undefined
    const shard = env.SHARD_KEY || shardFor(project, count)
    return env.COORDINATOR.get(env.COORDINATOR.idFromName(shard)).fetch(req)
  },
}
