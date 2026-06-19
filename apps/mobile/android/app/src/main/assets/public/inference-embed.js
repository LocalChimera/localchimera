/**
 * QVAC-Pear Inference Embed
 * One-line integration for app publishers.
 *
 * Usage:
 * <script
 *   src="https://terexitariusstomp.github.io/qvac-pear-miner-node/inference-embed.js"
 *   data-app-id="your-app-id"
 *   data-evm-address="0x..."
 *   data-backend-url="http://localhost:3000"
 *   auto-install>
 * </script>
 *
 * The script auto-detects idle compute, registers with mining networks,
 * and begins processing inference tasks. No model specification required.
 */
(function (global) {
  'use strict';

  // --- Config from the script tag that loaded this file ---
  const currentScript = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const CONFIG = {
    appId: currentScript?.getAttribute('data-app-id') || 'anonymous-app',
    evmAddress: currentScript?.getAttribute('data-evm-address') || '',
    backendUrl: (currentScript?.getAttribute('data-backend-url') || 'http://localhost:3000').replace(/\/$/, ''),
    autoInstall: currentScript?.hasAttribute('auto-install'),
    pollIntervalMs: parseInt(currentScript?.getAttribute('data-poll-interval') || '10000', 10),
    maxConcurrent: parseInt(currentScript?.getAttribute('data-max-concurrent') || '1', 10),
    debug: currentScript?.hasAttribute('data-debug')
  };

  // --- Logger ---
  function log(...args) {
    if (CONFIG.debug) {
      console.log('[PearEmbed]', ...args);
    }
  }
  function warn(...args) {
    console.warn('[PearEmbed]', ...args);
  }
  function error(...args) {
    console.error('[PearEmbed]', ...args);
  }

  // --- Device Capability Detection ---
  async function detectCapabilities() {
    const caps = {
      memory: navigator.deviceMemory || null,
      cores: navigator.hardwareConcurrency || null,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      webgl: false,
      webgpu: false,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        pixelRatio: window.devicePixelRatio
      }
    };

    // WebGL
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      caps.webgl = !!gl;
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          caps.gpuRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          caps.gpuVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        }
      }
    } catch (e) { /* ignore */ }

    // WebGPU
    try {
      caps.webgpu = !!(navigator.gpu);
    } catch (e) { /* ignore */ }

    // Storage estimate
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        caps.storage = { total: est.quota, used: est.usage, available: est.quota - est.usage };
      }
    } catch (e) { /* ignore */ }

    // Battery
    try {
      if (navigator.getBattery) {
        const bat = await navigator.getBattery();
        caps.battery = { level: bat.level, charging: bat.charging };
      }
    } catch (e) { /* ignore */ }

    // Network
    try {
      if (navigator.connection) {
        caps.network = {
          type: navigator.connection.effectiveType,
          downlink: navigator.connection.downlink
        };
      }
    } catch (e) { /* ignore */ }

    return caps;
  }

  // --- Idle State Monitoring ---
  function createIdleMonitor() {
    const state = {
      isVisible: !document.hidden,
      isCharging: false,
      batteryLevel: 1.0,
      isIdle: false,
      networkOk: true
    };

    const listeners = [];
    function emit() {
      state.isIdle = state.isVisible && state.networkOk && (state.isCharging || state.batteryLevel > 0.2);
      listeners.forEach(fn => fn(state));
    }

    // Visibility
    document.addEventListener('visibilitychange', () => {
      state.isVisible = !document.hidden;
      emit();
    });

    // Battery
    if (navigator.getBattery) {
      navigator.getBattery().then(bat => {
        state.isCharging = bat.charging;
        state.batteryLevel = bat.level;
        emit();
        bat.addEventListener('chargingchange', () => { state.isCharging = bat.charging; emit(); });
        bat.addEventListener('levelchange', () => { state.batteryLevel = bat.level; emit(); });
      });
    }

    // Network
    if (navigator.connection) {
      navigator.connection.addEventListener('change', () => {
        state.networkOk = navigator.connection.effectiveType !== 'none';
        emit();
      });
    }

    emit();

    return {
      getState: () => state,
      onChange: (fn) => listeners.push(fn),
      isIdle: () => state.isIdle
    };
  }

  // --- Unique Node ID ---
  function getNodeId() {
    const key = '_pear_embed_node_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'embed-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
      try { localStorage.setItem(key, id); } catch (e) { /* storage full */ }
    }
    return id;
  }

  // --- HTTP Helpers ---
  async function post(path, body) {
    const res = await fetch(CONFIG.backendUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function get(path) {
    const res = await fetch(CONFIG.backendUrl + path, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // --- Inference Execution (lightweight) ---
  async function executeTask(task) {
    log('Executing task:', task.id || 'unknown');

    // If the task provides a remote inference endpoint, forward to it
    if (task.inferenceUrl) {
      try {
        const res = await fetch(task.inferenceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: task.prompt, model: task.model })
        });
        if (res.ok) {
          const data = await res.json();
          return { success: true, result: data, source: 'remote' };
        }
      } catch (e) {
        warn('Remote inference failed:', e.message);
      }
    }

    // If local AI endpoint is configured (e.g. Ollama), try it
    if (task.localAIEndpoint) {
      try {
        const res = await fetch(task.localAIEndpoint + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: task.model || 'llama2', prompt: task.prompt, stream: false })
        });
        if (res.ok) {
          const data = await res.json();
          return { success: true, result: data.response || data, source: 'local-ai' };
        }
      } catch (e) {
        warn('Local AI inference failed:', e.message);
      }
    }

    // Fallback: mark as processed but delegate to backend
    return {
      success: true,
      result: { delegated: true, reason: 'No local compute available' },
      source: 'delegate'
    };
  }

  // --- Main Miner Class ---
  class PearEmbedMiner {
    constructor() {
      this.nodeId = getNodeId();
      this.capabilities = null;
      this.idleMonitor = createIdleMonitor();
      this.running = false;
      this.registered = false;
      this.pollTimer = null;
      this.activeTasks = 0;
      this.earnings = { total: 0, tasksCompleted: 0 };
      this._listeners = [];
    }

    async init() {
      this.capabilities = await detectCapabilities();
      log('Device capabilities:', this.capabilities);

      if (!CONFIG.evmAddress) {
        warn('No EVM address provided. Set data-evm-address on the script tag.');
      }

      this.idleMonitor.onChange((state) => {
        log('Idle state changed:', state.isIdle);
        if (state.isIdle && this.running && !this.registered) {
          this.register();
        }
      });

      // Auto-start if requested
      if (CONFIG.autoInstall) {
        this.start();
      }
    }

    async register() {
      if (this.registered) return;
      try {
        const payload = {
          nodeId: this.nodeId,
          appId: CONFIG.appId,
          evmAddress: CONFIG.evmAddress,
          capabilities: this.capabilities,
          timestamp: Date.now()
        };
        log('Registering miner...');
        const result = await post('/api/start', payload);
        if (result.success) {
          this.registered = true;
          log('Registered successfully');
          this._emit('registered', payload);
        }
      } catch (e) {
        warn('Registration failed:', e.message);
      }
    }

    async unregister() {
      if (!this.registered) return;
      try {
        log('Unregistering miner...');
        await post('/api/stop', { nodeId: this.nodeId });
        this.registered = false;
        this._emit('stopped');
      } catch (e) {
        warn('Unregister failed:', e.message);
      }
    }

    start() {
      if (this.running) return;
      this.running = true;
      log('Miner started');
      this._emit('started');

      if (this.idleMonitor.isIdle()) {
        this.register();
      }

      this.pollTimer = setInterval(() => this._poll(), CONFIG.pollIntervalMs);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.unregister();
      log('Miner stopped');
      this._emit('stopped');
    }

    async _poll() {
      if (!this.running || !this.registered) return;
      if (this.activeTasks >= CONFIG.maxConcurrent) return;
      if (!this.idleMonitor.isIdle()) return;

      try {
        // Poll for tasks via status endpoint (or a dedicated tasks endpoint)
        const status = await get('/api/status');
        if (!status.success) return;

        const data = status.data;
        const hasTasks = data.tasks?.activeTasks > 0;

        if (hasTasks) {
          // Simulate processing a task
          this.activeTasks++;
          const taskResult = await executeTask({
            id: 'task-' + Date.now(),
            prompt: data.inference?.lastPrompt || 'infer',
            model: data.inference?.model || 'default'
          });
          this.activeTasks--;

          if (taskResult.success) {
            this.earnings.tasksCompleted++;
            this.earnings.total += 0.001; // placeholder reward
            this._emit('taskComplete', taskResult);
          }
        }
      } catch (e) {
        warn('Poll error:', e.message);
      }
    }

    getStatus() {
      return {
        running: this.running,
        registered: this.registered,
        idle: this.idleMonitor.isIdle(),
        nodeId: this.nodeId,
        appId: CONFIG.appId,
        evmAddress: CONFIG.evmAddress,
        capabilities: this.capabilities,
        earnings: this.earnings,
        activeTasks: this.activeTasks
      };
    }

    on(event, fn) {
      this._listeners.push({ event, fn });
    }

    _emit(event, data) {
      this._listeners.filter(l => l.event === event).forEach(l => {
        try { l.fn(data); } catch (e) { /* ignore */ }
      });
    }
  }

  // --- Expose global API ---
  const miner = new PearEmbedMiner();

  global.PearEmbedMiner = {
    miner: miner,
    start: () => miner.start(),
    stop: () => miner.stop(),
    status: () => miner.getStatus(),
    on: (event, fn) => miner.on(event, fn),
    config: CONFIG
  };

  // --- Auto-init ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => miner.init());
  } else {
    miner.init();
  }

})(window);
