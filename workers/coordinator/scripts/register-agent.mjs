#!/usr/bin/env node
/**
 * register-agent.mjs — register the coordinator's agent card on an
 * ERC-8004-style identity registry.
 *
 * ERC-8004 ("Trustless Agents") registries expose register(agentURI) →
 * agentId. The agentURI points at the coordinator's /.well-known/agent.json.
 *
 * Usage:
 *   AGENT_REGISTRY=0x<registry>  # deployed IdentityRegistry on Base
 *   AGENT_URI=https://coordinator.widespread.fyi/.well-known/agent.json \
 *   COORDINATOR_PRIVATE_KEY=0x... \
 *   BASE_RPC_URL=https://mainnet.base.org \
 *   node register-agent.mjs
 */
import { createPublicClient, createWalletClient, http } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const REGISTRY = process.env.AGENT_REGISTRY
const URI = process.env.AGENT_URI
const KEY = process.env.COORDINATOR_PRIVATE_KEY
const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org'

if (!REGISTRY || !URI || !KEY) {
  console.error('AGENT_REGISTRY, AGENT_URI and COORDINATOR_PRIVATE_KEY are required')
  process.exit(1)
}

// Minimal ERC-8004 IdentityRegistry surface — register(string) returns the
// minted agentId; AgentMetadata read is via the Registered event.
const REGISTRY_ABI = [
  {
    type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'event', name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
]

const chain = RPC.includes('sepolia') ? baseSepolia : base
const account = privateKeyToAccount(KEY)
const wallet = createWalletClient({ account, chain, transport: http(RPC) })
const pub = createPublicClient({ chain, transport: http(RPC) })

const { request } = await pub.simulateContract({
  address: REGISTRY, abi: REGISTRY_ABI,
  functionName: 'register', args: [URI], account,
})
const tx = await wallet.writeContract(request)
console.log(`register tx: ${tx}`)
const receipt = await pub.waitForTransactionReceipt({ hash: tx })
const ev = receipt.logs
  .map((l) => { try { return { agentId: BigInt(l.topics[1] || 0) } } catch { return null } })
  .filter(Boolean)[0]
console.log(`agent registered${ev ? ` — agentId ${ev.agentId}` : ''} — card: ${URI}`)
