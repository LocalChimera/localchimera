import { pipeline } from '@huggingface/transformers';

export class EmbeddingService {
  constructor(config = {}) {
    this.config = config;
    this.pipe = null;
    this.model = config.model || 'Xenova/all-MiniLM-L6-v2';
    this.started = false;
  }

  async initialize() {
    this.pipe = await pipeline('feature-extraction', this.model, {
      dtype: 'fp32',
    });
  }

  async start() {
    if (!this.pipe) await this.initialize();
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async embed(text) {
    if (!this.pipe) await this.initialize();
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async embedBatch(texts) {
    if (!this.pipe) await this.initialize();
    const output = await this.pipe(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }

  getStatus() {
    return { started: this.started, model: this.model };
  }
}
