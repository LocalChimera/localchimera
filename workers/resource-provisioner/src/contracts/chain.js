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
  coordinator: process.env.CHIMERA_COORDINATOR || '0x',
  bridgeDispatcher: process.env.CHIMERA_BRIDGE_DISPATCHER || '0x',
  proofOfInference: process.env.CHIMERA_PROOF_OF_INFERENCE || '0x',
  escrow: process.env.ESCROW_CHANNEL_ADDRESS || '0x',
  protocolMultisig: '0x7eB4A545F875FC1Da252661d31a3e28e67bf723f',
};
