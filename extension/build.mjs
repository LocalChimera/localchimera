#!/usr/bin/env node
/**
 * build.mjs — produce vendor/transformers.js for the MV3 extension.
 *
 * MV3 CSP forbids remote code, so @huggingface/transformers must be bundled
 * into the package. background.js's loadInfer() dynamic-imports this file;
 * if it's absent the extension still ships (fetch/pin/canary lanes only).
 *
 *   npm install && npm run build   →   vendor/transformers.js
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

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
console.log('vendor/transformers.js written — repack the extension to ship infer')
