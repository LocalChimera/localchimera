import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import { loadModel, completion, BITNET_0_7B_INST_TQ2_0 } from '@qvac/sdk';

const FRONTEND_URL = 'https://new.localchimera.com/inference/';

export default function App() {
  const [modelStatus, setModelStatus] = useState('idle');
  const [frontendUri, setFrontendUri] = useState(null);
  const [webError, setWebError] = useState(null);
  const [modelId, setModelId] = useState(null);
  const [modelError, setModelError] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [miningRunning, setMiningRunning] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [swarmTopics, setSwarmTopics] = useState([]);
  const webViewRef = useRef(null);
  const bridgeResolvers = useRef(new Map());
  const nodeIdRef = useRef('chimera-' + Math.random().toString(36).slice(2, 14));

  // Load frontend immediately — use remote URL which has all assets
  useEffect(() => {
    setFrontendUri(FRONTEND_URL);
  }, []);

  // Load model on user request only — never blocks the UI or crashes the app
  async function loadLLM() {
    if (modelStatus === 'loading' || modelStatus === 'ready') return;
    setModelStatus('loading');
    setModelError(null);
    try {
      const mid = await loadModel({
        modelSrc: BITNET_0_7B_INST_TQ2_0,
        modelType: 'llm',
        onProgress: (p) => {
          setModelStatus(`loading model: ${Math.round(p * 100)}%`);
        },
      });
      setModelId(mid);
      setModelStatus('ready');
    } catch (e) {
      console.error('Model load error:', e);
      setModelStatus('error');
      setModelError(e.message || 'Failed to load model');
    }
  }

  async function ensureModelLoaded() {
    if (!modelId) {
      await loadLLM();
    }
    if (!modelId) throw new Error('Model not loaded — tap Start to load the AI model');
  }

  async function handleStart(body) {
    const address = body?.evmAddress || body?.walletAddress || walletAddress || null;
    if (address) setWalletAddress(address);
    setMiningRunning(true);
    setAuthed(true);
    // Load model in background — don't block the start response
    loadLLM().catch(() => {});
    return {
      success: true,
      data: {
        message: 'Mining started',
        running: true,
        registered: { url: 'mobile://on-device', evmAddress: address || '', casperProvider: '' },
        casper: { registered: [], errors: [] },
      },
    };
  }

  async function handleAIWrite(body) {
    const prompt = body.prompt?.trim();
    if (!prompt) return { success: false, error: 'Prompt is required' };
    try {
      await ensureModelLoaded();
    } catch (e) {
      return { success: false, error: e.message || 'AI model not loaded' };
    }
    const title = body.title?.trim() || '';
    const fullPrompt = `Write a wiki article${title ? ` titled "${title}"` : ''} about: ${prompt}`;
    const history = [{ role: 'user', content: fullPrompt }];
    const result = completion({ modelId, history, stream: false });
    let generated = '';
    for await (const token of result.tokenStream) {
      generated += token;
    }
    const docId = `ai-${Date.now()}`;
    const generatedTitle = title || generated.split('\n')[0].replace(/^#\s*/, '').slice(0, 100);
    const doc = {
      id: docId,
      title: generatedTitle,
      body: generated,
      source: 'qvac-on-device',
      model: 'BITNET_0_7B_INST_TQ2_0',
      prompt,
      createdAt: Date.now(),
    };
    await appendAIDoc(doc);
    return { success: true, data: doc };
  }

  async function handleAIStatus() {
    return {
      success: true,
      data: {
        available: true,
        qvacAvailable: !!modelId,
        model: modelId ? 'BITNET_0_7B_INST_TQ2_0' : null,
        modelLoading: !modelId && modelStatus !== 'ready' && modelStatus !== 'error',
        modelStatus,
        modelError,
      },
    };
  }

  // ─── AI Docs Storage ───
  const AI_DOCS_DIR = FileSystem.documentDirectory + 'ai-docs/';

  async function ensureAIDocsDir() {
    const dir = await FileSystem.getInfoAsync(AI_DOCS_DIR);
    if (!dir.exists) {
      await FileSystem.makeDirectoryAsync(AI_DOCS_DIR, { intermediates: true });
    }
  }

  async function listAIDocs() {
    await ensureAIDocsDir();
    const files = await FileSystem.readDirectoryAsync(AI_DOCS_DIR);
    const docs = [];
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = await FileSystem.readAsStringAsync(AI_DOCS_DIR + file);
        const titleMatch = content.match(/^#\s+(.+)$/m);
        docs.push({
          id: file.replace('.md', ''),
          title: titleMatch?.[1] || file.replace('.md', ''),
          createdAt: Date.now(),
        });
      } catch {}
    }
    return docs;
  }

  async function appendAIDoc(doc) {
    await ensureAIDocsDir();
    const filename = `${doc.id}.md`;
    const content = `# ${doc.title}\n\n${doc.body}\n\n<!-- source: ${doc.source || 'qvac-sdk'} | model: ${doc.model || 'llama'} | prompt: ${doc.prompt || ''} -->\n`;
    await FileSystem.writeAsStringAsync(AI_DOCS_DIR + filename, content);
  }

  async function handleAIDocs() {
    const docs = await listAIDocs();
    return { success: true, data: docs };
  }

  // ─── Local Notes Storage ───
  const NOTES_DIR = FileSystem.documentDirectory + 'notes/';

  async function ensureNotesDir() {
    const dir = await FileSystem.getInfoAsync(NOTES_DIR);
    if (!dir.exists) {
      await FileSystem.makeDirectoryAsync(NOTES_DIR, { intermediates: true });
    }
  }

  async function listNotes() {
    await ensureNotesDir();
    const files = await FileSystem.readDirectoryAsync(NOTES_DIR);
    const notes = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await FileSystem.readAsStringAsync(NOTES_DIR + file);
        const note = JSON.parse(content);
        notes.push({
          id: note.id || file.replace('.json', ''),
          title: note.title || 'Untitled',
          body: note.content || '',
          category: note.category || '.',
          createdAt: note.createdAt || Date.now(),
          updatedAt: note.updatedAt || Date.now(),
        });
      } catch (e) {
        console.warn('Failed to read note', file, e);
      }
    }
    return notes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function saveNote(body) {
    await ensureNotesDir();
    const id = body.id || `note-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const now = Date.now();
    const note = {
      id,
      title: body.title || 'Untitled',
      content: body.content || '',
      category: body.category || '.',
      createdAt: now,
      updatedAt: now,
    };
    try {
      const existing = await FileSystem.readAsStringAsync(NOTES_DIR + id + '.json');
      const parsed = JSON.parse(existing);
      note.createdAt = parsed.createdAt || now;
    } catch {}
    await FileSystem.writeAsStringAsync(NOTES_DIR + id + '.json', JSON.stringify(note));
    return { id, title: note.title, body: note.content, category: note.category, createdAt: note.createdAt, updatedAt: note.updatedAt };
  }

  async function deleteNote(id) {
    await ensureNotesDir();
    const path = NOTES_DIR + id + '.json';
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path);
    }
  }

  async function handleStatus() {
    return {
      success: true,
      data: {
        running: !!modelId,
        nodeId: nodeIdRef.current,
        inference: { isRunning: !!modelId },
        mining: {
          running: miningRunning,
          currentMiner: miningRunning ? 'on-device' : null,
          availableMiners: ['on-device'],
        },
        embedding: { ready: false },
        p2p: { running: false, peers: 0 },
      },
    };
  }

  async function handleWikiSearch(query) {
    const q = (query?.q || '').toLowerCase();
    const category = query?.category || '';
    const notes = await listNotes();
    let results = notes;
    if (q) {
      results = results.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.body || '').toLowerCase().includes(q)
      );
    }
    if (category) {
      results = results.filter(n => n.category === category);
    }
    return {
      success: true, data: results.map(n => ({
        id: n.id, title: n.title, path: `${n.id}.md`,
        snippet: (n.body || '').slice(0, 200), category: n.category,
      }))
    };
  }

  async function handleWikiGraph(query) {
    const nodeId = query?.id || '';
    const notes = await listNotes();
    if (nodeId) {
      const note = notes.find(n => n.id === nodeId);
      if (!note) return { success: true, data: { nodes: 0, links: 0 } };
      const linkedIds = new Set();
      for (const other of notes) {
        if (other.id === nodeId) continue;
        if (note.body?.includes(other.id) || other.body?.includes(nodeId)) {
          linkedIds.add(other.id);
        }
      }
      return {
        success: true, data: {
          node: { id: note.id, title: note.title },
          links: Array.from(linkedIds).map(id => ({ source: nodeId, target: id })),
          nodes: [{ id: note.id, title: note.title }, ...notes.filter(n => linkedIds.has(n.id)).map(n => ({ id: n.id, title: n.title }))],
        }
      };
    }
    return {
      success: true, data: {
        nodes: notes.length,
        links: 0,
      }
    };
  }

  async function handleWikiStatus() {
    const notes = await listNotes();
    return {
      success: true, data: {
        qvac: { available: !!modelId, model: modelId ? 'BITNET_0_7B_INST_TQ2_0' : null },
        embedding: { available: false },
        hypercore: { available: false },
        pear: { available: false, running: false, peers: 0 },
        openviking: { available: false },
        otterwiki: { available: false, pages: 0 },
        wikiDir: NOTES_DIR,
        localNotes: notes.length,
      }
    };
  }

  async function handleLLMWikiCreate(body) {
    const { topic = '', prompt: customPrompt = '', category = 'concepts' } = body;
    if (!topic && !customPrompt) return { success: false, error: 'topic or prompt is required' };
    try {
      await ensureModelLoaded();
    } catch (e) {
      return { success: false, error: e.message || 'AI model not loaded' };
    }
    const fullPrompt = `Write a comprehensive wiki page about: ${customPrompt || topic}`;
    const history = [{ role: 'user', content: fullPrompt }];
    const result = completion({ modelId, history, stream: false });
    let generated = '';
    for await (const token of result.tokenStream) {
      generated += token;
    }
    const title = topic || customPrompt || 'Generated Page';
    const note = await saveNote({ content: generated, title, category });
    return { success: true, data: note };
  }

  async function handleWikiDocs() {
    const notes = await listNotes();
    return { success: true, data: notes };
  }

  async function handleWikiSave(body) {
    const note = await saveNote(body);
    return { success: true, data: note };
  }

  async function handleWikiDelete(query) {
    const id = query?.id;
    if (!id) return { success: false, error: 'Missing id' };
    await deleteNote(id);
    return { success: true };
  }

  // ─── Swarm (local topic tracking) ───
  async function handleSwarmStatus() {
    return {
      success: true, data: {
        available: true,
        running: swarmTopics.length > 0,
        peers: 0,
        topics: swarmTopics,
      }
    };
  }

  async function handleSwarmCreate(body) {
    const scope = body?.scope || 'wiki';
    const pageId = body?.pageId || null;
    const randomBytes = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
    const topicHex = randomBytes.map(b => b.toString(16).padStart(2, '0')).join('');
    const topicEntry = { topic: topicHex, scope, pageId, title: body?.pageTitle || null };
    setSwarmTopics(prev => [...prev, topicEntry]);
    const inviteUrl = `chimera://swarm/join?topic=${topicHex}`;
    return {
      success: true, data: {
        topic: topicHex,
        shortTopic: topicHex.slice(0, 16) + '...',
        scope, pageId, inviteUrl,
        message: scope === 'page'
          ? 'Share the topic hex to collaborate on this page only.'
          : 'Share the topic hex to sync the entire wiki.',
      }
    };
  }

  async function handleSwarmJoin(body) {
    const topicHex = body?.topic || '';
    if (!topicHex || topicHex.length !== 64) {
      return { success: false, error: 'Valid 64-char topic hex required' };
    }
    const topicEntry = { topic: topicHex, scope: body?.scope || 'wiki', pageId: body?.pageId || null };
    setSwarmTopics(prev => prev.find(t => t.topic === topicHex) ? prev : [...prev, topicEntry]);
    return { success: true, data: { topic: topicHex, status: 'joined', peers: 0 } };
  }

  // ─── Mining Control ───
  async function handleStop() {
    setMiningRunning(false);
    return { success: true, data: { message: 'Mining stopped', running: false } };
  }

  // ─── Auth (wallet-based) ───
  async function handleSignIn(body) {
    const address = body?.evmAddress || body?.walletAddress || walletAddress;
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return { success: false, error: 'Valid EVM wallet address required' };
    }
    setAuthed(true);
    setWalletAddress(address);
    return { success: true, data: { user: { wallet: { address } }, token: `mobile-${address}` } };
  }

  async function handleSignOut() {
    setAuthed(false);
    return { success: true, data: { signedOut: true } };
  }

  // ─── File Conversion ───
  async function handleConvertToMd(body) {
    const { filename, content } = body;
    if (!content) return { success: false, error: 'No file content provided' };
    const text = typeof content === 'string' ? content : String(content);
    const md = text.replace(/\r\n/g, '\n').trim();
    return { success: true, data: { filename: filename || 'uploaded.md', markdown: md } };
  }

  async function handleRepoToMd(body) {
    const { url, path: dirPath } = body;
    if (url) {
      try {
        const repoInfo = parseGitHubUrl(url);
        const branchesToTry = repoInfo.branch ? [repoInfo.branch] : ['main', 'master', 'dev'];
        let treeData = null;
        let workingBranch = null;
        for (const branch of branchesToTry) {
          try {
            const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/trees/${branch}?recursive=1`;
            const resp = await fetch(apiUrl);
            if (resp.ok) {
              const data = await resp.json();
              if (data.tree) { treeData = data.tree; workingBranch = branch; break; }
            }
          } catch {}
        }
        if (!treeData) return { success: false, error: `Could not access repository "${repoInfo.owner}/${repoInfo.repo}"` };
        let files = treeData.filter(item => item.type === 'blob');
        if (repoInfo.subdirectory) {
          files = files.filter(item => item.path.startsWith(repoInfo.subdirectory + '/'));
        }
        const skipPatterns = ['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', '.next', 'out', '.DS_Store', 'Thumbs.db', '.idea', '.vscode'];
        const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.mov', '.avi', '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.jar'];
        files = files.filter(f => {
          const basename = f.path.split('/').pop();
          const ext = '.' + (basename.split('.').pop() || '').toLowerCase();
          if (binaryExts.includes(ext)) return false;
          if (f.size > 500 * 1024) return false;
          for (const p of skipPatterns) { if (f.path.includes(p)) return false; }
          return true;
        });
        let md = `# Repository Digest\n\nRepository: ${repoInfo.owner}/${repoInfo.repo}\nBranch: ${workingBranch}\nFiles: ${files.length}\n\n---\n\n`;
        let processed = 0;
        for (const file of files) {
          try {
            const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${workingBranch}/${file.path}`;
            const resp = await fetch(rawUrl);
            if (resp.ok) {
              const content = await resp.text();
              const safe = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              md += `<file path="${file.path}">\n${safe}\n</file>\n\n`;
              processed++;
            }
          } catch {}
        }
        return { success: true, data: { markdown: md, fileCount: processed, rootDir: url } };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    if (dirPath) {
      try {
        const info = await FileSystem.getInfoAsync(dirPath);
        if (!info.exists || !info.isDirectory) {
          return { success: false, error: 'Directory not found or not accessible' };
        }
        const files = await walkLocalDir(dirPath);
        let md = `# Repository Digest\n\nPath: ${dirPath}\nFiles: ${files.length}\n\n---\n\n`;
        for (const f of files) {
          try {
            const content = await FileSystem.readAsStringAsync(f.fullPath);
            const safe = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            md += `<file path="${f.relativePath}">\n${safe}\n</file>\n\n`;
          } catch {}
        }
        return { success: true, data: { markdown: md, fileCount: files.length, rootDir: dirPath } };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'Provide either path or url' };
  }

  function parseGitHubUrl(urlStr) {
    let owner, repo, branch = null, subdirectory = '';
    if (urlStr.includes('github.com')) {
      const urlParts = new URL(urlStr);
      const pathParts = urlParts.pathname.split('/').filter(p => p);
      if (pathParts.length < 2) throw new Error('Invalid GitHub URL format');
      owner = pathParts[0];
      repo = pathParts[1].replace(/\.git$/, '');
      if (pathParts.length > 2) {
        const routeType = pathParts[2];
        if ((routeType === 'tree' || routeType === 'blob') && pathParts.length > 3) {
          branch = pathParts[3];
          if (pathParts.length > 4) subdirectory = pathParts.slice(4).join('/').replace(/^\/+|\/+$/g, '');
        }
      }
    } else {
      const parts = urlStr.split('/');
      if (parts.length < 2) throw new Error('Invalid repository format');
      owner = parts[0];
      repo = parts[1].replace(/\.git$/, '');
      if (parts.length > 2) { branch = parts[2]; subdirectory = parts.slice(3).join('/').replace(/^\/+|\/+$/g, ''); }
    }
    return { owner, repo, branch, subdirectory };
  }

  async function walkLocalDir(dir, baseDir = dir, results = []) {
    const entries = await FileSystem.readDirectoryAsync(dir);
    const skipPatterns = ['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', '.next', 'out', '.DS_Store', 'Thumbs.db', '.idea', '.vscode'];
    const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.mov', '.avi', '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.jar'];
    for (const entry of entries.sort()) {
      const fullPath = dir + (dir.endsWith('/') ? '' : '/') + entry;
      const relativePath = fullPath.replace(baseDir, '').replace(/^\//, '');
      const info = await FileSystem.getInfoAsync(fullPath);
      if (!info.exists) continue;
      if (info.isDirectory) {
        if (skipPatterns.includes(entry)) continue;
        await walkLocalDir(fullPath, baseDir, results);
      } else {
        const ext = '.' + (entry.split('.').pop() || '').toLowerCase();
        if (binaryExts.includes(ext)) continue;
        if (skipPatterns.some(p => entry.includes(p))) continue;
        if (info.size > 500 * 1024) continue;
        results.push({ relativePath, fullPath, size: info.size });
      }
    }
    return results;
  }

  function parseQuery(path) {
    const idx = path.indexOf('?');
    if (idx === -1) return {};
    const qs = path.slice(idx + 1);
    const result = {};
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=');
      if (k) result[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
    return result;
  }

  async function resolveBridge(id, res) {
    try {
      webViewRef.current?.injectJavaScript(`
        window.__bridgeResolve(${id}, ${JSON.stringify(res)});
        true;
      `);
    } catch (e) {
      console.error('Bridge resolve error:', e);
    }
  }

  const handleWebViewMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === 'bridge-ready') return;

      const { id, method, path: rawPath, body } = msg;
      const queryIdx = rawPath.indexOf('?');
      const path = queryIdx === -1 ? rawPath : rawPath.slice(0, queryIdx);
      const query = parseQuery(rawPath);
      let res;

      try {
        if (method === 'POST' && path === '/api/start') {
          res = await handleStart(body);
        } else if (method === 'POST' && path === '/api/ai-write') {
          res = await handleAIWrite(body);
        } else if (method === 'GET' && path === '/api/ai-status') {
          res = await handleAIStatus();
        } else if (method === 'GET' && path === '/api/ai-docs') {
          res = await handleAIDocs();
        } else if (method === 'GET' && path === '/api/status') {
          res = await handleStatus();
        } else if (method === 'GET' && path === '/api/llmwiki-docs') {
          res = await handleWikiDocs();
        } else if (method === 'GET' && path === '/api/llmwiki-search') {
          res = await handleWikiSearch(query);
        } else if (method === 'GET' && path === '/api/llmwiki-graph') {
          res = await handleWikiGraph(query);
        } else if (method === 'GET' && path === '/api/wiki-status') {
          res = await handleWikiStatus();
        } else if (method === 'POST' && path === '/api/llmwiki-create') {
          res = await handleLLMWikiCreate(body);
        } else if (method === 'POST' && path === '/api/llmwiki-save') {
          res = await handleWikiSave(body);
        } else if (method === 'DELETE' && path === '/api/llmwiki-delete') {
          res = await handleWikiDelete(query);
        } else if (method === 'POST' && path === '/api/convert-to-md') {
          res = await handleConvertToMd(body);
        } else if (method === 'POST' && path === '/api/repo-to-md') {
          res = await handleRepoToMd(body);
        } else if (method === 'GET' && path === '/api/swarm/status') {
          res = await handleSwarmStatus();
        } else if (method === 'POST' && path === '/api/swarm/create') {
          res = await handleSwarmCreate(body);
        } else if (method === 'POST' && path === '/api/swarm/join') {
          res = await handleSwarmJoin(body);
        } else if (method === 'POST' && path === '/api/stop') {
          res = await handleStop();
        } else if (method === 'POST' && path === '/api/signin') {
          res = await handleSignIn(body);
        } else if (method === 'POST' && path === '/api/signout') {
          res = await handleSignOut();
        } else {
          res = { success: false, error: 'Not found' };
        }
      } catch (e) {
        console.error('Bridge handler error:', e);
        res = { success: false, error: e.message || 'Handler failed' };
      }

      resolveBridge(id, res);
    } catch (e) {
      console.error('Bridge error:', e);
    }
  };

  const injectedBridge = `
    (function() {
      if (window.__bridgeActive) return;
      window.__bridgeActive = true;
      window.__bridgeFetch = true;
      window.__bridgeResolvers = {};
      window.__bridgeResolve = function(id, data) {
        const cb = window.__bridgeResolvers[id];
        if (cb) cb(data);
        delete window.__bridgeResolvers[id];
      };

      const originalFetch = window.fetch;
      const isApiCall = (url) => {
        if (typeof url !== 'string') return false;
        return url.startsWith('/api') || url.startsWith('http://localhost:3002/api');
      };
      const extractPath = (url) => {
        if (url.startsWith('/api')) return url;
        return url.replace('http://localhost:3002', '');
      };

      window.fetch = async function(url, options = {}) {
        if (isApiCall(url)) {
          return new Promise((resolve, reject) => {
            const id = Date.now() + Math.random();
            let body = {};
            let filePart = null;
            if (options.body instanceof FormData) {
              filePart = options.body.get('file');
              if (filePart) {
                body._isFormData = true;
                body.filename = filePart.name || 'upload';
                body.contentType = filePart.type || '';
              }
            } else if (options.body) {
              try { body = JSON.parse(options.body); } catch { body = {}; }
            }
            window.__bridgeResolvers[id] = (res) => {
              resolve(new Response(JSON.stringify(res), {
                status: res.success ? 200 : 500,
                headers: { 'Content-Type': 'application/json' }
              }));
            };

            if (body._isFormData && filePart) {
              const reader = new FileReader();
              reader.onload = () => {
                body.content = reader.result;
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  id, method: options.method || 'GET', path: extractPath(url), body
                }));
              };
              reader.onerror = () => reject(new Error('File read failed'));
              reader.readAsText(filePart);
            } else {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                id, method: options.method || 'GET', path: extractPath(url), body
              }));
            }

            setTimeout(() => {
              if (window.__bridgeResolvers[id]) {
                delete window.__bridgeResolvers[id];
                reject(new Error('Bridge timeout'));
              }
            }, 120000);
          });
        }
        return originalFetch(url, options);
      };

      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'bridge-ready' }));
    })();
  `;

  if (!frontendUri) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#00e5ff" />
        <Text style={styles.text}>Loading Chimera...</Text>
      </View>
    );
  }

  if (webError) {
    return (
      <View style={styles.container}>
        <Text style={[styles.text, { color: '#ff6b6b', marginBottom: 16 }]}>Failed to load frontend</Text>
        <Text style={[styles.text, { fontSize: 12, color: '#7a7468' }]}>{webError}</Text>
        <Text style={[styles.text, { marginTop: 16, color: '#00e5ff' }]} onPress={() => { setWebError(null); setFrontendUri(null); }}>Retry</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: frontendUri }}
        style={styles.webview}
        injectedJavaScript={injectedBridge}
        onMessage={handleWebViewMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        originWhitelist={['*']}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        allowsInlineMediaPlayback={true}
        onError={(e) => {
          console.error('WebView error:', e.nativeEvent);
          setWebError('WebView error: ' + (e.nativeEvent.description || 'unknown'));
        }}
        onHttpError={(e) => {
          console.error('WebView HTTP error:', e.nativeEvent);
          setWebError('HTTP ' + (e.nativeEvent.statusCode || 'error'));
        }}
        renderError={(errorName) => (
          <View style={styles.container}>
            <Text style={[styles.text, { color: '#ff6b6b' }]}>WebView render error: {errorName}</Text>
          </View>
        )}
        onShouldStartLoadWithRequest={(request) => {
          // Allow Privy OAuth redirects — don't block navigation to auth domains
          const url = request.url || '';
          if (url.startsWith('file://') ||
              url.startsWith('http://') ||
              url.startsWith('https://') ||
              url.startsWith('io.chimera://') ||
              url.startsWith('chimera://')) {
            return true;
          }
          return true;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: {
    flex: 1,
    width: '100%',
  },
  text: {
    color: '#e8e2d8',
    marginTop: 16,
    fontSize: 14,
  },
});
