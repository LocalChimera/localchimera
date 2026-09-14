import { pipeline } from '@huggingface/transformers';

export class SemanticDedup {
  constructor(config = {}) {
    this.config = config;
    this.pipe = null;
    this.model = config.model || 'Xenova/all-MiniLM-L6-v2';
    this.threshold = config.threshold || 0.85;
    this.started = false;
  }

  async initialize() {
    this.pipe = await pipeline('feature-extraction', this.model, { dtype: 'fp32' });
  }

  async start() {
    if (!this.pipe) await this.initialize();
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async dedup(texts) {
    if (!this.pipe) await this.initialize();
    const embeddings = await this.pipe(texts, { pooling: 'mean', normalize: true });
    const vectors = embeddings.tolist();
    const seen = [];
    const unique = [];
    for (let i = 0; i < texts.length; i++) {
      let isDup = false;
      for (const seenIdx of seen) {
        const sim = this._cosine(vectors[i], vectors[seenIdx]);
        if (sim >= this.threshold) { isDup = true; break; }
      }
      if (!isDup) { seen.push(i); unique.push(texts[i]); }
    }
    return unique;
  }

  _cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
  }

  getStats() {
    return { started: this.started, model: this.model, threshold: this.threshold };
  }
}
