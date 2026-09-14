import { useState, useRef, useCallback, useEffect } from 'react';

const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

const WLLAMA_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/wasm/wllama.wasm';
const WLLAMA_MODEL = {
  repo: 'MaziyarPanahi/SmolLM-135M-Instruct-GGUF',
  file: 'SmolLM-135M-Instruct.Q4_K_M.gguf',
};
const WLLAMA_INIT_TIMEOUT_MS = 60000;
const INFERENCE_TIMEOUT_MS = 120000;

function useDeviceCapabilities() {
  const [caps, setCaps] = useState({
    hasWebGPU: false,
    hasWebGL: false,
    hasIndexedDB: false,
    hasWebWorker: false,
    cpuCores: 0,
    ramGb: 0,
    gpuName: '',
    isMobile: false,
    isAndroid: false,
  });

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || window.innerWidth <= 768;
    setCaps({
      hasWebGPU: !!navigator.gpu,
      hasWebGL: (() => {
        try {
          const canvas = document.createElement('canvas');
          return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch {
          return false;
        }
      })(),
      hasIndexedDB: !!window.indexedDB,
      hasWebWorker: typeof Worker !== 'undefined',
      cpuCores: navigator.hardwareConcurrency || 0,
      ramGb: navigator.deviceMemory || 0,
      gpuName: '',
      isMobile,
      isAndroid,
    });
  }, []);

  return caps;
}

