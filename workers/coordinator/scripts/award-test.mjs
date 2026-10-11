#!/usr/bin/env node
/**
 * award-test.mjs — accepted-outcome award lifecycle, live.
 *
 * Covers the funded-outcome money leg end-to-end:
 *   1. /patronage {fund:'award'} deposits into poolfund:<slug>
 *   2. /poolfund reports deposited/available
 *   3. /award single-recipient debits fund → credits ledger:<did>
 *   4. idempotent ref → 409
 *   5. insufficient funds → 402
 *   6. split award (largest-remainder) → exact total across payees
 *   7. /earnings?id=<did> shows the credited balance
 *   8. /awards?did=<did> lists settle history
 *   9. pending lifecycle when AWARD_REVIEW_MS set → /award/:ref/approve
 *      (admin) flips to credited
 *
 *   COORDINATOR_URL=http://localhost:8787 DISPATCH_AUTH_TOKEN=… \
 *   ADMIN_TOKEN=… AWARD_REVIEW_MS=… node scripts/award-test.mjs
 */
const {
  COORDINATOR_URL = 'http://localhost:8787',
  DISPATCH_AUTH_TOKEN = '',
  ADMIN_TOKEN = '',
  AWARD_REVIEW_MS = '',
} = process.env
const base = COORDINATOR_URL.replace(/\/$/, '')
const H = { 'content-type': 'application/json', authorization: `Bearer ${DISPATCH_AUTH_TOKEN}` }
const AH = { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` }
let pass = 0, fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} ${extra}`) }
}
const post = async (path, body, h = H) =>
  fetch(`${base}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
const get = async (path) => (await fetch(`${base}${path}`)).json()

const uniq = `${Date.now().toString(36)}`
const PROJECT = `dg:award-test-${uniq}/repo`
const DID_A = `did:key:z6MkAwa${uniq}Alpha`
const DID_B = `did:key:z6MkAwa${uniq}Beta`
const DID_C = `did:key:z6MkAwa${uniq}Gamma`

// 1 · fund the award pool
let r = await post('/patronage', { project: PROJECT, amountWei: '2000000', fund: 'award', patron: 'did:key:z6MkPatron' })
ok(r.status === 200, 'patronage fund=award deposits', await r.text())

// 2 · poolfund reflects the deposit
const fund = await get(`/poolfund/${encodeURIComponent(PROJECT)}`)
ok(fund.depositedWei === '2000000' && fund.availableWei === '2000000', 'poolfund shows deposit', JSON.stringify(fund))

// 3 · single-recipient award
r = await post('/award', { project: PROJECT, ref: `work:t1:${uniq}`, did: DID_A, amountWei: '500000', reason: 'work-verified' })
const aw = await r.json()
ok(r.status === 200 && aw.status === (AWARD_REVIEW_MS ? 'pending' : 'credited'), `award → ${aw.status}`, JSON.stringify(aw))

// 4 · idempotent ref
r = await post('/award', { project: PROJECT, ref: `work:t1:${uniq}`, did: DID_A, amountWei: '500000' })
ok(r.status === 409, 'duplicate ref → 409', await r.text())

// 5 · insufficient funds
r = await post('/award', { project: PROJECT, ref: `work:big:${uniq}`, did: DID_B, amountWei: '999999999' })
ok(r.status === 402, 'oversized award → 402', await r.text())

// 6 · split award — arena-style score-weighted
r = await post('/award', {
  project: PROJECT, ref: `match:m1:${uniq}`,
  split: [
    { did: DID_A, score: 835 },
    { did: DID_B, score: 833 },
    { did: DID_C, score: 828 },
  ],
  amountWei: '1000000', reason: 'arena-winner',
})
const split = await r.json()
if (r.status === 200) {
  const total = split.recipients.reduce((t, x) => t + BigInt(x.amountWei), 0n)
  ok(total === 1000000n && split.recipients.length === 3, 'split allocates exact total', JSON.stringify(split.recipients))
  const get = (d) => BigInt(split.recipients.find((x) => x.did === d).amountWei)
  ok(get(DID_A) > get(DID_B) && get(DID_B) > get(DID_C), 'split respects score order')
} else ok(false, 'split award', JSON.stringify(split))

// 7 · earnings reflect credits (only meaningful when instant-credit)
if (!AWARD_REVIEW_MS) {
  const earn = await get(`/earnings?id=${encodeURIComponent(DID_A)}`)
  const expected = BigInt('500000') + BigInt(split.recipients.find((x) => x.did === DID_A).amountWei)
  ok(BigInt(earn.totalWei) === expected, `earnings credited ${expected}`, JSON.stringify(earn))
} else {
  // 9 · pending → admin approve
  r = await post(`/award/${encodeURIComponent(`work:t1:${uniq}`)}/approve`, {}, AH)
  ok(r.status === 200, 'admin approve pending award', await r.text())
  const earn = await get(`/earnings?id=${encodeURIComponent(DID_A)}`)
  ok(BigInt(earn.totalWei) >= 500000n, 'approved award credited', JSON.stringify(earn))
}

// 8 · settle history
const hist = await get(`/awards?did=${encodeURIComponent(DID_A)}`)
ok(hist.awards.length >= 2 && hist.awards.every((a) => a.ref), 'awards?did= lists history', JSON.stringify(hist))

// fund accounting closed
const fund2 = await get(`/poolfund/${encodeURIComponent(PROJECT)}`)
const accounted = BigInt(fund2.depositedWei) - BigInt(fund2.spentWei) - BigInt(fund2.pendingWei)
ok(BigInt(fund2.availableWei) === accounted, 'fund accounting consistent', JSON.stringify(fund2))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
