import { Logger } from '../core/Logger.js';
import { createServer } from 'http';
import { promises as fs, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { MarkdownIndexer } from '../llmwiki/MarkdownIndexer.js';
import { NodeOrchestrator } from '../orchestrator/NodeOrchestrator.js';
import { matchRoute, extractRouteParams } from './router.js';
import { ok, accepted, badRequest, serverError, serviceUnavailable, parseBody } from './reply.js';
import { extractBoundary, readBody, parseMultipart } from './multipart.js';
import { repoToMarkdown } from './repoDigest.js';
import { PayoutRouter } from '../payout/PayoutRouter.js';
import { marketApi } from '../api/marketApi.js';

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
  
  handleHealth(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }

  async handleAuditLogs(req, res) {
    const auditDir = path.join(process.cwd(), 'data', 'audit');
    try {
      const files = (await fs.readdir(auditDir)).filter(f => f.endsWith('.jsonl')).sort();
      const logs = [];
      for (const file of files.slice(-7)) { // last 7 days
        const raw = await fs.readFile(path.join(auditDir, file), 'utf-8');
        const lines = raw.split('\n').filter(Boolean);
        logs.push({ date: file.replace('.jsonl', ''), events: lines.map(l => JSON.parse(l)) });
      }
      ok(res, { files: files.length, logs });
    } catch {
      ok(res, { files: 0, logs: [] });
    }
  }

  async handleAuditRun(req, res) {
    if (!this._requireAuth(req, res)) return;
    const audit = this.nodeManager?.audit;
    if (!audit) { serviceUnavailable(res, 'Audit logger not initialized'); return; }
    // Trigger a lightweight audit heartbeat event
    audit.modelLoad({ modelId: 'api-ping', durationMs: 0, source: 'api-trigger' });
    await audit.stop();
    ok(res, { triggered: true, note: 'For a full audit run execute: node scripts/audit-demo.js from the repo root' });
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
    const auth = this.nodeManager?.authService;
    if (!auth) { serviceUnavailable(res, 'Auth service not available'); return; }
    try {
      const result = await auth.signIn(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      badRequest(res, e.message);
    }
  }

  async handleSignOut(req, res) {
    const auth = this.nodeManager?.authService;
    if (!auth) { serviceUnavailable(res, 'Auth service not available'); return; }
    await auth.signOut();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ signedOut: true }));
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
    const aiStart = Date.now();
    const result = await inference.handleInferenceRequest({
      prompt: `Write a wiki article${title ? ` titled "${title}"` : ''} about: ${prompt}`,
      maxTokens: 1024,
      temperature: 0.7,
      source: 'llmwiki-ai-write'
    });

    const aiDuration = Date.now() - aiStart;
    const aiTokens = result.tokensGenerated || Math.ceil(result.output.length / 4);
    if (this.nodeManager?.audit) this.nodeManager.audit.inference({ prompt, outputTokens: aiTokens, durationMs: aiDuration, modelId: result.model || 'llama', source: 'llmwiki-ai-write' });

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

  _requireAuth(req, res) {
    const auth = this.nodeManager?.authService;
    if (!auth) { serviceUnavailable(res, 'Auth service unavailable'); return false; }
    const header = req.headers['authorization'] || '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (!token || !auth.validateToken(token)) { badRequest(res, 'Authentication required'); return false; }
    return true;
  }

  async handleStart(req, res) {
    if (!this._requireAuth(req, res)) return;
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

    // ─── Auto-register provider on all Casper contracts ───
    let casperResult = null;
    if (this.nodeManager.casperRegistrar) {
      try {
        const deviceProfile = {
          hasGpu: false,
          vramMb: 0,
          cpuCores: require('os').cpus().length,
          ramMb: Math.round(require('os').totalmem() / 1024 / 1024),
          storageMb: 10240,
          bandwidthMbps: 100,
          models: this.config?.inference?.qvac?.models || ['llama-3.2-1b-instruct'],
        };
        casperResult = await this.nodeManager.casperRegistrar.registerAll({
          peerId: this.config?.node?.id || 'chimera-node',
          nodeName: this.config?.node?.name || 'Chimera Node',
          deviceProfile,
        });
        this.logger.info(`[casper] Auto-registration result: ${casperResult.registered.length} contracts, ${casperResult.errors.length} errors`);
      } catch (e) {
        this.logger.warn(`[casper] Auto-registration failed: ${e.message}`);
        casperResult = { registered: [], errors: [e.message] };
      }
    }

    ok(res, { message: 'Mining started', running: true, registered: { url: nodeUrl, evmAddress: evmAddr, casperProvider: providerHash }, casper: casperResult });
  }

  async handleStop(req, res) {
    if (!this._requireAuth(req, res)) return;
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
    if (!this._requireAuth(req, res)) return;
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

  /* ─── Proof of Inference ─── */

  handleProofStatus(req, res) {
    const poi = this.nodeManager?.proofOfInference;
    if (!poi) { serviceUnavailable(res, 'Proof of Inference not initialized'); return; }
    ok(res, poi.getStatus());
  }

  async handleProofVerify(req, res) {
    const body = await parseBody(req);
    const { receipt } = body;
    if (!receipt) { badRequest(res, 'Provide "receipt" object'); return; }
    const { ProofOfInference } = await import('../inference/ProofOfInference.js');
    const result = ProofOfInference.verifyReceipt(receipt);
    ok(res, result);
  }

  /* ─── Prompt Guard ─── */

  handlePromptGuardStatus(req, res) {
    const guard = this.nodeManager?.promptGuard;
    if (!guard) { serviceUnavailable(res, 'PromptGuard not initialized'); return; }
    ok(res, guard.getStats());
  }

  async handlePromptGuardCheck(req, res) {
    const guard = this.nodeManager?.promptGuard;
    if (!guard) { serviceUnavailable(res, 'PromptGuard not initialized'); return; }
    const body = await parseBody(req);
    const { text } = body;
    if (!text) { badRequest(res, 'Provide "text"'); return; }
    ok(res, { injectionSuspected: guard.detectInjection(text) });
  }

  /* ─── Token Meter ─── */

  handleMeterStatus(req, res) {
    const meter = this.nodeManager?.tokenMeter;
    if (!meter) { serviceUnavailable(res, 'TokenMeter not initialized'); return; }
    ok(res, meter.getStatus());
  }

  handleMeterSessions(req, res) {
    const meter = this.nodeManager?.tokenMeter;
    if (!meter) { serviceUnavailable(res, 'TokenMeter not initialized'); return; }
    ok(res, { sessions: meter.getSessions(), settlements: meter.getSettlements() });
  }

  async handleMeterSettle(req, res) {
    const meter = this.nodeManager?.tokenMeter;
    if (!meter) { serviceUnavailable(res, 'TokenMeter not initialized'); return; }
    const body = await parseBody(req);
    const { routeId, txHash, amount, chain } = body;
    if (!routeId || !txHash || amount === undefined) { badRequest(res, 'Provide routeId, txHash, amount'); return; }
    const record = meter.recordSettlement(routeId, { txHash, amount, chain: chain || 'sepolia' });
    ok(res, record);
  }

  /* ─── Voice Pipeline ─── */

  async handleVoiceTranscribe(req, res) {
    const vp = this.nodeManager?.voicePipeline;
    if (!vp) { serviceUnavailable(res, 'VoicePipeline not initialized'); return; }
    const body = await parseBody(req);
    const { audioPath, workspace, generateSummary, generateEmbeddings } = body;
    if (!audioPath) { badRequest(res, 'Provide "audioPath"'); return; }
    try {
      const result = await vp.process(audioPath, { workspace, generateSummary, generateEmbeddings });
      ok(res, result);
    } catch (e) {
      this.logger.error(`[voice] ${e.message}`);
      serverError(res, e);
    }
  }

  handleVoiceStatus(req, res) {
    const vp = this.nodeManager?.voicePipeline;
    if (!vp) { serviceUnavailable(res, 'VoicePipeline not initialized'); return; }
    ok(res, vp.getStatus());
  }

  /* ─── Agent Loop ─── */

  async handleAgentQuery(req, res) {
    const agent = this.nodeManager?.agentLoop;
    if (!agent) { serviceUnavailable(res, 'AgentLoop not initialized'); return; }
    const body = await parseBody(req);
    const { query, history } = body;
    if (!query) { badRequest(res, 'Provide "query"'); return; }
    try {
      const result = await agent.run(query, {
        inferenceLayer: this.nodeManager?.inferenceLayer,
        embeddingService: this.nodeManager?.embeddingService,
        wikiIndexer: this.indexer,
        history: history || [],
      });
      ok(res, result);
    } catch (e) {
      this.logger.error(`[agent] ${e.message}`);
      serverError(res, e);
    }
  }

  handleAgentTools(req, res) {
    const agent = this.nodeManager?.agentLoop;
    if (!agent) { serviceUnavailable(res, 'AgentLoop not initialized'); return; }
    ok(res, { tools: agent.getToolDefinitions(), status: agent.getStatus() });
  }

  /* ─── Document Chunker ─── */

  async handleChunkDocuments(req, res) {
    const chunker = this.nodeManager?.documentChunker;
    if (!chunker) { serviceUnavailable(res, 'DocumentChunker not initialized'); return; }
    const body = await parseBody(req);
    const { documents } = body;
    if (!documents || !Array.isArray(documents)) { badRequest(res, 'Provide "documents" array'); return; }
    const chunks = chunker.chunkDocuments(documents);
    ok(res, { chunks, count: chunks.length });
  }

  /* ─── Content Address ─── */

  handleContentStatus(req, res) {
    const ca = this.nodeManager?.contentAddress;
    if (!ca) { serviceUnavailable(res, 'ContentAddress not initialized'); return; }
    ok(res, ca.getStats());
  }

  async handleContentRegister(req, res) {
    const ca = this.nodeManager?.contentAddress;
    if (!ca) { serviceUnavailable(res, 'ContentAddress not initialized'); return; }
    const body = await parseBody(req);
    const { data } = body;
    if (data === undefined) { badRequest(res, 'Provide "data"'); return; }
    const hash = ca.register(data);
    ok(res, { hash, exists: ca.exists(hash) });
  }

  async handleContentVerify(req, res) {
    const ca = this.nodeManager?.contentAddress;
    if (!ca) { serviceUnavailable(res, 'ContentAddress not initialized'); return; }
    const body = await parseBody(req);
    const { data, expectedHash } = body;
    if (data === undefined || !expectedHash) { badRequest(res, 'Provide "data" and "expectedHash"'); return; }
    const valid = ca.verify(data, expectedHash);
    ok(res, { valid });
  }

  /* ─── Capability Manifest ─── */

  handleCapabilityStatus(req, res) {
    const cm = this.nodeManager?.capabilityManifest;
    if (!cm) { serviceUnavailable(res, 'CapabilityManifest not initialized'); return; }
    ok(res, cm.getStatus());
  }

  async handleCapabilityCreate(req, res) {
    const cm = this.nodeManager?.capabilityManifest;
    if (!cm) { serviceUnavailable(res, 'CapabilityManifest not initialized'); return; }
    const body = await parseBody(req);
    const { peerId, models, datasets, provider, capacity } = body;
    const manifest = cm.createManifest({ peerId, models: models || [], datasets: datasets || [], provider: provider || false, capacity: capacity || {} });
    ok(res, manifest);
  }

  handleCapabilityPeers(req, res) {
    const cm = this.nodeManager?.capabilityManifest;
    if (!cm) { serviceUnavailable(res, 'CapabilityManifest not initialized'); return; }
    ok(res, { peers: cm.getPeerManifests() });
  }

  /* ─── Deployment Lifecycle ─── */

  async handleDeploymentCreate(req, res) {
    const dl = this.nodeManager?.deploymentLifecycle;
    if (!dl) { serviceUnavailable(res, 'DeploymentLifecycle not initialized'); return; }
    const body = await parseBody(req);
    const { template, params, public: isPublic } = body;
    if (!template) { badRequest(res, 'Provide "template"'); return; }
    const deployment = dl.create({ template, params: params || {}, public: isPublic || false });
    accepted(res, deployment);
  }

  handleDeploymentList(req, res) {
    const dl = this.nodeManager?.deploymentLifecycle;
    if (!dl) { serviceUnavailable(res, 'DeploymentLifecycle not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const publicOnly = url.searchParams.get('public') === 'true';
    ok(res, { deployments: dl.list({ publicOnly }) });
  }

  handleDeploymentGet(req, res) {
    const dl = this.nodeManager?.deploymentLifecycle;
    if (!dl) { serviceUnavailable(res, 'DeploymentLifecycle not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = extractRouteParams(url.pathname);
    const dep = dl.get(params.id);
    if (!dep) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Deployment not found' })); return; }
    ok(res, { ...dep, eta: dl.getETA(params.id) });
  }

  handleDeploymentEvents(req, res) {
    const dl = this.nodeManager?.deploymentLifecycle;
    if (!dl) { serviceUnavailable(res, 'DeploymentLifecycle not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = extractRouteParams(url.pathname);
    const dep = dl.get(params.id);
    if (!dep) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Deployment not found' })); return; }
    const cleanup = dl.subscribe(params.id, res);
    req.on('close', cleanup);
  }

  /* ─── Circuit Breaker ─── */

  handleCircuitStatus(req, res) {
    const cb = this.nodeManager?.circuitBreaker;
    if (!cb) { serviceUnavailable(res, 'CircuitBreaker not initialized'); return; }
    ok(res, cb.getStatus());
  }

  handleCircuitList(req, res) {
    const cb = this.nodeManager?.circuitBreaker;
    if (!cb) { serviceUnavailable(res, 'CircuitBreaker not initialized'); return; }
    ok(res, { circuits: cb.getAllCircuits() });
  }

  async handleCircuitReset(req, res) {
    const cb = this.nodeManager?.circuitBreaker;
    if (!cb) { serviceUnavailable(res, 'CircuitBreaker not initialized'); return; }
    const body = await parseBody(req);
    const { targetId, all } = body;
    if (all) {
      cb.resetAll();
      ok(res, { reset: 'all' });
    } else if (targetId) {
      cb.reset(targetId);
      ok(res, { reset: targetId });
    } else {
      badRequest(res, 'Provide "targetId" or "all": true');
    }
  }

  /* ─── Peer Reputation ─── */

  handleReputationStatus(req, res) {
    const pr = this.nodeManager?.peerReputation;
    if (!pr) { serviceUnavailable(res, 'PeerReputation not initialized'); return; }
    ok(res, pr.getStatus());
  }

  handleReputationPeers(req, res) {
    const pr = this.nodeManager?.peerReputation;
    if (!pr) { serviceUnavailable(res, 'PeerReputation not initialized'); return; }
    ok(res, { peers: pr.getAllStats() });
  }

  /* ─── Model Hot-Swap ─── */

  async handleModelSwitch(req, res) {
    const layer = this.nodeManager?.inferenceLayer;
    if (!layer) { serviceUnavailable(res, 'Inference layer not initialized'); return; }
    const body = await parseBody(req);
    const { model } = body;
    if (!model) { badRequest(res, 'Provide "model" name'); return; }
    try {
      const modelId = await layer.switchModel(model);
      ok(res, { model, modelId, success: true });
    } catch (e) {
      serverError(res, e);
    }
  }

  handleModelCurrent(req, res) {
    const layer = this.nodeManager?.inferenceLayer;
    if (!layer) { serviceUnavailable(res, 'Inference layer not initialized'); return; }
    ok(res, { model: layer.getLoadedModelName(), modelId: layer.modelId });
  }

  /* ─── Memory Compactor ─── */

  handleMemoryStatus(req, res) {
    const mc = this.nodeManager?.memoryCompactor;
    if (!mc) { serviceUnavailable(res, 'MemoryCompactor not initialized'); return; }
    ok(res, mc.getStats());
  }

  /* ─── Knowledge Graph ─── */

  handleKGStatus(req, res) {
    const kg = this.nodeManager?.knowledgeGraph;
    if (!kg) { serviceUnavailable(res, 'KnowledgeGraph not initialized'); return; }
    ok(res, kg.getStats());
  }

  handleKGSearch(req, res) {
    const kg = this.nodeManager?.knowledgeGraph;
    if (!kg) { serviceUnavailable(res, 'KnowledgeGraph not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    ok(res, { results: kg.searchEntities(query, limit) });
  }

  handleKGEntity(req, res) {
    const kg = this.nodeManager?.knowledgeGraph;
    if (!kg) { serviceUnavailable(res, 'KnowledgeGraph not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const name = url.searchParams.get('name') || '';
    const entity = kg.getEntity(name);
    if (!entity) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Entity not found' })); return; }
    ok(res, entity);
  }

  handleKGSubgraph(req, res) {
    const kg = this.nodeManager?.knowledgeGraph;
    if (!kg) { serviceUnavailable(res, 'KnowledgeGraph not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const name = url.searchParams.get('name') || '';
    const depth = parseInt(url.searchParams.get('depth') || '2', 10);
    ok(res, kg.getSubgraph(name, depth));
  }

  async handleKGIngest(req, res) {
    const kg = this.nodeManager?.knowledgeGraph;
    if (!kg) { serviceUnavailable(res, 'KnowledgeGraph not initialized'); return; }
    const body = await parseBody(req);
    const { nodes, edges, source } = body;
    const result = kg.ingest({ nodes: nodes || [], edges: edges || [], source: source || 'api' });
    ok(res, result);
  }

  /* ─── Crypto Vault ─── */

  handleVaultStatus(req, res) {
    const vault = this.nodeManager?.cryptoVault;
    if (!vault) { serviceUnavailable(res, 'CryptoVault not initialized'); return; }
    ok(res, vault.getStats());
  }

  async handleVaultEncrypt(req, res) {
    const vault = this.nodeManager?.cryptoVault;
    if (!vault) { serviceUnavailable(res, 'CryptoVault not initialized'); return; }
    const body = await parseBody(req);
    const { workspace, plaintext } = body;
    if (!workspace || !plaintext) { badRequest(res, 'Provide "workspace" and "plaintext"'); return; }
    ok(res, vault.encrypt(workspace, plaintext));
  }

  async handleVaultDecrypt(req, res) {
    const vault = this.nodeManager?.cryptoVault;
    if (!vault) { serviceUnavailable(res, 'CryptoVault not initialized'); return; }
    const body = await parseBody(req);
    const { workspace, data, nonce, tag } = body;
    if (!workspace || !data) { badRequest(res, 'Provide "workspace" and "data"'); return; }
    try {
      const plaintext = vault.decrypt(workspace, { data, nonce, tag });
      ok(res, { plaintext });
    } catch (e) {
      serverError(res, e);
    }
  }

  /* ─── Receipt Gossip ─── */

  handleGossipStatus(req, res) {
    const gossip = this.nodeManager?.receiptGossip;
    if (!gossip) { serviceUnavailable(res, 'ReceiptGossip not initialized'); return; }
    ok(res, gossip.getStats());
  }

  handleGossipReceipts(req, res) {
    const gossip = this.nodeManager?.receiptGossip;
    if (!gossip) { serviceUnavailable(res, 'ReceiptGossip not initialized'); return; }
    ok(res, { receipts: gossip.getCommunityVerifiedReceipts() });
  }

  async handleGossipBroadcast(req, res) {
    const gossip = this.nodeManager?.receiptGossip;
    if (!gossip) { serviceUnavailable(res, 'ReceiptGossip not initialized'); return; }
    const body = await parseBody(req);
    const { receipt } = body;
    if (!receipt) { badRequest(res, 'Provide "receipt"'); return; }
    await gossip.gossipReceipt(receipt);
    accepted(res, { broadcast: true });
  }

  /* ─── Dynamic Pricing ─── */

  handlePricingStatus(req, res) {
    const dp = this.nodeManager?.dynamicPricing;
    if (!dp) { serviceUnavailable(res, 'DynamicPricing not initialized'); return; }
    ok(res, dp.getStats());
  }

  handlePricingHistory(req, res) {
    const dp = this.nodeManager?.dynamicPricing;
    if (!dp) { serviceUnavailable(res, 'DynamicPricing not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    ok(res, { history: dp.getPriceHistory(limit), currentPrice: dp.getCurrentPrice() });
  }

  /* ─── Model Registry ─── */

  handleRegistryStatus(req, res) {
    const reg = this.nodeManager?.modelRegistry;
    if (!reg) { serviceUnavailable(res, 'ModelRegistry not initialized'); return; }
    ok(res, reg.getStats());
  }

  handleRegistryList(req, res) {
    const reg = this.nodeManager?.modelRegistry;
    if (!reg) { serviceUnavailable(res, 'ModelRegistry not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const type = url.searchParams.get('type');
    ok(res, { models: type ? reg.listByType(type) : reg.list() });
  }

  async handleRegistryRegister(req, res) {
    const reg = this.nodeManager?.modelRegistry;
    if (!reg) { serviceUnavailable(res, 'ModelRegistry not initialized'); return; }
    const body = await parseBody(req);
    const { name, type, contextLength, quantization, modelConst, metadata } = body;
    if (!name) { badRequest(res, 'Provide "name"'); return; }
    const entry = reg.register({ name, type, contextLength, quantization, modelConst, metadata });
    ok(res, entry);
  }

  /* ─── Tool Result Cache ─── */

  handleToolCacheStatus(req, res) {
    const tc = this.nodeManager?.toolResultCache;
    if (!tc) { serviceUnavailable(res, 'ToolResultCache not initialized'); return; }
    ok(res, tc.getStats());
  }

  async handleToolCacheInvalidate(req, res) {
    const tc = this.nodeManager?.toolResultCache;
    if (!tc) { serviceUnavailable(res, 'ToolResultCache not initialized'); return; }
    const body = await parseBody(req);
    const { toolName, all } = body;
    if (all) {
      tc.clear();
      ok(res, { cleared: 'all' });
    } else if (toolName) {
      const count = tc.invalidateTool(toolName);
      ok(res, { invalidated: count });
    } else {
      badRequest(res, 'Provide "toolName" or "all": true');
    }
  }

  /* ─── Semantic Dedup ─── */

  handleDedupStatus(req, res) {
    const sd = this.nodeManager?.semanticDedup;
    if (!sd) { serviceUnavailable(res, 'SemanticDedup not initialized'); return; }
    ok(res, sd.getStats());
  }

  /* ─── SLA Enforcer ─── */

  handleSLAStatus(req, res) {
    const sla = this.nodeManager?.slaEnforcer;
    if (!sla) { serviceUnavailable(res, 'SLAEnforcer not initialized'); return; }
    ok(res, sla.getStats());
  }

  /* ─── Content Pinner ─── */

  handlePinningStatus(req, res) {
    const cp = this.nodeManager?.contentPinner;
    if (!cp) { serviceUnavailable(res, 'ContentPinner not initialized'); return; }
    ok(res, cp.getStats());
  }

  async handlePinningPin(req, res) {
    const cp = this.nodeManager?.contentPinner;
    if (!cp) { serviceUnavailable(res, 'ContentPinner not initialized'); return; }
    const body = await parseBody(req);
    const { hash, data, ttl, encrypt, workspace } = body;
    if (!data) { badRequest(res, 'Provide "data"'); return; }
    const result = await cp.pin(hash, data, { ttl, encrypt, workspace });
    ok(res, result);
  }

  async handlePinningUnpin(req, res) {
    const cp = this.nodeManager?.contentPinner;
    if (!cp) { serviceUnavailable(res, 'ContentPinner not initialized'); return; }
    const body = await parseBody(req);
    const { hash } = body;
    if (!hash) { badRequest(res, 'Provide "hash"'); return; }
    await cp.unpin(hash);
    ok(res, { unpinned: true });
  }

  handlePinningCheck(req, res) {
    const cp = this.nodeManager?.contentPinner;
    if (!cp) { serviceUnavailable(res, 'ContentPinner not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = extractRouteParams(url.pathname);
    const status = cp.getPinStatus(params.hash);
    ok(res, status);
  }

  /* ─── Deployment Rollback ─── */

  async handleDeploymentRollback(req, res) {
    const dl = this.nodeManager?.deploymentLifecycle;
    if (!dl) { serviceUnavailable(res, 'DeploymentLifecycle not initialized'); return; }
    const body = await parseBody(req);
    const { id, reason } = body;
    if (!id) { badRequest(res, 'Provide deployment "id"'); return; }
    const result = dl.rollback(id, reason || 'manual rollback');
    if (!result) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Deployment not found' })); return; }
    ok(res, { rolled_back: true, id, restored_to: result.previousPhase });
  }

  /* ─── Task Decomposer ─── */

  handleDecomposeStatus(req, res) {
    const td = this.nodeManager?.taskDecomposer;
    if (!td) { serviceUnavailable(res, 'TaskDecomposer not initialized'); return; }
    ok(res, td.getStats());
  }

  async handleDecomposeRun(req, res) {
    const td = this.nodeManager?.taskDecomposer;
    if (!td) { serviceUnavailable(res, 'TaskDecomposer not initialized'); return; }
    const body = await parseBody(req);
    const { prompt, maxTokens, temperature } = body;
    if (!prompt) { badRequest(res, 'Provide "prompt"'); return; }
    const { subTasks, complexity, decomposed } = await td.decompose(prompt, {
      inferenceLayer: this.nodeManager.inferenceLayer,
    });
    if (!decomposed) {
      ok(res, { decomposed: false, subTasks, complexity, message: 'Request not complex enough for decomposition' });
      return;
    }
    const result = await td.executeAndSynthesize(subTasks, {
      inferenceLayer: this.nodeManager.inferenceLayer,
      router: this.nodeManager.inferenceRouter || null,
    }, { maxTokens: maxTokens || 256, temperature: temperature || 0.7 });
    ok(res, { decomposed: true, complexity, subTaskCount: subTasks.length, subResults: result.subResults, output: result.output, synthesized: result.synthesized });
  }

  /* ─── Conversation Brancher ─── */

  handleConversationList(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    ok(res, { conversations: cb.list() });
  }

  async handleConversationCreate(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    const body = await parseBody(req);
    const { systemPrompt } = body;
    const result = cb.create(systemPrompt);
    ok(res, result);
  }

  async handleConversationMessage(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    const body = await parseBody(req);
    const { conversationId, role, content } = body;
    if (!conversationId || !role || !content) { badRequest(res, 'Provide "conversationId", "role", "content"'); return; }
    try {
      const msg = cb.addMessage(conversationId, { role, content });
      ok(res, msg);
    } catch (e) { serverError(res, e); }
  }

  async handleConversationBranch(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    const body = await parseBody(req);
    const { conversationId, fromMsgId, role, content } = body;
    if (!conversationId || !fromMsgId || !role || !content) { badRequest(res, 'Provide "conversationId", "fromMsgId", "role", "content"'); return; }
    try {
      const result = cb.branch(conversationId, fromMsgId, { role, content });
      ok(res, result);
    } catch (e) { serverError(res, e); }
  }

  async handleConversationSwitch(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    const body = await parseBody(req);
    const { conversationId, leafMsgId } = body;
    if (!conversationId || !leafMsgId) { badRequest(res, 'Provide "conversationId", "leafMsgId"'); return; }
    try {
      const path = cb.switchBranch(conversationId, leafMsgId);
      ok(res, { activePath: path });
    } catch (e) { serverError(res, e); }
  }

  handleConversationTree(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = extractRouteParams(url.pathname);
    const tree = cb.getTree(params.id);
    if (!tree) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Conversation not found' })); return; }
    ok(res, tree);
  }

  handleConversationHistory(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = extractRouteParams(url.pathname);
    const history = cb.getActiveHistory(params.id);
    ok(res, { history });
  }

  handleConversationDelete(req, res) {
    const cb = this.nodeManager?.conversationBrancher;
    if (!cb) { serviceUnavailable(res, 'ConversationBrancher not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = extractRouteParams(url.pathname);
    const deleted = cb.delete(params.id);
    if (!deleted) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Conversation not found' })); return; }
    ok(res, { deleted: true });
  }

  /* ─── Auto Tagger ─── */

  handleTaggerStatus(req, res) {
    const at = this.nodeManager?.autoTagger;
    if (!at) { serviceUnavailable(res, 'AutoTagger not initialized'); return; }
    ok(res, at.getStats());
  }

  async handleTaggerTag(req, res) {
    const at = this.nodeManager?.autoTagger;
    if (!at) { serviceUnavailable(res, 'AutoTagger not initialized'); return; }
    const body = await parseBody(req);
    const { content, useLLM, existingTags } = body;
    if (!content) { badRequest(res, 'Provide "content"'); return; }
    const result = await at.tag(content, {
      knowledgeGraph: this.nodeManager.knowledgeGraph,
      inferenceLayer: useLLM ? this.nodeManager.inferenceLayer : null,
      useLLM,
      existingTags,
    });
    ok(res, result);
  }

  async handleTaggerBatch(req, res) {
    const at = this.nodeManager?.autoTagger;
    if (!at) { serviceUnavailable(res, 'AutoTagger not initialized'); return; }
    const body = await parseBody(req);
    const { documents, useLLM } = body;
    if (!documents || !Array.isArray(documents)) { badRequest(res, 'Provide "documents" array'); return; }
    const results = await at.tagBatch(documents, {
      knowledgeGraph: this.nodeManager.knowledgeGraph,
      inferenceLayer: useLLM ? this.nodeManager.inferenceLayer : null,
      useLLM,
    });
    ok(res, { results });
  }

  /* ─── Conversation Export ─── */

  handleExportFormats(req, res) {
    const ce = this.nodeManager?.conversationExporter;
    if (!ce) { serviceUnavailable(res, 'ConversationExporter not initialized'); return; }
    ok(res, { formats: ce.getFormats() });
  }

  async handleExportConversation(req, res) {
    const ce = this.nodeManager?.conversationExporter;
    const cb = this.nodeManager?.conversationBrancher;
    if (!ce || !cb) { serviceUnavailable(res, 'Exporter not initialized'); return; }
    const body = await parseBody(req);
    const { conversationId, format, includeBranches, activePathOnly } = body;
    if (!conversationId || !format) { badRequest(res, 'Provide "conversationId" and "format"'); return; }
    const tree = cb.getTree(conversationId);
    if (!tree) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Conversation not found' })); return; }
    try {
      const result = ce.export(tree, format, { includeBranches: includeBranches !== false, activePathOnly: !!activePathOnly });
      res.writeHead(200, {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      });
      res.end(result.content);
    } catch (e) { serverError(res, e); }
  }

  /* ─── Private helpers ─── */

  /* ─── Confidence Router ─── */

  handleConfidenceStatus(req, res) {
    const cr = this.nodeManager?.confidenceRouter;
    if (!cr) { serviceUnavailable(res, 'ConfidenceRouter not initialized'); return; }
    ok(res, cr.getStats());
  }

  async handleConfidenceRoute(req, res) {
    const cr = this.nodeManager?.confidenceRouter;
    if (!cr) { serviceUnavailable(res, 'ConfidenceRouter not initialized'); return; }
    const body = await parseBody(req);
    const { prompt, maxTokens, temperature, k } = body;
    if (!prompt) { badRequest(res, 'Provide "prompt"'); return; }
    const result = await cr.route(prompt, {
      inferenceLayer: this.nodeManager.inferenceLayer,
      embeddingService: this.nodeManager.embeddingService,
      router: this.nodeManager.inferenceRouter || null,
    }, { maxTokens, temperature, k });
    ok(res, result);
  }

  /* ─── Spend Policy ─── */

  handleSpendStatus(req, res) {
    const sp = this.nodeManager?.spendPolicy;
    if (!sp) { serviceUnavailable(res, 'SpendPolicy not initialized'); return; }
    ok(res, sp.getStats());
  }

  async handleSpendSessionStart(req, res) {
    const sp = this.nodeManager?.spendPolicy;
    if (!sp) { serviceUnavailable(res, 'SpendPolicy not initialized'); return; }
    const body = await parseBody(req);
    const sessionId = sp.startSession(body.sessionId);
    ok(res, { sessionId });
  }

  async handleSpendSessionEnd(req, res) {
    const sp = this.nodeManager?.spendPolicy;
    if (!sp) { serviceUnavailable(res, 'SpendPolicy not initialized'); return; }
    const body = await parseBody(req);
    sp.endSession(body.sessionId);
    ok(res, { ended: true });
  }

  handleSpendSessionStatus(req, res) {
    const sp = this.nodeManager?.spendPolicy;
    if (!sp) { serviceUnavailable(res, 'SpendPolicy not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const status = sp.getSessionStatus(sessionId);
    if (!status) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Session not found' })); return; }
    ok(res, status);
  }

  /* ─── Escrow Channel ─── */

  handleEscrowStatus(req, res) {
    const ec = this.nodeManager?.escrowChannel;
    if (!ec) { serviceUnavailable(res, 'EscrowChannel not initialized'); return; }
    ok(res, ec.getStats());
  }

  async handleEscrowOpen(req, res) {
    const ec = this.nodeManager?.escrowChannel;
    if (!ec) { serviceUnavailable(res, 'EscrowChannel not initialized'); return; }
    const body = await parseBody(req);
    const { buyer, seller, depositAmount, sessionId } = body;
    if (!buyer || !seller || !depositAmount) { badRequest(res, 'Provide "buyer", "seller", "depositAmount"'); return; }
    const result = await ec.open({ buyer, seller, depositAmount, sessionId });
    ok(res, result);
  }

  async handleEscrowVoucher(req, res) {
    const ec = this.nodeManager?.escrowChannel;
    if (!ec) { serviceUnavailable(res, 'EscrowChannel not initialized'); return; }
    const body = await parseBody(req);
    const { channelId, amount, deadline } = body;
    if (!channelId || amount === undefined) { badRequest(res, 'Provide "channelId" and "amount"'); return; }
    const result = await ec.createVoucher(channelId, amount, { deadline });
    ok(res, result);
  }

  async handleEscrowSettle(req, res) {
    const ec = this.nodeManager?.escrowChannel;
    if (!ec) { serviceUnavailable(res, 'EscrowChannel not initialized'); return; }
    const body = await parseBody(req);
    const { channelId } = body;
    if (!channelId) { badRequest(res, 'Provide "channelId"'); return; }
    const result = await ec.settle(channelId);
    ok(res, result);
  }

  async handleEscrowClose(req, res) {
    const ec = this.nodeManager?.escrowChannel;
    if (!ec) { serviceUnavailable(res, 'EscrowChannel not initialized'); return; }
    const body = await parseBody(req);
    const { channelId } = body;
    if (!channelId) { badRequest(res, 'Provide "channelId"'); return; }
    const result = await ec.close(channelId);
    ok(res, result);
  }

  handleEscrowList(req, res) {
    const ec = this.nodeManager?.escrowChannel;
    if (!ec) { serviceUnavailable(res, 'EscrowChannel not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const status = url.searchParams.get('status');
    ok(res, { channels: ec.listChannels(status) });
  }

  /* ─── Memory Manager ─── */

  handleMemoryStatus(req, res) {
    const mm = this.nodeManager?.memoryManager;
    if (!mm) { serviceUnavailable(res, 'MemoryManager not initialized'); return; }
    ok(res, mm.getStats());
  }

  async handleMemoryAdd(req, res) {
    const mm = this.nodeManager?.memoryManager;
    if (!mm) { serviceUnavailable(res, 'MemoryManager not initialized'); return; }
    const body = await parseBody(req);
    const { content, type, namespace, importance, source, metadata, ttl } = body;
    if (!content) { badRequest(res, 'Provide "content"'); return; }
    const memory = mm.add({ content, type, namespace, importance, source, metadata, ttl });
    ok(res, memory);
  }

  handleMemorySearch(req, res) {
    const mm = this.nodeManager?.memoryManager;
    if (!mm) { serviceUnavailable(res, 'MemoryManager not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const namespace = url.searchParams.get('namespace');
    const type = url.searchParams.get('type');
    const query = url.searchParams.get('query');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const minImportance = parseFloat(url.searchParams.get('minImportance') || '0');
    const results = mm.search({ namespace, type, query, limit, minImportance });
    ok(res, { results });
  }

  async handleMemoryUpdate(req, res) {
    const mm = this.nodeManager?.memoryManager;
    if (!mm) { serviceUnavailable(res, 'MemoryManager not initialized'); return; }
    const body = await parseBody(req);
    const { id, content, importance, metadata, ttl } = body;
    if (!id) { badRequest(res, 'Provide "id"'); return; }
    const result = mm.update(id, { content, importance, metadata, ttl });
    if (!result) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Memory not found' })); return; }
    ok(res, result);
  }

  async handleMemoryDelete(req, res) {
    const mm = this.nodeManager?.memoryManager;
    if (!mm) { serviceUnavailable(res, 'MemoryManager not initialized'); return; }
    const body = await parseBody(req);
    const { id } = body;
    if (!id) { badRequest(res, 'Provide "id"'); return; }
    const deleted = mm.delete(id);
    ok(res, { deleted });
  }

  handleMemoryTypes(req, res) {
    const mm = this.nodeManager?.memoryManager;
    if (!mm) { serviceUnavailable(res, 'MemoryManager not initialized'); return; }
    ok(res, mm.getTypes());
  }

  /* ─── Hybrid Retriever ─── */

  handleHybridStatus(req, res) {
    const hr = this.nodeManager?.hybridRetriever;
    if (!hr) { serviceUnavailable(res, 'HybridRetriever not initialized'); return; }
    ok(res, hr.getStats());
  }

  async handleHybridSearch(req, res) {
    const hr = this.nodeManager?.hybridRetriever;
    if (!hr) { serviceUnavailable(res, 'HybridRetriever not initialized'); return; }
    const body = await parseBody(req);
    const { workspace, query, queryEmbedding, limit, rerank, filters } = body;
    if (!workspace || !query) { badRequest(res, 'Provide "workspace" and "query"'); return; }
    const results = await hr.search(workspace, query, queryEmbedding, {
      limit, rerank,
      inferenceLayer: rerank ? this.nodeManager.inferenceLayer : null,
      filters,
    });
    ok(res, { results });
  }

  /* ─── Enrichment Queue ─── */

  handleEnrichmentStatus(req, res) {
    const eq = this.nodeManager?.enrichmentQueue;
    if (!eq) { serviceUnavailable(res, 'EnrichmentQueue not initialized'); return; }
    ok(res, eq.getStats());
  }

  async handleEnrichmentSave(req, res) {
    const eq = this.nodeManager?.enrichmentQueue;
    if (!eq) { serviceUnavailable(res, 'EnrichmentQueue not initialized'); return; }
    const body = await parseBody(req);
    const { content, id, metadata, enrich, jobTypes } = body;
    if (!content) { badRequest(res, 'Provide "content"'); return; }
    const result = eq.save({ content, id, metadata }, { enrich, jobTypes });
    ok(res, result);
  }

  /* ─── Link Metadata ─── */

  handleLinkMetaStatus(req, res) {
    const lm = this.nodeManager?.linkMetadataCache;
    if (!lm) { serviceUnavailable(res, 'LinkMetadataCache not initialized'); return; }
    ok(res, lm.getStats());
  }

  async handleLinkMetaFetch(req, res) {
    const lm = this.nodeManager?.linkMetadataCache;
    if (!lm) { serviceUnavailable(res, 'LinkMetadataCache not initialized'); return; }
    const body = await parseBody(req);
    const { url } = body;
    if (!url) { badRequest(res, 'Provide "url"'); return; }
    const metadata = await lm.get(url);
    ok(res, metadata);
  }

  /* ─── Vision Captioner ─── */

  handleVisionStatus(req, res) {
    const vc = this.nodeManager?.visionCaptioner;
    if (!vc) { serviceUnavailable(res, 'VisionCaptioner not initialized'); return; }
    ok(res, vc.getStats());
  }

  async handleVisionCaption(req, res) {
    const vc = this.nodeManager?.visionCaptioner;
    if (!vc) { serviceUnavailable(res, 'VisionCaptioner not initialized'); return; }
    const body = await parseBody(req);
    const { imagePath, prompt, maxTokens } = body;
    if (!imagePath) { badRequest(res, 'Provide "imagePath"'); return; }
    const result = await vc.caption(imagePath, { prompt, maxTokens });
    ok(res, result);
  }

  /* ─── Evidence Exporter ─── */

  handleEvidenceTypes(req, res) {
    const ee = this.nodeManager?.evidenceExporter;
    if (!ee) { serviceUnavailable(res, 'EvidenceExporter not initialized'); return; }
    ok(res, { types: ee.getTypes() });
  }

  async handleEvidenceExport(req, res) {
    const ee = this.nodeManager?.evidenceExporter;
    if (!ee) { serviceUnavailable(res, 'EvidenceExporter not initialized'); return; }
    const body = await parseBody(req);
    const { type } = body;
    if (!type) { badRequest(res, 'Provide "type"'); return; }
    const context = {
      auditLogger: this.nodeManager.audit,
      p2pNetwork: this.nodeManager.p2pNetwork,
      hybridRetriever: this.nodeManager.hybridRetriever,
      embeddingService: this.nodeManager.embeddingService,
      modelRegistry: this.nodeManager.modelRegistry,
      nodeManager: this.nodeManager,
      promptGuard: this.nodeManager.promptGuard,
      promptBudgeter: this.nodeManager.promptBudgeter,
      dataStore: this.nodeManager.dataStore,
      knowledgeGraph: this.nodeManager.knowledgeGraph,
    };
    const result = await ee.export(type, context);
    ok(res, result);
  }

  async handleEvidenceExportAll(req, res) {
    const ee = this.nodeManager?.evidenceExporter;
    if (!ee) { serviceUnavailable(res, 'EvidenceExporter not initialized'); return; }
    const context = {
      auditLogger: this.nodeManager.audit,
      p2pNetwork: this.nodeManager.p2pNetwork,
      hybridRetriever: this.nodeManager.hybridRetriever,
      embeddingService: this.nodeManager.embeddingService,
      modelRegistry: this.nodeManager.modelRegistry,
      nodeManager: this.nodeManager,
      promptGuard: this.nodeManager.promptGuard,
      promptBudgeter: this.nodeManager.promptBudgeter,
      dataStore: this.nodeManager.dataStore,
      knowledgeGraph: this.nodeManager.knowledgeGraph,
    };
    const results = await ee.exportAll(context);
    ok(res, { results });
  }

  /* ─── MCP Client ─── */

  handleMCPStatus(req, res) {
    const mcp = this.nodeManager?.mcpClient;
    if (!mcp) { serviceUnavailable(res, 'MCPClient not initialized'); return; }
    ok(res, mcp.getStats());
  }

  handleMCPServers(req, res) {
    const mcp = this.nodeManager?.mcpClient;
    if (!mcp) { serviceUnavailable(res, 'MCPClient not initialized'); return; }
    ok(res, { servers: mcp.listServers() });
  }

  handleMCPTools(req, res) {
    const mcp = this.nodeManager?.mcpClient;
    if (!mcp) { serviceUnavailable(res, 'MCPClient not initialized'); return; }
    ok(res, { tools: mcp.getAllTools() });
  }

  async handleMCPConnect(req, res) {
    const mcp = this.nodeManager?.mcpClient;
    if (!mcp) { serviceUnavailable(res, 'MCPClient not initialized'); return; }
    const body = await parseBody(req);
    const { name, transport, command, args, url } = body;
    if (!name) { badRequest(res, 'Provide "name"'); return; }
    let success = false;
    if (transport === 'http' && url) {
      success = await mcp.connectHttp(name, url);
    } else if (command) {
      success = await mcp.connectStdio(name, command, args || []);
    } else {
      badRequest(res, 'Provide "transport": "http" with "url" or "command" with "args"');
      return;
    }
    ok(res, { connected: success, name });
  }

  async handleMCPCall(req, res) {
    const mcp = this.nodeManager?.mcpClient;
    if (!mcp) { serviceUnavailable(res, 'MCPClient not initialized'); return; }
    const body = await parseBody(req);
    const { serverName, toolName, args: toolArgs } = body;
    if (!serverName || !toolName) { badRequest(res, 'Provide "serverName" and "toolName"'); return; }
    try {
      const result = await mcp.callTool(serverName, toolName, toolArgs || {});
      ok(res, { result });
    } catch (e) { serverError(res, e); }
  }

  async handleMCPDisconnect(req, res) {
    const mcp = this.nodeManager?.mcpClient;
    if (!mcp) { serviceUnavailable(res, 'MCPClient not initialized'); return; }
    const body = await parseBody(req);
    const { serverName } = body;
    if (!serverName) { badRequest(res, 'Provide "serverName"'); return; }
    await mcp.disconnect(serverName);
    ok(res, { disconnected: true });
  }

  /* ─── Auto Linker ─── */

  handleAutoLinkStatus(req, res) {
    const al = this.nodeManager?.autoLinker;
    if (!al) { serviceUnavailable(res, 'AutoLinker not initialized'); return; }
    ok(res, al.getStats());
  }

  async handleAutoLinkBuild(req, res) {
    const al = this.nodeManager?.autoLinker;
    if (!al) { serviceUnavailable(res, 'AutoLinker not initialized'); return; }
    const body = await parseBody(req);
    const { workspace } = body;
    if (!workspace) { badRequest(res, 'Provide "workspace"'); return; }
    await al.buildLinks(workspace);
    ok(res, { built: true, stats: al.getStats() });
  }

  handleAutoLinkRelated(req, res) {
    const al = this.nodeManager?.autoLinker;
    if (!al) { serviceUnavailable(res, 'AutoLinker not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const workspace = url.searchParams.get('workspace');
    const docId = url.searchParams.get('docId');
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    if (!workspace || !docId) { badRequest(res, 'Provide "workspace" and "docId"'); return; }
    ok(res, { related: al.getRelated(workspace, docId, limit) });
  }

  handleAutoLinkGraph(req, res) {
    const al = this.nodeManager?.autoLinker;
    if (!al) { serviceUnavailable(res, 'AutoLinker not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const workspace = url.searchParams.get('workspace');
    if (!workspace) { badRequest(res, 'Provide "workspace"'); return; }
    ok(res, al.getGraph(workspace));
  }

  handleAutoLinkClusters(req, res) {
    const al = this.nodeManager?.autoLinker;
    if (!al) { serviceUnavailable(res, 'AutoLinker not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const workspace = url.searchParams.get('workspace');
    if (!workspace) { badRequest(res, 'Provide "workspace"'); return; }
    ok(res, { clusters: al.findClusters(workspace) });
  }

  /* ─── Private helpers (original) ─── */

  /* ─── Capability Prober ─── */

  handleProbeStatus(req, res) {
    const cp = this.nodeManager?.capabilityProber;
    if (!cp) { serviceUnavailable(res, 'CapabilityProber not initialized'); return; }
    ok(res, cp.getStats());
  }

  async handleProbeRun(req, res) {
    const cp = this.nodeManager?.capabilityProber;
    if (!cp) { serviceUnavailable(res, 'CapabilityProber not initialized'); return; }
    const profile = await cp.probe();
    ok(res, profile);
  }

  async handleProbeProfile(req, res) {
    const cp = this.nodeManager?.capabilityProber;
    if (!cp) { serviceUnavailable(res, 'CapabilityProber not initialized'); return; }
    const profile = await cp.getProfile();
    ok(res, profile);
  }

  handleProbeOffer(req, res) {
    const cp = this.nodeManager?.capabilityProber;
    if (!cp) { serviceUnavailable(res, 'CapabilityProber not initialized'); return; }
    ok(res, { offer: cp.getOffer(), canSell: cp.canSell() });
  }

  /* ─── Marketplace Broadcaster ─── */

  handleMarketStatus(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    ok(res, mb.getStats());
  }

  async handleMarketStart(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    await mb.start();
    ok(res, { started: true });
  }

  async handleMarketStop(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    mb.stop();
    ok(res, { stopped: true });
  }

  handleMarketDiscoverSellers(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    ok(res, { sellers: mb.discoverSellers() });
  }

  async handleMarketRequestQuote(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    const body = await parseBody(req);
    const { sellerId, prompt, maxTokens } = body;
    if (!sellerId || !prompt) { badRequest(res, 'Provide "sellerId" and "prompt"'); return; }
    const quoteId = await mb.requestQuote(sellerId, prompt, { maxTokens });
    ok(res, { quoteId });
  }

  async handleMarketAcceptQuote(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    const body = await parseBody(req);
    const { quoteId } = body;
    if (!quoteId) { badRequest(res, 'Provide "quoteId"'); return; }
    try {
      const quote = await mb.acceptQuote(quoteId);
      ok(res, { accepted: true, quote });
    } catch (e) { serverError(res, e); }
  }

  handleMarketQuoteStatus(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const quoteId = url.searchParams.get('quoteId');
    if (!quoteId) { badRequest(res, 'Provide "quoteId"'); return; }
    const quote = mb.getQuote(quoteId);
    if (!quote) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Quote not found' })); return; }
    ok(res, quote);
  }

  handleMarketMyOffer(req, res) {
    const mb = this.nodeManager?.marketplaceBroadcaster;
    if (!mb) { serviceUnavailable(res, 'MarketplaceBroadcaster not initialized'); return; }
    ok(res, { offer: mb.getMyOffer() });
  }

  /* ─── Memory Extractor ─── */

  handleExtractStatus(req, res) {
    const me = this.nodeManager?.memoryExtractor;
    if (!me) { serviceUnavailable(res, 'MemoryExtractor not initialized'); return; }
    ok(res, me.getStats());
  }

  async handleExtractRun(req, res) {
    const me = this.nodeManager?.memoryExtractor;
    if (!me) { serviceUnavailable(res, 'MemoryExtractor not initialized'); return; }
    const body = await parseBody(req);
    const { content, namespace, source, skipStore, skipDedup } = body;
    if (!content) { badRequest(res, 'Provide "content"'); return; }
    const result = await me.extract(content, { namespace, source, skipStore, skipDedup });
    ok(res, result);
  }

  async handleExtractBatch(req, res) {
    const me = this.nodeManager?.memoryExtractor;
    if (!me) { serviceUnavailable(res, 'MemoryExtractor not initialized'); return; }
    const body = await parseBody(req);
    const { contents, namespace, source, skipStore, skipDedup } = body;
    if (!contents || !Array.isArray(contents)) { badRequest(res, 'Provide "contents" array'); return; }
    const result = await me.extractBatch(contents, { namespace, source, skipStore, skipDedup });
    ok(res, result);
  }

  /* ─── Private helpers (original) ─── */

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

  /* ─── Market API — programmatic resource requests ─── */

  async handleMarketInference(req, res) {
    try {
      const body = await parseBody(req);
      if (!body.private_key_pem && !body.key_pem_path) return badRequest(res, 'Missing private_key_pem or key_pem_path — a funded Casper account key is required');
      if (!body.prompt) return badRequest(res, 'Missing prompt');
      
      const result = await marketApi.createInferenceJob({
        privateKeyPem: body.private_key_pem || body.key_pem_path,
        prompt: body.prompt,
        amountCSPR: body.amount_cspr || '10',
      });
      ok(res, result);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketStorageAllocate(req, res) {
    try {
      const body = await parseBody(req);
      if (!body.private_key_pem && !body.key_pem_path) return badRequest(res, 'Missing private_key_pem or key_pem_path — a funded Casper account key is required');
      if (!body.space_name) return badRequest(res, 'Missing space_name');
      
      const result = await marketApi.createStorageAllocation({
        privateKeyPem: body.private_key_pem || body.key_pem_path,
        spaceName: body.space_name,
        sizeMb: body.size_mb || '100',
        amountCSPR: body.amount_cspr || '10',
      });
      ok(res, result);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketStorageStore(req, res) {
    try {
      const body = await parseBody(req);
      if (!body.private_key_pem && !body.key_pem_path) return badRequest(res, 'Missing private_key_pem or key_pem_path — a funded Casper account key is required');
      if (!body.space_name) return badRequest(res, 'Missing space_name');
      if (!body.file_hash) return badRequest(res, 'Missing file_hash');
      
      const result = await marketApi.createStorageFile({
        privateKeyPem: body.private_key_pem || body.key_pem_path,
        spaceName: body.space_name,
        fileHash: body.file_hash,
        fileSizeMb: body.file_size_mb || '1',
        amountCSPR: body.amount_cspr || '5',
        mode: body.mode || 'file',
        anonymous: !!body.anonymous,
        encrypted: !!body.encrypted,
        tags: body.tags || '',
        description: body.description || '',
      });
      ok(res, result);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketStorageRetrieve(req, res) {
    try {
      const body = await parseBody(req);
      if (!body.private_key_pem && !body.key_pem_path) return badRequest(res, 'Missing private_key_pem or key_pem_path — a funded Casper account key is required');
      if (!body.space_name) return badRequest(res, 'Missing space_name');
      if (!body.file_hash) return badRequest(res, 'Missing file_hash');
      
      const result = await marketApi.retrieveFile({
        privateKeyPem: body.private_key_pem || body.key_pem_path,
        spaceName: body.space_name,
        fileHash: body.file_hash,
        amountCSPR: body.amount_cspr || '1',
      });
      ok(res, result);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketCompute(req, res) {
    try {
      const body = await parseBody(req);
      if (!body.private_key_pem && !body.key_pem_path) return badRequest(res, 'Missing private_key_pem or key_pem_path — a funded Casper account key is required');
      if (!body.code) return badRequest(res, 'Missing code');
      
      const result = await marketApi.createComputeJob({
        privateKeyPem: body.private_key_pem || body.key_pem_path,
        runtime: body.runtime || 'shell',
        code: body.code,
        cpuCores: body.cpu_cores || '2',
        ramMb: body.ram_mb || '512',
        gpu: body.gpu || false,
        timeoutSec: body.timeout_sec || '30',
        amountCSPR: body.amount_cspr || '10',
      });
      ok(res, result);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketBandwidth(req, res) {
    try {
      const body = await parseBody(req);
      if (!body.private_key_pem && !body.key_pem_path) return badRequest(res, 'Missing private_key_pem or key_pem_path — a funded Casper account key is required');
      
      const result = await marketApi.createBandwidthJob({
        privateKeyPem: body.private_key_pem || body.key_pem_path,
        durationHours: body.duration_hours || '1',
        dataAllowanceGb: body.data_allowance_gb || '1',
        amountCSPR: body.amount_cspr || '5',
      });
      ok(res, result);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketJobStatus(req, res) {
    try {
      const pathname = req.url.split('?')[0];
      const params = extractRouteParams(pathname);
      const jobId = params.jobId;
      if (!jobId) return badRequest(res, 'Missing jobId');
      const status = await marketApi.getJobStatus(jobId);
      ok(res, status);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketJobResult(req, res) {
    try {
      const pathname = req.url.split('?')[0];
      const params = extractRouteParams(pathname);
      const jobId = params.jobId;
      if (!jobId) return badRequest(res, 'Missing jobId');
      const result = await marketApi.getJobResult(jobId);
      ok(res, result);
    } catch (e) { serverError(res, e.message); }
  }

  async handleMarketDocs(req, res) {
    ok(res, {
      title: 'Chimera Market API',
      description: 'Programmatic API for requesting compute resources on the Casper testnet',
      base_url: '/api/market',
      authentication: 'All POST endpoints require a Casper private key (PEM string or file path) from a funded account to sign transactions',
      endpoints: {
        inference: {
          method: 'POST',
          path: '/api/market/inference',
          body: { private_key_pem: 'string (PEM) or key_pem_path: string (file path) — required, must be funded', prompt: 'string', amount_cspr: 'string (default: 10)' },
          returns: { deploy_hash: 'string', order_id: 'string', resource_type: 'inference' },
        },
        storage_allocate: {
          method: 'POST',
          path: '/api/market/storage/allocate',
          body: { private_key_pem: 'string (required, funded)', space_name: 'string', size_mb: 'string (default: 100)', amount_cspr: 'string (default: 10)' },
          returns: { deploy_hash: 'string', order_id: 'string', resource_type: 'storage', sub_type: 'allocation' },
        },
        storage_store: {
          method: 'POST',
          path: '/api/market/storage/store',
          body: { private_key_pem: 'string (required, funded)', space_name: 'string', file_hash: 'string (sha256)', file_size_mb: 'string', amount_cspr: 'string (default: 5)', mode: 'string (public|personal|encrypted, default: file)', anonymous: 'boolean (public only)', encrypted: 'boolean', tags: 'string', description: 'string' },
          returns: { deploy_hash: 'string', order_id: 'string', resource_type: 'storage', sub_type: 'file' },
        },
        storage_retrieve: {
          method: 'POST',
          path: '/api/market/storage/retrieve',
          body: { private_key_pem: 'string (required, funded)', space_name: 'string', file_hash: 'string', amount_cspr: 'string (default: 1)' },
          returns: { deploy_hash: 'string', order_id: 'string', resource_type: 'storage', sub_type: 'retrieve' },
        },
        compute: {
          method: 'POST',
          path: '/api/market/compute',
          body: { private_key_pem: 'string (required, funded)', runtime: 'shell|python3|node|docker', code: 'string', cpu_cores: 'string (default: 2)', ram_mb: 'string (default: 512)', gpu: 'boolean (default: false)', timeout_sec: 'string (default: 30)', amount_cspr: 'string (default: 10)' },
          returns: { deploy_hash: 'string', order_id: 'string', resource_type: 'compute' },
        },
        bandwidth: {
          method: 'POST',
          path: '/api/market/bandwidth',
          body: { private_key_pem: 'string (required, funded)', duration_hours: 'string (default: 1)', data_allowance_gb: 'string (default: 1)', amount_cspr: 'string (default: 5)' },
          returns: { deploy_hash: 'string', order_id: 'string', resource_type: 'bandwidth' },
        },
        job_status: {
          method: 'GET',
          path: '/api/market/job/:jobId',
          returns: { job_id: 'string', state: 'string', state_code: 'number', request_hash: 'string', response_hash: 'string' },
        },
        job_result: {
          method: 'GET',
          path: '/api/market/job/:jobId/result',
          returns: { job_id: 'string', state: 'string', result: 'string|null' },
        },
      },
      states: ['pending', 'assigned', 'in_progress', 'provider_done', 'consumer_confirmed', 'settled', 'refunded', 'disputed'],
      examples: {
        inference: "curl -X POST http://localhost:3002/api/market/inference -H 'Content-Type: application/json' -d '{\"key_pem_path\":\"/tmp/key.pem\",\"prompt\":\"What is 2+2?\",\"amount_cspr\":\"10\"}'",
        compute: "curl -X POST http://localhost:3002/api/market/compute -H 'Content-Type: application/json' -d '{\"key_pem_path\":\"/tmp/key.pem\",\"runtime\":\"shell\",\"code\":\"echo hello\",\"cpu_cores\":\"2\",\"timeout_sec\":\"10\"}'",
        job_status: "curl http://localhost:3002/api/market/job/job:abc123:0",
      },
    });
  }

  /* ─── Chimera Storage Hub (BTFS-inspired) ─── */

  async handleStorageUpload(req, res) {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) { badRequest(res, 'Expected multipart/form-data'); return; }

    const boundary = extractBoundary(req);
    if (!boundary) { badRequest(res, 'Missing boundary'); return; }

    try {
      const data = await readBody(req);
      const parts = parseMultipart(data, boundary);
      const filePart = parts.find(p => p.name === 'file' && p.filename);
      if (!filePart) { badRequest(res, 'Missing file field'); return; }

      const getField = (name) => parts.find(p => p.name === name && !p.filename)?.value || '';
      const spaceName = getField('space_name').trim();
      const fileHash = getField('file_hash').trim();
      const mode = getField('mode') || 'public';
      const anonymous = getField('anonymous') === 'true';
      const encrypted = getField('encrypted') === 'true';
      const tags = getField('tags');
      const description = getField('description');

      if (!spaceName || !fileHash) { badRequest(res, 'Missing space_name or file_hash'); return; }

      const storageDir = path.join('/tmp/chimera-storage', spaceName);
      mkdirSync(storageDir, { recursive: true });
      const filePath = path.join(storageDir, fileHash);
      writeFileSync(filePath, filePart.data);

      const meta = { fileHash, spaceName, mode, anonymous, encrypted, tags, description, originalName: filePart.filename, uploadedAt: new Date().toISOString() };
      writeFileSync(`${filePath}.meta.json`, JSON.stringify(meta, null, 2));

      this.logger.info(`[storage] Uploaded ${filePart.filename} to ${filePath} (${filePart.data.length} bytes)`);
      ok(res, { success: true, fileHash, spaceName, size: filePart.data.length });
    } catch (e) {
      this.logger.error(`[storage] Upload failed: ${e.message}`);
      serverError(res, e.message);
    }
  }

  async handleStorageDownload(req, res) {
    const { spaceName, fileHash } = extractRouteParams(req.url);
    if (!spaceName || !fileHash) { badRequest(res, 'Missing spaceName or fileHash'); return; }

    const filePath = path.join('/tmp/chimera-storage', spaceName, fileHash);
    if (!existsSync(filePath)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'File not found' })); return; }

    try {
      let fileName = fileHash;
      const metaPath = `${filePath}.meta.json`;
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        fileName = meta.originalName || fileName;
      }
      const data = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': data.length,
      });
      res.end(data);
    } catch (e) {
      this.logger.error(`[storage] Download failed: ${e.message}`);
      serverError(res, e.message);
    }
  }
}
