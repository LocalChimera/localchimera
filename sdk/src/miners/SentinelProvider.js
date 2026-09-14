/**
 * SentinelProvider — Sentinel L1 bandwidth marketplace.
 *
 * Decentralized bandwidth marketplace on Cosmos L1.
 * AI agent autonomous payments, per-GB on-chain pricing.
 * No local private keys in SDK.
 */

import { getProtocolPayoutAddress } from './protocol-address.js';

export class SentinelProvider {
  constructor(opts = {}) {
    this.process = null;
    this.running = false;
    this.logs = [];
    this.apiKey = opts.apiKey || process.env.SENTINEL_API_KEY || '';
    this.payoutAddress = getProtocolPayoutAddress(opts);
  }

  async init() {
    if (!this.apiKey) {
      throw new Error('SENTINEL_API_KEY not set');
    }
  }

  async start() {
    if (this.running) return { success: true, alreadyRunning: true };
    this.running = true;
    return { success: true, provider: 'sentinel', mode: 'api', payoutAddress: this.payoutAddress };
  }

  async stop() {
    this.running = false;
    return { success: true, provider: 'sentinel' };
  }

  status() {
    return {
      provider: 'sentinel',
      running: this.running,
      payoutAddress: this.payoutAddress,
      resources: 'Bandwidth relay (WebRTC + WireGuard)',
      recentLogs: this.logs.slice(-10),
    };
  }
}
