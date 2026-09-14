/**
 * Chimera SDK
 * Tasking network provider SDK — integrate decentralized compute, storage,
 * bandwidth, and inference mining into your app.
 *
 * Runs exclusively inside a hardened privacy container. No inline mode.
 * The container enforces: random hostname/MAC, bridge networking, cap-drop ALL,
 * no-new-privileges, named volumes, CHIMERA_PRIVACY_MODE=true.
 * All provider binaries run as processes inside the single container.
 *
 * Payout model:
 *   - All tasking network providers mine into the Chimera protocol multisig.
 *   - Individual Web3Auth wallet addresses are NOT used by providers directly.
 *   - A monthly sweep from the protocol multisig distributes funds to
 *     machine owner and app developer Web3Auth wallets based on revenue split.
 */

import { Logger } from './core/Logger.js';
import { ResourceMonitor } from './core/resource-monitor.js';
import { PrivacyContainer } from './runtime/PrivacyContainer.js';
import { GenericProcessProvider } from './miners/GenericProcessProvider.js';
import { BtfsStorageProvider } from './miners/BtfsStorageProvider.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const logger = new Logger('ChimeraSDK');

// Chimera protocol EVM multisig — all tasking network rewards flow here.
// Individual Web3Auth wallets receive funds only via the monthly sweep.
const PROTOCOL_MULTISIG = '0x7eB4A545F875FC1Da252661d31a3e28e67bf723f';

