const ENDPOINTS = [
  { url: 'http://localhost:11434/api/tags', name: 'Ollama', type: 'ollama' },
  { url: 'http://localhost:1234/v1/models', name: 'LM Studio', type: 'lmstudio' },
  { url: 'http://localhost:8080/v1/models', name: 'LocalAI', type: 'localai' },
  { url: 'http://127.0.0.1:11434/api/tags', name: 'Ollama (127.0.0.1)', type: 'ollama' },
  { url: 'http://127.0.0.1:1234/v1/models', name: 'LM Studio (127.0.0.1)', type: 'lmstudio' },
]

export async function detectLocalAI(endpointOverride = null) {
  const results = []

  const urlsToCheck = endpointOverride
    ? [{ url: endpointOverride, name: 'Custom', type: 'custom' }]
    : ENDPOINTS

  for (const endpoint of urlsToCheck) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      const response = await fetch(endpoint.url, {
        method: 'GET',
        signal: controller.signal,
        mode: 'no-cors' // Some endpoints may block CORS
      })
      clearTimeout(timeout)

      // no-cors returns opaque response, so we can't read body
      // But if it doesn't error, the endpoint is likely there
      results.push({
        ...endpoint,
        available: true,
        models: []
      })
    } catch {
      // Endpoint not available
    }
  }

  return results
}

export async function fetchOllamaModels(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    if (response.ok) {
      const data = await response.json()
      return data.models || []
    }
  } catch {
    // CORS or network error
  }
  return []
}

export function getModelRecommendation(deviceClass) {
  const models = [
    {
      id: 'tinyllama-1.1b',
      name: 'TinyLlama 1.1B',
      size: '~600MB',
      quant: 'Q4',
      minRam: 2,
      minCores: 2,
      description: 'Fast, lightweight. Good for text generation tasks.',
      tasks: ['text-gen', 'summarization', 'chat']
    },
    {
      id: 'phi-2',
      name: 'Phi-2',
      size: '~1.6GB',
      quant: 'Q4',
      minRam: 4,
      minCores: 2,
      description: 'Microsoft\'s efficient 2.7B model. Strong reasoning.',
      tasks: ['text-gen', 'code', 'reasoning']
    },
    {
      id: 'llama-2-7b',
      name: 'Llama 2 7B',
      size: '~3.8GB',
      quant: 'Q4',
      minRam: 6,
      minCores: 4,
      description: 'Meta\'s popular 7B model. Balanced quality.',
      tasks: ['text-gen', 'chat', 'code', 'summarization']
    },
    {
      id: 'qwen2-0.5b',
      name: 'Qwen2 0.5B',
      size: '~400MB',
      quant: 'Q4',
      minRam: 2,
      minCores: 2,
      description: 'Alibaba\'s tiny model. Multilingual support.',
      tasks: ['text-gen', 'translation', 'chat']
    }
  ]

  if (deviceClass === 'high') {
    return models.filter(m => m.minRam <= 6)
  } else if (deviceClass === 'medium') {
    return models.filter(m => m.minRam <= 4)
  } else {
    return models.filter(m => m.minRam <= 2)
  }
}
