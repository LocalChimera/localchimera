import archiver from 'archiver';
import { createWriteStream } from 'fs';

export class EvidenceExporter {
  constructor(config = {}) {
    this.config = config;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  async exportToZip(evidence, outputPath) {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve({ path: outputPath, bytes: archive.pointer() }));
      archive.on('error', reject);

      archive.pipe(output);

      for (const item of evidence) {
        if (item.type === 'file') {
          archive.file(item.path, { name: item.name });
        } else if (item.type === 'content') {
          archive.append(item.content, { name: item.name });
        } else if (item.type === 'json') {
          archive.append(JSON.stringify(item.data, null, 2), { name: item.name || 'evidence.json' });
        }
      }

      archive.finalize();
    });
  }

  async exportToJSON(evidence) {
    return JSON.stringify(evidence, null, 2);
  }

  getStats() {
    return { started: this.started };
  }
}
