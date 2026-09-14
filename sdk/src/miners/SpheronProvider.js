/**
 * SpheronProvider — Spheron Fizz Nodes compute marketplace.
 *
 * Consumer hardware GPU compute on Base L2.
 * No local private keys in SDK.
 */

import { getProtocolPayoutAddress } from './protocol-address.js';

export class SpheronProvider {
  constructor(opts = {}) {
    this.process = null;
    this.running = false;
    this.logs = [];
    this.apiKey = opts.apiKey || process.env.SPHERON_API_KEY || '';
    this.payoutAddress = getProtocolPayoutAddress(opts);
  }

  async init() {
    if (!this.apiKey) {
      throw new Error('SPHERON_API_KEY not set');
    }
  }

  async start() {
    if (this.running) return { success: true, alreadyRunning: true };
    this.running = true;
    return { success: true, provider: 'spheron', mode: 'api', payoutAddress: this.payoutAddress };
  }

  async stop() {
    this.running = false;
    return { success: true, provider: 'spheron' };
  }

  status() {
    return {
      provider: 'spheron',
      running: this.running,
      payoutAddress: this.payoutAddress,
      resources: 'Consumer GPU compute (Fizz Nodes)',
      recentLogs: this.logs.slice(-10),
    };
  }
}
