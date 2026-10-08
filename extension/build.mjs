#!/usr/bin/env node
/**
 * build.mjs — produce vendor bundles for the MV3 extension.
 *
 * MV3 CSP forbids remote code, so both inference engines must be bundled
 * into the package:
 *
 *   vendor/transformers.js    esbuild bundle of @huggingface/transformers
 *   vendor/wllama-page.js     esbuild bundle of wllama-entry.js (offscreen page)
 *   vendor/wllama.wasm        threaded/JSPI build (@wllama/wllama)
 *   vendor/wllama-compat.*    single-thread fallback build (@wllama/wllama-compat)
 *
 * background.js loads them lazily; without them the extension still ships
 * (fetch/pin/canary lanes only).
 *
 *   npm install && npm run build   →   vendor/*
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('vendor', { recursive: true })

await build({
  entryPoints: ['infer-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  outfile: 'vendor/transformers.js',
  minify: true,
  // ONNX wasm artifacts resolve to URLs at runtime — keep them external and
  // let transformers.js fetch weights/wasm from HuggingFace + Cache API.
  external: ['*.wasm', '*.onnx'],
})
console.log('vendor/transformers.js written')

await build({
  entryPoints: ['wllama-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  outfile: 'vendor/wllama-page.js',
  minify: true,
})
console.log('vendor/wllama-page.js written')

// Engine binaries — the worker resolves these via chrome.runtime.getURL()
copyFileSync('node_modules/@wllama/wllama/esm/wasm/wllama.wasm', 'vendor/wllama.wasm')
copyFileSync('node_modules/@wllama/wllama-compat/wasm/wllama.wasm', 'vendor/wllama-compat.wasm')
copyFileSync('node_modules/@wllama/wllama-compat/wasm/wllama.js', 'vendor/wllama-compat.js')
console.log('vendor/wllama*.wasm + wllama-compat.js written — repack the extension to ship')
