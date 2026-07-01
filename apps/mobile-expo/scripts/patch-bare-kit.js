// Patches react-native-bare-kit to gracefully handle missing TurboModule
// in release builds. Without this, TurboModuleRegistry.getEnforcing('BareKit')
// throws a JavascriptException that crashes the app.
const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..', 'node_modules', 'react-native-bare-kit');

// 1. Patch NativeBareKit.ts: getEnforcing -> get (returns null instead of throwing)
const specsFile = path.join(baseDir, 'specs', 'NativeBareKit.ts');
if (fs.existsSync(specsFile)) {
  let content = fs.readFileSync(specsFile, 'utf-8');
  if (content.includes('getEnforcing')) {
    content = content.replace('TurboModuleRegistry.getEnforcing', 'TurboModuleRegistry.get');
    fs.writeFileSync(specsFile, content);
    console.log('[patch-bare-kit] Patched NativeBareKit.ts: getEnforcing -> get');
  } else {
    console.log('[patch-bare-kit] NativeBareKit.ts already patched or no getEnforcing found');
  }
} else {
  console.log('[patch-bare-kit] NativeBareKit.ts not found');
}

// 2. Patch index.js to handle null NativeBareKit gracefully
const indexFile = path.join(baseDir, 'index.js');
if (fs.existsSync(indexFile)) {
  let content = fs.readFileSync(indexFile, 'utf-8');
  if (!content.includes('__bareKitPatched')) {
    // Add null check after the require for NativeBareKit
    const oldRequire = "const { default: NativeBareKit } = require('./specs/NativeBareKit')";
    const newRequire = `const { default: NativeBareKit } = require('./specs/NativeBareKit')
// __bareKitPatched: graceful fallback when TurboModule is unavailable
if (!NativeBareKit) {
  console.warn('[BareKit] TurboModule not available - AI features will be disabled');
  class UnavailableWorklet {
    constructor() { throw new Error('BareKit TurboModule not available in this build'); }
  }
  class UnavailableIPC {
    constructor() { throw new Error('BareKit TurboModule not available in this build'); }
  }
  module.exports = { Worklet: UnavailableWorklet, IPC: UnavailableIPC };
  return;
}`;
    if (content.includes(oldRequire)) {
      content = content.replace(oldRequire, newRequire);
      fs.writeFileSync(indexFile, content);
      console.log('[patch-bare-kit] Patched index.js with null check for NativeBareKit');
    } else {
      console.log('[patch-bare-kit] Could not find require line in index.js, skipping');
    }
  } else {
    console.log('[patch-bare-kit] index.js already patched');
  }
} else {
  console.log('[patch-bare-kit] index.js not found');
}

console.log('[patch-bare-kit] Done');
