import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../core/Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIKI_DIR = path.join(__dirname, '..', '..', 'llmwiki-data', 'wiki');

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const TAG_RE = /#([a-zA-Z0-9_-]+)/g;

function _parseFrontmatter(text) {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return {};
  const lines = m[1].split('\n');
  const meta = {};
  let key = null;
  for (const line of lines) {
    const top = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (top) {
      key = top[1];
      let val = top[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        try { meta[key] = JSON.parse(val); } catch { meta[key] = val; }
      } else {
        meta[key] = val;
      }
    } else if (key && line.startsWith('  ')) {
      if (!Array.isArray(meta[key])) meta[key] = [meta[key]];
      meta[key].push(line.trim().replace(/^- /, '').replace(/,$/, ''));
    }
  }
  return meta;
}

export class MarkdownIndexer {
  constructor(wikiDir = WIKI_DIR) {
    this.wikiDir = wikiDir;
    this.logger = new Logger('MarkdownIndexer');
    this.documents = [];
    this.links = [];
    this._mtime = 0;
  }

  async index() {
    this.logger.info('Indexing llmwiki markdown files...');
    const docs = [];
    const links = [];
    const stack = [this.wikiDir];

    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch { continue; }

      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!ent.name.endsWith('.md')) continue;
        const text = await fs.readFile(full, 'utf-8');
        const rel = path.relative(this.wikiDir, full);
        const meta = _parseFrontmatter(text);
        const body = text.replace(FRONTMATTER_RE, '').trim();
        const relPath = rel.replace(/\\/g, '/');
        const conceptId = meta.id || relPath.replace(/\.md$/, '');

        docs.push({
          id: conceptId,
          path: '/' + relPath,
          relPath,
          filename: ent.name,
          title: meta.title || ent.name.replace('.md', ''),
          description: meta.description || '',
          date: meta.created || meta.date || '',
          created: meta.created || '',
          modified: meta.modified || '',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          category: path.dirname(rel).replace(/\\/g, '/'),
          body,
          bodyLower: body.toLowerCase(),
          mtime: (await fs.stat(full)).mtimeMs,
        });

        let m;
        while ((m = WIKILINK_RE.exec(text)) !== null) {
          links.push({ from: conceptId, to: m[1].trim(), type: 'wikilink' });
        }
      }
    }

    this.documents = docs;
    this.links = links;
    this._mtime = Date.now();
    this.logger.info(`Indexed ${docs.length} documents, ${links.length} links`);
    return { documents: docs.length, links: links.length };
  }

  search(query, opts = {}) {
    const q = query.toLowerCase();
    const { tags = [], category = '' } = opts;
    return this.documents
      .filter(d => {
        if (tags.length && !tags.every(t => d.tags.includes(t))) return false;
        if (category && !d.category.includes(category)) return false;
        return (
          d.title.toLowerCase().includes(q) ||
          d.bodyLower.includes(q) ||
          d.tags.some(t => t.toLowerCase().includes(q))
        );
      })
      .map(d => ({
        id: d.id,
        title: d.title,
        path: d.path,
        category: d.category,
        tags: d.tags,
        date: d.date,
        snippet: d.body.slice(0, 200).replace(/\s+/g, ' '),
      }));
  }

  graph(nodeId) {
    const outgoing = this.links.filter(l => l.from === nodeId).map(l => l.to);
    const incoming = this.links.filter(l => l.to === nodeId).map(l => l.from);
    const neighbors = [...new Set([...outgoing, ...incoming])];
    return {
      id: nodeId,
      outgoing,
      incoming,
      neighbors: neighbors.map(n => {
        const d = this.documents.find(doc => doc.id === n);
        return d ? { id: n, title: d.title } : { id: n, title: n };
      }),
    };
  }

  getDocument(id) {
    return this.documents.find(d => d.id === id) || null;
  }

  async removeDocument(id) {
    const doc = this.getDocument(id);
    if (!doc) return false;
    try {
      await fs.unlink(doc.path);
      this.logger.info(`Deleted wiki page: ${doc.path}`);
      await this.index();
      return true;
    } catch (e) {
      this.logger.error(`Failed to delete wiki page ${doc.path}: ${e.message}`);
      return false;
    }
  }

  listDocuments() {
    return this.documents.map(d => ({
      id: d.id,
      title: d.title,
      path: d.path,
      category: d.category,
      tags: d.tags,
      date: d.date,
    }));
  }

  async _latestMtime(dir) {
    let max = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          const child = await this._latestMtime(full);
          if (child > max) max = child;
        } else if (ent.name.endsWith('.md')) {
          const s = await fs.stat(full);
          if (s.mtimeMs > max) max = s.mtimeMs;
        }
      }
    } catch { /* ignore */ }
    return max;
  }

  async ensureFresh() {
    try {
      const latest = await this._latestMtime(this.wikiDir);
      if (latest > this._mtime) {
        await this.index();
      }
    } catch (e) {
      this.logger.warn(`Cannot refresh wiki index: ${e.message}`);
    }
  }
}
