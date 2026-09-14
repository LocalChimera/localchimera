import { createPublicClient, http, parseAbi } from 'viem';

const REGISTRAR_ABI = parseAbi([
  'function isRegistered(address provider) external view returns (bool)',
  'function getProviderInfo(address provider) external view returns (tuple(address id, uint256 stake, uint256 reputation, bool active))',
  'function registerProvider(address provider, uint256 stake) external',
  'function unregisterProvider(address provider) external',
]);

export class EscrowRegistrar {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
    this.contractAddress = config.contractAddress || null;
    this.chain = config.chain || null;
    this.started = false;
  }

  initialize({ chain, contractAddress }) {
    this.chain = chain || this.chain;
    this.contractAddress = contractAddress || this.contractAddress;
    if (this.chain) {
      this.client = createPublicClient({ chain: this.chain, transport: http() });
    }
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }

  async isRegistered(providerAddress) {
    if (!this.client || !this.contractAddress) return false;
    return this.client.readContract({
      address: this.contractAddress,
      abi: REGISTRAR_ABI,
      functionName: 'isRegistered',
      args: [providerAddress],
    });
  }

  async getProviderInfo(providerAddress) {
    if (!this.client || !this.contractAddress) return null;
    return this.client.readContract({
      address: this.contractAddress,
      abi: REGISTRAR_ABI,
      functionName: 'getProviderInfo',
      args: [providerAddress],
    });
  }

  getStats() {
    return {
      started: this.started,
      hasContract: !!this.contractAddress,
      chain: this.chain?.name || null,
    };
  }
}
