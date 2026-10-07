/**
 * Ported from resource-provisioner/src/coordinator/{volunteer-registry,task-types}.js
 * — canonical task types (0-3) and idle-first volunteer selection.
 *
 * Proof-of-Interest P1 additions: project-pool task types (200-205), swarm
 * reservations (300-301), the project/referrer volunteer fields, difficulty-
 * aware selection, and the per-taskType result schema table (zod).
 */

import { z } from 'zod'

export const CANONICAL = { INFERENCE: 0, STORAGE: 1, COMPUTE: 2, BANDWIDTH: 3 } as const
// wp-cloud job types — site-scoped AI work routed to a site's own visitors first
export const WPCLOUD = { INFER_TEXT: 100, INFER_SEO: 101, MODERATE: 102, SUPPORT: 103 } as const
// project-pool job types — work attributed to a project:<slug> instead of a site
export const PROJECT = {
  AGENT_INFER: 200,
  MARKET_RESEARCH: 201,
  REPO_INDEX: 202,
  SOCIAL_COPY: 203,
  HUMAN_JURY: 204,
  WEB_FETCH: 205,
  // coordinator-internal control job — node echoes the nonce back; used by
  // the honesty-canary to measure (and penalize) fabricated results
  CANARY: 206,
} as const
// swarm tier — reserved; nodes may not claim these until the durable tier ships
export const SWARM = { SWARM_INFER: 300, BUILD_VERIFY: 301 } as const

export interface VolunteerMeta {
  id: string
  address: string
  taskTypes: number[]
  capabilities: Record<string, unknown>
  networks: string[]
  status: 'idle' | 'busy'
  site?: string                    // wp-cloud site the visitor connected from
  project?: string                 // project:<slug> pool the node registered into
  referrer?: string                // volunteerId that recruited this node (record-only in P1)
  did?: string                     // DID-bound address (secp256k1-verified at REGISTER)
  durable?: boolean                // self-declared durable node — groundwork for the swarm tier
  shardCapacity?: number           // declared shard capacity for durable nodes
  trust?: number                   // coordinator-side adjustment (canary penalties subtract)
  registeredAt: number
  lastHeartbeat: number
}

/** Registered ranges: canonical 0-3, wp-cloud 100-103, project 200-206.
 *  Swarm 300-301 deliberately excluded — claiming them is meaningless until
 *  the durable tier exists. Out-of-range still collapses to 0 (upstream
 *  compat) rather than being dropped. */
function inRegisteredRange(n: number): boolean {
  return (n >= 0 && n <= 3) || (n >= 100 && n <= 103) || (n >= 200 && n <= 206)
}

export function normalizeTaskTypes(taskTypes: unknown): number[] {
  if (!Array.isArray(taskTypes)) return []
  return taskTypes.map((tt) => {
    const n = Number(tt) || 0
    return inRegisteredRange(n) ? n : 0
  })
}

/** Capability score below which a node is a poor fit for difficulty>=2 jobs.
 *  Mirrors score(): WebGPU(10)+gpu(5)+cores(≤8)+ram(≤16)+trust(≤10 each). */
export const HARD_JOB_MIN_SCORE = 15

/** Idle-first, then capability score (mirrors upstream `selectVolunteer`).
 *  Preference cascade narrows the candidate pool before sorting:
 *    `preferProject` — project-pooled volunteers first (site→project rollup)
 *    `preferSite`    — then the job's own site visitors
 *    global pool     — spillover when neither has free nodes
 *  `difficulty` >= 2 additionally filters to capable nodes when any exist —
 *  hard jobs land on strong hardware, easy jobs stay democratic. */
