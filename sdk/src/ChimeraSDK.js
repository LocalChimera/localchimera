/**
 * Chimera SDK
 * Integrate local AI mining into your application.
 * Your users earn revenue from idle inference tasks.
 * You earn a percentage as the app integrator.
 */

import { NodeManager } from '../../qvac/src/core/NodeManager.js';
import { Logger } from '../../qvac/src/core/Logger.js';
import { promises as fs } from 'fs';
import path from 'path';

const logger = new Logger('ChimeraSDK');

/**
 * ChimeraSDK — mining-only wrapper for app developers.
 *
 * Usage:
 *   import { ChimeraSDK } from '@chimera/sdk';
 *   const sdk = new ChimeraSDK({
 *     appName: 'MyApp',
 *     integratorWallet: '0x...', // your payout address
 *     revenueSplit: { integrator: 0.30, machineOwner: 0.70 }
 *   });
 *   await sdk.init();
 *   await sdk.requestConsent(); // UI: ask user to opt in
 *   await sdk.start();            // starts mining
 *   await sdk.stop();             // stops mining
 *   const status = sdk.status();   // { running, miners, earnings }
 */
export class ChimeraSDK {
  constructor(opts = {}) {
    this.appName = opts.appName || 'unknown-app';
    this.machineOwnerEVM = opts.machineOwnerEVM || null;
    this.appDeveloperEVM = opts.appDeveloperEVM || null;
    this.revenueSplit = opts.revenueSplit || { machineOwner: 0.70, appDeveloper: 0.30 };
    this.configPath = opts.configPath || path.join(process.cwd(), 'config.json');
    this.userConsent = false;
    this.nodeManager = null;
    this._config = null;
  }

  /**
   * Load and merge configuration.
   * Sets integrator wallet into the miner config if provided.
   */
  async init() {
    const raw = await fs.readFile(this.configPath, 'utf-8');
    this._config = JSON.parse(raw);

    // Inject user EVM addresses into multisig config
    if (this.machineOwnerEVM) {
      this._config.multisig = this._config.multisig || {};
      this._config.multisig.machineOwnerAddress = this.machineOwnerEVM;
      logger.info(`[${this.appName}] Machine owner EVM: ${this.machineOwnerEVM}`);
    }
    if (this.appDeveloperEVM) {
      this._config.multisig = this._config.multisig || {};
      this._config.multisig.appDeveloperAddress = this.appDeveloperEVM;
      this._config.multisig.revenueSplit = this.revenueSplit;
      logger.info(`[${this.appName}] App developer EVM: ${this.appDeveloperEVM}`);
      logger.info(`[${this.appName}] Revenue split — machine owner: ${(this.revenueSplit.machineOwner * 100).toFixed(0)}%, app developer: ${(this.revenueSplit.appDeveloper * 100).toFixed(0)}%`);
    }

    // Disable wiki / AI writer features — SDK is mining-only
    this._config.inference = this._config.inference || {};
    this._config.p2p = this._config.p2p || {};
    this._config.p2p.enabled = false; // no P2P swarm in SDK mode

    this.nodeManager = new NodeManager(this._config);
    await this.nodeManager.initialize();
    logger.info(`[${this.appName}] Chimera SDK initialized`);
  }

  /**
   * Record user consent.
   * Call this from your UI after the user agrees to mining.
   */
  giveConsent() {
    this.userConsent = true;
    logger.info(`[${this.appName}] User consent given`);
  }

  revokeConsent() {
    this.userConsent = false;
    logger.info(`[${this.appName}] User consent revoked`);
  }

  hasConsent() {
    return this.userConsent;
  }

  /**
   * Start mining.
   * Requires user consent. Fails silently if no consent.
   */
  async start() {
    if (!this.nodeManager) throw new Error('SDK not initialized. Call init() first.');
    if (!this.userConsent) {
      logger.warn(`[${this.appName}] Cannot start: user consent required`);
      return { success: false, error: 'User consent required' };
    }
    await this.nodeManager.start();
    logger.info(`[${this.appName}] Mining started`);
    return { success: true, running: true };
  }

  /**
   * Stop mining.
   */
  async stop() {
    if (!this.nodeManager) throw new Error('SDK not initialized. Call init() first.');
    await this.nodeManager.stop();
    logger.info(`[${this.appName}] Mining stopped`);
    return { success: true, running: false };
  }

  /**
   * Get current status.
   */
  status() {
    if (!this.nodeManager) return { initialized: false };
    const s = this.nodeManager.getStatus();
    return {
      initialized: true,
      appName: this.appName,
      consent: this.userConsent,
      running: s.running,
      miners: s.mining?.minerStatus || {},
      machineOwnerEVM: this.machineOwnerEVM,
      appDeveloperEVM: this.appDeveloperEVM,
      revenueSplit: this.revenueSplit
    };
  }

  /**
   * Test all registered miners.
   */
  async testMiners() {
    if (!this.nodeManager?.minerManager) {
      throw new Error('Miner manager not available');
    }
    const mm = this.nodeManager.minerManager;
    const results = [];
    const testTask = { id: `test-${Date.now()}`, prompt: 'What is 2+2?', maxTokens: 32, temperature: 0.5 };
    for (const [name, miner] of mm.miners) {
      const started = Date.now();
      try {
        const result = await miner.onInferenceTask(testTask);
        results.push({ miner: name, success: result.success, latency: Date.now() - started });
      } catch (err) {
        results.push({ miner: name, success: false, latency: Date.now() - started, error: err.message });
      }
    }
    return { tested: results.length, passed: results.filter(r => r.success).length, results };
  }

  /**
   * Graceful shutdown.
   */
  async shutdown() {
    if (this.nodeManager) {
      await this.nodeManager.stop();
      logger.info(`[${this.appName}] SDK shutdown complete`);
    }
  }
}
