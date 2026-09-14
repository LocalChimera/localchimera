import { useState, useEffect } from 'react'

export function useDeviceCapabilities() {
  const [capabilities, setCapabilities] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const detect = async () => {
      const caps = {
        memory: navigator.deviceMemory || 'unknown',
        cores: navigator.hardwareConcurrency || 'unknown',
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        webgl: false,
        webgpu: false,
        storage: null,
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          pixelRatio: window.devicePixelRatio
        }
      }

      // Detect WebGL
      try {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
        caps.webgl = !!gl
        if (gl) {
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
          if (debugInfo) {
            caps.gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            caps.gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
          }
        }
      } catch (e) {
        caps.webgl = false
      }

      // Detect WebGPU
      try {
        caps.webgpu = !!navigator.gpu
      } catch (e) {
        caps.webgpu = false
      }

      // Detect storage
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate()
          caps.storage = {
            total: estimate.quota,
            used: estimate.usage,
            available: estimate.quota - estimate.usage
          }
        }
      } catch (e) {
        caps.storage = null
      }

      // Detect battery
      try {
        if (navigator.getBattery) {
          const battery = await navigator.getBattery()
          caps.battery = {
            level: battery.level,
            charging: battery.charging
          }
        }
      } catch (e) {
        caps.battery = null
      }

      // Network info
      try {
        if (navigator.connection) {
          caps.network = {
            type: navigator.connection.effectiveType,
            downlink: navigator.connection.downlink
          }
        }
      } catch (e) {
        caps.network = null
      }

      setCapabilities(caps)
      setLoading(false)
    }

    detect()
  }, [])

  const getRecommendedModel = () => {
    if (!capabilities) return null

    const memoryGB = typeof capabilities.memory === 'number' ? capabilities.memory : 4
    const cores = typeof capabilities.cores === 'number' ? capabilities.cores : 2
    const hasWebGPU = capabilities.webgpu
    const hasWebGL = capabilities.webgl

    // Model recommendations based on device capabilities
    if (memoryGB >= 8 && cores >= 8 && hasWebGPU) {
      return {
        name: 'Llama-2-7B-ONNX',
        size: '3.8GB',
        format: 'ONNX',
        quant: 'Q4',
        backend: hasWebGPU ? 'WebGPU' : 'WebGL',
        tasks: 'medium',
        description: 'Balanced performance for modern devices'
      }
    } else if (memoryGB >= 6 && cores >= 4) {
      return {
        name: 'TinyLlama-1.1B-ONNX',
        size: '0.8GB',
        format: 'ONNX',
        quant: 'Q4',
        backend: hasWebGPU ? 'WebGPU' : 'WebGL',
        tasks: 'small',
        description: 'Lightweight model for most smartphones'
      }
    } else if (memoryGB >= 4 && cores >= 2) {
      return {
        name: 'Phi-2-ONNX',
        size: '1.6GB',
        format: 'ONNX',
        quant: 'Q4',
        backend: hasWebGL ? 'WebGL' : 'CPU',
        tasks: 'small',
        description: 'Efficient model for entry-level devices'
      }
    } else {
      return {
        name: 'None - Use Backend Node',
        size: '0GB',
        format: 'remote',
        backend: 'HTTP',
        tasks: 'none',
        description: 'Device too limited for local inference. Connect to a backend node.'
      }
    }
  }

  const getDeviceClass = () => {
    if (!capabilities) return 'unknown'
    const memoryGB = typeof capabilities.memory === 'number' ? capabilities.memory : 4
    const cores = typeof capabilities.cores === 'number' ? capabilities.cores : 2
    if (memoryGB >= 8 && cores >= 6) return 'high'
    if (memoryGB >= 4 && cores >= 2) return 'medium'
    return 'low'
  }

  return { capabilities, loading, getRecommendedModel, getDeviceClass }
}
