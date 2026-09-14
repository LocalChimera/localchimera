import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class MCPClient {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
    this.transport = null;
    this.started = false;
  }

  async initialize() {
    this.client = new Client(
      { name: 'chimera-mcp-client', version: '1.0.0' },
      { capabilities: {} }
    );
  }

  async start() {
    if (!this.client) await this.initialize();
    this.started = true;
  }

  async stop() {
    if (this.transport) await this.transport.close();
    this.started = false;
  }

  async connect(command, args = []) {
    if (!this.client) await this.initialize();
    this.transport = new StdioClientTransport({ command, args });
    await this.client.connect(this.transport);
  }

  async listTools() {
    if (!this.client) return [];
    const { tools } = await this.client.listTools();
    return tools;
  }

  async callTool(name, args = {}) {
    if (!this.client) throw new Error('MCP client not connected');
    return this.client.callTool({ name, arguments: args });
  }

  getStats() {
    return { started: this.started, connected: !!this.transport };
  }
}
