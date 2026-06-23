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
import { AkashProvider } from './miners/AkashProvider.js';
import { TargonProvider } from './miners/TargonProvider.js';
import { KeyringManager } from './miners/KeyringManager.js';
import { WalletSetup } from './miners/WalletSetup.js';

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
    this.externalProviders = [];
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

    // Auto-setup external providers (Akash, Targon)
    // Keys are NEVER stored in the SDK — we only reference OS-level keyring names.
    await this._initExternalProviders();

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
   * Onboard a new machine — recover wallets so it contributes resources
   * and earnings flow to your address.
   *
   * Call this before init() on a brand-new machine.
   * Returns instructions if credentials are missing.
   */
  async onboard() {
    const result = await WalletSetup.onboardNewMachine();
    const missing = [];

    if (!result.akash.exists) {
      missing.push({
        network: 'akash',
        instruction: 'Run: provider-services keys add mykey --recover (type your mnemonic interactively)'
      });
    }

    if (!result.targon.exists) {
      missing.push({
        network: 'targon',
        instruction: 'Use WalletSetup.recoverTargon(mnemonic) or targon-cli config to write ~/.config/.targon.json'
      });
    }

    if (missing.length > 0) {
      logger.warn(`[${this.appName}] New machine onboarding incomplete — ${missing.length} wallets missing`);
      return { ready: false, missing, details: result };
    }

    logger.info(`[${this.appName}] New machine onboarded — all wallets present`);
    return { ready: true, details: result };
  }

  /**
   * Initialize external providers (Akash, Targon) by key reference only.
   * Private keys live in OS keyrings / user config files, never in SDK code.
   */
  async _initExternalProviders() {
    const keyStatus = await KeyringManager.status();

    if (keyStatus.akash.kubeconfig) {
      try {
        const akash = new AkashProvider();
        await akash.init();
        this.externalProviders.push(akash);
        logger.info(`[${this.appName}] Akash provider ready (key: ${keyStatus.akash.keyName})`);
      } catch (err) {
        logger.warn(`[${this.appName}] Akash provider init failed: ${err.message}`);
      }
    }

    if (keyStatus.targon.exists) {
      try {
        const targon = new TargonProvider();
        await targon.init();
        this.externalProviders.push(targon);
        logger.info(`[${this.appName}] Targon provider ready (config: ~/.config/.targon.json)`);
      } catch (err) {
        logger.warn(`[${this.appName}] Targon provider init failed: ${err.message}`);
      }
    }
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

    // Start external providers (Akash, Targon)
    const providerResults = [];
    for (const p of this.externalProviders) {
      try {
        const r = await p.start();
        providerResults.push(r);
      } catch (err) {
        providerResults.push({ success: false, provider: p.constructor.name, error: err.message });
      }
    }

    logger.info(`[${this.appName}] Mining started (${providerResults.length} external providers)`);
    return { success: true, running: true, providers: providerResults };
  }

  /**
   * Stop mining.
   */
  async stop() {
    if (!this.nodeManager) throw new Error('SDK not initialized. Call init() first.');
    await this.nodeManager.stop();

    // Stop external providers
    for (const p of this.externalProviders) {
      try { await p.stop(); } catch (err) {}
    }

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
      externalProviders: this.externalProviders.map(p => p.status()),
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
    for (const p of this.externalProviders) {
      try { await p.stop(); } catch (err) {}
    }
    if (this.nodeManager) {
      await this.nodeManager.stop();
      logger.info(`[${this.appName}] SDK shutdown complete`);
    }
  }
}
