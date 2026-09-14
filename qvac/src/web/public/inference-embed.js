/**
 * QVAC-Pear Inference Embed Script
 * Auto-detects idle compute and connects to mining networks
 * User ID must be affiliated with EVM address for inference resource confirmation
 */

(function() {
  'use strict';

  const script = document.currentScript;
  const appId = script.getAttribute('data-app-id');
  const autoInstall = script.hasAttribute('auto-install');
  const machineOwnerAddress = script.getAttribute('data-evm-address');

  if (!appId) {
    console.error('QVAC-Pear Embed: data-app-id is required');
    return;
  }

  // data-evm-address = machine owner's payout address
  // Protocol multisigs are shared across all apps
  let evmAddress = machineOwnerAddress || null;
  if (!evmAddress && window.ethereum && window.ethereum.selectedAddress) {
    evmAddress = window.ethereum.selectedAddress;
  }

  // Configuration
  const config = {
    appId: appId,
    machineOwnerAddress: evmAddress,
    autoInstall: autoInstall,
    apiEndpoint: 'https://api.qvac-pear.io',
    version: '1.0.0',
    isContributing: false,
    isPaused: false,
    status: 'initializing'
  };

  /**
   * Initialize the embed script
   */
  async function initialize() {
    console.log('QVAC-Pear Embed: Initializing with app ID:', appId);
    
    // Check for EVM address affiliation
    if (!evmAddress) {
      console.warn('QVAC-Pear Embed: No EVM wallet connected. User ID must be affiliated with EVM address for inference resource confirmation.');
      
      if (autoInstall) {
        // Request wallet connection if auto-install is enabled
        try {
          await connectWallet();
        } catch (error) {
          console.error('QVAC-Pear Embed: Failed to connect wallet:', error);
        }
      }
    }
    
    // Auto-detect idle compute
    detectIdleCompute();
    
    // Connect to mining networks if auto-install is enabled
    if (autoInstall) {
      connectToMiningNetworks();
    }
  }

  /**
   * Connect to EVM wallet (machine owner address)
   */
  async function connectWallet() {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts'
        });
        evmAddress = accounts[0];
        config.machineOwnerAddress = evmAddress;
        console.log('QVAC-Pear Embed: Machine owner wallet connected:', evmAddress);
      } catch (error) {
        console.error('QVAC-Pear Embed: Wallet connection failed:', error);
        throw error;
      }
    } else {
      throw new Error('No Web3 wallet detected');
    }
  }

  /**
   * Detect idle compute resources
   */
  function detectIdleCompute() {
    // Check CPU usage
    const cpuCores = navigator.hardwareConcurrency || 4;
    
    // Check memory
    const memory = navigator.deviceMemory || 8; // GB
    
    // Check GPU (if available)
    const gpuInfo = getGPUInfo();
    
    console.log('QVAC-Pear Embed: Detected compute resources:', {
      cpuCores: cpuCores,
      memory: memory + 'GB',
      gpu: gpuInfo
    });
    
    // Report to API
    reportComputeResources({
      cpuCores,
      memory,
      gpu: gpuInfo
    });
  }

  /**
   * Get GPU information
   */
  function getGPUInfo() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) return null;
    
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return null;
    
    return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  }

  /**
   * Connect to mining networks
   */
  function connectToMiningNetworks() {
    console.log('QVAC-Pear Embed: Connecting to mining networks...');
    config.status = 'connecting';
    notifyStatusChange();

    // Connect to QVAC-Pear mining networks
    // This would establish connections to:
    // - Botchain (EVM — relay mode, untrusted-safe)

    // Register with the API
    registerWithAPI();
  }

  /**
   * Pause earning (e.g. when host app needs AI)
   */
  function pause() {
    if (config.isPaused) return;
    config.isPaused = true;
    config.status = 'paused';
    console.log('QVAC-Pear Embed: Earning paused');
    notifyStatusChange();
  }

  /**
   * Resume earning
   */
  function resume() {
    if (!config.isPaused) return;
    config.isPaused = false;
    config.status = config.isContributing ? 'active' : 'idle';
    console.log('QVAC-Pear Embed: Earning resumed');
    notifyStatusChange();
  }

  /**
   * Check if user is contributing
   */
  function isContributing() {
    return config.isContributing && !config.isPaused;
  }

  /**
   * Get current status
   */
  function getStatus() {
    return {
      appId: config.appId,
      evmAddress: config.evmAddress,
      status: config.status,
      isContributing: config.isContributing,
      isPaused: config.isPaused,
      autoInstall: config.autoInstall
    };
  }

  let statusCallback = null;
  let earningCallback = null;

  /**
   * Notify status change callback
   */
  function notifyStatusChange() {
    if (statusCallback) {
      statusCallback(getStatus());
    }
  }

  /**
   * Notify earning callback
   */
  function notifyEarning(amount) {
    if (earningCallback) {
      earningCallback(amount);
    }
  }

  /**
   * Register with QVAC-Pear API
   */
  async function registerWithAPI() {
    try {
      const response = await fetch(`${config.apiEndpoint}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          appId: config.appId,
          machineOwnerAddress: config.machineOwnerAddress,
          version: config.version
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('QVAC-Pear Embed: Registered successfully:', data);
        config.isContributing = true;
        config.status = config.isPaused ? 'paused' : 'active';
        notifyStatusChange();
      } else {
        console.error('QVAC-Pear Embed: Registration failed');
        config.status = 'error';
        notifyStatusChange();
      }
    } catch (error) {
      console.error('QVAC-Pear Embed: API registration error:', error);
    }
  }

  /**
   * Report compute resources to API
   */
  async function reportComputeResources(resources) {
    try {
      await fetch(`${config.apiEndpoint}/report-resources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          appId: config.appId,
          evmAddress: config.evmAddress,
          resources: resources
        })
      });
    } catch (error) {
      console.error('QVAC-Pear Embed: Resource reporting error:', error);
    }
  }

  /**
   * Expose legacy QVACPear API
   */
  window.QVACPear = {
    config: config,
    connectWallet: connectWallet,
    detectIdleCompute: detectIdleCompute,
    connectToMiningNetworks: connectToMiningNetworks
  };

  /**
   * Expose QVACInference API (preferred)
   */
  window.QVACInference = {
    init: async function(opts = {}) {
      if (opts.machineOwnerAddress) {
        config.machineOwnerAddress = opts.machineOwnerAddress;
      }
      if (opts.onStatusChange) {
        statusCallback = opts.onStatusChange;
      }
      if (opts.onEarning) {
        earningCallback = opts.onEarning;
      }
      await initialize();
      return getStatus();
    },
    pause: pause,
    resume: resume,
    isContributing: isContributing,
    getStatus: getStatus,
    connectWallet: connectWallet
  };

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();
