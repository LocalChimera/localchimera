import { defineChain } from 'viem';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  testnet: {
    id: 46630,
    name: 'Robinhood Chain Testnet',
    rpcUrls: {
      default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
    },
    blockExplorers: {
      default: { name: 'Blockscout Testnet', url: 'https://explorer.testnet.chain.robinhood.com' },
    },
  },
});

export const CHIMERA_CONTRACTS = {
  // v1 contracts (deprecated — ETH-based)
  coordinatorV1: process.env.CHIMERA_COORDINATOR_ADDRESS || '0x',
  bridgeDispatcher: process.env.CHIMERA_BRIDGE_DISPATCHER_ADDRESS || '0x',
  proofOfInferenceV1: process.env.CHIMERA_PROOF_OF_INFERENCE_ADDRESS || '0x',
  escrowV1: process.env.ESCROW_CHANNEL_ADDRESS || '0x',
  protocolMultisig: '0x7eB4A545F875FC1Da252661d31A3e28e67bf723f',

  // v2 tokenomics contracts (CHIMERA-based)
  chimeraToken: process.env.CHIMERA_TOKEN_ADDRESS || '0x',
  chimeraStaking: process.env.CHIMERA_STAKING_ADDRESS || '0x',
  coordinator: process.env.CHIMERA_COORDINATOR_V2_ADDRESS || '0x',
  proofOfInference: process.env.CHIMERA_PROOF_OF_INFERENCE_V2_ADDRESS || '0x',
  escrow: process.env.ESCROW_CHANNEL_V2_ADDRESS || '0x',
  timelockController: process.env.CHIMERA_TIMELOCK_ADDRESS || '0x',
  chimeraGovernance: process.env.CHIMERA_GOVERNANCE_ADDRESS || '0x',
};
