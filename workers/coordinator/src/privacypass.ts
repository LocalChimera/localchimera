/**
 * privacypass.ts — Privacy Pass (RFC 9578) anonymous-attestation gate.
 *
 * The coordinator acts as a Privacy Pass *origin*: anonymous clients present
 * `Authorization: PrivateToken token=…` (a publicly-verifiable Blind-RSA
 * token issued by a configured attester/issuer). A valid, unspent token
 * substitutes for a Turnstile challenge on anonymous /jobs submissions —
 * the submitter proves human attestation without revealing identity.
 *
 * Config:
 *   PRIVACYPASS_ISSUER_KEY — base64 SPKI public key of the trusted issuer
 *   PRIVACYPASS_ORIGIN     — origin name bound into challenges (optional)
 *
 * Runs in workerd: @cloudflare/privacypass-ts is pure WebCrypto (its deps —
 * blindrsa-ts, voprf-ts, asn1js, rfc4648, quicvarint — have no node APIs).
 */
import {
  AUTH_SCHEME_NAME,
  TOKEN_TYPES,
  AuthorizationHeader,
  publicVerif,
} from '@cloudflare/privacypass-ts'

export interface PrivacyPassConfig {
  issuerKey: string   // base64 SPKI
  originName?: string // e.g. 'coordinator.widespread.fyi'
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** True when the Authorization header carries a PrivateToken credential. */
export function hasPrivateToken(auth: string | null): boolean {
  return !!auth && auth.startsWith(`${AUTH_SCHEME_NAME} `)
}

/**
 * Verify a presented `Authorization: PrivateToken …` header against the
 * configured issuer's public key. Returns the token's SHA-256 (for replay
 * prevention) on success, null on any failure — malformed header, wrong
 * issuer, bad signature.
 */
export async function verifyPrivateToken(
  authHeader: string, cfg: PrivacyPassConfig,
): Promise<string | null> {
  try {
    const headers = AuthorizationHeader.parse(TOKEN_TYPES.BLIND_RSA, authHeader)
    if (headers.length === 0) return null
    const { token } = headers[0]
    const issuerKey = await crypto.subtle.importKey(
      'spki',
      b64ToBytes(cfg.issuerKey) as BufferSource,
      { name: 'RSA-PSS', hash: 'SHA-384' },
      false, ['verify'],
    )
    const origin = new publicVerif.Origin(
      publicVerif.BlindRSAMode.PSS,
      cfg.originName ? [cfg.originName] : undefined,
    )
    if (!(await origin.verify(token, issuerKey))) return null
    const digest = await crypto.subtle.digest(
      'SHA-256', token.serialize() as BufferSource)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
