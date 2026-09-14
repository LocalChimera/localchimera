/**
 * CrustProvider — Crust Network IPFS incentive layer.
 *
 * EVM-compatible decentralized pinning and storage market.
 * No local private keys in SDK.
 */

import { getProtocolPayoutAddress } from './protocol-address.js';

export class CrustProvider {
  constructor(opts = {}) {
    this.process = null;
    this.running = false;
    this.logs = [];
    this.apiUrl = opts.apiUrl || process.env.CRUST_API_URL || 'https://api.crust.network';
    this.payoutAddress = getProtocolPayoutAddress(opts);
  }

  async init() {
    // Crust API is public, no key required for basic pinning
  }

  async start() {
    if (this.running) return { success: true, alreadyRunning: true };
    this.running = true;
    return { success: true, provider: 'crust', mode: 'api', apiUrl: this.apiUrl, payoutAddress: this.payoutAddress };
  }

  async stop() {
    this.running = false;
    return { success: true, provider: 'crust' };
  }

  status() {
    return {
      provider: 'crust',
      running: this.running,
      apiUrl: this.apiUrl,
      payoutAddress: this.payoutAddress,
      resources: 'IPFS pinning + storage incentive layer',
      recentLogs: this.logs.slice(-10),
    };
  }
}
