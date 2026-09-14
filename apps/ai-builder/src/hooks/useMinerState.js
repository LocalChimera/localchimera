import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'qvac-miner-config'

const DEFAULT_CONFIG = {
  walletAddress: '',
  backendUrl: 'http://localhost:3000',
  localAIEndpoint: '',
  selectedModel: null,
  isMining: false,
  setupComplete: false,
  deviceProfile: null,
  earnings: {
    total: 0,
    today: 0,
    tasksCompleted: 0
  }
}

function loadConfig() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG
  } catch {
    return DEFAULT_CONFIG
  }
}

function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Storage full or unavailable
  }
}

export function useMinerState() {
  const [config, setConfig] = useState(() => loadConfig())

  const updateConfig = useCallback((updates) => {
    setConfig(prev => {
      const next = { ...prev, ...updates }
      saveConfig(next)
      return next
    })
  }, [])

  const setWalletAddress = useCallback((address) => {
    updateConfig({ walletAddress: address })
  }, [updateConfig])

  const setBackendUrl = useCallback((url) => {
    updateConfig({ backendUrl: url })
  }, [updateConfig])

  const setLocalAIEndpoint = useCallback((url) => {
    updateConfig({ localAIEndpoint: url })
  }, [updateConfig])

  const setSelectedModel = useCallback((model) => {
    updateConfig({ selectedModel: model })
  }, [updateConfig])

  const setSetupComplete = useCallback((complete) => {
    updateConfig({ setupComplete: complete })
  }, [updateConfig])

  const setDeviceProfile = useCallback((profile) => {
    updateConfig({ deviceProfile: profile })
  }, [updateConfig])

  const startMining = useCallback(() => {
    updateConfig({ isMining: true })
  }, [updateConfig])

  const stopMining = useCallback(() => {
    updateConfig({ isMining: false })
  }, [updateConfig])

  const addEarnings = useCallback((amount, tasks = 1) => {
    setConfig(prev => {
      const next = {
        ...prev,
        earnings: {
          total: prev.earnings.total + amount,
          today: prev.earnings.today + amount,
          tasksCompleted: prev.earnings.tasksCompleted + tasks
        }
      }
      saveConfig(next)
      return next
    })
  }, [])

  const resetDailyEarnings = useCallback(() => {
    updateConfig({
      earnings: { ...config.earnings, today: 0 }
    })
  }, [updateConfig, config.earnings])

  const clearConfig = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setConfig(DEFAULT_CONFIG)
  }, [])

  return {
    ...config,
    updateConfig,
    setWalletAddress,
    setBackendUrl,
    setLocalAIEndpoint,
    setSelectedModel,
    setSetupComplete,
    setDeviceProfile,
    startMining,
    stopMining,
    addEarnings,
    resetDailyEarnings,
    clearConfig
  }
}
