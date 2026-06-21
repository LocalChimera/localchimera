import { Logger } from '../core/Logger.js';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { MarkdownIndexer } from '../llmwiki/MarkdownIndexer.js';
import { NodeOrchestrator } from '../orchestrator/NodeOrchestrator.js';
import { matchRoute } from './router.js';
import { ok, accepted, badRequest, serverError, serviceUnavailable, parseBody } from './reply.js';
import { extractBoundary, readBody, parseMultipart } from './multipart.js';
import { repoToMarkdown } from './repoDigest.js';
import { PayoutRouter } from '../payout/PayoutRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve built React frontend from project root
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'dist');

export class WebServer {
  constructor(config, nodeManager = null) {
    this.config = config;
    this.nodeManager = nodeManager;
    this.logger = new Logger('WebServer');
    this.server = null;
    this.port = process.env.PORT || 3002;
    this.corsOrigin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? null : '*');
    this.indexer = new MarkdownIndexer();
    this.orchestrator = new NodeOrchestrator();
    this.payoutRouter = new PayoutRouter(config?.multisig || {});
  }

  async initialize() {
    this.logger.info('Initializing web server...');
    try {
      await this.indexer.index();
    } catch (e) {
      this.logger.warn(`Initial llmwiki index failed: ${e.message}`);
    }
    // Create default welcome page if wiki is empty
    await this.ensureDefaultWelcomePage();
    this.logger.info('Web server initialized');
    await this.payoutRouter.store._ensureDir();
  }

  async ensureDefaultWelcomePage() {
    try {
      const wikiDir = path.join(process.cwd(), 'llmwiki-data', 'wiki', 'concepts');
      const welcomePath = path.join(wikiDir, 'welcome-to-chimera.md');
      try { await fs.access(welcomePath); return; } catch {}
      await fs.mkdir(wikiDir, { recursive: true });
      const content = `---
title: Welcome to Chimera
description: Getting started with your distributed AI wiki
date: ${new Date().toISOString().split('T')[0]}
tags: ["welcome","chimera","getting-started"]
---

# Welcome to Chimera

**Chimera** is a distributed AI wiki powered by QVAC, Hypercore, and Pear P2P.

## What you can do here

- **Generate** — Use AI to write wiki pages from prompts
- **Edit** — Rewrite, improve, or expand existing content
- **Draft** — Create structured outlines before writing
- **Analyze** — Check tone, readability, and weaknesses
- **Ingest** — Drag and drop PDFs, links, and files to convert to markdown
- **Auto** — Enable continuous AI research on a topic

## P2P Sharing

Create scoped swarms to collaborate:
- **Wiki Swarm** — Share your entire wiki with peers
- **Page Swarm** — Share only a specific page

Copy the topic hex and invite others to join.

## Getting Started

1. Click **+ New Page** or use the **Generate** tab in the AI panel
2. Write with AI assistance, save your work
3. Share via Hyperswarm P2P with your team

---

*Built with QVAC inference, Hypercore storage, and Pear P2P mesh networking.*
`;
      await fs.writeFile(welcomePath, content, 'utf-8');
      this.logger.info(`Created default welcome page: ${welcomePath}`);
      await this.indexer.index();
    } catch (e) {
      this.logger.warn(`Failed to create welcome page: ${e.message}`);
    }
  }
  
  /* ─── Upstream Python Bridge Helpers ─── */

  async _callPyBridge(scriptPath, args) {
    return new Promise((resolve, reject) => {
      const py = spawn('/usr/bin/python3', [scriptPath, ...args], {
        timeout: 30000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      let out = '', err = '';
      py.stdout.on('data', d => { out += d; });
      py.stderr.on('data', d => { err += d; });
      py.on('close', code => {
        if (code !== 0) {
          this.logger.warn(`[bridge] ${path.basename(scriptPath)} stderr: ${err.trim()}`);
          reject(new Error(err.trim() || `bridge exited ${code}`));
        } else {
          try { resolve(JSON.parse(out.trim())); }
          catch { resolve({ success: false, error: 'Invalid JSON from bridge' }); }
        }
      });
    });
  }

  async otterwiki(action, params = {}) {
    const script = path.join(__dirname, '..', 'llmwiki', 'otterwiki_bridge.py');
    const args = [action];
    for (const [k, v] of Object.entries(params)) {
      args.push(`--${k.replace(/_/g, '-')}`, String(v));
    }
    try {
      return await this._callPyBridge(script, args);
    } catch (e) {
      this.logger.warn(`[otterwiki] Bridge error: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  async openviking(action, params = {}) {
    const script = path.join(__dirname, '..', 'llmwiki', 'openviking_bridge.py');
    const args = [action];
    for (const [k, v] of Object.entries(params)) {
      args.push(`--${k.replace(/_/g, '-')}`, String(v));
    }
    try {
      return await this._callPyBridge(script, args);
    } catch (e) {
      this.logger.warn(`[openviking] Bridge error: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  async start() {
    this.logger.info('Starting web server...');
    
    this.server = createServer(async (req, res) => {
      // CORS — configurable via CORS_ORIGIN env var
      const origin = req.headers['origin'];
      if (this.corsOrigin === '*') {
        res.setHeader('Access-Control-Allow-Origin', '*');
      } else if (this.corsOrigin && origin === this.corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (this.corsOrigin) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      await this.handleRequest(req, res);
    });

    // Increase server timeout for long AI generation (10 min)
    this.server.timeout = 600000;
    this.server.keepAliveTimeout = 620000;
    
    this.server.listen(this.port, () => {
      this.logger.info(`Web server listening on port ${this.port}`);
    });
  }
  
  async stop() {
    this.logger.info('Stopping web server...');
    
    if (this.server) {
      this.server.close();
    }
    
    this.logger.info('Web server stopped');
  }
  
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    this.logger.debug(`${req.method} ${url.pathname}`);

    const handlerName = matchRoute(req.method, url.pathname);
    if (handlerName) {
      try {
        await this[handlerName](req, res);
      } catch (error) {
        this.logger.error(`${handlerName} threw:`, error);
        serverError(res, error);
      }
      return;
    }

    await this.serveStatic(res, url.pathname);
  }

  async serveStatic(res, pathname) {
    try {
      let filePath;
      let contentType = 'application/octet-stream';

      if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(PUBLIC_DIR, 'index.html');
        contentType = 'text/html';
      } else if (pathname.startsWith('/assets/')) {
        filePath = path.join(PUBLIC_DIR, pathname);
        try {
          await fs.access(filePath);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        if (pathname.endsWith('.js')) contentType = 'application/javascript';
        else if (pathname.endsWith('.css')) contentType = 'text/css';
      } else {
        // Try to serve other files from dist, fall back to index.html for SPA routing
        filePath = path.join(PUBLIC_DIR, pathname);
        try {
          await fs.access(filePath);
          if (pathname.endsWith('.html')) contentType = 'text/html';
          else if (pathname.endsWith('.css')) contentType = 'text/css';
          else if (pathname.endsWith('.js')) contentType = 'application/javascript';
          else if (pathname.endsWith('.json')) contentType = 'application/json';
          else if (pathname.endsWith('.png')) contentType = 'image/png';
          else if (pathname.endsWith('.svg')) contentType = 'image/svg+xml';
        } catch {
          // Don't fallback for known asset extensions — return 404 so browser knows to refresh
          if (/\.(js|css|png|svg|json|woff|woff2|ttf|eot)$/i.test(pathname)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }
          // SPA fallback: serve index.html for unknown routes (no extension or .html)
          filePath = path.join(PUBLIC_DIR, 'index.html');
          contentType = 'text/html';
        }
      }

      const content = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      this.logger.error(`Error serving ${pathname}:`, error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
  
  async handleConsent(req, res) {
    const body = await parseBody(req);
    const consentPath = path.join(process.cwd(), 'data', 'consent.json');
    await fs.mkdir(path.dirname(consentPath), { recursive: true });
    await fs.writeFile(consentPath, JSON.stringify({
      accepted: body.accepted,
      timestamp: Date.now(),
      userAgent: req.headers['user-agent'],
    }, null, 2));
    ok(res, { accepted: body.accepted });
  }
  
  async handleSignIn(req, res) {
    const body = await parseBody(req);
    ok(res, { method: body.method || 'email', email: body.email, timestamp: Date.now() });
  }
  
  async handleDownload(req, res) {
    const consentPath = path.join(process.cwd(), 'data', 'consent.json');
    try { await fs.access(consentPath); }
    catch { badRequest(res, 'Consent required'); return; }
    ok(res, { downloadUrl: '/install/qvac-chimera-installer.sh' });
  }
  
  async handleStatus(req, res) {
    if (!this.nodeManager) { serviceUnavailable(res, 'Node manager not available'); return; }
    const status = this.nodeManager.getStatus();
    // If this node is a commander, include the fleet roster
    if (this.orchestrator?.role === 'commander' && this.orchestrator.getWorkers) {
      status.fleet = {
        workers: this.orchestrator.getWorkers(),
        stats: this.orchestrator.getFleetStats(),
      };
    }
    ok(res, status);
  }
  
  async handleAIWrite(req, res) {
    const body = await parseBody(req);
    const prompt = body.prompt?.trim();
    const title = body.title?.trim();
    if (!prompt) { badRequest(res, 'Prompt is required'); return; }

    // Use QVAC inference layer (@qvac/sdk) for AI writing — always local
    const inference = this.nodeManager?.inferenceLayer;
    if (!inference) { serviceUnavailable(res, 'QVAC inference not initialized'); return; }

    this.logger.info(`AI write request: ${title || prompt}`);
    const result = await inference.handleInferenceRequest({
      prompt: `Write a wiki article${title ? ` titled "${title}"` : ''} about: ${prompt}`,
      maxTokens: 1024,
      temperature: 0.7,
      source: 'llmwiki-ai-write'
    });

    const docId = `ai-${Date.now()}`;
    const generatedTitle = title || result.output.split('\n')[0].replace(/^#\s*/, '').slice(0, 100);
    const doc = {
      id: docId,
      title: generatedTitle,
      body: result.output,
      source: 'qvac-sdk',
      model: result.model || 'llama',
      prompt,
      createdAt: Date.now()
    };

    if (this.nodeManager?.dataStore) await this.nodeManager.dataStore.appendAIDoc(doc);

    const docPath = path.join(process.cwd(), 'data', 'ai-docs', `${docId}.md`);
    await fs.mkdir(path.dirname(docPath), { recursive: true });
    await fs.writeFile(docPath, `# ${doc.title}\n\n${doc.body}\n\n<!-- source: qvac-sdk | model: ${doc.model} | prompt: ${prompt} -->\n`);

    ok(res, doc);
  }

  async handleAIStatus(req, res) {
    const inference = this.nodeManager?.inferenceLayer;
    ok(res, inference ? inference.getStatus() : { available: false });
  }

  async handleAIDocs(req, res) {
    const docsDir = path.join(process.cwd(), 'data', 'ai-docs');
    const files = [];
    try {
      const entries = await fs.readdir(docsDir);
      for (const entry of entries.filter(e => e.endsWith('.md'))) {
        const full = path.join(docsDir, entry);
        const content = await fs.readFile(full, 'utf-8');
        const titleMatch = content.match(/^#\s(.+)$/m);
        files.push({ id: entry.replace('.md', ''), title: titleMatch?.[1] ?? entry, createdAt: (await fs.stat(full)).mtime.getTime() });
      }
    } catch { /* directory may not exist */ }
    ok(res, files.sort((a, b) => b.createdAt - a.createdAt));
  }

  // ── Embedding + RAG (QVAC SDK) ──────────────────────────────────────

  async handleEmbedding(req, res) {
    const svc = this.nodeManager?.embeddingService;
    if (!svc || !svc.ready) { serviceUnavailable(res, 'Embedding service not ready'); return; }

    const body = await parseBody(req);
    const texts = body.texts || body.text ? [body.text] : [];
    if (!texts.length) { badRequest(res, 'Provide "texts" or "text"'); return; }

    try {
      const vectors = await svc.embed(texts);
      ok(res, { vectors, count: vectors.length, dimension: vectors[0]?.length || 0 });
    } catch (e) {
      this.logger.error(`[embedding] ${e.message}`);
      serverError(res, e);
    }
  }

  async handleRagIngest(req, res) {
    const svc = this.nodeManager?.embeddingService;
    if (!svc || !svc.ready) { serviceUnavailable(res, 'Embedding service not ready'); return; }

    const body = await parseBody(req);
    const { workspace = 'chimera-rag', documents = [] } = body;
    if (!documents.length) { badRequest(res, 'Provide "documents" array'); return; }

    try {
      await svc.ragIngest(workspace, documents);
      ok(res, { workspace, ingested: documents.length });
    } catch (e) {
      this.logger.error(`[rag-ingest] ${e.message}`);
      serverError(res, e);
    }
  }

  async handleRagSearch(req, res) {
    const svc = this.nodeManager?.embeddingService;
    if (!svc || !svc.ready) { serviceUnavailable(res, 'Embedding service not ready'); return; }

    const body = await parseBody(req);
    const { workspace = 'chimera-rag', query = '', topK = 5 } = body;
    if (!query) { badRequest(res, 'Provide "query"'); return; }

    try {
      const matches = await svc.ragSearch(workspace, query, topK);
      ok(res, { workspace, query, matches });
    } catch (e) {
      this.logger.error(`[rag-search] ${e.message}`);
      serverError(res, e);
    }
  }

  async handleRagWorkspaces(req, res) {
    const svc = this.nodeManager?.embeddingService;
    try {
      const workspaces = await svc?.ragListWorkspaces() || [];
      ok(res, { workspaces });
    } catch (e) {
      this.logger.error(`[rag-workspaces] ${e.message}`);
      serverError(res, e);
    }
  }

  // ── LLM Wiki ────────────────────────────────────────────────────────

  async handleLLMWikiCreate(req, res) {
    const body = await parseBody(req);
    const { topic = '', prompt: customPrompt = '', category = 'concepts', tags = [], description = '', links = [] } = body;
    if (!topic && !customPrompt) { badRequest(res, 'topic or prompt is required'); return; }

    const jobId = await this._spawnBridgeJob({ topic, customPrompt, category, tags, description, links });
    accepted(res, { jobId, topic: customPrompt || topic, category, status: 'started',
      message: `Wiki page generation started for category '${category}'.` });
  }

  async handleLLMWikiUpload(req, res) {
    const boundary = extractBoundary(req);
    if (!boundary) { badRequest(res, 'Missing multipart boundary'); return; }

    const data = await readBody(req);
    const parts = parseMultipart(data, boundary);
    const filePart = parts.find(p => p.filename);
    if (!filePart) { badRequest(res, 'No file uploaded'); return; }

    const fields = Object.fromEntries(parts.filter(p => !p.filename).map(p => [p.name, p.value]));
    const category = fields.category || 'concepts';
    const tags = (fields.tags || '').split(',').map(t => t.trim()).filter(Boolean);

    const sourcesDir = path.join(process.cwd(), 'llmwiki-data', 'sources');
    await fs.mkdir(sourcesDir, { recursive: true });
    const destPath = path.join(sourcesDir, filePart.filename);
    await fs.writeFile(destPath, filePart.data);

    const jobId = await this._spawnBridgeJob({
      topic: filePart.filename,
      customPrompt: 'Analyze the following document and write a comprehensive wiki page summarizing its key concepts, findings, and structure.',
      category,
      tags,
      description: fields.title || '',
      fileSource: destPath,
    });
    accepted(res, { jobId, filename: filePart.filename, category, status: 'started',
      message: `File saved. Wiki page generation started for category '${category}'.` });
  }

  async handleConvertToMd(req, res) {
    const boundary = extractBoundary(req);
    if (!boundary) { badRequest(res, 'Missing multipart boundary'); return; }

    const data = await readBody(req);
    const parts = parseMultipart(data, boundary);
    const filePart = parts.find(p => p.filename);
    if (!filePart) { badRequest(res, 'No file uploaded'); return; }

    const tmpDir = path.join(process.cwd(), 'tmp-uploads');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `${Date.now()}-${filePart.filename}`);
    await fs.writeFile(tmpPath, filePart.data);

    try {
      this.logger.info(`[markitdown] Converting ${filePart.filename} via upstream/microsoft-markitdown...`);
      // Use upstream markitdown as a Python module (installed from submodule)
      const py = spawn('/usr/bin/python3', ['-m', 'markitdown', tmpPath], { timeout: 60000 });

      let out = '', err = '';
      py.stdout.on('data', d => { out += d; });
      py.stderr.on('data', d => { err += d; });

      await new Promise((resolve, reject) => {
        py.on('close', code => {
          if (code !== 0) reject(new Error(err || 'markitdown failed'));
          else resolve();
        });
      });

      // cleanup temp file
      try { await fs.unlink(tmpPath); } catch (_) {}

      ok(res, { filename: filePart.filename, markdown: out.trim() });
    } catch (e) {
      this.logger.error(`[markitdown] Failed: ${e.message}`);
      try { await fs.unlink(tmpPath); } catch (_) {}
      serverError(res, e);
    }
  }

  async handleLLMWikiDocs(req, res) {
    await this.indexer.ensureFresh();
    const docs = this.indexer.listDocuments();
    // Also query OtterWiki upstream backend
    const ow = await this.otterwiki('list');
    if (ow.success && ow.pages) {
      for (const p of ow.pages) {
        if (!docs.find(d => d.path === p)) {
          docs.push({ id: p.replace('.md',''), title: p.replace('.md','').replace(/_/g,' '), path: p, category: 'concepts' });
        }
      }
    }
    ok(res, docs);
  }

  async handleLLMWikiSearch(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = url.searchParams.get('q') || '';
    const tags = (url.searchParams.get('tags') || '').split(',').filter(Boolean);
    const category = url.searchParams.get('category') || '';
    await this.indexer.ensureFresh();
    const results = this.indexer.search(query, { tags, category });
    // Also search OtterWiki upstream backend
    const ow = await this.otterwiki('search', { query });
    if (ow.success && ow.results) {
      for (const r of ow.results) {
        if (!results.find(x => x.path === r.filename)) {
          results.push({ id: r.filename.replace('.md',''), title: r.filename.replace('.md','').replace(/_/g,' '), path: r.filename, snippet: r.snippet });
        }
      }
    }
    ok(res, results);
  }

  async handleWikiStatus(req, res) {
    const store = this.nodeManager?.dataStore;
    const p2p = this.nodeManager?.p2pNetwork;
    const llm = this.nodeManager?.localLLM;

    // Check upstream integrations
    let openvikingStatus = { available: false };
    let otterwikiStatus = { available: false };
    try {
      const ov = await this.openviking('create_session');
      openvikingStatus = { available: ov.success, session: ov.result?.id || 'chimera-default' };
    } catch (e) { /* ignore */ }
    try {
      const ow = await this.otterwiki('list');
      otterwikiStatus = { available: ow.success, pages: ow.pages?.length || 0 };
    } catch (e) { /* ignore */ }

    const emb = this.nodeManager?.embeddingService;
    ok(res, {
      qvac: llm ? { available: true, ...llm.getStatus() } : { available: false },
      embedding: emb ? { available: emb.ready, ...emb.getStatus() } : { available: false },
      hypercore: store ? { available: true, ...store.getStatus() } : { available: false },
      pear: p2p ? { available: true, running: p2p.isRunning, peers: p2p.peers?.size || 0 } : { available: false },
      openviking: openvikingStatus,
      otterwiki: otterwikiStatus,
      wikiDir: path.join(process.cwd(), 'llmwiki-data')
    });
  }

  async handleLLMWikiGraph(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const nodeId = url.searchParams.get('id') || '';
    await this.indexer.ensureFresh();
    const result = nodeId
      ? this.indexer.graph(nodeId)
      : { nodes: this.indexer.documents.length, links: this.indexer.links.length };
    ok(res, result);
  }

  async handleLLMWikiDelete(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = url.searchParams.get('id') || '';
    if (!id) { badRequest(res, 'id is required'); return; }
    // Also delete from OtterWiki upstream backend
    await this.otterwiki('delete', { title: id });
    const removed = await this.indexer.removeDocument(id);
    if (removed) ok(res, { deleted: true });
    else badRequest(res, 'Document not found');
  }

  async handleRepoToMd(req, res) {
    const body = await parseBody(req);
    const result = await repoToMarkdown(body);
    if (result.success) ok(res, result.data);
    else badRequest(res, result.error);
  }

  async handleLLMWikiSave(req, res) {
    const body = await parseBody(req);
    const { content = '', title = 'Untitled', category = 'concepts', tags = [] } = body;
    if (!content.trim()) { badRequest(res, 'content is required'); return; }

    const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const fileName = `${slug || 'untitled'}.md`;
    const wikiDir = path.join(process.cwd(), 'llmwiki-data', 'wiki', category);
    const filePath = path.join(wikiDir, fileName);
    const conceptId = `${category}/${slug || 'untitled'}`;
    const today = new Date().toISOString().split('T')[0];

    const frontmatter = `---\nid: ${conceptId}\ntitle: ${title}\ndescription: AI-generated wiki page\ntags: ${JSON.stringify(tags)}\ncreated: ${today}\nmodified: ${today}\n---\n\n`;
    const fullContent = frontmatter + content;

    try {
      await fs.mkdir(wikiDir, { recursive: true });
      await fs.writeFile(filePath, fullContent, 'utf-8');
      this.logger.info(`[llmwiki] Saved ${filePath}`);

      // ─── OtterWiki upstream backend ───
      const ow = await this.otterwiki('save', { title, content: fullContent, message: `Save ${title}` });
      if (ow.success) {
        this.logger.info(`[otterwiki] Saved ${title} → ${ow.filename}`);
      }

      // ─── OpenViking memory store ───
      const ov = await this.openviking('store', { content: fullContent, role: 'assistant' });
      if (ov.success) {
        this.logger.info(`[openviking] Stored memory for ${title}`);
      }

      // ─── Hypercore persistence ───
      if (this.nodeManager?.dataStore) {
        const seq = await this.nodeManager.dataStore.append({
          type: 'wiki-page',
          title,
          category,
          tags,
          content: fullContent,
          filePath,
          createdAt: Date.now()
        });
        this.logger.info(`[llmwiki] Hypercore append seq ${seq}`);
      }

      // ─── Pear P2P broadcast ───
      const p2p = this.nodeManager?.p2pNetwork;
      if (p2p) {
        const pageId = conceptId;
        const msg = { type: 'wiki-new-page', title, category, fileName, content: fullContent, tags, timestamp: Date.now() };

        // Broadcast to wiki-wide swarms
        const wikiTopics = p2p.getTopicsByScope('wiki');
        if (wikiTopics.length > 0) {
          await p2p.broadcastToTopics(msg, { scope: 'wiki', pageId });
          this.logger.info(`[llmwiki] Broadcast to ${wikiTopics.length} wiki swarm(s): ${title}`);
        }

        // Broadcast to page-specific swarms
        const pageTopics = p2p.getTopicsByScope('page', pageId);
        if (pageTopics.length > 0) {
          await p2p.broadcastToTopics(msg, { scope: 'page', pageId });
          this.logger.info(`[llmwiki] Broadcast to ${pageTopics.length} page swarm(s): ${title}`);
        }
      }

      // Refresh index so it appears immediately
      await this.indexer.index();
      ok(res, { id: conceptId, title, path: `/${category}/${fileName}`, category, tags });
    } catch (e) {
      this.logger.error(`[llmwiki] Save failed: ${e.message}`);
      serverError(res, e);
    }
  }

  /* ─── Swarm / P2P Handlers ─── */

  async handleSwarmCreate(req, res) {
    const p2p = this.nodeManager?.p2pNetwork;
    if (!p2p) { serviceUnavailable(res, 'P2P not initialized'); return; }

    const body = await parseBody(req);
    const scope = body.scope || 'wiki'; // 'wiki' | 'page'
    const pageId = body.pageId || null;
    const pageTitle = body.pageTitle || null;

    const topic = p2p.generateTopic();
    const topicHex = await p2p.joinTopic(topic, { scope, pageId, title: pageTitle });
    const inviteUrl = `${req.headers.origin || `http://${req.headers.host}`}/api/swarm/join?topic=${topicHex}`;

    ok(res, {
      topic: topicHex,
      shortTopic: topicHex.slice(0, 16) + '...',
      scope,
      pageId,
      inviteUrl,
      message: scope === 'page'
        ? `Share the topic hex to collaborate on this page only.`
        : `Share the topic hex to sync the entire wiki.`
    });
  }

  async handleSwarmJoin(req, res) {
    const p2p = this.nodeManager?.p2pNetwork;
    if (!p2p) { serviceUnavailable(res, 'P2P not initialized'); return; }

    const body = await parseBody(req);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const topicHex = body.topic || url.searchParams.get('topic') || '';
    if (!topicHex || topicHex.length !== 64) { badRequest(res, 'Valid 64-char topic hex required'); return; }

    try {
      const joinedHex = await p2p.joinTopic(Buffer.from(topicHex, 'hex'), { scope: body.scope || 'wiki', pageId: body.pageId || null });
      ok(res, { topic: joinedHex, status: 'joined', peers: p2p.peers.size });
    } catch (e) {
      this.logger.error(`[swarm] Join failed: ${e.message}`);
      serverError(res, e);
    }
  }

  async handleSwarmStatus(req, res) {
    const p2p = this.nodeManager?.p2pNetwork;
    if (!p2p) { ok(res, { available: false }); return; }
    ok(res, {
      available: true,
      running: p2p.isRunning,
      peers: p2p.peers.size,
      topics: p2p.getTopicList()
    });
  }

  /* ─── Inference Swarm ─── */

  async handleSwarmInfer(req, res) {
    const body = await parseBody(req);
    const prompt = body.prompt?.trim();
    if (!prompt) { badRequest(res, 'Prompt is required'); return; }

    // If this node is a commander with active workers, route inference to the swarm
    const orch = this.orchestrator;
    const useSwarm = orch?.role === 'commander' && orch?.getWorkers && orch.getWorkers().some(w => w.online && w.inferenceReady);

    if (useSwarm) {
      this.logger.info(`[swarm-infer] Routing inference to swarm: ${prompt.slice(0, 80)}…`);
      const result = await orch.routeInference({
        model: body.model || 'chimera-local',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: body.maxTokens || 1024,
        temperature: body.temperature ?? 0.7,
      });

      if (result.success) {
        ok(res, {
          swarm: true,
          worker: result.worker,
          output: result.data?.choices?.[0]?.message?.content || result.data?.output || JSON.stringify(result.data),
          model: body.model || 'chimera-local',
        });
        return;
      }

      this.logger.warn(`[swarm-infer] Routing failed (${result.reason}), falling back to local inference`);
    }

    // Fallback: run inference locally
    const inference = this.nodeManager?.inferenceLayer;
    if (!inference) { serviceUnavailable(res, 'QVAC inference not initialized'); return; }

    this.logger.info(`[swarm-infer] Local inference: ${prompt.slice(0, 80)}…`);
    const result = await inference.handleInferenceRequest({
      prompt,
      maxTokens: body.maxTokens || 1024,
      temperature: body.temperature ?? 0.7,
      source: 'swarm-infer',
    });

    ok(res, {
      swarm: false,
      fallback: true,
      output: result.output,
      model: result.model || 'llama',
    });
  }

  /* ─── Orchestrator Handlers ─── */

  async handleCommanderRegister(req, res) {
    const { workerUrl, evmAddress, casperProvider, capacity, inferenceUrl, inferenceReady } = await parseBody(req);
    const result = this.orchestrator.registerWorker(workerUrl, { evmAddress, casperProvider, capacity, inferenceUrl, inferenceReady });
    ok(res, result);
  }

  async handleCommanderWorkers(req, res) {
    ok(res, this.orchestrator.getWorkers());
  }

  async handleCommanderStats(req, res) {
    ok(res, this.orchestrator.getFleetStats());
  }

  async handleCommanderJobs(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    ok(res, this.orchestrator.claimJob(url.searchParams.get('worker') || ''));
  }

  async handleCommanderComplete(req, res) {
    const { jobId, workerUrl, pagesGenerated = 1 } = await parseBody(req);
    this.orchestrator.completeJob(jobId, workerUrl, pagesGenerated);
    ok(res, { completed: jobId });
  }

  async handleCommanderDistribute(req, res) {
    const { jobs = [] } = await parseBody(req);
    const result = this.orchestrator.addJobs(jobs);
    ok(res, result);
  }

  async handleCommanderStop(req, res) {
    ok(res, this.orchestrator.stopFleet());
  }

  async handleCommanderStart(req, res) {
    ok(res, this.orchestrator.startFleet());
  }

  async handleWorkerStop(req, res) {
    this.orchestrator.receiveStop();
    ok(res, { message: 'Worker will halt after current job' });
  }

  async handleStart(req, res) {
    if (!this.nodeManager) { serviceUnavailable(res, 'Node manager not available'); return; }
    const body = await parseBody(req);

    // Ensure the inference node is running (idempotent)
    if (!this.nodeManager.isRunning) await this.nodeManager.start();

    let machineOwner = (body.machineOwnerEVM || body.evmAddress || '').trim();
    let appDev = (body.appDeveloperEVM || '').trim();

    // ─── Require a valid EVM address before miners can start ───
    const evmRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!evmRegex.test(machineOwner)) {
      badRequest(res, 'A valid machineOwnerEVM address is required to start mining (42-char hex starting with 0x)');
      return;
    }

    if (this.nodeManager.minerManager) {
      this.nodeManager.minerManager.evmAddress = machineOwner;
      this.logger.info(`[miner] Machine owner EVM: ${machineOwner}`);

      // Propagate to already-constructed miners so they start with the correct address
      const miners = this.nodeManager.minerManager.miners;
      for (const name of ['cortensor', 'fortytwo']) {
        const m = miners.get(name);
        if (m) m.walletAddress = machineOwner;
      }
      for (const name of ['chutes', 'routstr']) {
        const m = miners.get(name);
        if (m) m.evmAddress = machineOwner;
      }

      // Persist to config.json so the address survives restarts
      try {
        const configPath = path.join(__dirname, '..', '..', 'config.json');
        const raw = await fs.readFile(configPath, 'utf-8');
        const cfg = JSON.parse(raw);
        cfg.multisig.machineOwnerAddress = machineOwner;
        cfg.miners.cortensor.config.walletAddress = machineOwner;
        cfg.miners.fortytwo.config.walletAddress = machineOwner;
        await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
        this.logger.info(`[miner] Persisted EVM address to config.json`);
      } catch (e) {
        this.logger.warn(`[miner] Could not persist EVM address to config.json: ${e.message}`);
      }
      if (appDev) {
        this.nodeManager.minerManager.appDeveloperEVM = appDev;
        this.logger.info(`[miner] App developer EVM: ${appDev}`);
      }
      if (body.revenueSplit) {
        this.nodeManager.minerManager.revenueSplit = body.revenueSplit;
        this.logger.info(`[miner] Revenue split — machine owner: ${(body.revenueSplit.machineOwner * 100).toFixed(0)}%, app developer: ${(body.revenueSplit.appDeveloper * 100).toFixed(0)}%`);
      }

      // ─── START MINERS ONLY when user explicitly consents ───
      if (!this.nodeManager.minerManager.isRunning) {
        await this.nodeManager.minerManager.start();
        this.logger.info('[miner] Miners started by user action');
      }
    }

    // ─── Auto-register this machine on the routing network ───
    // Use configured publicUrl, or X-Forwarded-Host / Host header, or fallback to localhost
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || `localhost:${this.port}`;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const configPublicUrl = this.nodeManager?.config?.node?.publicUrl || '';
    const nodeUrl = configPublicUrl || `${proto}://${host}`;
    const providerHash = body.casperProvider || '';
    const evmAddr = machineOwner || appDev || '';
    this.orchestrator.registerWorker(nodeUrl, {
      evmAddress: evmAddr,
      casperProvider: providerHash,
      capacity: body.capacity || 1,
      inferenceUrl: `${nodeUrl}/v1/chat/completions`,
      inferenceReady: true,
    });
    this.logger.info(`[router] Auto-registered node ${nodeUrl} (EVM: ${evmAddr}, Provider: ${providerHash})`);

    ok(res, { message: 'Mining started', running: true, registered: { url: nodeUrl, evmAddress: evmAddr, casperProvider: providerHash } });
  }

  async handleStop(req, res) {
    if (!this.nodeManager) { serviceUnavailable(res, 'Node manager not available'); return; }
    // Only stop miners — inference node keeps running so the user can
    // browse the wiki and use AI features without earning.
    if (this.nodeManager.minerManager?.isRunning) {
      await this.nodeManager.minerManager.stop();
      this.logger.info('[miner] Miners stopped by user action');
    }
    ok(res, { message: 'Mining stopped', running: false });
  }

  async handleCasperStatus(req, res) {
    if (!this.nodeManager?.minerManager) { serviceUnavailable(res, 'Miner manager not available'); return; }
    const casper = this.nodeManager.minerManager.miners.get('casper');
    if (!casper) { ok(res, { available: false, reason: 'Casper miner not configured' }); return; }
    ok(res, { available: true, ...casper.getStatus() });
  }

  async handleMinerTest(req, res) {
    if (!this.nodeManager?.minerManager) { serviceUnavailable(res, 'Miner manager not available'); return; }
    const mm = this.nodeManager.minerManager;
    const results = [];
    const testTask = { id: `test-${Date.now()}`, prompt: 'What is 2+2?', maxTokens: 32, temperature: 0.5 };

    for (const [name, miner] of mm.miners) {
      const started = Date.now();
      try {
        const result = await miner.onInferenceTask(testTask);
        results.push({
          miner: name,
          success: result.success,
          output: result.result?.output?.slice(0, 200) || result.output?.slice(0, 200) || null,
          latency: Date.now() - started,
          fallback: result.result?.fallback || result.fallback || false,
          error: result.error || null
        });
      } catch (err) {
        results.push({ miner: name, success: false, latency: Date.now() - started, error: err.message });
      }
    }

    const allPassed = results.every(r => r.success);
    ok(res, {
      tested: results.length,
      passed: results.filter(r => r.success).length,
      allPassed,
      task: testTask.id,
      results
    });
  }

  // ─── Payout Router ───

  async handlePayoutRegisterApp(req, res) {
    const body = await parseBody(req);
    const result = await this.payoutRouter.registerApp(body);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetApps(req, res) {
    ok(res, await this.payoutRouter.getApps());
  }

  async handlePayoutRegisterUser(req, res) {
    const body = await parseBody(req);
    const result = await this.payoutRouter.registerUser(body);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetUsers(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const appId = url.searchParams.get('appId');
    ok(res, await this.payoutRouter.getUsers(appId));
  }

  async handlePayoutRecordOrder(req, res) {
    const body = await parseBody(req);
    const result = await this.payoutRouter.recordOrder(body);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetOrders(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId');
    const appId = url.searchParams.get('appId');
    const year = parseInt(url.searchParams.get('year') || '0', 10) || undefined;
    const month = parseInt(url.searchParams.get('month') || '0', 10) || undefined;
    ok(res, await this.payoutRouter.getOrders({ userId, appId, year, month }));
  }

  async handlePayoutCalculate(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const year = parseInt(url.searchParams.get('year') || String(new Date().getUTCFullYear()), 10);
    const month = parseInt(url.searchParams.get('month') || String(new Date().getUTCMonth() + 1), 10);
    const result = await this.payoutRouter.calculateMonthlyPayout(year, month);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetManifest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const year = parseInt(url.searchParams.get('year') || String(new Date().getUTCFullYear()), 10);
    const month = parseInt(url.searchParams.get('month') || String(new Date().getUTCMonth() + 1), 10);
    ok(res, await this.payoutRouter.getPayoutManifest(year, month));
  }

  async handlePayoutMarkDistributed(req, res) {
    const body = await parseBody(req);
    const { year, month, txHash } = body;
    ok(res, await this.payoutRouter.markDistributed(year, month, txHash));
  }

  async handlePayoutDeny(req, res) {
    const body = await parseBody(req);
    const { year, month, memberId, reason } = body;
    const result = await this.payoutRouter.denyDistribution(year, month, { memberId, reason });
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutConfirm(req, res) {
    const body = await parseBody(req);
    const { year, month, txHash } = body;
    const result = await this.payoutRouter.confirmDistribution(year, month, txHash);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutExecute(req, res) {
    const body = await parseBody(req);
    const year = parseInt(body.year || new Date().getUTCFullYear(), 10);
    const month = parseInt(body.month || new Date().getUTCMonth() + 1, 10);
    const result = await this.payoutRouter.executeDistribution(year, month);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutStats(req, res) {
    ok(res, await this.payoutRouter.getStats());
  }

  // ─── OpenAI-compatible proxy (for Routstr upstream) ───

  async handleOpenAIModels(req, res) {
    ok(res, {
      object: 'list',
      data: [
        { id: 'llama-3.2-1b-instruct', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'chimera' },
        { id: 'llama-3.2-3b-instruct', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'chimera' },
        { id: 'chimera-local',        object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'chimera' }
      ]
    });
  }

  async handleOpenAIChat(req, res) {
    const body = await parseBody(req);
    const messages = body.messages || [];
    const stream = body.stream === true;
    const model = body.model || 'chimera-local';
    const maxTokens = body.max_tokens || 512;
    const temperature = body.temperature || 0.7;

    // Convert messages array to a single prompt
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const userMsgs = messages.filter(m => m.role === 'user').map(m => m.content);
    const prompt = userMsgs.join('\n\n') || JSON.stringify(messages);

    const inference = this.nodeManager?.inferenceLayer;
    if (!inference) {
      if (stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.write(`data: ${JSON.stringify({ id: 'chatcmpl-error', object: 'chat.completion.chunk', choices: [{ delta: { content: 'Inference layer not available' }, index: 0 }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        serviceUnavailable(res, 'QVAC inference not initialized');
      }
      return;
    }

    const requestId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    try {
      this.logger.info(`[openai-proxy] ${model} | ${prompt.slice(0, 80)}…`);
      const result = await inference.handleInferenceRequest({
        prompt: systemMsg ? `[System: ${systemMsg}]\n${prompt}` : prompt,
        maxTokens,
        temperature,
        source: 'routstr-openai-proxy'
      });

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // Send chunks word-by-word for streaming effect
        const words = (result.output || '').split(/\s+/);
        for (let i = 0; i < words.length; i++) {
          const chunk = {
            id: requestId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: { content: (i > 0 ? ' ' : '') + words[i] },
              finish_reason: null
            }]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        // Final chunk
        res.write(`data: ${JSON.stringify({ id: requestId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        ok(res, {
          id: requestId,
          object: 'chat.completion',
          created,
          model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: result.output || '' },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: prompt.length / 4,
            completion_tokens: (result.output || '').length / 4,
            total_tokens: (prompt.length + (result.output || '').length) / 4
          }
        });
      }
    } catch (e) {
      this.logger.error(`[openai-proxy] Inference failed: ${e.message}`);
      if (stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'chatcmpl-error', object: 'chat.completion.chunk', choices: [{ delta: { content: `Error: ${e.message}` }, index: 0 }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        serverError(res, e);
      }
    }
  }

  /* ─── Private helpers ─── */

  async _spawnBridgeJob({ topic, customPrompt, category, tags, description, links = [], fileSource = '' }) {
    const workspace = path.join(process.cwd(), 'llmwiki-data');
    const bridge = path.join(process.cwd(), 'src', 'llmwiki', 'bridge.py');
    const args = [bridge, workspace, topic || 'Untitled', '--category', category];
    if (tags.length)       args.push('--tags', ...tags);
    if (description)       args.push('--description', description);
    if (customPrompt)      args.push('--prompt', customPrompt);
    if (links.length)      args.push('--links', ...links);
    if (fileSource)        args.push('--file-source', fileSource);

    const jobId = `lw-${Date.now()}`;
    this.logger.info(`[llmwiki] Job ${jobId}: ${customPrompt || topic} (${category})`);

    const proc = spawn('/usr/bin/python3', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.unref();
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code !== 0) this.logger.error(`[llmwiki] Job ${jobId} failed: ${err || out}`);
      else this.logger.info(`[llmwiki] Job ${jobId} completed`);
    });
    return jobId;
  }
}
