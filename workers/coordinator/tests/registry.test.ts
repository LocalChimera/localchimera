import { describe, it, expect } from 'vitest'
import {
  CANONICAL, WPCLOUD, PROJECT, SWARM,
  normalizeTaskTypes, stripSwarmClaims, selectVolunteer, validateJobResult,
  HARD_JOB_MIN_SCORE,
} from '../src/registry'
import type { VolunteerMeta } from '../src/registry'

const NOW = Date.now()

function vol(over: Partial<VolunteerMeta> = {}): VolunteerMeta {
  return {
    id: crypto.randomUUID(),
    address: '',
    taskTypes: [0],
    capabilities: { cpuCores: 4, ramGb: 8 },
    networks: ['base'],
    status: 'idle',
    registeredAt: NOW,
    lastHeartbeat: NOW,
    ...over,
  }
}

describe('task-type ranges', () => {
  it('accepts canonical, wp-cloud, and project types', () => {
    // 206 = CANARY (coordinator-internal echo check)
    expect(normalizeTaskTypes([0, 1, 2, 3, 100, 103, 200, 205, 206])).toEqual([0, 1, 2, 3, 100, 103, 200, 205, 206])
  })
  it('accepts swarm types after normalize but strips them from non-durable claims', () => {
    // 300-301 are registered ranges; stripSwarmClaims gates them on durable.
    expect(normalizeTaskTypes([SWARM.SWARM_INFER, SWARM.BUILD_VERIFY])).toEqual([300, 301])
    expect(stripSwarmClaims(normalizeTaskTypes([300, 301, 0]), false)).toEqual([0, 0, 0])
    expect(stripSwarmClaims(normalizeTaskTypes([300, 301, 0]), true)).toEqual([300, 301, 0])
  })
  it('collapses out-of-range types to 0 (upstream compat)', () => {
    expect(normalizeTaskTypes([104, 207, 302, 999, 'abc'])).toEqual([0, 0, 0, 0, 0])
  })
  it('non-array input normalizes to empty', () => {
    expect(normalizeTaskTypes(undefined)).toEqual([])
    expect(normalizeTaskTypes('200')).toEqual([])
  })
})

