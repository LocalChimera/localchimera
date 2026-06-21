const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Support for .mjs and bare imports
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];
config.resolver.assetExts = [...config.resolver.assetExts, 'bin', 'gguf'];

// Alias missing @qvac/sdk internal dependency
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform, realModuleName) => {
  if (moduleName === '@qvac/rag/errors.js') {
    return { filePath: path.resolve(__dirname, 'stubs/qvac-rag-errors.js'), type: 'sourceFile' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform, realModuleName);
  }
  return context.resolveRequest(context, moduleName, platform, realModuleName);
};

module.exports = config;
