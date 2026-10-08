import { describe, it, expect } from 'vitest'
import { lintPayload, classificationOk, redactPayload, parseSealed } from '../src/lint'

describe('classificationOk', () => {
  it('accepts undefined, PUBLIC, and INTERNAL', () => {
    expect(classificationOk(undefined)).toBe(true)
    expect(classificationOk('PUBLIC')).toBe(true)
    // INTERNAL is accepted — dispatch selection restricts it to
    // durable+DID-bound nodes (see selectVolunteer's internalOnly gate).
    expect(classificationOk('INTERNAL')).toBe(true)
  })
  it('rejects SECRET/unrecognized', () => {
    expect(classificationOk('SECRET')).toBe(false)
    expect(classificationOk('public')).toBe(false)
  })
})

describe('lintPayload', () => {
  it('accepts clean payloads', () => {
    expect(lintPayload('Summarize the quarterly report for Acme Corp')).toBeNull()
    expect(lintPayload(JSON.stringify({ prompt: 'write a haiku about trees' }))).toBeNull()
  })
  it('accepts tx hashes and bare hex digests (not keys)', () => {
    expect(lintPayload(`verify tx 0x${'ab'.repeat(32)}`)).toBeNull()
    expect(lintPayload(JSON.stringify({ bodyHash: 'a'.repeat(64) }))).toBeNull()
  })
  it('rejects PEM private keys', () => {
    expect(lintPayload('-----BEGIN EC PRIVATE KEY-----\nMHQ…')).toBe('pem-private-key')
  })
  it('rejects labeled hex keys', () => {
    // both secret-assignment and labeled-hex-key fire — either name means rejected
    expect(lintPayload(`privateKey: 0x${'de'.repeat(32)}`)).not.toBeNull()
  })
  it('rejects secret assignments', () => {
    expect(lintPayload('api_key = "sk_live_abcdef1234567890"')).toBe('secret-assignment')
    expect(lintPayload('mnemonic: "abandon abandon abandon"')).toBe('secret-assignment')
  })
  it('rejects well-known token prefixes', () => {
    expect(lintPayload('use token ghp_AbCdEfGhIjKlMnOpQrStUvWx')).toBe('token-prefix')
    expect(lintPayload('AWS key AKIA1234567890ABCDEF')).toBe('token-prefix')
  })
  it('rejects long lowercase word runs (seed-phrase shape)', () => {
    const words = Array.from({ length: 20 }, () => 'abandon').join(' ')
    expect(lintPayload(words)).toBe('seed-phrase-run')
  })
  it('rejects obvious PII', () => {
    expect(lintPayload('email alice@example.com for details')).toBe('email')
    expect(lintPayload('card 4111-1111-1111-1111')).toBe('card-pan')
  })
})

describe('redactPayload (sealed-value gate)', () => {
  const sealed = { apiKey: 'supersecretvalue123', token: 'tok-abcdef' }

  it('replaces sealed values with [SEALED:name]', () => {
    const r = redactPayload('call upstream with supersecretvalue123 attached', sealed)
    expect(r.payload).toBe('call upstream with [SEALED:apiKey] attached')
    expect(r.redacted).toEqual(['apiKey'])
  })
  it('redacts every occurrence', () => {
    const r = redactPayload('tok-abcdef and again tok-abcdef', sealed)
    expect(r.payload).not.toContain('tok-abcdef')
    expect(r.redacted).toEqual(['token'])
  })
  it('ignores values under 8 chars (collision-prone)', () => {
    const r = redactPayload('the word key appears', { k: 'key' })
    expect(r.payload).toBe('the word key appears')
    expect(r.redacted).toEqual([])
  })
  it('sealed value provably never survives in output', () => {
    const secret = 'x'.repeat(32)
    const r = redactPayload(`{"key":"${secret}","other":"${secret}"}`, { s: secret })
    expect(r.payload).not.toContain(secret)
  })
})

describe('parseSealed', () => {
  it('parses a name→value map', () => {
    expect(parseSealed('{"a":"b12345678"}')).toEqual({ a: 'b12345678' })
  })
  it('tolerates absent/malformed/array JSON', () => {
    expect(parseSealed(undefined)).toEqual({})
    expect(parseSealed('not json')).toEqual({})
    expect(parseSealed('[1,2]')).toEqual({})
  })
})
