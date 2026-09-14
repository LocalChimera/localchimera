import { createPublicClient, http, parseAbi } from 'viem';

const PRICING_ABI = parseAbi([
  'function getCurrentPrice() external view returns (uint256)',
  'function getMarketRate() external view returns (uint256)',
  'function setPrice(uint256 _price) external',
]);

export class DynamicPricing {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
    this.contractAddress = config.contractAddress || null;
    this.chain = config.chain || null;
    this.basePrice = config.basePrice || 1000n;
    this.multiplier = config.multiplier || 1n;
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

  async getPrice() {
    if (this.client && this.contractAddress) {
      try {
        return await this.client.readContract({
          address: this.contractAddress,
          abi: PRICING_ABI,
          functionName: 'getCurrentPrice',
        });
      } catch {
        return this.basePrice * this.multiplier;
      }
    }
    return this.basePrice * this.multiplier;
  }

  setMultiplier(m) {
    this.multiplier = m;
  }

  getStats() {
    return {
      started: this.started,
      basePrice: this.basePrice.toString(),
      multiplier: this.multiplier.toString(),
      hasContract: !!this.contractAddress,
    };
  }
}
