/**
 * InfernetProvider — Infernet Protocol open inference marketplace.
 *
 * Open source, no native token, pays in any crypto.
 * Nostr auth, Ollama/vLLM backends, libp2p.
 * No local private keys in SDK.
 */

import { getProtocolPayoutAddress } from './protocol-address.js';

export class InfernetProvider {
  constructor(opts = {}) {
    this.process = null;
    this.running = false;
    this.logs = [];
    this.apiUrl = opts.apiUrl || process.env.INFERNET_API_URL || 'https://api.infernet.protocol';
    this.apiKey = opts.apiKey || process.env.INFERNET_KEY || '';
    this.payoutAddress = getProtocolPayoutAddress(opts);
  }

  async init() {
    if (!this.apiKey) {
      throw new Error('INFERNET_KEY not set');
    }
  }

  async start() {
    if (this.running) return { success: true, alreadyRunning: true };
    this.running = true;
    return { success: true, provider: 'infernet', mode: 'api', apiUrl: this.apiUrl, payoutAddress: this.payoutAddress };
  }

  async stop() {
    this.running = false;
    return { success: true, provider: 'infernet' };
  }

  status() {
    return {
      provider: 'infernet',
      running: this.running,
      apiUrl: this.apiUrl,
      payoutAddress: this.payoutAddress,
      resources: 'Open inference (Ollama/vLLM, any-token payments)',
      recentLogs: this.logs.slice(-10),
    };
  }
}
