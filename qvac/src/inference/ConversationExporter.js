import { writeFileSync } from 'fs';

export class ConversationExporter {
  constructor(config = {}) {
    this.config = config;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  exportJSON(messages) {
    return JSON.stringify(messages, null, 2);
  }

  exportMarkdown(messages) {
    return messages.map(m => `**${m.role || m.type || 'unknown'}**: ${m.content || m.text || ''}`).join('\n\n');
  }

  exportCSV(messages) {
    const header = 'role,content,timestamp\n';
    const rows = messages.map(m => `"${m.role || ''}","${(m.content || '').replace(/"/g, '""') }","${m.timestamp || ''}"`).join('\n');
    return header + rows;
  }

  toFile(messages, filePath, format = 'json') {
    const data = format === 'md' ? this.exportMarkdown(messages) : format === 'csv' ? this.exportCSV(messages) : this.exportJSON(messages);
    writeFileSync(filePath, data, 'utf-8');
  }

  getStats() {
    return { started: this.started };
  }
}