export function selectVolunteer(
  volunteers: Iterable<VolunteerMeta>,
  taskType: number,
  networks: string[],
  now = Date.now(),
  preferSite?: string,
  preferProject?: string,
  difficulty?: number,
): VolunteerMeta | null {
  const eligible = (v: VolunteerMeta) =>
    now - v.lastHeartbeat < 60_000 &&
    v.taskTypes.includes(taskType) &&
    // Killswitch — nodes at trust <= -15 (three failed canaries) are excluded
    // from dispatch entirely. Churn/offline never reaches this; only a
    // proven fabricated result subtracts.
    (v.trust ?? 0) > -15 &&
    // Swarm tier (300+) is durable-only — browser/ephemeral nodes can't hold
    // pipeline stage state. Nothing dispatches there until durable nodes
    // register with `durable: true` + shardCapacity.
    (taskType < 300 || v.durable === true) &&
    (networks.length === 0 || networks.some((n) => v.networks.includes(n)))
  let candidates = [...volunteers].filter(eligible)
  if (preferProject) {
    const own = candidates.filter((v) => v.project === preferProject)
    if (own.length) candidates = own
  }
  if (preferSite) {
    const own = candidates.filter((v) => v.site === preferSite)
    if (own.length) candidates = own
  }
  if (!candidates.length) return null
  if (typeof difficulty === 'number' && difficulty >= 2) {
    const capable = candidates.filter((v) => score(v) >= HARD_JOB_MIN_SCORE)
    if (capable.length) candidates = capable
  }
  candidates.sort((a, b) => {
    if (a.status === 'idle' && b.status !== 'idle') return -1
    if (a.status !== 'idle' && b.status === 'idle') return 1
    return score(b) - score(a)
  })
  return candidates[0]
}

function score(v: VolunteerMeta): number {
  const c = v.capabilities as Record<string, number | boolean | undefined>
  return (
    (c.hasWebGPU ? 10 : 0) +
    (c.hasGpu ? 5 : 0) +
    Math.min(Number(c.cpuCores) || 0, 8) +
    Math.min(Number(c.ramGb) || 0, 16) +
    (Number(c.deviceTrustScore) || 0) * 10 +
    // coordinator-side trust adjustment — canary failures subtract, so a
    // node that fabricates results slides down the dispatch order
    (v.trust ?? 0) +
    // energy-aware dispatch — on-battery/throttled nodes get a nudge down;
    // they're eligible (consent is theirs) but lose ties to plugged-in peers
    (c.batterySaver ? -3 : 0)
  )
}

// ── Per-taskType job specs ──
// Result is transmitted as a string over the wire; object schemas are parsed
// from JSON. modelClass feeds the node's model-pipeline choice.

// non-empty — crediting an empty "result" would invite free-riding
const inferResult = z.string().min(1)
const researchResult = z.object({ summary: z.string() })
const indexResult = z.object({ vectors: z.array(z.array(z.number())) })
const copyResult = z.object({ drafts: z.array(z.string()).min(1) })
const fetchResult = z.object({
  bodyHash: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
})
const pinResult = z.object({
  cid: z.string().regex(/^[0-9a-f]{64}$/),
  verified: z.literal(true),
})
const serveResult = z.object({
  served: z.literal(true),
  bytes: z.number().int().nonnegative(),
})

export interface JobSpec {
  result: z.ZodTypeAny
  /** 'json' = result string must JSON.parse into the schema; 'text' = the
   *  string itself is the result. */
  encoding: 'json' | 'text'
  modelClass: 'instruct' | 'embedding' | 'fetch' | 'pin'
}

export const PROJECT_JOB: Record<number, JobSpec> = {
  [CANONICAL.STORAGE]: { result: pinResult, encoding: 'json', modelClass: 'pin' },
  [CANONICAL.BANDWIDTH]: { result: serveResult, encoding: 'json', modelClass: 'pin' },
  [PROJECT.AGENT_INFER]: { result: inferResult, encoding: 'text', modelClass: 'instruct' },
  [PROJECT.MARKET_RESEARCH]: { result: researchResult, encoding: 'json', modelClass: 'instruct' },
  [PROJECT.REPO_INDEX]: { result: indexResult, encoding: 'json', modelClass: 'embedding' },
  [PROJECT.SOCIAL_COPY]: { result: copyResult, encoding: 'json', modelClass: 'instruct' },
  [PROJECT.WEB_FETCH]: { result: fetchResult, encoding: 'json', modelClass: 'fetch' },
}

/** Validate a JOB_RESULT payload against the task's result schema.
 *  TaskTypes without a spec pass through (canonical/WPCLOUD legacy jobs). */
export function validateJobResult(taskType: number, result: string): boolean {
  const spec = PROJECT_JOB[taskType]
  if (!spec) return true
  if (spec.encoding === 'text') return spec.result.safeParse(result).success
  try {
    return spec.result.safeParse(JSON.parse(result)).success
  } catch {
    return false
  }
}
