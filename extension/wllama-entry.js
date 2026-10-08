// Offscreen-page logic for the wllama lane (llama.cpp → WASM/WebGPU).
// The page runs cross-origin-isolated (manifest COOP/COEP keys), so
// SharedArrayBuffer + JSPI engage the threaded build. Without isolation the
// lane refuses: the compat single-thread build measured slower than the
// engines it replaced, so it was removed rather than shipped.
// background.js drives this page via chrome.runtime.sendMessage.
import { Wllama } from '@wllama/wllama/esm/index.js'

let wllama = null
let loadedUrl = null
let loading = null

async function ensureWllama(modelUrl) {
  if (!crossOriginIsolated) throw new Error('wllama requires a cross-origin-isolated context')
  if (!wllama || loadedUrl && loadedUrl !== modelUrl) {
    try { await wllama?.exit() } catch {}
    wllama = new Wllama({ default: chrome.runtime.getURL('vendor/wllama.wasm') }, { suppressNativeLog: true })
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
