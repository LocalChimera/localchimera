/** viem clients + the VolunteerEscrow ABI the DO talks to. */
import {
  createPublicClient, createWalletClient, http, keccak256, toHex,
  type Address, type Hex,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

export const ESCROW_ABI = [
  {
    type: 'event', name: 'JobCreated',
    inputs: [
      { name: 'jobId', type: 'bytes32', indexed: true },
      { name: 'consumer', type: 'address', indexed: true },
      { name: 'taskType', type: 'uint8', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint64', indexed: false },
      { name: 'payload', type: 'string', indexed: false },
    ],
  },
  {
    type: 'function', name: 'completeJob', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'resultHash', type: 'bytes32' },
      { name: 'volunteerId', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'jobs', stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    outputs: [
      { name: 'consumer', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint64' }, { name: 'taskType', type: 'uint8' },
      { name: 'completed', type: 'bool' }, { name: 'refunded', type: 'bool' },
    ],
  },
] as const

/** RPC failover — BASE_RPC_URLS is a comma-separated list; BASE_RPC_URL is
 *  the single-URL fallback. pollChain rotates rpcIndex on transport errors. */
export function rpcUrls(env: { BASE_RPC_URL: string; BASE_RPC_URLS?: string }): string[] {
  const list = (env.BASE_RPC_URLS || env.BASE_RPC_URL || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  return list.length ? list : [env.BASE_RPC_URL]
}

export function makeClients(env: {
  BASE_RPC_URL: string
  BASE_RPC_URLS?: string
  ESCROW_CONTRACT: string
  COORDINATOR_PRIVATE_KEY?: string
}, rpcIndex = 0) {
  const urls = rpcUrls(env)
  const url = urls[rpcIndex % urls.length]
  const isTestnet = url.includes('sepolia')
  const chain = isTestnet ? baseSepolia : base
  const pub = createPublicClient({ chain, transport: http(url) })
  const contract = env.ESCROW_CONTRACT as Address

  const account = env.COORDINATOR_PRIVATE_KEY
    ? privateKeyToAccount(env.COORDINATOR_PRIVATE_KEY as Hex)
    : null
  const wallet = account
    ? createWalletClient({ account, chain, transport: http(url) })
    : null

  return { pub, wallet, account, contract, chain, url, urlCount: urls.length }
}

export function resultHash(resultText: string): Hex {
  return keccak256(toHex(resultText))
}

/** EIP-3009 settle — the coordinator can broadcast a verified
 *  TransferWithAuthorization itself when no x402 facilitator is configured.
 *  USDC enforces nonce single-use on-chain; a replayed auth just reverts. */
export const USDC_EIP3009_ABI = [
  {
    type: 'function', name: 'transferWithAuthorization', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

/** Sign the dispatch envelope so nodes can verify a job came from this
 *  coordinator (node-side verification is opt-in — the signature is always
 *  attached once COORDINATOR_PRIVATE_KEY is set). */
export function signDispatch(
  account: { signMessage(args: { message: string }): Promise<Hex> },
  jobId: string,
): Promise<Hex> {
  return account.signMessage({ message: `chimera-job:${jobId}` })
}
