import { pipeline } from '@huggingface/transformers';

export class VisionCaptioner {
  constructor(config = {}) {
    this.config = config;
    this.pipe = null;
    this.model = config.model || 'Xenova/vit-gpt2-image-captioning';
    this.started = false;
  }

  async initialize() {
    this.pipe = await pipeline('image-to-text', this.model, { dtype: 'fp32' });
  }

  async start() {
    if (!this.pipe) await this.initialize();
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async caption(imageUrl) {
    if (!this.pipe) await this.initialize();
    const output = await this.pipe(imageUrl);
    return output[0]?.generated_text || '';
  }

  getStatus() {
    return { started: this.started, model: this.model };
  }
}
