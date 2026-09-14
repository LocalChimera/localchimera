import { Logger } from '../core/Logger.js';
import { CreateMLCEngine, preloadApp } from '@mlc-ai/web-llm';

/**
 * QVACInferenceLayer — unified inference backend using @mlc-ai/web-llm.
 *
 * Uses @mlc-ai/web-llm (Apache-2.0) for in-browser/Node LLM inference.
 * Supports model hot-swapping with a small cache for multiple models.
 */
export class QVACInferenceLayer {
  constructor(config, taskMonitor = null, audit = null) {
    this.config = config;
    this.taskMonitor = taskMonitor;
    this.audit = audit;
    this.logger = new Logger('QVACInference');
    this.activeRequests = new Map();
    this.lastActivity = Date.now();
    this.isRunning = false;
    this.modelId = null;
    this._loading = null;
    this._activityTimer = null;
    // New: injected modules
    this._queue = null;
    this._promptGuard = null;
    this._promptBudgeter = null;
    this._proofOfInference = null;
    this._tokenMeter = null;
    this._circuitBreaker = null;
    // Model hot-swapping: track loaded model name and support switching
    this._loadedModelName = null;
    this._modelCache = new Map(); // modelName -> modelId
    this._maxCachedModels = 2;
  }

  setQueue(queue) { this._queue = queue; }
  setPromptGuard(guard) { this._promptGuard = guard; }
  setPromptBudgeter(budgeter) { this._promptBudgeter = budgeter; }
  setProofOfInference(poi) { this._proofOfInference = poi; }
  setTokenMeter(meter) { this._tokenMeter = meter; }
  setCircuitBreaker(cb) { this._circuitBreaker = cb; }

