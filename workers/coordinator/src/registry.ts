/**
 * Ported from resource-provisioner/src/coordinator/{volunteer-registry,task-types}.js
 * — canonical task types (0-3) and idle-first volunteer selection.
 */

export const CANONICAL = { INFERENCE: 0, STORAGE: 1, COMPUTE: 2, BANDWIDTH: 3 } as const
// wp-cloud job types — site-scoped AI work routed to a site's own visitors first
export const WPCLOUD = { INFER_TEXT: 100, INFER_SEO: 101, MODERATE: 102, SUPPORT: 103 } as const

export interface VolunteerMeta {
  id: string
  address: string
  taskTypes: number[]
  capabilities: Record<string, unknown>
  networks: string[]
  status: 'idle' | 'busy'
  site?: string                    // wp-cloud site the visitor connected from
  registeredAt: number
  lastHeartbeat: number
}

export function normalizeTaskTypes(taskTypes: unknown): number[] {
  if (!Array.isArray(taskTypes)) return []
  return taskTypes.map((tt) => {
    const n = Number(tt) || 0
    return (n >= 0 && n <= 3) || (n >= 100 && n <= 103) ? n : 0
  })
}

/** Idle-first, then capability score (mirrors upstream `selectVolunteer`).
 *  `preferSite`: site-scoped jobs prefer the site's own visitors, spilling
 *  to the global pool only when none are free — the site's AI work runs on
 *  its own traffic whenever possible. */
export function selectVolunteer(
  volunteers: Iterable<VolunteerMeta>,
  taskType: number,
  networks: string[],
  now = Date.now(),
  preferSite?: string,
): VolunteerMeta | null {
  const eligible = (v: VolunteerMeta) =>
    now - v.lastHeartbeat < 60_000 &&
    v.taskTypes.includes(taskType) &&
    (networks.length === 0 || networks.some((n) => v.networks.includes(n)))
  let candidates = [...volunteers].filter(eligible)
  if (preferSite) {
    const own = candidates.filter((v) => v.site === preferSite)
    if (own.length) candidates = own
  }
  if (!candidates.length) return null
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
    (Number(c.deviceTrustScore) || 0) * 10
  )
}
