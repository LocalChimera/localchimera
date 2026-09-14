import { pipeline } from '@huggingface/transformers';

export class VoicePipeline {
  constructor(config = {}) {
    this.config = config;
    this.pipe = null;
    this.model = config.whisperModel || 'Xenova/whisper-tiny';
    this.started = false;
  }

  async initialize() {
    this.pipe = await pipeline('automatic-speech-recognition', this.model, { dtype: 'fp32' });
  }

  async start() {
    if (!this.pipe) await this.initialize();
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async transcribe(audioBuffer) {
    if (!this.pipe) await this.initialize();
    const output = await this.pipe(audioBuffer);
    return output.text;
  }

  getStatus() {
    return { started: this.started, model: this.model };
  }
}
