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
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout Testnet', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
});

export const CHIMERA_CONTRACTS = {
  // v1 contracts (deprecated — ETH-based)
  coordinatorV1: '0x2583006159d8cCe0E49C91dA8c7cc52D369624A6',
  bridgeDispatcher: '0x',
  proofOfInferenceV1: '0xCf3005d6682FAD55a12e5246d2Db6f7Fb0775eB2',
  escrowV1: '0xa081d022bFFDeE898CC0Bd1Cd956BA982650E60A',
  protocolMultisig: '0x7eB4A545F875FC1Da252661d31A3e28e67bf723f',

  // v2 tokenomics contracts (CHIMERA-based — TBD after deployment)
  chimeraToken: (import.meta.env?.VITE_CHIMERA_TOKEN_ADDRESS as string) || '0x',
  chimeraStaking: (import.meta.env?.VITE_CHIMERA_STAKING_ADDRESS as string) || '0x',
  coordinator: (import.meta.env?.VITE_CHIMERA_COORDINATOR_V2_ADDRESS as string) || '0x',
  proofOfInference: (import.meta.env?.VITE_CHIMERA_PROOF_OF_INFERENCE_V2_ADDRESS as string) || '0x',
  escrow: (import.meta.env?.VITE_ESCROW_CHANNEL_V2_ADDRESS as string) || '0x',
  timelockController: (import.meta.env?.VITE_CHIMERA_TIMELOCK_ADDRESS as string) || '0x',
  chimeraGovernance: (import.meta.env?.VITE_CHIMERA_GOVERNANCE_ADDRESS as string) || '0x',
};
