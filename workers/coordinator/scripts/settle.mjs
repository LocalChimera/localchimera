#!/usr/bin/env node
/**
 * Settlement automation — scans volunteer/project ledgers, applies the
 * dust→rep threshold, and emits a payout manifest for human approval.
 * This *prepares* settlement; an operator reviews and runs /settle.
 *
 * Usage:
 *   COORDINATOR_URL=... ADMIN_TOKEN=... node scripts/settle.mjs [--apply]
 *   --apply actually POSTs /settle after printing the manifest.
 */
// Multi-shard — SHARD_URLS is a comma-separated list of coordinator worker
// URLs (one per shard deployment); each holds its own ledgers, so settlement
// aggregates across all of them. Unset = single coordinator.
const SHARDS = (process.env.SHARD_URLS || process.env.COORDINATOR_URL || 'http://localhost:8787')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
const TOKEN = process.env.ADMIN_TOKEN
const APPLY = process.argv.includes('--apply')
if (!TOKEN) { console.error('ADMIN_TOKEN required'); process.exit(1) }

const auth = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }

const status = { volunteers: 0, durable: 0, byProject: {}, pausedProjects: [] }
for (const coord of SHARDS) {
  const s = await fetch(`${coord}/status`).then((r) => r.json()).catch(() => null)
  if (!s) { console.error(`shard ${coord} unreachable — skipped`); continue }
  status.volunteers += s.volunteers ?? 0
  status.durable += s.durable ?? 0
  for (const [p, n] of Object.entries(s.byProject || {}))
    status.byProject[p] = (status.byProject[p] || 0) + n
  status.pausedProjects.push(...(s.pausedProjects || []))
}
console.log('pool:', JSON.stringify(status), `(${SHARDS.length} shard${SHARDS.length > 1 ? 's' : ''})`)

// Per-project statements — each shard answers for the slugs it holds, so
// query every shard and merge (a slug lives on exactly one shard).
const statements = {}
for (const coord of SHARDS) {
  for (const slug of Object.keys(status.byProject || {})) {
    const led = await fetch(`${coord}/earnings?project=${encodeURIComponent(slug)}`)
      .then((r) => r.json()).catch(() => null)
    if (!led || !led.jobs) continue
    const cur = statements[slug] ?? { totalWei: '0', jobs: 0, settledWei: '0' }
    statements[slug] = {
      totalWei: (BigInt(cur.totalWei) + BigInt(led.totalWei || '0')).toString(),
      jobs: cur.jobs + (led.jobs || 0),
      settledWei: (BigInt(cur.settledWei) + BigInt(led.settledWei || '0')).toString(),
    }
  }
}
console.log('\nproject statements:')
for (const [slug, led] of Object.entries(statements)) {
  console.log(`  ${slug}: ${(Number(BigInt(led.totalWei || '0')) / 1e18).toFixed(6)} USD-eq · ${led.jobs} jobs`)
}

if (APPLY) {
  for (const coord of SHARDS) {
    const r = await fetch(`${coord}/settle`, { method: 'POST', headers: auth, body: '{}' })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }))
    console.log(`\n${coord} settle:`, JSON.stringify(r))
  }
} else {
  console.log('\ndry-run — re-run with --apply to POST /settle on each shard (marks ledgers settled; dust converts to rep).')
}