export function useBrowserNode() {
  const caps = useDeviceCapabilities();
  const [aiStatus, setAiStatus] = useState('idle');
  const [aiError, setAiError] = useState(null);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiEngine, setAiEngine] = useState(null); // 'webllm' | 'wllama'
  const [nodeStatus, setNodeStatus] = useState(null);
  const [nodeRunning, setNodeRunning] = useState(false);
  const engineRef = useRef(null);
  const engineTypeRef = useRef(null); // 'webllm' | 'wllama'
  const nodeRef = useRef(null);
  const loadingRef = useRef(false);
  const webllmFailedRef = useRef(false);

  const loadEngine = useCallback(async () => {
    if (engineRef.current) return engineRef.current;
    if (loadingRef.current) return null;
    loadingRef.current = true;
    console.log('[useBrowserNode] loadEngine start, webllmFailed:', webllmFailedRef.current, 'hasWebGPU:', caps.hasWebGPU);
    setAiStatus('loading');
    setAiError(null);
    try {
      // Try WebLLM first if WebGPU is present and we haven't already failed it.
      // Skip WebLLM on mobile Android WebView because WebGPU inference often hangs the main thread,
      // making the fallback timeout unusable. Use wllama (WASM CPU) as the primary engine there.
      const tryWebLLM = caps.hasWebGPU && !webllmFailedRef.current && !caps.isMobile;
      if (tryWebLLM) {
        try {
          setAiProgress(0);
          const webllm = await import('@mlc-ai/web-llm');
          const available = webllm.prebuiltAppConfig?.model_list?.map((m) => m.model_id) || [];
          const modelId = available.includes(MODEL_ID) ? MODEL_ID : available[0];
          if (!modelId) {
            throw new Error('No WebLLM prebuilt models available');
          }
          console.log('[useBrowserNode] Creating WebLLM engine for model', modelId);
          const engine = await Promise.race([
            webllm.CreateMLCEngine(modelId, {
              initProgressCallback: (p) => setAiProgress(p.progress || 0),
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('WebLLM initialization timed out')), WLLAMA_INIT_TIMEOUT_MS)
            ),
          ]);
          engineRef.current = engine;
          engineTypeRef.current = 'webllm';
          setAiEngine('webllm');
          setAiStatus('ready');
          console.log('[useBrowserNode] WebLLM engine ready');
          setAiProgress(1);
          return engine;
        } catch (err) {
          console.warn('[useBrowserNode] WebLLM failed or hung, falling back to wllama:', err);
          webllmFailedRef.current = true;
          setAiError(`WebLLM unavailable (${err.message}), switching to CPU fallback...`);
          setAiProgress(0);
        }
      }

      // Fallback to wllama (WASM CPU inference).
      try {
        const { Wllama } = await import('@wllama/wllama/esm/index.js');
        // Disable WebGPU in the WebView so wllama uses CPU only; Mali WebGPU
        // adapter initialization causes the inference to hang indefinitely.
        if (navigator.gpu && navigator.gpu.requestAdapter) {
          navigator.gpu.requestAdapter = async () => null;
        }
        const wllama = new Wllama({ default: WLLAMA_WASM_PATH });
        // Load the model as a Blob directly to avoid wllama's OPFS cache manager,
        // which throws a SecurityError in the Android WebView file:// origin.
        const modelUrl = `https://huggingface.co/${WLLAMA_MODEL.repo}/resolve/main/${WLLAMA_MODEL.file}`;
        console.log('[useBrowserNode] Fetching wllama model:', modelUrl);
        const modelRes = await fetch(modelUrl);
        if (!modelRes.ok) throw new Error(`Failed to fetch model: ${modelRes.status} ${modelRes.statusText}`);
        console.log('[useBrowserNode] Downloading model...');
        const modelBlob = await modelRes.blob();
        console.log('[useBrowserNode] Model downloaded, size:', modelBlob.size);
        await wllama.loadModel([modelBlob], { n_threads: 2, n_gpu_layers: 0 });
        engineRef.current = wllama;
        engineTypeRef.current = 'wllama';
        setAiEngine('wllama');
        setAiStatus('ready');
        console.log('[useBrowserNode] wllama engine ready');
        setAiProgress(1);
        return wllama;
      } catch (err) {
        console.error('[useBrowserNode] wllama fallback failed:', err);
        setAiError(err.message || 'CPU fallback failed');
        setAiStatus('error');
        return null;
      }
    } finally {
      loadingRef.current = false;
    }
  }, [caps]);

  const runInference = useCallback(async (engine, prompt, opts = {}) => {
    setAiStatus('inferring');
    const maxTokens = opts.maxTokens || 512;
    const systemPrompt = opts.systemPrompt;
    const doInference = async () => {
    if (engineTypeRef.current === 'wllama') {
      const messages = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }];
      const response = await engine.createChatCompletion({
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      });
      return response.choices?.[0]?.message?.content || '';
    }
    const messages = [{ role: 'user', content: prompt }];
    const reply = await engine.chat.completions.create({ messages });
    return reply.choices?.[0]?.message?.content || '';
    };
    return await Promise.race([
      doInference(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Inference timed out')), INFERENCE_TIMEOUT_MS)),
    ]);
  }, []);

  const generate = useCallback(async (prompt, opts) => {
    let engine = await loadEngine();
    if (!engine) {
      throw new Error(aiError || 'On-device AI not available');
    }
    try {
      const text = await runInference(engine, prompt, opts);
      setAiStatus('ready');
      return text;
    } catch (err) {
      console.error('[useBrowserNode] inference failed:', err);
      if (engineTypeRef.current === 'webllm') {
        console.warn('[useBrowserNode] WebLLM inference failed, retrying with wllama fallback');
        webllmFailedRef.current = true;
        engineRef.current = null;
        engineTypeRef.current = null;
        setAiEngine(null);
        engine = await loadEngine();
        if (!engine) throw new Error(aiError || 'Fallback AI not available');
        const text = await runInference(engine, prompt);
        setAiStatus('ready');
        return text;
      }
      setAiStatus('error');
      setAiError(err.message || 'Inference failed');
      throw err;
    }
  }, [loadEngine, aiError, aiEngine, runInference]);

  const startTasker = useCallback(async () => {
    if (nodeRef.current || nodeRunning) return;
    console.log('[useBrowserNode] startTasker: importing browser-sdk');
    try {
      const { quickStart } = await import('@localchimera/browser-sdk');
      console.log('[useBrowserNode] startTasker: calling quickStart');
      const node = await quickStart(undefined, undefined, undefined, {
        onStatus: (status) => {
          console.log('[useBrowserNode] status update:', status);
          setNodeStatus(status);
          setNodeRunning(status.running);
        },
      });
      nodeRef.current = node;
      setNodeRunning(true);
    } catch (err) {
      console.error('[useBrowserNode] BrowserNode start failed:', err);
      setNodeStatus({ running: false, error: err.message });
    }
  }, [nodeRunning]);

  const stopTasker = useCallback(async () => {
    if (!nodeRef.current) return;
    try {
      await nodeRef.current.stop();
    } catch (err) {
      console.error('[useBrowserNode] BrowserNode stop failed:', err);
    } finally {
      nodeRef.current = null;
      setNodeRunning(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (nodeRef.current) {
        nodeRef.current.stop().catch(() => {});
      }
      if (engineRef.current) {
        if (engineTypeRef.current === 'wllama') {
          engineRef.current.exit?.().catch(() => {});
        } else {
          engineRef.current.unload?.().catch(() => {});
        }
      }
    };
  }, []);

  return {
    caps,
    aiStatus,
    aiError,
    aiProgress,
    aiEngine,
    generate,
    loadEngine,
    nodeStatus,
    nodeRunning,
    startTasker,
    stopTasker,
  };
}
