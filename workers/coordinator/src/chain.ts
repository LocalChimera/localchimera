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

export function makeClients(env: {
  BASE_RPC_URL: string
  ESCROW_CONTRACT: string
  COORDINATOR_PRIVATE_KEY?: string
}) {
  const isTestnet = env.BASE_RPC_URL.includes('sepolia')
  const chain = isTestnet ? baseSepolia : base
  const pub = createPublicClient({ chain, transport: http(env.BASE_RPC_URL) })
  const contract = env.ESCROW_CONTRACT as Address

  const account = env.COORDINATOR_PRIVATE_KEY
    ? privateKeyToAccount(env.COORDINATOR_PRIVATE_KEY as Hex)
    : null
  const wallet = account
    ? createWalletClient({ account, chain, transport: http(env.BASE_RPC_URL) })
    : null

  return { pub, wallet, account, contract, chain }
}

export function resultHash(resultText: string): Hex {
  return keccak256(toHex(resultText))
}
