/**
 * Payload lint — reject jobs carrying secrets or obvious PII before they are
 * ever dispatched to a node. Runs at POST /jobs (+ /jobs/batch) and in
 * pollChain for on-chain submissions.
 *
 * Conservative by design: a false positive costs a rejected job; a false
 * negative costs leaked data. Patterns are intentionally coarse — 12-word
 * BIP39 phrases aren't reliably detectable without a wordlist (deferred),
 * so we cover 18+/24-word runs and keyword-adjacent secrets instead.
 */

interface LintPattern {
  name: string
  re: RegExp
}

const PATTERNS: LintPattern[] = [
  // PEM blocks
  { name: 'pem-private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  // "privateKey: ...", "seed phrase = ...", "api_key '...'" style assignments
  {
    name: 'secret-assignment',
    re: /(private[_\s-]*key|secret[_\s-]*key|api[_\s-]*key|access[_\s-]*token|seed[_\s-]*phrase|mnemonic|recovery[_\s-]*phrase|password|passwd)\s*[:=]\s*["']?\S{8,}/i,
  },
  // Hex private key explicitly labeled (bare 0x…64 is NOT rejected — tx
  // hashes and sha256 digests are legitimate payload content)
  {
    name: 'labeled-hex-key',
    re: /(key|secret|seed|private)\s*[:=]\s*["']?0x[0-9a-fA-F]{64}\b/i,
  },
  // Well-known token prefixes — separators differ per issuer (ghp_/xox-/sk_
  // vs. AWS/Gemini which embed no separator at all)
  {
    name: 'token-prefix',
    re: /\b(?:gh[pousr]_[0-9A-Za-z]{16,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk(?:_live|_test)?-[0-9A-Za-z_-]{16,}|sk_live_[0-9A-Za-z]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|dop_v1_[0-9a-f]{16,}|npm_[0-9A-Za-z]{16,}|glpat-[0-9A-Za-z_-]{16,}|shpat_[0-9A-Fa-f]{16,}|hf_[0-9A-Za-z]{16,})\b/,
  },
  // ≥18 consecutive lowercase alpha words — 18/24-word seed phrase shape.
  // 12-word runs are too close to normal prose to block safely.
  { name: 'seed-phrase-run', re: /(?:\b[a-z]{3,8}\b[\s,]+){17}\b[a-z]{3,8}\b/ },
  // PII patterns
  { name: 'email', re: /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/ },
  { name: 'card-pan', re: /\b(?:\d{4}[ -]){3}\d{4}\b/ },
]

/** Returns the offending pattern name, or null if the payload is clean. */
export function lintPayload(payload: string): string | null {
  for (const p of PATTERNS) {
    if (p.re.test(payload)) return p.name
  }
  return null
}

/** Deep lint — @secretlint/core + the recommend preset (AWS/GCP/npm/GitHub/
 *  Slack/Stripe/Shopify/SendGrid/privatekey/basicauth rules). Runs after the
 *  regex fast-path; a hit here returns a rule id, failures degrade to the
 *  regex layer alone (logged — never silently skipped). Lazy-imported so the
 *  preset cost is paid once per isolate, not per job. */
let presetMod: Promise<typeof import('@secretlint/secretlint-rule-preset-recommend')> | null = null
export async function lintPayloadDeep(payload: string): Promise<string | null> {
  try {
    const { lintSource } = await import('@secretlint/core')
    // workerd lacks PerformanceObserver — disable the profiler before the
    // first mark() would lazily try to construct one.
    const { secretLintProfiler } = await import('@secretlint/profiler')
    secretLintProfiler.setEnabled(false)
    presetMod ??= import('@secretlint/secretlint-rule-preset-recommend')
    const { creator } = await presetMod
    const res = await lintSource({
      source: {
        content: payload,
        filePath: 'payload.txt',
        ext: '.txt',
        contentType: 'text',
      },
      options: {
        config: {
          rules: [
            { id: '@secretlint/secretlint-rule-preset-recommend', rule: creator, options: {} },
          ],
        },
      },
    })
    const hit = res.messages.find((m) => m.severity === 'error' || m.ruleId)
    return hit ? `secretlint:${hit.ruleId ?? 'hit'}` : null
  } catch (e) {
    console.error('[lint] secretlint layer failed, regex layer only:', e)
    return null
  }
}

/** Accepted classifications: PUBLIC (any node) and INTERNAL (payloads that
 *  may contain non-secret internal data — dispatched only to durable,
 *  DID-bound nodes; see the eligibleInternal gate in selectVolunteer).
 *  SECRET is never accepted — sealed material belongs in SEALED_VALUES
 *  handles, not payloads. */
export function classificationOk(classification: unknown): boolean {
  return classification === undefined || classification === 'PUBLIC' || classification === 'INTERNAL'
}

/** Redaction gate — sealed values (from the SEALED_VALUES env map, name →
 *  secret) are replaced with `[SEALED:name]` before a payload is stored or
 *  dispatched. The sealed value therefore provably cannot reach a node even
 *  if a submitter inlines it. Values under 8 chars are ignored (too
 *  collision-prone to redact safely). */
export function redactPayload(
  payload: string,
  sealed: Record<string, string>,
): { payload: string; redacted: string[] } {
  const redacted: string[] = []
  let out = payload
  for (const [name, value] of Object.entries(sealed)) {
    if (typeof value !== 'string' || value.length < 8) continue
    if (out.includes(value)) {
      out = out.split(value).join(`[SEALED:${name}]`)
      redacted.push(name)
    }
  }
  return { payload: out, redacted }
}

export function parseSealed(envValue?: string): Record<string, string> {
  if (!envValue) return {}
  try {
    const parsed = JSON.parse(envValue)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Result sandboxing — the instruction-strip half of the sandboxing contract
 * (schema-validate happens in registry.validateJobResult; consumers quote-
 * embed rather than concat). Strips lines that look like prompt-injection
 * payloads riding back through a node result — role markers and imperative
 * override phrasing. Conservative: only whole-line/leading matches are cut,
 * and the function returns the list of removed lines for the audit record.
 */
const INJECTION_LINE = /^\s*(?:\[[a-z ]+\]\s*)?(?:system|assistant|user)\s*:|^\s*(?:ignore|disregard|forget)\b.{0,40}\b(?:previous|prior|above|all)\b.{0,20}\b(?:instructions?|prompts?|context)\b/i

export function stripInstructions(result: string): { text: string; stripped: number } {
  const lines = result.split('\n')
  const kept: string[] = []
  let stripped = 0
  for (const line of lines) {
    if (INJECTION_LINE.test(line)) stripped++
    else kept.push(line)
  }
  return { text: kept.join('\n'), stripped }
}

/** True when the result text contains a sealed value — meaning the node saw
 *  secret material it should never have had (it leaked through the payload
 *  path or the node scanned its own environment). Treated as a killswitch:
 *  no credit, node banned, audit event. */
export function leaksSealed(result: string, sealed: Record<string, string>): string | null {
  for (const [name, value] of Object.entries(sealed)) {
    if (typeof value === 'string' && value.length >= 8 && result.includes(value)) return name
  }
  return null
}
