import Graph from 'graphology';
import { writeFileSync } from 'fs';

export class KnowledgeGraph {
  constructor(config = {}) {
    this.config = config;
    this.graph = new Graph({ multi: false, type: 'directed' });
    this.started = false;
    this.persistPath = config.persistPath || null;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  addNode(id, attrs = {}) {
    if (!this.graph.hasNode(id)) this.graph.addNode(id, attrs);
  }

  addEdge(from, to, attrs = {}) {
    this.addNode(from);
    this.addNode(to);
    if (!this.graph.hasEdge(from, to)) this.graph.addEdge(from, to, attrs);
  }

  getNeighbors(id) {
    if (!this.graph.hasNode(id)) return [];
    return this.graph.neighbors(id);
  }

  search(query, limit = 10) {
    const results = [];
    this.graph.forEachNode((node, attrs) => {
      if (attrs.label?.toLowerCase().includes(query.toLowerCase()) || node.toLowerCase().includes(query.toLowerCase())) {
        results.push({ id: node, attrs });
        if (results.length >= limit) return;
      }
    });
    return results;
  }

  persist() {
    if (this.persistPath) {
      writeFileSync(this.persistPath, JSON.stringify(this.graph.export()), 'utf-8');
    }
  }

  getStats() {
    return {
      started: this.started,
      nodes: this.graph.order,
      edges: this.graph.size,
    };
  }
}
