/**
 * decodeEip3009Payment — the x-payment header decode feeding direct
 * EIP-3009 settlement. Covers: well-formed auth + signature split into
 * v/r/s in the shape transferWithAuthorization expects, malformed input
 * rejection (bad base64, missing fields, bad sig length).
 */
import { describe, expect, it } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { decodeEip3009Payment } from '../src/chain'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

function makeXpay(over: Record<string, unknown> = {}) {
  return b64(JSON.stringify({
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature: over.signature,
      authorization: over.authorization ?? {
        from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        value: '1000000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0x' + 'ab'.repeat(32),
      },
      ...over,
    },
  }))
}

describe('decodeEip3009Payment', () => {
  it('decodes a well-formed x-payment into auth + v/r/s', async () => {
    // Real 65-byte signature from a viem account (contents irrelevant —
    // we only check the split is faithful).
    const acct = privateKeyToAccount(generatePrivateKey())
    const sig = await acct.signMessage({ message: 'test auth' })
    const xpay = makeXpay({ signature: sig })

    const d = decodeEip3009Payment(xpay)
    expect(d).not.toBeNull()
    expect(d!.auth.to).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
    expect(d!.auth.value).toBe('1000000')
    expect(d!.auth.nonce).toBe('0x' + 'ab'.repeat(32))
    // v/r/s must round-trip to the original signature bytes.
    expect([27, 28]).toContain(d!.v)
    expect(d!.r).toMatch(/^0x[0-9a-f]{64}$/)
    expect(d!.s).toMatch(/^0x[0-9a-f]{64}$/)
    const rebuilt = `0x${d!.r.slice(2)}${d!.s.slice(2)}${d!.v.toString(16).padStart(2, '0')}`
    expect(rebuilt.toLowerCase()).toBe(sig.toLowerCase())
  })

  it('rejects malformed input without throwing', () => {
    expect(decodeEip3009Payment('not-base64!!!')).toBeNull()
    expect(decodeEip3009Payment(b64('{"payload":{}}'))).toBeNull()
    expect(decodeEip3009Payment(b64('{"payload":{"signature":"0x12"}}'))).toBeNull()
    expect(decodeEip3009Payment(b64('{}'))).toBeNull()
    expect(decodeEip3009Payment('')).toBeNull()
  })

  it('rejects a truncated signature', () => {
    const xpay = makeXpay({ signature: '0x' + 'ab'.repeat(32) }) // 32B, not 65
    expect(decodeEip3009Payment(xpay)).toBeNull()
  })
})
