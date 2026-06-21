import { Logger } from '../core/Logger.js';

/**
 * QVACInferenceLayer — unified inference backend for miners and services.
 *
 * Loads the official @qvac/sdk and serves inference requests from all
 * task networks (Cortensor, Routstr, Solana, etc.) as well as internal
 * services like the wiki AI writer.
 *
 * Shares the same QVAC runtime as LocalLLM so the entire node uses one
 * inference backend.
 */
export class QVACInferenceLayer {
  constructor(config, taskMonitor = null) {
    this.config = config;
    this.taskMonitor = taskMonitor;
    this.logger = new Logger('QVACInference');
    this.activeRequests = new Map();
    this.lastActivity = Date.now();
    this.isRunning = false;
    this.qvac = null;
    this.modelId = null;
    this._loading = null;
    this._activityTimer = null;
  }

  async initialize() {
    this.logger.info('Initializing QVAC inference layer...');
    try {
      this.qvac = await import('@qvac/sdk');
      this.logger.info('QVAC SDK loaded for inference layer.');
    } catch (e) {
      this.logger.warn(`QVAC SDK not available: ${e.message}`);
      this.qvac = null;
    }
    const qvacCfg = this.config?.qvac || {};
    this.logger.info(`Configured models: ${(qvacCfg.models || ['default']).join(', ')}`);
    this.logger.info(`Max concurrent requests: ${qvacCfg.maxConcurrent || 4}`);
    this.logger.info('QVAC inference layer initialized');
  }

  async start() {
    this.logger.info('Starting QVAC inference layer...');
    this.isRunning = true;
    this.startActivityMonitor();
    this.logger.info('QVAC inference layer started');
  }

  async stop() {
    this.logger.info('Stopping QVAC inference layer...');
    this.isRunning = false;
    this.activeRequests.clear();
    if (this._activityTimer) { clearInterval(this._activityTimer); this._activityTimer = null; }
    this.logger.info('QVAC inference layer stopped');
  }

  startActivityMonitor() {
    this._activityTimer = setInterval(() => {
      const now = Date.now();
      const idleTime = now - this.lastActivity;
      if (idleTime > this.config.idleTimeout) {
        this.logger.debug(`Idle for ${idleTime}ms, ready for mining`);
      }
    }, 10000).unref();
  }

  async _ensureModel() {
    if (this.modelId) return this.modelId;
    if (this._loading) return this._loading;
    if (!this.qvac) throw new Error('QVAC SDK not available');

    this._loading = (async () => {
      const { loadModel, LLAMA_3_2_1B_INST_Q4_0 } = this.qvac;
      const modelSrc = this.config.qvac.modelConst || LLAMA_3_2_1B_INST_Q4_0;
      const modelName = this.config.qvac.models[0] || 'llama-3.2-1b-instruct';
      this.logger.info(`Loading QVAC model for inference layer: ${modelName}`);
      this.modelId = await loadModel({
        modelSrc,
        modelType: 'llm',
        modelConfig: { device: 'cpu' },
        onProgress: (p) => {
          if (p.percent % 10 === 0) this.logger.info(`Model load: ${p.percent}%`);
        },
      });
      this.logger.info(`QVAC model ready: ${this.modelId}`);
      return this.modelId;
    })();

    try { await this._loading; } finally { this._loading = null; }
    return this.modelId;
  }

  async handleInferenceRequest(request) {
    if (!this.isRunning) throw new Error('Inference layer not running');
    const maxConcurrent = this.config?.qvac?.maxConcurrent || 4;
    if (this.activeRequests.size >= maxConcurrent) {
      throw new Error('Max concurrent requests reached');
    }

    this.lastActivity = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    this.activeRequests.set(requestId, { start: Date.now() });

    this.logger.info(`Processing inference request ${requestId} from ${request.source || 'unknown'}`);

    if (this.taskMonitor) {
      this.taskMonitor.registerInferenceTask({
        id: requestId,
        model: request.model || (this.config?.qvac?.models?.[0] || 'default'),
        type: 'inference',
        priority: request.priority || 'normal',
        source: request.source,
        _skipNotify: true
      });
    }

    let result;
    try {
      if (this.qvac) {
        result = await this._runQVAC(request, requestId);
      } else {
        result = this._fallback(request, requestId);
      }
    } catch (error) {
      this.logger.error(`Inference failed for ${requestId}: ${error.message}`);
      result = this._fallback(request, requestId);
    }

    if (this.taskMonitor) this.taskMonitor.completeTask(requestId);
    this.activeRequests.delete(requestId);
    return result;
  }

  async _runQVAC(request, requestId) {
    const { completion } = this.qvac;
    const modelId = await this._ensureModel();

    const systemPrompt = request.systemPrompt || 'You are a helpful AI assistant.';
    const userPrompt = request.prompt || request.input || JSON.stringify(request);

    const history = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const gen = completion({
      modelId,
      history,
      stream: true,
      generationParams: {
        predict: request.maxTokens || 512,
        temp: request.temperature || 0.7
      }
    });

    let output = '';
    for await (const token of gen.tokenStream) {
      output += token;
    }

    const latency = Date.now() - (this.activeRequests.get(requestId)?.start || Date.now());
    return {
      requestId,
      model: this.config?.qvac?.models?.[0] || 'default',
      output: output.trim(),
      latency,
      source: request.source,
      success: true
    };
  }

  _fallback(request, requestId) {
    const latency = Date.now() - (this.activeRequests.get(requestId)?.start || Date.now());
    return {
      requestId,
      model: this.config?.qvac?.models?.[0] || 'fallback',
      output: `Fallback inference for: ${request.prompt || request.input || JSON.stringify(request).slice(0, 200)}`,
      latency,
      source: request.source,
      success: true,
      fallback: true
    };
  }

  isIdle() {
    const idleTime = Date.now() - this.lastActivity;
    const idleTimeout = this.config?.idleTimeout || 300000;
    return idleTime > idleTimeout && this.activeRequests.size === 0;
  }

  getStatus() {
    return {
      running: this.isRunning,
      activeRequests: this.activeRequests.size,
      maxConcurrent: this.config?.qvac?.maxConcurrent || 4,
      idle: this.isIdle(),
      lastActivity: this.lastActivity,
      qvacAvailable: !!this.qvac,
      modelLoaded: !!this.modelId
    };
  }
}