describe('selectVolunteer preference cascade', () => {
  const stale = () => vol({ lastHeartbeat: NOW - 120_000 })

  it('filters stale volunteers', () => {
    expect(selectVolunteer([stale()], 0, [], NOW)).toBeNull()
  })

  it('prefers project-pooled volunteers over site and global', () => {
    const pooled = vol({ project: 'acme', site: 'other-site' })
    const sited = vol({ site: 'mysite' })
    const global = vol({})
    const picked = selectVolunteer([global, sited, pooled], 0, [], NOW, 'mysite', 'acme')
    expect(picked?.id).toBe(pooled.id)
  })

  it('falls back to site volunteers when no pooled match', () => {
    const pooled = vol({ project: 'other-project' })
    const sited = vol({ site: 'mysite' })
    const picked = selectVolunteer([pooled, sited, vol({})], 0, [], NOW, 'mysite', 'acme')
    expect(picked?.id).toBe(sited.id)
  })

  it('falls back to global when neither project nor site matches', () => {
    // No pool narrowing applies — the whole eligible set competes on score.
    const g = vol({ capabilities: { cpuCores: 8, ramGb: 32, hasWebGPU: true } })
    const picked = selectVolunteer([vol({ site: 'x' }), g], 0, [], NOW, 'mysite', 'acme')
    expect(picked?.id).toBe(g.id)
  })

  it('idle beats busy', () => {
    const busy = vol({ status: 'busy', capabilities: { cpuCores: 8, ramGb: 32, hasWebGPU: true } })
    const idle = vol({})
    expect(selectVolunteer([busy, idle], 0, [], NOW)?.id).toBe(idle.id)
  })

  it('difficulty>=2 prefers high-capability nodes', () => {
    const weak = vol({ capabilities: { cpuCores: 1, ramGb: 1 } })
    const strong = vol({ capabilities: { cpuCores: 8, ramGb: 16, hasWebGPU: true } })
    expect(selectVolunteer([weak, strong], 0, [], NOW, undefined, undefined, 3)?.id).toBe(strong.id)
  })

  it('difficulty gate degrades gracefully when no capable node exists', () => {
    const weak = vol({ capabilities: { cpuCores: 1, ramGb: 1 } })
    expect(selectVolunteer([weak], 0, [], NOW, undefined, undefined, 3)?.id).toBe(weak.id)
  })

  it('respects taskType matching', () => {
    const fetcher = vol({ taskTypes: [PROJECT.WEB_FETCH] })
    const inferer = vol({ taskTypes: [PROJECT.AGENT_INFER] })
    expect(selectVolunteer([fetcher, inferer], PROJECT.WEB_FETCH, [], NOW)?.id).toBe(fetcher.id)
  })

  it('canary-failed nodes (negative trust) sort below equal-capability peers', () => {
    const honest = vol({})
    const caught = vol({ trust: -5 })
    expect(selectVolunteer([caught, honest], 0, [], NOW)?.id).toBe(honest.id)
  })

  it('killswitch — trust <= -15 excludes the node entirely', () => {
    const banished = vol({ trust: -15 })
    const honest = vol({})
    expect(selectVolunteer([banished], 0, [], NOW)).toBeNull()
    expect(selectVolunteer([banished, honest], 0, [], NOW)?.id).toBe(honest.id)
  })

  it('swarm taskTypes (300+) only route to durable nodes', () => {
    const browser = vol({ taskTypes: [300] })
    const daemon = vol({ taskTypes: [300], durable: true, shardCapacity: 2 })
    expect(selectVolunteer([browser], 300, [], NOW)).toBeNull()
    expect(selectVolunteer([browser, daemon], 300, [], NOW)?.id).toBe(daemon.id)
  })

  it('on-battery nodes lose ties to plugged-in peers (energy-aware)', () => {
    const onBattery = vol({ capabilities: { cpuCores: 8, ramGb: 16, hasWebGPU: true, batterySaver: true } })
    const plugged = vol({ capabilities: { cpuCores: 8, ramGb: 16, hasWebGPU: true } })
    expect(selectVolunteer([onBattery, plugged], 0, [], NOW)?.id).toBe(plugged.id)
  })

  it('INTERNAL classification only routes to durable+DID-bound nodes', () => {
    const visitor = vol({ taskTypes: [200] })                                    // browser, no DID
    const anonDurable = vol({ taskTypes: [200], durable: true })                  // durable, no DID
    const boundDurable = vol({ taskTypes: [200], durable: true, did: 'did:key:zabc' })
    const boundVisitor = vol({ taskTypes: [200], did: 'did:key:zabc' })           // DID but not durable
    expect(selectVolunteer([visitor], 200, [], NOW, undefined, undefined, undefined, 'INTERNAL')).toBeNull()
    expect(selectVolunteer([anonDurable], 200, [], NOW, undefined, undefined, undefined, 'INTERNAL')).toBeNull()
    expect(selectVolunteer([boundVisitor], 200, [], NOW, undefined, undefined, undefined, 'INTERNAL')).toBeNull()
    expect(selectVolunteer([visitor, anonDurable, boundVisitor, boundDurable], 200, [], NOW,
      undefined, undefined, undefined, 'INTERNAL')?.id).toBe(boundDurable.id)
    // PUBLIC (and unset) jobs keep the broad pool.
    expect(selectVolunteer([visitor], 200, [], NOW)?.id).toBe(visitor.id)
    expect(selectVolunteer([visitor], 200, [], NOW, undefined, undefined, undefined, 'PUBLIC')?.id).toBe(visitor.id)
  })
})

describe('validateJobResult', () => {
  it('passes untyped taskTypes through', () => {
    expect(validateJobResult(CANONICAL.INFERENCE, 'anything')).toBe(true)
    expect(validateJobResult(WPCLOUD.INFER_TEXT, 'anything')).toBe(true)
  })
  it('AGENT_INFER accepts non-empty strings, rejects empty', () => {
    expect(validateJobResult(PROJECT.AGENT_INFER, 'hello')).toBe(true)
    expect(validateJobResult(PROJECT.AGENT_INFER, '')).toBe(false)
  })
  it('WEB_FETCH requires {bodyHash: sha256, bytes}', () => {
    const ok = JSON.stringify({ bodyHash: 'a'.repeat(64), bytes: 123 })
    expect(validateJobResult(PROJECT.WEB_FETCH, ok)).toBe(true)
    expect(validateJobResult(PROJECT.WEB_FETCH, '{"bodyHash":"xyz","bytes":1}')).toBe(false)
    expect(validateJobResult(PROJECT.WEB_FETCH, 'not json')).toBe(false)
  })
  it('HUMAN_JURY requires {verdict: nonneg int}, optional rationale', () => {
    expect(validateJobResult(PROJECT.HUMAN_JURY, '{"verdict":1}')).toBe(true)
    expect(validateJobResult(PROJECT.HUMAN_JURY, '{"verdict":0,"rationale":"ok"}')).toBe(true)
    expect(validateJobResult(PROJECT.HUMAN_JURY, '{"verdict":-1}')).toBe(false)
    expect(validateJobResult(PROJECT.HUMAN_JURY, '"yes"')).toBe(false)
  })
  it('STORAGE pin requires {cid: hex64, verified: true}', () => {
    const ok = JSON.stringify({ cid: 'b'.repeat(64), verified: true })
    expect(validateJobResult(CANONICAL.STORAGE, ok)).toBe(true)
    expect(validateJobResult(CANONICAL.STORAGE, JSON.stringify({ cid: 'b'.repeat(64), verified: false }))).toBe(false)
  })
})
