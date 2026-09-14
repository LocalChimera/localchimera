import { MemoryVectorStore } from 'langchain/vectorstores/memory';

export class HybridRetriever {
  constructor(config = {}) {
    this.config = config;
    this.store = null;
    this.retriever = null;
    this.embeddings = null;
    this.started = false;
  }

  async initialize({ embeddings }) {
    this.embeddings = embeddings;
    this.store = new MemoryVectorStore(embeddings);
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }

  async addDocuments(docs) {
    if (!this.store) throw new Error('HybridRetriever not initialized');
    await this.store.addDocuments(docs);
  }

  async search(query, k = 4) {
    if (!this.store) return [];
    return this.store.similaritySearch(query, k);
  }

  async searchWithScores(query, k = 4) {
    if (!this.store) return [];
    return this.store.similaritySearchWithScore(query, k);
  }

  getStats() {
    return { started: this.started, hasStore: !!this.store };
  }
}
