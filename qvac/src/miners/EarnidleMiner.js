import { Logger } from '../core/Logger.js';

/**
 * EarnidleMiner — IDLE Inference Network worker
 *
 * Polls api.earnidle.com for inference jobs, runs them via the QVAC
 * inference layer (@qvac/sdk), and submits results for USDC payout.
 *
 * Payout wallet: Solana SPL token account (e.g. 4R5d...muQA)
 */
export class EarnidleMiner {
  constructor(config, inferenceLayer = null) {
    this.config = config;
    this.inferenceLayer = inferenceLayer;
    this.name = 'earnidle';
    this.logger = new Logger('EarnidleMiner');
    this.isRunning = false;
    this.walletAddress = config.walletAddress || null;
    this.network = config.network || 'solana';
    this.apiBase = config.apiBase || 'https://api.earnidle.com';
    this.model = config.model || 'llama-3.2-1b-instruct';
    this.nodeName = config.nodeName || 'QVAC-Chimera-Node';
    this.gpuAvailable = config.gpuAvailable || false;

    // Runtime counters
    this.jobsCompleted = 0;
    this.jobsFailed = 0;
    this.totalTokens = 0;
    this.earningsUSDC = 0;
    this._pollTimer = null;
    this._pollCount = 0;
  }

  async initialize() {
    this.logger.info('Initializing Earnidle (IDLE) inference worker...');

    if (this.walletAddress) {
      if (!this.validateWalletAddress(this.walletAddress)) {
        throw new Error('Invalid Solana wallet address format');
      }
      this.logger.info(`Payout wallet: ${this.maskAddress(this.walletAddress)}`);
    } else {
      this.logger.warn('No wallet configured — payouts disabled');
    }

    this.logger.info(`Model: ${this.model} | GPU: ${this.gpuAvailable}`);
    this.logger.info('Earnidle worker initialized');
  }

  validateWalletAddress(addr) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
  }

  maskAddress(addr) {
    if (!addr || addr.length < 10) return '***';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  async start() {
    if (this.isRunning) { this.logger.warn('Already running'); return; }
    this.logger.info('Starting IDLE inference worker...');
    this.isRunning = true;
    this._runLoop();
  }

  async startMonitoring() {
    if (this.isRunning) { this.logger.warn('Already running'); return; }
    this.logger.info('Starting IDLE worker...');
    this.isRunning = true;
    this._runLoop();
  }

  async stop() {
    if (!this.isRunning) return;
    this.logger.info('Stopping IDLE worker...');
    this.isRunning = false;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  }

  // ─── Main polling loop ───

  async _runLoop() {
    while (this.isRunning) {
      try {
        await this._pollAndRun();
      } catch (e) {
        this.logger.error(`Polling error: ${e.message}`);
      }
      this._pollCount++;
      if (this._pollCount % 10 === 0) {
        this.logger.info(`IDLE heartbeat: ${this._pollCount} polls, ${this.jobsCompleted} jobs, ${this.earningsUSDC.toFixed(4)} USDC`);
      }
      // IDLE recommends ~30s between polls
      await this._sleep(this.config.pollInterval || 30000);
    }
  }

  async _sleep(ms) {
    return new Promise(resolve => { this._pollTimer = setTimeout(resolve, ms).unref(); });
  }

  // ─── Poll for job, execute, submit ───

  async _pollAndRun() {
    if (!this.walletAddress) return;

    const pollUrl = `${this.apiBase}/api/inference/job?` +
      `node_id=${encodeURIComponent(this.walletAddress)}&` +
      `model=${encodeURIComponent(this.model)}`;

    let job = null;
    try {
      const res = await fetch(pollUrl, { headers: { 'Accept': 'application/json' } });
      if (res.status === 204) {
        this.logger.debug('IDLE poll: no jobs available (204)');
        return;
      }
      if (res.status === 404) {
        this.logger.warn(`IDLE poll: endpoint not found (404) — check apiBase config`);
        return;
      }
      if (!res.ok) {
        this.logger.warn(`IDLE poll: HTTP ${res.status}`);
        return;
      }
      job = await res.json();
    } catch (e) {
      this.logger.debug(`IDLE poll: network error (${e.message})`);
      return;
    }

    if (!job || !job.id) return;

    this.logger.info(`Job ${job.id.slice(0, 8)}… received | prompt: ${(job.prompt || '').slice(0, 60)}…`);

    // Run inference via QVAC SDK or inference layer
    const result = await this._runInference(job);

    // Submit result back to IDLE
    await this._submitResult(job.id, result);
  }

  async _runInference(job) {
    const prompt = job.prompt || job.messages?.map(m => m.content).join('\n') || '';
    const maxTokens = job.max_tokens || 256;
    const temperature = job.temperature || 0.7;

    try {
      if (this.inferenceLayer) {
        this.logger.info('Routing through QVAC inference layer');
        const out = await this.inferenceLayer.handleInferenceRequest({
          model: this.model,
          prompt,
          maxTokens,
          temperature,
          stream: false
        }, this.name);
        return {
          success: out.success,
          text: out.text || out.result || '',
          tokens: out.tokens || maxTokens
        };
      }

      // Fallback: direct QVAC SDK call if inferenceLayer unavailable
      this.logger.info('Using direct QVAC SDK inference');
      const qvac = await import('@qvac/sdk');
      const modelId = await qvac.loadModel({
        modelSrc: qvac.LLAMA_3_2_1B_INST_Q4_0,
        modelType: 'text',
        modelConfig: { device: 'cpu' }
      });
      const out = await qvac.complete({
        modelId,
        prompt,
        maxTokens,
        temperature,
        stream: false
      });
      return { success: true, text: out.text || '', tokens: out.tokens || maxTokens };
    } catch (e) {
      this.logger.error(`Inference failed: ${e.message}`);
      return { success: false, error: e.message, text: '', tokens: 0 };
    }
  }

  async _submitResult(jobId, result) {
    const submitUrl = `${this.apiBase}/api/inference/result`;
    const payload = {
      node_id: this.walletAddress,
      job_id: jobId,
      model: this.model,
      output: result.text || '',
      tokens: result.tokens || 0,
      success: result.success
    };

    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        this.jobsCompleted++;
        this.totalTokens += result.tokens || 0;
        this.earningsUSDC += data.usdcEarned || 0;
        this.logger.info(`Result submitted | earned ${data.usdcEarned || 0} USDC | total: ${this.earningsUSDC.toFixed(4)}`);
      } else {
        this.jobsFailed++;
        const text = await res.text();
        this.logger.warn(`Submit failed ${res.status}: ${text}`);
      }
    } catch (e) {
      this.jobsFailed++;
      this.logger.error(`Submit error: ${e.message}`);
    }
  }

  // ─── Status ───

  getStatus() {
    return {
      running: this.isRunning,
      name: this.name,
      nodeName: this.nodeName,
      walletConfigured: !!this.walletAddress,
      walletAddress: this.maskAddress(this.walletAddress),
      network: this.network,
      model: this.model,
      gpuAvailable: this.gpuAvailable,
      jobsCompleted: this.jobsCompleted,
      jobsFailed: this.jobsFailed,
      totalTokens: this.totalTokens,
      earningsUSDC: this.earningsUSDC
    };
  }
}
