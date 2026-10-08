import { describe, it, expect } from 'vitest'
import { base58Decode, didKeyPublicKey, verifyDidKey, decodeSig, contentHashToCid } from '../src/didkey'

// ed25519 did:key — generate a keypair, multibase-encode the pubkey into a
// did:key, sign a bind message, verify. Also covers Byzantine rejection:
// wrong-key or tampered signatures must fail.

async function makeDidKey() {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  // did:key:z<base58(0xed01 || raw)>
  const prefixed = new Uint8Array(34)
  prefixed[0] = 0xed; prefixed[1] = 0x01; prefixed.set(raw, 2)
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  // big-int style base58 encode
  let num = 0n
  for (const b of prefixed) num = num * 256n + BigInt(b)
  let enc = ''
  while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n }
  for (const b of prefixed) { if (b === 0) enc = '1' + enc; else break }
  return { did: `did:key:z${enc}`, priv: pair.privateKey, raw }
}

describe('did:key', () => {
  it('round-trips base58 decode', () => {
    const bytes = new Uint8Array([0xed, 0x01, ...new Array(32).fill(7)])
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let num = 0n
    for (const b of bytes) num = num * 256n + BigInt(b)
    let enc = ''
    while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n }
    for (const b of bytes) { if (b === 0) enc = '1' + enc; else break }
    expect(base58Decode(enc)).toEqual(bytes)
  })

  it('decodes the pubkey out of a did:key', async () => {
    const { did, raw } = await makeDidKey()
    expect(didKeyPublicKey(did)).toEqual(raw)
  })

  it('rejects malformed / wrong-codec DIDs', () => {
    expect(didKeyPublicKey('did:key:xyz')).toBeNull()
    expect(didKeyPublicKey('did:web:example.com')).toBeNull()
    expect(didKeyPublicKey('not-a-did')).toBeNull()
  })

  it('verifies a signature over the bind message', async () => {
    const { did, priv } = await makeDidKey()
    const msg = new TextEncoder().encode('chimera-bind:vol-123')
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', priv, msg))
    expect(await verifyDidKey(did, 'chimera-bind:vol-123', sig)).toBe(true)
  })

  it('rejects a signature from a different key (byzantine vote/forgery)', async () => {
    const a = await makeDidKey()
    const b = await makeDidKey()
    const msg = new TextEncoder().encode('chimera-vote:m1:yes')
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', b.priv, msg))
    expect(await verifyDidKey(a.did, 'chimera-vote:m1:yes', sig)).toBe(false)
  })

  it('rejects a tampered message', async () => {
    const { did, priv } = await makeDidKey()
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', priv, new TextEncoder().encode('real')))
    expect(await verifyDidKey(did, 'forged', sig)).toBe(false)
  })

  it('decodeSig accepts 64-byte hex and base64, rejects junk', () => {
    const sig = new Uint8Array(64).fill(1)
    const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(decodeSig(hex)).toEqual(sig)
    expect(decodeSig(btoa(String.fromCharCode(...sig)))).toEqual(sig)
    expect(decodeSig('zzzz')).toBeNull()
    expect(decodeSig('abcd')).toBeNull()
  })
})

describe('contentHashToCid', () => {
  it('decodes e301 ipfs contenthash to a b… CIDv1', () => {
    // e301 = ipfs-ns; 01 70 = CIDv1 dag-pb; 12 20 = sha2-256 len 32.
    const digest = new Uint8Array(32).fill(0xaa)
    const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digest]
    const hex = 'e301' + cidBytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    const cid = contentHashToCid(hex)
    expect(cid).toMatch(/^b[a-z2-7]+$/)
    expect(cid!.length).toBe(59) // 'b' + 58 base32 chars for 36 bytes
  })
  it('rejects non-ipfs / malformed contenthash', () => {
    expect(contentHashToCid('e5010000')).toBeNull()   // ipns
    expect(contentHashToCid('0x')).toBeNull()
    expect(contentHashToCid('abc')).toBeNull()
  })
})
