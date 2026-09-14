import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

export class DocumentChunker {
  constructor(config = {}) {
    this.config = config;
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: config.chunkSize || 1000,
      chunkOverlap: config.chunkOverlap || 200,
      separators: ['\n\n', '\n', '. ', ' ', ''],
    });
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  async chunk(text, metadata = {}) {
    const chunks = await this.splitter.splitText(text);
    return chunks.map((c, i) => ({ text: c, index: i, metadata }));
  }

  async chunkDocuments(docs) {
    return this.splitter.splitDocuments(docs);
  }

  getStats() {
    return { started: this.started, chunkSize: this.config.chunkSize || 1000 };
  }
}
