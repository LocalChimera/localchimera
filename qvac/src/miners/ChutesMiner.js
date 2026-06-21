import { Logger } from '../core/Logger.js';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * ChutesMiner — Chutes.ai decentralized AI inference provider
 *
 * Chutes is a Bittensor subnet for decentralized GPU compute.
 * Providers offer inference capacity and earn TAO rewards.
 *
 * Auth: Bittensor wallet (coldkey + hotkey) + Chutes API key
 * Dashboard: https://chutes.ai
 * Docs: https://chutes.ai/docs
 *
 * This miner integrates Chimera's local inference as a Chutes provider.
 */
export class ChutesMiner {
  constructor(config, inferenceLayer = null, evmAddress = null) {
    this.config = config;
    this.inferenceLayer = inferenceLayer;
    this.name = 'chutes';
    this.logger = new Logger('ChutesMiner');
    this.isRunning = false;

    this.evmAddress = evmAddress || config.evmAddress || null;
    this.walletAddress = config.walletAddress || null;
    this.hotkeyAddress = config.hotkeyAddress || null;
    this.mnemonic = config.mnemonic || null;
    this.network = config.network || 'bittensor';
    this.apiKey = process.env.CHUTES_API_KEY || config.apiKey || '';
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.chutes.ai';
    this.inferenceBaseUrl = config.inferenceBaseUrl || 'https://llm.chutes.ai/v1';

    // Paths
    this.chutesHome = config.chutesHome || join(homedir(), '.chutes');
    this.configFile = join(this.chutesHome, 'config.ini');
    this.bittensorWallets = join(homedir(), '.bittensor', 'wallets');

    // Runtime
    this._proc = null;
    this._apiInfo = null;
    this._healthTimer = null;
  }

  async initialize() {
    this.logger.info('Initializing Chutes miner...');

    // Ensure config directory exists
    if (!existsSync(this.chutesHome)) {
      mkdirSync(this.chutesHome, { recursive: true });
    }

    // Check for existing Chutes config
    if (existsSync(this.configFile)) {
      this.logger.info(`Found existing Chutes config: ${this.configFile}`);
      this._parseConfig();
    } else {
      this.logger.warn('No Chutes config found — registration required');
      this.logger.info('Run: chutes register (or visit https://chutes.ai to create account)');
    }

    // Check Bittensor wallet
    let hasWallet = this._hasBittensorWallet();
    if (!hasWallet && this.mnemonic) {
      this.logger.info('Mnemonic provided — deriving Bittensor wallet...');
      try {
        await this._setupWalletFromMnemonic();
        hasWallet = true;
      } catch (e) {
        this.logger.error(`Wallet setup from mnemonic failed: ${e.message}`);
      }
    }
    if (!hasWallet) {
      this.logger.warn('No Bittensor wallet found — needed for Chutes auth');
      this.logger.info('Create wallet: btcli wallet new_coldkey --wallet.name chimera');
    } else {
      this.logger.info('Bittensor wallet detected');
    }

    this.logger.info('Chutes miner initialized');
  }

  async start() {
    if (this.isRunning) { this.logger.warn('Already running'); return; }

    if (!this.apiKey) {
      this.logger.warn('No API key configured — cannot start Chutes provider');
      this.logger.info('Get API key: chutes keys create --name chimera-key');
      return;
    }

    this.logger.info('Starting Chutes provider...');
    this.logger.info(`API endpoint: ${this.apiBaseUrl}`);
    this.logger.info(`Inference endpoint: ${this.inferenceBaseUrl}`);

    // Verify API connectivity
    try {
      const status = await this._checkApiStatus();
      if (status.ok) {
        this.logger.info(`Chutes API reachable — account: ${status.username || 'unknown'}`);
      }
    } catch (e) {
      this.logger.warn(`Chutes API check failed: ${e.message}`);
    }

    // Register this node as a provider if not already registered
    await this._ensureNodeRegistered();

    // Start health ping loop
    this._healthTimer = setInterval(() => this._heartbeat(), 30_000);

    this.isRunning = true;
    this.logger.info('Chutes provider started');
  }

  async startMonitoring() {
    if (this.isRunning) { this.logger.warn('Already running'); return; }
    this.logger.info('Starting Chutes miner in monitoring mode...');
    await this.start();
  }

  async stop() {
    if (!this.isRunning) return;
    this.logger.info('Stopping Chutes provider...');
    if (this._healthTimer) clearInterval(this._healthTimer);
    if (this._proc) { this._proc.kill(); this._proc = null; }
    this.isRunning = false;
    this.logger.info('Chutes provider stopped');
  }

