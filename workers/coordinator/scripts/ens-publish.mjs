#!/usr/bin/env node
/**
 * ens-publish.mjs — set the contenthash on an ENS name to a swarm/IPFS CID.
 *
 * Part of the P8 naming layer: the coordinator resolves names via
 * /.well-known/ens; this script is how a project's site artifact gets *into*
 * ENS in the first place.
 *
 * Usage:
 *   ENS_NAME=chimera.eth \
 *   CONTENTHASH=bafybeig...        # CIDv1, or ipfs:// / swarm:// URI
 *   PRIVATE_KEY=0x...            # owner/controller key — NOT the coordinator key
 *   ETH_RPC=https://eth.llamarpc.com \
 *   node ens-publish.mjs
 */
import { createPublicClient, createWalletClient, http, namehash, toHex } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const NAME = process.env.ENS_NAME
const HASH_URI = process.env.CONTENTHASH
const KEY = process.env.PRIVATE_KEY
const RPC = process.env.ETH_RPC || 'https://eth.llamarpc.com'
// ENS PublicResolver — contenthash() lives on the resolver for the name's node.
const RESOLVER = process.env.RESOLVER || '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63'

if (!NAME || !HASH_URI || !KEY) {
  console.error('ENS_NAME, CONTENTHASH and PRIVATE_KEY are required')
  process.exit(1)
}

/** Minimal contenthash codec — IPFS CIDv1 (dag-pb 0x70) or raw hex bytes.
 *  ENS stores contenthash as a protobuf-ish multicodec blob:
 *  ipfs = 0xe3 0x01 0x70 <varint len> <cid multihash>. */
function encodeContenthash(uri) {
  let s = uri.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '')
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s // already-encoded blob passthrough
  // CIDv1 base32 → bytes via multibase-free path: decode base32 ourselves.
  if (/^b[a-z2-7]+$/.test(s)) {
    const b32 = 'abcdefghijklmnopqrstuvwxyz234567'
    let bits = 0, value = 0, bytes = []
    for (const c of s.slice(1)) { // strip 'b' multibase prefix
      value = (value << 5) | b32.indexOf(c)
      bits += 5
      if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
    }
    bytes = bytes.slice(1) // strip 0x01 cidv1 marker? no — keep CIDv1 bytes, drop only the multibase 'b'
    // CIDv1 bytes = [0x01, codec, multihash...]; first decoded byte IS 0x01
    bytes.unshift(0x01)
    const blob = [0xe3, 0x01, 0x70, bytes.length, ...bytes]
    return '0x' + blob.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  throw new Error(`unsupported contenthash '${uri}' — pass a CIDv1 (bafy...) or an 0x blob`)
}

const RESOLVER_ABI = [{
  type: 'function', name: 'setContenthash', stateMutability: 'nonpayable',
  inputs: [{ name: 'node', type: 'bytes32' }, { name: 'hash', type: 'bytes' }],
  outputs: [],
}]

const account = privateKeyToAccount(KEY)
const node = namehash(NAME)
const hash = encodeContenthash(HASH_URI)
const wallet = createWalletClient({ account, chain: mainnet, transport: http(RPC) })
const pub = createPublicClient({ chain: mainnet, transport: http(RPC) })

const tx = await wallet.writeContract({
  address: RESOLVER, abi: RESOLVER_ABI,
  functionName: 'setContenthash', args: [node, hash],
})
console.log(`setContenthash tx: ${tx}`)
await pub.waitForTransactionReceipt({ hash: tx })
console.log(`${NAME} → ${HASH_URI} — resolvable via /.well-known/ens?name=${NAME}`)
