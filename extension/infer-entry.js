// Bundled entry for vendor/transformers.js — re-export only what
// background.js's infer lane uses so the bundle stays minimal.
export { pipeline, env } from '@huggingface/transformers'