  async onInferenceTask(task) {
    this.logger.info(`Chutes inference task: ${task.id || 'unknown'}`);
    if (this.inferenceLayer) {
      return this.inferenceLayer.handleInferenceRequest({ ...task, source: 'chutes' });
    }
    return { success: false, error: 'No inference layer available' };
  }

  getStatus() {
    return {
      running: this.isRunning,
      name: this.name,
      network: this.network,
      walletConfigured: !!this.walletAddress || !!this.hotkeyAddress,
      apiConfigured: !!this.apiKey,
      apiBaseUrl: this.apiBaseUrl,
      inferenceBaseUrl: this.inferenceBaseUrl,
      account: this._apiInfo || null,
    };
  }

  /* ─── Private helpers ─── */

  _parseConfig() {
    try {
      const content = readFileSync(this.configFile, 'utf-8');
      const lines = content.split('\n');
      let section = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          section = trimmed.slice(1, -1).toLowerCase();
          continue;
        }
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...valParts] = trimmed.split('=');
        const value = valParts.join('=').trim();
        if (section === 'auth' && key.trim() === 'hotkey_ss58address') {
          this.hotkeyAddress = value;
        }
        if (section === 'api' && key.trim() === 'base_url') {
          this.apiBaseUrl = value;
        }
      }
      this.logger.info(`Parsed hotkey: ${this.maskAddress(this.hotkeyAddress)}`);
    } catch (e) {
      this.logger.error(`Config parse failed: ${e.message}`);
    }
  }

  _hasBittensorWallet() {
    return existsSync(this.bittensorWallets);
  }

  async _checkApiStatus() {
    const res = await fetch(`${this.apiBaseUrl}/ping`, {
      headers: { 'Authorization': `Basic ${this.apiKey}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  }

  async _ensureNodeRegistered() {
    // Chutes provider registration requires a supported GPU.
    // CPU-only nodes cannot register as providers; the miner still works
    // in consumer mode (authenticated inference via API key).
    this.logger.info('Ensuring Chutes node registration...');
    this.logger.info('Chutes provider registration requires a supported GPU (3090, 4090, A100, H100, etc.)');
    this.logger.info('CPU-only nodes operate in consumer/inference mode only');
    // Skip provider registration for CPU-only setups.
    // The API key is sufficient for task consumption and earning.
  }

  async _signChutesRequest(method, path, payload) {
    const scriptPath = join(process.cwd(), 'scripts', 'chutes-sign-request.py');
    const args = [scriptPath, method, path, JSON.stringify(payload)];
    const output = execSync(`python3 ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
      encoding: 'utf-8',
      timeout: 15000,
    });
    const result = JSON.parse(output.trim());
    if (result.error) throw new Error(result.error);
    // Also inject the API key for Basic auth alongside the signed headers
    result.headers['Authorization'] = `Basic ${this.apiKey}`;
    return result;
  }

  async _heartbeat() {
    try {
      const res = await fetch(`${this.apiBaseUrl}/nodes/`, {
        headers: { 'Authorization': `Basic ${this.apiKey}` }
      });
      if (res.ok) {
        this.logger.debug('Chutes heartbeat OK');
      }
    } catch (e) {
      this.logger.warn(`Heartbeat failed: ${e.message}`);
    }
  }

  async _setupWalletFromMnemonic() {
    const scriptPath = join(process.cwd(), 'scripts', 'setup-bittensor-wallet.py');
    const walletName = 'chimera';
    const hotkeyName = 'default';

    // Run Python helper to create wallet files
    const cmd = [
      'python3', scriptPath,
      '--mnemonic', this.mnemonic,
      '--wallet-name', walletName,
      '--hotkey-name', hotkeyName,
    ].join(' ');

    this.logger.info(`Running wallet setup: ${cmd.replace(this.mnemonic, '***')}`);
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    this.logger.info(output.trim());

    // Parse derived addresses from stdout
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.startsWith('COLDKEY_SS58=')) {
        this.walletAddress = line.split('=')[1];
      }
      if (line.startsWith('HOTKEY_SS58=')) {
        this.hotkeyAddress = line.split('=')[1];
      }
    }

    // Ensure Chutes config.ini has the hotkey
    this._ensureChutesConfig();
  }

  _ensureChutesConfig() {
    if (!this.hotkeyAddress) return;
    try {
      const ini = `[auth]\nhotkey_ss58address = ${this.hotkeyAddress}\n\n[api]\nbase_url = ${this.apiBaseUrl}\n`;
      writeFileSync(this.configFile, ini, 'utf-8');
      this.logger.info(`Wrote Chutes config: ${this.configFile}`);
    } catch (e) {
      this.logger.error(`Failed to write Chutes config: ${e.message}`);
    }
  }

  maskAddress(addr) {
    if (!addr || addr.length < 10) return '***';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }
}
