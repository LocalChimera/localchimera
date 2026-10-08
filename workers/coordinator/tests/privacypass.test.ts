/**
 * Privacy Pass (RFC 9578) origin-side verification — proves the Blind-RSA
 * token redemption path runs under the same WebCrypto primitives workerd
 * provides, and that verifyPrivateToken accepts a real issuer's tokens
 * while rejecting forged/wrong-issuer ones.
 */
import { describe, expect, it } from 'vitest'
import { publicVerif, TOKEN_TYPES, AuthorizationHeader } from '@cloudflare/privacypass-ts'
import { verifyPrivateToken, hasPrivateToken } from '../src/privacypass'

const { Origin, Client, Issuer, BlindRSAMode } = publicVerif

const RSA_PARAMS = { modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }

async function makeIssuer(name: string) {
  const keys = await Issuer.generateKey(BlindRSAMode.PSS, RSA_PARAMS)
  return new Issuer(BlindRSAMode.PSS, name, keys.privateKey, keys.publicKey)
}

async function issueToken(issuer: InstanceType<typeof Issuer>): Promise<string> {
  const origin = new Origin(BlindRSAMode.PSS, ['coordinator.test'])
  const challenge = origin.createTokenChallenge(issuer.name, new Uint8Array(32))
  const client = new Client(BlindRSAMode.PSS)
  const issuerPubBytes = await crypto.subtle.exportKey('spki', issuer.publicKey)
  const req = await client.createTokenRequest(challenge, new Uint8Array(issuerPubBytes))
  const res = await issuer.issue(req)
  const token = await client.finalize(res)
  return new AuthorizationHeader(token).toString()
}

const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64')

describe('privacy pass origin redemption', () => {
  it('accepts a valid token from the configured issuer', async () => {
    const issuer = await makeIssuer('issuer.test')
    const issuerKey = b64(await crypto.subtle.exportKey('spki', issuer.publicKey))
    const header = await issueToken(issuer)
    expect(hasPrivateToken(header)).toBe(true)
    const hash = await verifyPrivateToken(header, { issuerKey })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a token from a different issuer', async () => {
    const real = await makeIssuer('issuer.test')
    const evil = await makeIssuer('evil.test')
    const header = await issueToken(evil)
    const issuerKey = b64(await crypto.subtle.exportKey('spki', real.publicKey))
    expect(await verifyPrivateToken(header, { issuerKey })).toBeNull()
  })

  it('rejects malformed headers', async () => {
    const issuer = await makeIssuer('issuer.test')
    const issuerKey = b64(await crypto.subtle.exportKey('spki', issuer.publicKey))
    expect(await verifyPrivateToken('PrivateToken token=aGVsbG8=', { issuerKey })).toBeNull()
    expect(await verifyPrivateToken('Bearer abc', { issuerKey })).toBeNull()
    expect(hasPrivateToken('Bearer abc')).toBe(false)
    expect(hasPrivateToken(null)).toBe(false)
  })
})
