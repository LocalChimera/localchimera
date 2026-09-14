import { pipeline } from '@huggingface/transformers';

export class LocalLLM {
  constructor(config = {}) {
    this.config = config;
    this.pipe = null;
    this.model = config.model || 'Xenova/Qwen1.5-0.5B-Chat';
    this.started = false;
  }

  async initialize() {
    this.pipe = await pipeline('text-generation', this.model, {
      dtype: 'q4',
      device: 'cpu',
    });
  }

  async start() {
    if (!this.pipe) await this.initialize();
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async generate(prompt, options = {}) {
    if (!this.pipe) await this.initialize();
    const output = await this.pipe(prompt, {
      max_new_tokens: options.maxTokens || 256,
      temperature: options.temperature || 0.7,
      do_sample: true,
    });
    return output[0]?.generated_text || '';
  }

  getStatus() {
    return { started: this.started, model: this.model };
  }
}