  async initialize() {
    this.logger.info('Initializing QVAC inference layer...');
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

  async _ensureModel(requestedModel = null) {
    const targetModel = requestedModel || this.config?.qvac?.models?.[0] || 'llama-3.2-1b-instruct';

    // If we have the right model loaded, return it
    if (this.modelId && this._loadedModelName === targetModel) return this.modelId;

    // Check cache
    if (this._modelCache.has(targetModel)) {
      this.modelId = this._modelCache.get(targetModel);
      this._loadedModelName = targetModel;
      this.logger.info(`Switched to cached model: ${targetModel}`);
      return this.modelId;
    }

    // Need to load a new model (hot-swap)
    return this._loadModel(targetModel);
  }

  async _loadModel(targetModel) {
    if (this._loading) return this._loading;

    this._loading = (async () => {
      this.logger.info(`Loading model for inference layer: ${targetModel}`);

      // Hot-swap: unload previous model if we're at cache capacity
      if (this._modelCache.size >= this._maxCachedModels && this.modelId) {
        const oldModel = this._loadedModelName;
        this.logger.info(`Hot-swap: unloading ${oldModel} to make room for ${targetModel}`);
        try {
          const oldEngine = this._modelCache.get(oldModel);
          if (oldEngine?.unload) await oldEngine.unload();
        } catch {}
        this._modelCache.delete(oldModel);
        if (this.audit) this.audit.modelUnload({ modelId: this.modelId, source: 'hot-swap' });
      }

      const engine = await CreateMLCEngine(
        targetModel,
        { initProgressCallback: (p) => {
          if (Math.round((p.progress || 0) * 100) % 10 === 0)
            this.logger.info(`Model load: ${Math.round((p.progress || 0) * 100)}%`);
        }}
      );

      this.modelId = targetModel;
      this._loadedModelName = targetModel;
      this._modelCache.set(targetModel, engine);
      this.logger.info(`Model ready: ${targetModel}`);
      if (this.audit) this.audit.modelLoad({ modelId: targetModel, durationMs: 0, source: 'inference-layer' });
      return targetModel;
    })();

    try { await this._loading; } finally { this._loading = null; }
    return this.modelId;
  }

  /**
   * Explicitly switch to a different model (hot-swap).
   */
  async switchModel(modelName) {
    this.logger.info(`Hot-swap requested: ${this._loadedModelName} → ${modelName}`);
    return this._ensureModel(modelName);
  }

  /**
   * Get the currently loaded model name.
   */
  getLoadedModelName() {
    return this._loadedModelName;
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

    // Token meter: check spend cap before running inference
    if (this._tokenMeter) {
      const promptTokens = Math.ceil((request.prompt || request.input || '').length / 4);
      const meterResult = this._tokenMeter.meter(request.source || requestId, { promptTokens: 0 });
      if (!meterResult.allowed) {
        this.logger.warn(`Inference blocked by token meter: ${meterResult.reason}`);
        this.activeRequests.delete(requestId);
        if (this.taskMonitor) this.taskMonitor.completeTask(requestId);
        return {
          requestId,
          model: this.config?.qvac?.models?.[0] || 'default',
          output: '',
          latency: 0,
          source: request.source,
          success: false,
          error: meterResult.reason,
          blocked: true,
        };
      }
    }

    // Use inference queue for serialized execution if available
    const runInference = () => this._executeInference(request, requestId);
    const result = this._queue
      ? await this._queue.enqueueWithTimeout(runInference, this.config?.timeout || 300000)
      : await runInference();

    if (this.taskMonitor) this.taskMonitor.completeTask(requestId);
    this.activeRequests.delete(requestId);

    // Audit log the inference call
    if (this.audit) {
      const prompt = request.prompt || request.input || '';
      const tokens = result.output ? Math.ceil(result.output.length / 4) : 0;
      this.audit.inference({
        prompt,
        outputTokens: tokens,
        durationMs: result.latency || 0,
        ttftMs: result.ttftMs || 0,
        tokensPerSec: result.tokensPerSec || 0,
        modelId: result.model || 'default',
        source: request.source || 'unknown',
        routeId: requestId
      });
    }

    // Generate proof-of-inference receipt
    if (this._proofOfInference && result.success) {
      result.receipt = this._proofOfInference.generateReceipt({
        prompt: request.prompt || request.input || '',
        output: result.output || '',
        modelId: result.model || 'default',
        routeId: requestId,
        durationMs: result.latency || 0,
        tokensGenerated: result.output ? Math.ceil(result.output.length / 4) : 0,
      });
    }

    // Meter completion tokens
    if (this._tokenMeter && result.success) {
      const completionTokens = result.output ? Math.ceil(result.output.length / 4) : 0;
      this._tokenMeter.meter(request.source || requestId, { completionTokens });
    }

    return result;
  }

  async _executeInference(request, requestId) {
    let result;
    try {
      if (this.modelId) {
        result = await this._runQVAC(request, requestId);
      } else {
        result = this._fallback(request, requestId);
      }
    } catch (error) {
      this.logger.error(`Inference failed for ${requestId}: ${error.message}`);
      result = this._fallback(request, requestId);
    }
    return result;
  }

  async _runQVAC(request, requestId) {
    const systemPrompt = request.systemPrompt || 'You are a helpful AI assistant.';
    const userPrompt = request.prompt || request.input || JSON.stringify(request);

    // Use PromptGuard to fence untrusted content and detect injection
    let history;
    let injectionSuspected = false;
    if (this._promptGuard && request.documents) {
      const guarded = this._promptGuard.buildSafePrompt({
        systemPrompt,
        documents: request.documents,
        userQuery: userPrompt,
        history: request.history || [],
      });
      history = guarded.history;
      injectionSuspected = guarded.injectionSuspected;
    } else if (this._promptBudgeter && (request.documents || request.history)) {
      const budgeted = this._promptBudgeter.build({
        systemPrompt,
        documents: request.documents || [],
        history: request.history || [],
        userQuery: userPrompt,
      });
      history = budgeted.history;
    } else {
      history = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];
    }

    // Support per-request model selection (hot-swap)
    const requestedModel = request.model || null;
    const modelId = await this._ensureModel(requestedModel);

    const engine = this._modelCache.get(this._loadedModelName);
    if (!engine) throw new Error('No engine available');

    const reply = await engine.chat.completions.create({
      messages: history,
      stream: true,
      max_tokens: request.maxTokens || 512,
      temperature: request.temperature || 0.7,
    });

    let output = '';
    let ttftMs = 0;
    const inferenceStart = Date.now();
    let firstTokenTime = null;
    for await (const chunk of reply) {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now();
        ttftMs = firstTokenTime - inferenceStart;
        this.logger.debug(`TTFT: ${ttftMs}ms for ${requestId}`);
      }
      output += chunk.choices[0]?.delta?.content || '';
    }

    const latency = Date.now() - (this.activeRequests.get(requestId)?.start || Date.now());
    const tokensGenerated = output ? Math.ceil(output.length / 4) : 0;
    const tokensPerSec = tokensGenerated > 0 && latency > 0 ? (tokensGenerated / (latency / 1000)).toFixed(1) : 0;

    return {
      requestId,
      model: this._loadedModelName || this.config?.qvac?.models?.[0] || 'default',
      output: output.trim(),
      latency,
      ttftMs,
      tokensGenerated,
      tokensPerSec: parseFloat(tokensPerSec),
      source: request.source,
      success: true,
      injectionSuspected,
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
      qvacAvailable: !!this.modelId,
      modelLoaded: !!this.modelId,
      queue: this._queue?.getStats() || null,
      promptGuard: this._promptGuard?.getStats() || null,
      promptBudgeter: this._promptBudgeter?.getStatus() || null,
      proofOfInference: this._proofOfInference?.getStatus() || null,
      tokenMeter: this._tokenMeter?.getStatus() || null,
    };
  }
}