function _maskAddress(addr) {
  if (!addr || addr.length < 10) return '***';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * ChimeraSDK — tasking network provider orchestrator.
 *
 * Runs all providers inside a hardened privacy container. Docker is required.
 *
 * Usage:
 *   import { ChimeraSDK } from '@localchimera/sdk';
 *   const sdk = new ChimeraSDK({
 *     appName: 'MyApp',
 *     appDeveloperEVM: '0x...',
 *     revenueSplit: { integrator: 0.30, machineOwner: 0.70 }
 *   });
 *   await sdk.init();     // prepares the hardened container
 *   sdk.giveConsent();
 *   await sdk.start();    // launches container + all providers
 *   await sdk.stop();     // stops container + all providers
 *   const status = sdk.status();
 */
export class ChimeraSDK {
  constructor(opts = {}) {
    this.appName = opts.appName || 'unknown-app';
    this.machineOwnerEVM = opts.machineOwnerEVM || null;  // Web3Auth wallet — receives monthly sweep
    this.appDeveloperEVM = opts.appDeveloperEVM || null;    // Web3Auth wallet — receives monthly sweep
    this.revenueSplit = opts.revenueSplit || { machineOwner: 0.70, appDeveloper: 0.30 };
    this.protocolMultisig = opts.protocolMultisig || null;  // EVM multisig — all mining rewards go here
    this.configPath = opts.configPath || path.join(process.cwd(), 'config.json');
    this.signer = opts.signer || null;
    this.userConsent = false;
    this._config = null;
    this.externalProviders = [];
    this.container = null;
    this.containerImage = opts.containerImage || process.env.CHIMERA_IMAGE || 'chimera:latest';
    this.containerPort = opts.containerPort || Number(process.env.CHIMERA_PORT) || 3002;
    this.containerConfigPath = opts.containerConfigPath || null;
    this.storj = opts.storj || null; // Storj storage node provider config
    this.resourceMonitor = new ResourceMonitor(opts.resourceThresholds || {});
    this._providersPaused = false;
  }

  /**
   * Load config and prepare the hardened privacy container.
   * Throws if Docker is not available — container mode is required.
   */
  async init() {
    if (!PrivacyContainer.dockerAvailable()) {
      throw new Error('Docker is required. The SDK runs exclusively in a hardened privacy container.');
    }

    const raw = await fs.readFile(this.configPath, 'utf-8');
    this._config = JSON.parse(raw);

    if (this.machineOwnerEVM) {
      this._config.multisig = this._config.multisig || {};
      this._config.multisig.machineOwnerAddress = this.machineOwnerEVM;
      logger.info(`[${this.appName}] Machine owner Web3Auth wallet (monthly sweep target): ${_maskAddress(this.machineOwnerEVM)}`);
    }
    if (this.appDeveloperEVM) {
      this._config.multisig = this._config.multisig || {};
      this._config.multisig.appDeveloperAddress = this.appDeveloperEVM;
      this._config.multisig.revenueSplit = this.revenueSplit;
      logger.info(`[${this.appName}] App developer Web3Auth wallet (monthly sweep target): ${_maskAddress(this.appDeveloperEVM)}`);
      logger.info(`[${this.appName}] Revenue split — machine owner: ${(this.revenueSplit.machineOwner * 100).toFixed(0)}%, app developer: ${(this.revenueSplit.appDeveloper * 100).toFixed(0)}%`);
    }

    // Set the protocol multisig — all providers mine into this address.
    // Individual Web3Auth wallets are NOT passed to providers.
    const multisig = this.protocolMultisig || this._config?.multisig?.protocolAddress || PROTOCOL_MULTISIG;
    this._config.protocolMultisig = multisig;
    logger.info(`[${this.appName}] Protocol multisig (all mining rewards): ${_maskAddress(multisig)}`);
    logger.info(`[${this.appName}] Monthly sweep: multisig → machine owner + app developer Web3Auth wallets`);

    // Disable local auth so the SDK can drive the container API without tokens.
    this._config.auth = this._config.auth || {};
    this._config.auth.required = false;

    // Enable privacy mode inside the container.
    this._config.node = this._config.node || {};
    this._config.node.privacyMode = true;
    this._config.node.anonymizeId = true;

    const configPath = this.containerConfigPath || await this._writeContainerConfig();
    this.container = new PrivacyContainer({
      appName: this.appName,
      configPath,
      image: this.containerImage,
      hostPort: this.containerPort,
      containerPort: this.containerPort,
      enableDocker: !!this.storj, // Docker-managed providers need the host socket
    });
    await this.container.prepare();

    // Initialize providers that run inside the container
    await this._initExternalProviders();

    logger.info(`[${this.appName}] Chimera SDK initialized — hardened container ready (${this.containerImage})`);
  }

  async _writeContainerConfig() {
    const configDir = path.join(os.homedir(), '.chimera', 'sdk-configs');
    await fs.mkdir(configDir, { recursive: true });
    const safeName = String(this.appName).toLowerCase().replace(/[^a-z0-9]/g, '') || 'default';
    const configPath = path.join(configDir, `${safeName}-config.json`);
    await fs.writeFile(configPath, JSON.stringify(this._config, null, 2), 'utf-8');
    return configPath;
  }

  /**
   * Record user consent.
   */
  async giveConsent() {
    this.userConsent = true;
    logger.info(`[${this.appName}] User consent given`);
    if (this.container?.appUrl) {
      try {
        await fetch(`${this.container.appUrl}/api/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accepted: true }),
        });
      } catch (e) {}
    }
  }

  async revokeConsent() {
    this.userConsent = false;
    logger.info(`[${this.appName}] User consent revoked`);
    if (this.container?.appUrl) {
      try {
        await fetch(`${this.container.appUrl}/api/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accepted: false }),
        });
      } catch (e) {}
    }
  }

  hasConsent() {
    return this.userConsent;
  }

  /**
   * Initialize tasking network providers.
   *
   * All providers run inside the hardened container with CHIMERA_PRIVACY_MODE=true.
   * Each provider spawns its binary directly (no Docker-in-Docker).
   *
   * Networks: Golem, Mysterium, Anyone Protocol, BTFS, BTT AI.
   * All providers run inline and mine into the protocol multisig.
   */
  async _initExternalProviders() {
    const multisig = this._config?.protocolMultisig || PROTOCOL_MULTISIG;

    const PROVIDER_DEFS = {
      bttai: { mode: 'process', binary: 'miner-cli', dockerImage: 'bttai/miner-cli:latest', evmAddress: multisig },
      golem: { mode: 'process', binary: 'yagna', dockerImage: 'golemprovider/golem-provider:latest', evmAddress: multisig },
      anyone: { mode: 'process', binary: 'anyone-relay', dockerImage: 'anyoneprotocol/relay:latest', evmAddress: multisig },
      mysterium: { mode: 'process', binary: 'myst', dockerImage: 'mysteriumnetwork/myst:latest', evmAddress: multisig },
    };

    for (const [name, def] of Object.entries(PROVIDER_DEFS)) {
      try {
        const provider = new GenericProcessProvider(name, def);
        await provider.init();
        this.externalProviders.push(provider);
        logger.info(`[${this.appName}] ${name} provider ready`);
      } catch (err) {
        logger.warn(`[${this.appName}] ${name} init failed: ${err.message}`);
      }
    }

    // BTFS has its own complex provider class (daemon, RPC, on-chain jobs)
    try {
      const btfsProvider = new BtfsStorageProvider({
        apiUrl: this._config?.btfs?.apiUrl || null,
        repoPath: this._config?.btfs?.repoPath || null,
        relayUrl: this._config?.btfs?.relayUrl || null,
        relayToken: this._config?.btfs?.relayToken || null,
        providerAccountHash: this._config?.btfs?.protocolWallet || this._config?.btfs?.providerAccountHash || null,
        rpcUrl: this._config?.btfs?.rpcUrl || null,
        signer: this.signer,
      });
      await btfsProvider.init();
      this.externalProviders.push(btfsProvider);
      logger.info(`[${this.appName}] BTFS walletless storage provider ready`);
    } catch (err) {
      logger.warn(`[${this.appName}] BTFS storage provider init failed: ${err.message}`);
    }

    // Storj decentralized storage node
    if (this.storj) {
      try {
        const storj = new GenericProcessProvider('storj', {
          mode: 'process',
          binary: 'storagenode',
          dockerImage: 'storjlabs/storagenode:latest',
          wallet: this.storj.wallet || this._config?.storj?.wallet || multisig,
          dataDir: this.storj.dataDir || this._config?.storj?.dataDir || null,
          email: this.storj.email || this._config?.storj?.email || null,
          externalAddress: this.storj.externalAddress || this._config?.storj?.externalAddress || null,
          storage: this.storj.storage || this._config?.storj?.storage || null,
        });
        await storj.init();
        this.externalProviders.push(storj);
        logger.info(`[${this.appName}] Storj storage node provider ready`);
      } catch (err) {
        logger.warn(`[${this.appName}] Storj init failed: ${err.message}`);
      }
    }

  }

  /**
   * Start the hardened container and all tasking network providers.
   * Requires user consent.
   */
  async start() {
    if (!this.userConsent) {
      logger.warn(`[${this.appName}] Cannot start: user consent required`);
      return { success: false, error: 'User consent required' };
    }
    if (!this.container) throw new Error('SDK not initialized. Call init() first.');

    const started = await this.container.start();
    const result = await this.container.apiStart({
      protocolMultisig: this._config?.protocolMultisig || PROTOCOL_MULTISIG,
      machineOwnerEVM: this.machineOwnerEVM,  // for monthly sweep, NOT for provider payouts
      appDeveloperEVM: this.appDeveloperEVM,  // for monthly sweep, NOT for provider payouts
      revenueSplit: this.revenueSplit,
    });

    // Start all providers inside the container
    const providerResults = [];
    for (const p of this.externalProviders) {
      try {
        const r = await p.start();
        providerResults.push(r);
      } catch (err) {
        providerResults.push({ success: false, provider: p.constructor.name, error: err.message });
      }
    }

    logger.info(`[${this.appName}] Mining started in hardened container (${providerResults.length} providers)`);

    // Start resource monitoring — pauses providers if machine is under load
    await this.resourceMonitor.start();
    this.resourceMonitor.onEvent((event) => {
      if (event.type === 'throttle') {
        logger.warn(`[${this.appName}] Resource throttle: ${event.reason}. Pausing providers.`);
        this._pauseProviders();
      } else {
        logger.info(`[${this.appName}] ${event.reason}. Resuming providers.`);
        this._resumeProviders();
      }
    });

    return { success: true, running: true, container: started, api: result, providers: providerResults };
  }

  /**
   * Stop the container and all providers.
   */
  async stop() {
    await this.resourceMonitor.stop();
    for (const p of this.externalProviders) {
      try { await p.stop(); } catch (err) {}
    }
    if (this.container) {
      try { await this.container.apiStop(); } catch (e) {}
      await this.container.stop();
    }
    logger.info(`[${this.appName}] Mining stopped`);
    return { success: true, running: false };
  }

  /**
   * Pause all providers without stopping the container.
   * Called automatically by ResourceMonitor when system is under load.
   */
  async _pauseProviders() {
    if (this._providersPaused) return;
    this._providersPaused = true;
    for (const p of this.externalProviders) {
      try { await p.stop(); } catch (err) {}
    }
    logger.info(`[${this.appName}] All providers paused (resource throttle)`);
  }

  /**
   * Resume all providers after a throttle event.
   */
  async _resumeProviders() {
    if (!this._providersPaused) return;
    this._providersPaused = false;
    for (const p of this.externalProviders) {
      try { await p.start(); } catch (err) {
        logger.warn(`[${this.appName}] Failed to resume provider: ${err.message}`);
      }
    }
    logger.info(`[${this.appName}] All providers resumed`);
  }

  /**
   * Get current status of the container and all providers.
   */
  status() {
    if (!this.container) return { initialized: false };
    const base = this.container.status();
    return {
      initialized: true,
      appName: this.appName,
      consent: this.userConsent,
      containerized: true,
      ...base,
      providers: this.externalProviders.map(p => p.status()),
      inference: {
        available: !!this.container?.appUrl,
        endpoint: this.container?.appUrl ? `${this.container.appUrl}/v1/chat/completions` : null,
        compatible: 'OpenAI-compatible',
        mode: 'hardened-container',
      },
      resources: this.resourceMonitor.getSnapshot(),
      providersPaused: this._providersPaused,
      protocolMultisig: _maskAddress(this._config?.protocolMultisig),
      machineOwnerEVM: this.machineOwnerEVM,  // Web3Auth wallet — monthly sweep target
      appDeveloperEVM: this.appDeveloperEVM,  // Web3Auth wallet — monthly sweep target
      revenueSplit: this.revenueSplit,
      payoutModel: 'protocol-multisig-monthly-sweep',
    };
  }

  /**
   * Fetch detailed status from the container API.
   */
  async containerStatus() {
    if (!this.container) return { containerized: false, status: this.status() };
    const base = this.container.status();
    let node = {};
    try {
      node = await this.container.apiStatus();
    } catch (e) {
      node = { error: e.message };
    }
    return { containerized: true, ...base, node };
  }

  /**
   * Test all providers.
   */
  async testProviders() {
    const results = [];
    for (const p of this.externalProviders) {
      const started = Date.now();
      try {
        const status = p.status();
        results.push({
          provider: status.provider || p.constructor.name,
          running: status.running,
          latency: Date.now() - started,
        });
      } catch (err) {
        results.push({
          provider: p.constructor.name,
          running: false,
          latency: Date.now() - started,
          error: err.message,
        });
      }
    }
    return { tested: results.length, active: results.filter(r => r.running).length, results };
  }

  // ─── Inference API Key Management ───

  /**
   * Create an inference API key.
   * The key can be shared with other apps/users to use the container's
   * OpenAI-compatible /v1/chat/completions endpoint.
   * The key contains no machine identity or personal info.
   *
   * @param {object} opts - { name, rateLimitRpm, modelAllowList }
   * @returns {object} - { id, key, name, keyPrefix, createdAt, ... }
   */
  async createInferenceKey(opts = {}) {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    const res = await fetch(`${this.container.appUrl}/api/inference-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * List all active inference API keys (metadata only — no raw keys returned).
   */
  async listInferenceKeys() {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    const res = await fetch(`${this.container.appUrl}/api/inference-keys`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Revoke an inference API key by ID.
   */
  async revokeInferenceKey(id) {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    const res = await fetch(`${this.container.appUrl}/api/inference-keys/${id}`, {
      method: 'DELETE',
    });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  // ─── Paid Inference Access ───

  /**
   * Purchase inference credits. Returns a temporary access token
   * with a token credit balance. No API key sharing required.
   *
   * @param {object} opts - { amountUSDT, ttlSeconds, modelAllowList, buyerAddress }
   * @returns {object} - { token, sessionId, credit, pricePerToken, expiresAt }
   */
  async purchaseInferenceAccess(opts = {}) {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    const res = await fetch(`${this.container.appUrl}/api/inference-access/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Get current pricing for inference access.
   */
  async getAccessPricing() {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    const res = await fetch(`${this.container.appUrl}/api/inference-access/pricing`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Get access session status by sessionId.
   */
  async getAccessStatus(sessionId) {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    const res = await fetch(`${this.container.appUrl}/api/inference-access/status?sessionId=${sessionId}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Revoke an access session by sessionId.
   */
  async revokeAccessSession(sessionId) {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    const res = await fetch(`${this.container.appUrl}/api/inference-access/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  // ─── Inference Endpoint ───

  /**
   * Get the inference endpoint URL and example usage.
   * The URL points to the container's local port — no host identity exposed.
   */
  getInferenceEndpoint() {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');
    return {
      url: `${this.container.appUrl}/v1/chat/completions`,
      modelsUrl: `${this.container.appUrl}/v1/models`,
      authHeader: 'Authorization: Bearer chim_... or chim_access_...',
      compatible: 'OpenAI-compatible',
      note: 'Create a key with createInferenceKey() or purchase access with purchaseInferenceAccess() and pass the token as a Bearer token',
    };
  }

  /**
   * Perform inference using the OpenAI-compatible endpoint.
   * Proxied through the hardened container.
   *
   * @param {object} params - { messages, model, maxTokens, temperature, stream, apiKey, accessToken }
   */
  async infer(params = {}) {
    if (!this.container?.appUrl) throw new Error('Container not running. Call init() and start() first.');

    const headers = { 'Content-Type': 'application/json' };
    const token = params.accessToken || params.apiKey;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const body = {
      messages: params.messages || [],
      model: params.model || 'chimera-local',
      max_tokens: params.maxTokens || 512,
      temperature: params.temperature || 0.7,
      stream: params.stream || false,
    };

    const res = await fetch(`${this.container.appUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (params.stream) {
      return res.body;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Graceful shutdown.
   */
  async shutdown() {
    for (const p of this.externalProviders) {
      try { await p.stop(); } catch (err) {}
    }
    if (this.container) {
      await this.container.stop();
    }
    logger.info(`[${this.appName}] SDK shutdown complete`);
  }
}
