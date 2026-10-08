// Offscreen-page logic for the wllama lane (llama.cpp → WASM/WebGPU).
// The page runs cross-origin-isolated (manifest COOP/COEP keys), so
// SharedArrayBuffer + JSPI are available → the threaded main build.
// On hosts without isolation support the library degrades to the compat
// single-thread build automatically.
// background.js drives this page via chrome.runtime.sendMessage.
import { Wllama } from '@wllama/wllama/esm/index.js'

let wllama = null
let loadedUrl = null
let loading = null

async function ensureWllama(modelUrl) {
  if (!wllama || loadedUrl && loadedUrl !== modelUrl) {
    try { await wllama?.exit() } catch {}
    const url = (p) => chrome.runtime.getURL(p)
    wllama = new Wllama({ default: url('vendor/wllama.wasm') }, { suppressNativeLog: true })
    wllama.setCompat({ worker: url('vendor/wllama-compat.js'), wasm: url('vendor/wllama-compat.wasm') })
    loadedUrl = null
  }
  if (loadedUrl === modelUrl) return wllama
  loading ??= wllama.loadModelFromUrl(modelUrl, { n_ctx: 2048 })
    .then(() => { loadedUrl = modelUrl; return wllama })
    .catch((e) => { loading = null; throw e })
  return loading
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd !== 'wllama-infer') return
  ensureWllama(msg.modelUrl)
    .then((w) => w.createCompletion({
      prompt: msg.prompt,
      max_tokens: msg.maxTokens || 256,
      temperature: 0,
      stream: false,
    }))
    .then((r) => sendResponse({ ok: true, text: r.choices?.[0]?.text ?? '' }))
    .catch((e) => sendResponse({ ok: false, error: String(e).slice(0, 200) }))
  return true
})
