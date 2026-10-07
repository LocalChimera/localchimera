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
const COORD = (process.env.COORDINATOR_URL || 'http://localhost:8787').replace(/\/$/, '')
const TOKEN = process.env.ADMIN_TOKEN
const APPLY = process.argv.includes('--apply')
if (!TOKEN) { console.error('ADMIN_TOKEN required'); process.exit(1) }

const auth = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }

const status = await fetch(`${COORD}/status`).then((r) => r.json())
console.log('pool:', JSON.stringify({ volunteers: status.volunteers, durable: status.durable, projects: status.byProject, paused: status.pausedProjects }))

// Per-project statements: ledger:project:* balances are only enumerable via
// /earnings?project= for known slugs — take them from /status.byProject.
const statements = {}
for (const slug of Object.keys(status.byProject || {})) {
  const led = await fetch(`${COORD}/earnings?project=${encodeURIComponent(slug)}`).then((r) => r.json())
  statements[slug] = led
}
console.log('\nproject statements:')
for (const [slug, led] of Object.entries(statements)) {
  console.log(`  ${slug}: ${(Number(BigInt(led.totalWei || '0')) / 1e18).toFixed(6)} USD-eq · ${led.jobs} jobs`)
}

if (APPLY) {
  const r = await fetch(`${COORD}/settle`, { method: 'POST', headers: auth, body: '{}' }).then((x) => x.json())
  console.log('\nsettle result:', JSON.stringify(r))
} else {
  console.log('\ndry-run — re-run with --apply to POST /settle (marks ledgers settled; dust converts to rep).')
}
