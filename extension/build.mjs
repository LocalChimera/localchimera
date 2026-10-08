#!/usr/bin/env node
/**
 * build.mjs — produce vendor bundles for the MV3 extension.
 *
 * MV3 CSP forbids remote code, so the inference engine must be bundled
 * into the package:
 *
 *   vendor/wllama-page.js  esbuild bundle of wllama-entry.js (offscreen page)
 *   vendor/wllama.wasm     threaded/JSPI build (@wllama/wllama)
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
  entryPoints: ['wllama-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  outfile: 'vendor/wllama-page.js',
  minify: true,
})
console.log('vendor/wllama-page.js written')

// Engine binary — the worker resolves this via chrome.runtime.getURL()
copyFileSync('node_modules/@wllama/wllama/esm/wasm/wllama.wasm', 'vendor/wllama.wasm')
console.log('vendor/wllama.wasm written — repack the extension to ship')
