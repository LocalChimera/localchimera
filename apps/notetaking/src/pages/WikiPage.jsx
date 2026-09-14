import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useChimera } from '@localchimera/sdk';
import { useBrowserNode } from '../hooks/useBrowserNode';

const isNative = typeof window !== 'undefined' && (window.Capacitor || window.__TAURI__ || window.__bridgeFetch);
const NATIVE_API_BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE
  : 'http://localhost:3002/api';
const API_BASE = isNative
  ? NATIVE_API_BASE
  : (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ? '/api'
    : NATIVE_API_BASE;

/* ─── Simple markdown renderer (no external deps) ─── */
function mdToHtml(text) {
  if (!text) return '';
  let lines = text.split('\n');
  // Hide YAML front matter from the preview; keep it in editorText so the AI still sees it.
  if (lines[0] === '---') {
    const closeIdx = lines.indexOf('---', 1);
    if (closeIdx !== -1) lines = lines.slice(closeIdx + 1);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html = '';
  let inList = false;
  let inCode = false;
  let codeBuf = '';
  let codeLang = '';

  const flushList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const startList = () => { if (!inList) { html += '<ul>'; inList = true; } };

  for (let raw of lines) {
    const line = raw; // keep original for code blocks

    // Code fences
    if (line.startsWith('```')) {
      if (inCode) {
        html += `<pre style="background:#f0ede8;padding:12px;border-radius:6px;overflow:auto;font-size:13px;border:1px solid rgba(0,0,0,0.08);margin:8px 0"><code style="color:#3d3a35;font-family:'JetBrains Mono',monospace">${esc(codeBuf)}</code></pre>`;
        codeBuf = '';
        inCode = false;
        continue;
      }
      inCode = true;
      codeLang = line.slice(3).trim();
      flushList();
      continue;
    }
    if (inCode) {
      codeBuf += line + '\n';
      continue;
    }

    // Headings
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);
    if (h1) { flushList(); html += `<h1 style="font-size:26px;margin:18px 0 10px;color:#1a1917;font-weight:700;letter-spacing:-0.02em">${renderInline(h1[1])}</h1>`; continue; }
    if (h2) { flushList(); html += `<h2 style="font-size:18px;margin:16px 0 8px;color:#1a1917;font-weight:600;border-bottom:1px solid rgba(0,0,0,0.08);padding-bottom:4px;letter-spacing:-0.01em">${renderInline(h2[1])}</h2>`; continue; }
    if (h3) { flushList(); html += `<h3 style="font-size:15px;margin:12px 0 6px;color:#8b6f3a;font-weight:600">${renderInline(h3[1])}</h3>`; continue; }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      html += `<blockquote style="border-left:3px solid #8b6f3a;padding-left:10px;margin:8px 0;color:#6b6559;font-style:italic">${renderInline(line.slice(2))}</blockquote>`;
      continue;
    }

    // List items
    if (line.match(/^[-*]\s/)) {
      startList();
      html += `<li style="margin:3px 0">${renderInline(line.replace(/^[-*]\s+/, ''))}</li>`;
      continue;
    }
    flushList();

    // Empty line
    if (!line.trim()) {
      html += '<br/>';
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      html += '<hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:12px 0"/>';
      continue;
    }

    // Regular paragraph
    html += `<p style="margin:6px 0;line-height:1.7;color:#3d3a35">${renderInline(line)}</p>`;
  }
  flushList();
  return html;
}

function renderInline(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f0ede8;padding:1px 5px;border-radius:3px;font-size:13px;color:#8b6f3a;border:1px solid rgba(0,0,0,0.08)">$1</code>')
    .replace(/\[\[([^\]]+)\]\]/g, '<a href="#" style="color:#8b6f3a;text-decoration:none;border-bottom:1px dotted rgba(139,111,58,0.4)" onclick="return false">$1</a>')
    .replace(/#([a-zA-Z0-9_-]+)/g, '<span style="color:#6b6559">#$1</span>');
}

/* ─── TOC extraction ─── */
function extractToc(text) {
  const items = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m2 = line.match(/^##\s+(.+)/);
    const m3 = line.match(/^###\s+(.+)/);
    if (m2) items.push({ text: m2[1].replace(/\*\*/g,'').trim(), level: 2 });
    else if (m3) items.push({ text: m3[1].replace(/\*\*/g,'').trim(), level: 3 });
  }
  return items;
}

/* ─── Main Component ─── */
export default function WikiPage({ onBack }) {
  const chimera = useChimera();
  const [view, setView] = useState('preview'); // split | edit | preview
  const [editorText, setEditorText] = useState(`---\nid: index\ntitle: Welcome to Chimera\ndescription: Root index for the Chimera knowledge bundle\ntags:\n  - wiki\n  - ai\n  - okf\ncreated: 2026-06-18\nmodified: 2026-06-18\n---\n\n# Welcome to Chimera\n\nThis is your personal wiki powered by local AI inference.\n\n## Getting Started\n\n- Use the **AI Writer** panel to generate content\n- Edit markdown directly in the editor\n- Preview renders your markdown in real-time\n\n## Example\n\n\`\`\`javascript\n// Generated by AI\nconsole.log("Hello, wiki!");\n\`\`\`\n\n> \"Knowledge is power.\"\n\n## Related\n\n- [concepts/getting-started](concepts/getting-started.md)\n- [concepts/ai-writing-guide](concepts/ai-writing-guide.md)\n- [Google Cloud Knowledge Catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog/)\n\n#wiki #ai #okf`);
  const [docs, setDocs] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [aiOpen, setAiOpen] = useState(typeof window !== 'undefined' ? window.innerWidth > 768 : true);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiTitle, setAiTitle] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [saveTitle, setSaveTitle] = useState('');
  const [saveCategory, setSaveCategory] = useState('concepts');
  const [lastSavedAt, setLastSavedAt] = useState(Date.now());
  const [timeAgo, setTimeAgo] = useState('Last saved just now');
  const [rewriteStyle, setRewriteStyle] = useState('concise');
  const [toc, setToc] = useState([]);
  const editorRef = useRef(null);

  // Inline toolbar
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [showInline, setShowInline] = useState(false);
  const [inlinePos, setInlinePos] = useState({ top: 0, left: 0 });

  // AI panel tabs
  const [aiTab, setAiTab] = useState('generate'); // generate | edit | draft | analyze | ingest | auto
  const [analysis, setAnalysis] = useState(null);
  const [draftOutline, setDraftOutline] = useState('');

  // On-device AI + tasker node
  const {
    caps,
    aiStatus,
    aiError,
    aiProgress,
    aiEngine,
    generate,
    nodeStatus,
    nodeRunning,
    startTasker,
    stopTasker,
  } = useBrowserNode();

  if (typeof window !== 'undefined') {
    window.__generate = generate;
    window.__aiStatus = aiStatus;
  }

  // Autoresearch
  const [autoTopic, setAutoTopic] = useState('');

  // Auto-save: debounced save on editorText change
  const saveTimeoutRef = useRef(null);
  const lastSavedRef = useRef('');
  useEffect(() => {
    if (!editorText.trim() || editorText === lastSavedRef.current) return;
    clearTimeout(saveTimeoutRef.current);
    setSaveStatus('Unsaved changes...');
    saveTimeoutRef.current = setTimeout(async () => {
      const title = saveTitle.trim() || (editorText.match(/^#\s+(.+)$/m)?.[1] || 'Untitled');
      setSaveStatus('Saving...');
      try {
        const res = await fetch(`${API_BASE}/llmwiki-save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editorText, title, id: selectedDoc, category: saveCategory })
        });
        const json = await res.json();
        if (json.success) {
          lastSavedRef.current = editorText;
          setSaveStatus('');
          setSaveTitle('');
          setLastSavedAt(Date.now());
          if (json.data?.id) setSelectedDoc(json.data.id);
          await fetchDocs();
        } else {
          setSaveStatus('Save failed');
        }
      } catch (e) {
        console.error(e);
        setSaveStatus('Save failed');
      }
    }, 2000);
    return () => clearTimeout(saveTimeoutRef.current);
  }, [editorText, saveTitle, saveCategory]);

  // Update time-ago text every second
  useEffect(() => {
    const update = () => {
      const diff = Math.floor((Date.now() - lastSavedAt) / 1000);
      if (diff < 5) setTimeAgo('Last saved just now');
      else if (diff < 60) setTimeAgo(`Last saved ${diff}s ago`);
      else if (diff < 3600) setTimeAgo(`Last saved ${Math.floor(diff / 60)}m ago`);
      else setTimeAgo(`Last saved ${Math.floor(diff / 3600)}h ago`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoIntervalRef, setAutoIntervalRef] = useState(null);
  const [autoStatus, setAutoStatus] = useState('');
  const [tdaiExtractStatus, setTdaiExtractStatus] = useState('');

  // L1 extraction: fetch unprocessed L0 conversations, run on-device LLM, save atoms
  const runL1Extraction = async () => {
    if (typeof window !== 'undefined') window.__runL1Extraction = runL1Extraction;
    setTdaiExtractStatus('Fetching unprocessed conversations...');
    try {
      const extractRes = await fetch(`${API_BASE}/tdai/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const extractData = await extractRes.json();
      if (extractData.error) { setTdaiExtractStatus(`Error: ${extractData.error}`); return; }
      const sessions = extractData.sessions || {};
      const sessionKeys = Object.keys(sessions);
      if (sessionKeys.length === 0) { setTdaiExtractStatus('No unprocessed conversations found.'); return; }
      setTdaiExtractStatus(`Found ${extractData.total_unprocessed} unprocessed records in ${sessionKeys.length} session(s). Loading LLM...`);

      const L1_SYSTEM = `You extract key facts from conversations. List each fact on its own line starting with a dash.`;

      let totalAtoms = 0;
      let totalScenes = 0;

      for (const sk of sessionKeys) {
        const records = sessions[sk];
        if (records.length === 0) continue;
        setTdaiExtractStatus(`Extracting from session "${sk}" (${records.length} messages)...`);

        // Format messages for the LLM — keep it short for the small model
        const messagesText = records.map(r =>
          `${r.role}: ${r.message_text || ''}`
        ).join('\n');

        const userPrompt = `List the key facts about the user from this conversation. One fact per line starting with - :

${messagesText}`;

        let llmResponse;
        try {
          llmResponse = await generate(userPrompt, { systemPrompt: L1_SYSTEM, maxTokens: 256 });
        } catch (e) {
          setTdaiExtractStatus(`LLM inference failed: ${e.message}`);
          continue;
        }

        // Parse bullet-point/numbered list response
        const allAtoms = [];
        const processedIds = records.map(r => r.id);
        const lines = llmResponse.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          // Match lines starting with -, *, or numbers followed by . or )
          const match = line.match(/^[-*•]\s*(.+)$/) || line.match(/^\d+[.)]\s*(.+)$/);
          if (match) {
            let content = match[1].trim();
            // Strip speaker prefixes
            content = content.replace(/^(user|assistant|human|ai)\s*:\s*/i, '');
            // Skip meta lines and too-short content
            if (content.length < 10) continue;
            if (content.startsWith('Here are') || content.startsWith('To extract') || content.startsWith('This will') || content.startsWith('Q:')) continue;
            allAtoms.push({
              content,
              type: 'persona',
              priority: 60,
              scene_name: sk,
              source_message_ids: [],
              metadata: {},
            });
          }
        }
        totalScenes++;

        if (allAtoms.length > 0) {
          setTdaiExtractStatus(`Saving ${allAtoms.length} atoms from session "${sk}"...`);
          const saveRes = await fetch(`${API_BASE}/tdai/l1/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              atoms: allAtoms,
              session_key: sk,
              processed_l0_ids: processedIds,
            }),
          });
          const saveData = await saveRes.json();
          totalAtoms += saveData.saved || 0;
        } else {
          // Still mark as processed even if no atoms extracted
          await fetch(`${API_BASE}/tdai/l1/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ atoms: [], session_key: sk, processed_l0_ids: processedIds }),
          });
        }
      }

      setTdaiExtractStatus(`Done: ${totalAtoms} atoms extracted from ${totalScenes} scenes.`);
      setTimeout(() => setTdaiExtractStatus(''), 8000);
    } catch (e) {
      setTdaiExtractStatus(`Extraction failed: ${e.message}`);
    }
  };

  if (typeof window !== 'undefined') window.__runL1Extraction = runL1Extraction;

  // Mobile responsive
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Mobile settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefBoot, setPrefBoot] = useState(() => localStorage.getItem('chimera_boot') === '1');
  const [prefHome, setPrefHome] = useState(() => localStorage.getItem('chimera_home') === '1');
  const [prefAiOpen, setPrefAiOpen] = useState(() => {
    const v = localStorage.getItem('chimera_ai');
    return v === null ? true : v === '1'; // default true
  });

  // Mobile AI sidebar overlay
  const [aiMobileOpen, setAiMobileOpen] = useState(true);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (isMobile && view === 'split') setView('edit');
  }, [isMobile, view]);

  // Respect AI-open preference on mount
  useEffect(() => {
    if (isMobile && !prefAiOpen) setAiOpen(false);
  }, [isMobile, prefAiOpen]);

  // Update check (mobile/web)
  const [appUpdate, setAppUpdate] = useState(null);
  useEffect(() => {
    const CURRENT = (typeof window !== 'undefined' && window.__appVersion) || '1.0.22';
    const compareVersion = (a, b) => {
      const normalize = (v) => v.replace(/^v/, '').split('-')[0].split('.').map(p => parseInt(p, 10) || 0);
      const pa = normalize(a);
      const pb = normalize(b);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
      }
      return 0;
    };
    fetch('https://api.github.com/repos/TerexitariusStomp/qvac-chimera/releases/latest', {
      headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !data.tag_name) return;
        const latest = data.tag_name.replace(/^v/, '');
        if (compareVersion(latest, CURRENT) > 0) {
          setAppUpdate({ current: CURRENT, latest, url: data.html_url || 'https://github.com/TerexitariusStomp/qvac-chimera/releases/latest' });
        }
      })
      .catch(() => {});
  }, []);

  // File drop
  const [dropHover, setDropHover] = useState(false);
  const [dropFiles, setDropFiles] = useState([]);

  // Repo digest (ai-digest)
  const [repoDigestPath, setRepoDigestPath] = useState('');

  // Integration status
  const [sysStatus, setSysStatus] = useState(null);

  // Swarm
  const [swarmTopic, setSwarmTopic] = useState('');
  const [swarmInvite, setSwarmInvite] = useState('');
  const [swarmPeers, setSwarmPeers] = useState(0);
  const [swarmTopics, setSwarmTopics] = useState([]);
  const [joinTopicInput, setJoinTopicInput] = useState('');
  const [swarmScope, setSwarmScope] = useState('wiki'); // 'wiki' | 'page'

  useEffect(() => {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'ssr';
    const isAllowed = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localchimera.com') || host === 'localchimera.com';
    if (typeof window.ReactNativeWebView !== 'undefined') {
      const flags = {
        providerActive: !!window.__chimeraWeb3AuthProviderActive,
      };
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'diag', msg: `host=${host} isAllowed=${isAllowed} provider=${flags.providerActive}` }));
    }
    const id = setInterval(() => {
      if (typeof window.ReactNativeWebView !== 'undefined') {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'diag', msg: `chimera status: ready=${chimera.ready} connected=${chimera.walletConnected} addr=${chimera.walletAddress || 'null'} adapter=${chimera.walletAdapterAddress || 'null'}` }));
      }
    }, 3000);
    return () => clearInterval(id);
  }, [chimera.ready, chimera.walletConnected, chimera.walletAddress, chimera.walletAdapterAddress]);

  // Miner node
  const [evmAddress, setEvmAddress] = useState('');
  const [backendError, setBackendError] = useState('');

  useEffect(() => {
    fetchDocs();
    fetchStatus();
    const saved = localStorage.getItem('chimeraEvmAddress');
    if (saved) setEvmAddress(saved);
  }, []);

  useEffect(() => { setToc(extractToc(editorText)); }, [editorText]);
  useEffect(() => () => { if (autoIntervalRef) clearInterval(autoIntervalRef); }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/wiki-status`);
      const json = await res.json();
      if (json.success) setSysStatus(json.data);
    } catch (e) { console.error(e); }
  };

  const connectWalletChain = async (chain) => {
    setSaveStatus(`Connecting ${chain} wallet...`);
    const res = await chimera.connectWallet(chain);
    if (res.success) {
      setSaveStatus(res.pending ? 'Complete the wallet connection' : 'Wallet connected');
    } else {
      setSaveStatus(res.error || 'Wallet connection failed');
    }
    setTimeout(() => setSaveStatus(''), 4000);
  };

  // Listen for browser-based wallet callback from React Native deep link
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const complete = async (data) => {
      console.log('[WikiPage] mobile wallet callback received', data);
      setSaveStatus('Completing wallet connection...');
      const res = await chimera.connectWalletWithJwt(data);
      if (res.success) {
        setSaveStatus('Wallet connected');
      } else {
        setSaveStatus(res.error || 'Wallet completion failed');
      }
      setTimeout(() => setSaveStatus(''), 4000);
    };
    window.__onMobileWalletCallback = complete;
    if (window.__mobileWalletCallback) {
      complete(window.__mobileWalletCallback);
    }
    return () => { window.__onMobileWalletCallback = null; };
  }, [chimera]);

  const doSignIn = async () => connectWalletChain('evm');

  const doSignOut = async () => {
    await chimera.disconnectWallet();
    setSaveStatus('Signed out');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const startNode = async () => {
    setSaveStatus('Starting tasker node...');
    try {
      await startTasker();
      setSaveStatus('Tasker node started');
    } catch (e) {
      setSaveStatus(`Tasker start failed: ${e.message}`);
    }
    setTimeout(() => setSaveStatus(''), 4000);
  };

  const stopNode = async () => {
    setSaveStatus('Stopping tasker node...');
    try {
      await stopTasker();
      setSaveStatus('Tasker node stopped');
    } catch (e) {
      setSaveStatus(`Tasker stop failed: ${e.message}`);
    }
    setTimeout(() => setSaveStatus(''), 4000);
  };

  const fetchSwarmStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/swarm/status`);
      const json = await res.json();
      if (json.success && json.data) {
        setSwarmPeers(json.data.peers || 0);
        setSwarmTopics(json.data.topics || []);
      }
    } catch (e) { console.error(e); }
  };

  const createSwarm = async () => {
    setSaveStatus('Creating swarm...');
    const pageId = selectedDoc || null;
    const pageTitle = pageId ? docs.find(d => d.id === pageId)?.title : null;
    try {
      const res = await fetch(`${API_BASE}/swarm/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: swarmScope, pageId, pageTitle })
      });
      const json = await res.json();
      if (json.success) {
        setSwarmTopic(json.data.topic);
        setSwarmInvite(json.data.inviteUrl);
        setSaveStatus(swarmScope === 'page' ? 'Page swarm created!' : 'Wiki swarm created!');
        fetchSwarmStatus();
      } else {
        setSaveStatus('Failed');
      }
    } catch (e) {
      console.error(e);
      setSaveStatus('Failed');
    }
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const joinSwarm = async () => {
    if (!joinTopicInput.trim()) return;
    setSaveStatus('Joining swarm...');
    try {
      const res = await fetch(`${API_BASE}/swarm/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: joinTopicInput.trim() })
      });
      const json = await res.json();
      if (json.success) {
        setSwarmTopic(json.data.topic);
        setSaveStatus('Joined!');
        setJoinTopicInput('');
        fetchSwarmStatus();
      } else {
        setSaveStatus('Join failed');
      }
    } catch (e) {
      console.error(e);
      setSaveStatus('Join failed');
    }
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const fetchDocs = async () => {
    try {
      const res = await fetch(`${API_BASE}/llmwiki-docs`);
      const json = await res.json();
      if (json.success) {
        setDocs(json.data || []);
        setBackendError('');
      }
    } catch (e) {
      console.error('Failed to fetch docs:', e);
      setBackendError('Backend not running — start the Chimera node');
    }
  };

  const loadDoc = async (doc) => {
    if (!doc?.id) return;
    setSaveStatus('Loading...');
    try {
      const res = await fetch(`${API_BASE}/llmwiki-read?id=${doc.id}`);
      const json = await res.json();
      if (json.success && json.data?.content != null) {
        setEditorText(json.data.content);
        setSaveCategory(doc.category || 'concepts');
        setSaveStatus('');
        lastSavedRef.current = json.data.content;
      } else {
        setEditorText(`# ${doc.title}\n\n(No content loaded)`);
        setSaveStatus(json.error || 'Load failed');
        setTimeout(() => setSaveStatus(''), 2000);
      }
    } catch (e) {
      console.error('Failed to load doc:', e);
      setEditorText(`# ${doc.title}\n\n(No content loaded)`);
      setSaveStatus('Load failed');
      setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const handleGenerate = async () => {
    console.log('[WikiPage] handleGenerate clicked, prompt:', aiPrompt.trim());
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setSaveStatus('Loading on-device AI...');
    try {
      const generated = await generate(aiPrompt);
      setEditorText(prev => {
        const sep = prev.trim().length > 0 ? '\n\n---\n\n' : '';
        return prev + sep + generated;
      });
      setAiPrompt('');
      setAiTitle('');
      setSaveStatus('Generated!');
      setTimeout(() => setSaveStatus(''), 1500);
    } catch (e) {
      console.error(e);
      setSaveStatus(`Generation failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editorText.trim()) return;
    const title = saveTitle.trim() || (editorText.match(/^#\s+(.+)$/m)?.[1] || 'Untitled');
    setSaveStatus('Saving...');
    try {
      const res = await fetch(`${API_BASE}/llmwiki-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editorText, title, id: selectedDoc, category: saveCategory })
      });
      const json = await res.json();
      if (json.success) {
        setSaveStatus('Saved!');
        setSaveTitle('');
        if (json.data?.id) setSelectedDoc(json.data.id);
        await fetchDocs();
        setTimeout(() => setSaveStatus(''), 2000);
      } else {
        setSaveStatus('Save failed');
      }
    } catch (e) {
      console.error(e);
      setSaveStatus('Save failed');
    }
  };

  const handleDelete = async () => {
    if (!selectedDoc) {
      setSaveStatus('Select a page first');
      setTimeout(() => setSaveStatus(''), 2000);
      return;
    }
    if (!window.confirm('Delete this wiki page? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/llmwiki-delete?id=${selectedDoc}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setSaveStatus('Deleted');
        setSelectedDoc(null);
        setEditorText('');
        fetchDocs();
        setTimeout(() => setSaveStatus(''), 2000);
      } else {
        setSaveStatus('Delete failed');
        setTimeout(() => setSaveStatus(''), 3000);
      }
    } catch (e) {
      setSaveStatus('Delete failed');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const handleRewrite = async () => {
    const ta = editorRef.current;
    const start = selStart;
    const end = selEnd;
    const selected = editorText.slice(start, end);
    if (!selected.trim()) {
      setSaveStatus('Select text first');
      setTimeout(() => setSaveStatus(''), 2000);
      return;
    }

    setAiLoading(true);
    setSaveStatus('Loading on-device AI...');
    try {
      const style = rewriteStyle.trim() || 'concise';
      const prompt = `Rewrite the following text in a ${style} style. Output ONLY the rewritten text — no preamble, no explanation, no markdown fences unless the original had them.\n\nOriginal text:\n${selected}`;
      const rewritten = await generate(prompt);
      const before = editorText.slice(0, start);
      const after = editorText.slice(end);
      setEditorText(before + rewritten.trim() + after);
      setSaveStatus('Rewritten!');
      if (ta) setTimeout(() => { setSaveStatus(''); ta.selectionStart = start; ta.selectionEnd = start + rewritten.trim().length; ta.focus(); }, 50);
    } catch (e) {
      console.error(e);
      setSaveStatus(`Rewrite failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const trackSelection = () => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setSelStart(start);
    setSelEnd(end);
    if (start !== end && !isMobile) {
      const rect = ta.getBoundingClientRect();
      // approximate position above selection
      setInlinePos({ top: rect.top + window.scrollY - 38, left: rect.left + window.scrollX + 10 });
      setShowInline(true);
    } else {
      setShowInline(false);
    }
  };

  const checkBackend = async () => {
    try {
      const res = await fetch(`${API_BASE}/llmwiki-docs`, { method: 'GET' });
      if (!res.ok) throw new Error('Not reachable');
      setBackendError('');
    } catch (e) {
      setBackendError('Wiki bridge not reachable. Native storage may be unavailable.');
    }
  };

  useEffect(() => {
    checkBackend();
  }, []);

  const aiAction = async (instruction, type = 'replace') => {
    const selected = editorText.slice(selStart, selEnd);
    if (!selected.trim()) {
      setSaveStatus('Select text first');
      setTimeout(() => setSaveStatus(''), 2000);
      return;
    }
    setAiLoading(true);
    setSaveStatus('Loading on-device AI...');
    try {
      const prompt = `${instruction}\n\nText:\n${selected}`;
      const result = await generate(prompt);
      const trimmed = result.trim();
      if (type === 'replace') {
        const before = editorText.slice(0, selStart);
        const after = editorText.slice(selEnd);
        setEditorText(before + trimmed + after);
        setSaveStatus('Done!');
        setTimeout(() => setSaveStatus(''), 1500);
      } else if (type === 'append') {
        const before = editorText.slice(0, selEnd);
        const after = editorText.slice(selEnd);
        setEditorText(before + '\n\n' + trimmed + after);
        setSaveStatus('Done!');
        setTimeout(() => setSaveStatus(''), 1500);
      } else if (type === 'analyze') {
        setAnalysis(trimmed);
        setSaveStatus('');
      }
      setShowInline(false);
    } catch (e) {
      console.error(e);
      setSaveStatus(`AI failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const docAIAction = async (instruction, type = 'append') => {
    setAiLoading(true);
    setSaveStatus('Loading on-device AI...');
    try {
      const prompt = `${instruction}\n\nDocument:\n${editorText}`;
      const result = await generate(prompt);
      const trimmed = result.trim();
      if (type === 'replace') {
        setEditorText(trimmed);
        setSaveStatus('Done!');
        setTimeout(() => setSaveStatus(''), 1500);
      } else if (type === 'append') {
        setEditorText(prev => {
          const sep = prev.trim().length > 0 ? '\n\n---\n\n' : '';
          return prev + sep + trimmed;
        });
        setSaveStatus('Done!');
        setTimeout(() => setSaveStatus(''), 1500);
      } else if (type === 'analyze') {
        setAnalysis(trimmed);
        setSaveStatus('');
      }
    } catch (e) {
      console.error(e);
      setSaveStatus(`AI failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  // ─── Autoresearch ───
  const startAutoresearch = () => {
    if (!autoTopic.trim()) return;
    setAutoRunning(true);
    setAutoStatus('Autoresearch running...');
    let count = 0;
    const id = setInterval(async () => {
      count++;
      setAutoStatus(`Researching... (cycle ${count})`);
      try {
        const generated = await generate(`Research and write a new wiki section about: ${autoTopic}. Add depth, new angles, or related subtopics. Output ONLY markdown content.`);
        setEditorText(prev => {
          const sep = prev.trim().length > 0 ? '\n\n---\n\n' : '';
          return prev + sep + `## Auto-Research: ${autoTopic} (Cycle ${count})\n\n` + generated;
        });
      } catch (e) { console.error(e); }
    }, 30000); // every 30 seconds
    setAutoIntervalRef(id);
  };

  const stopAutoresearch = () => {
    if (autoIntervalRef) clearInterval(autoIntervalRef);
    setAutoIntervalRef(null);
    setAutoRunning(false);
    setAutoStatus('Autoresearch stopped');
    setTimeout(() => setAutoStatus(''), 2000);
  };

  // ─── Drag & Drop ───
  const handleDragOver = (e) => { e.preventDefault(); setDropHover(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDropHover(false); };
  const handleDrop = async (e) => {
    e.preventDefault();
    setDropHover(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    setDropFiles(files.map(f => ({ name: f.name, size: f.size, status: 'uploading' })));
    setSaveStatus('Converting to markdown...');

    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch(`${API_BASE}/convert-to-md`, { method: 'POST', body: formData });
        const json = await res.json();
        if (json.success) {
          setDropFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'done' } : f));
          const md = json.data.markdown || '';
          setEditorText(prev => {
            const sep = prev.trim().length > 0 ? '\n\n---\n\n' : '';
            return prev + sep + `## Source: ${file.name}\n\n${md}\n`;
          });
        } else {
          setDropFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'failed' } : f));
        }
      } catch (err) {
        setDropFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'failed' } : f));
      }
    }
    setSaveStatus('Files converted');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const insertAtCursor = (text) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = editorText.slice(0, start);
    const after = editorText.slice(end);
    setEditorText(before + text + after);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
  };

  const filteredDocs = docs.filter(d =>
    (d.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.category || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedDocs = filteredDocs.reduce((acc, d) => {
    const cat = d.category || '.';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(d);
    return acc;
  }, {});

  const toolbarBtn = (label, action) => (
    <button key={label} style={s.toolbarBtn} onClick={action} title={label}>
      {label}
    </button>
  );

  // Mobile overlay click closes menu
  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <div style={{ ...s.layout, ...(isMobile ? { flexDirection: 'column', height: 'auto', overflow: 'auto' } : {}) }}>
      {/* Update banner */}
      {appUpdate && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 400,
          padding: '8px 12px', background: 'linear-gradient(90deg,#8b6f3a22,#00e5ff22)',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: '#1a1917'
        }}>
          <span>Update v{appUpdate.latest} available</span>
          <a href={appUpdate.url} target="_blank" rel="noopener" style={{ color: '#00e5ff', fontWeight: 600 }}>Download →</a>
        </div>
      )}

      {/* Backend error banner */}
      {backendError && (
        <div style={{
          position: 'fixed', top: appUpdate ? 38 : 0, left: 0, right: 0, zIndex: 399,
          padding: '10px 14px', background: '#7f1d1d', color: '#fca5a5',
          borderBottom: '1px solid #991b1b', fontSize: 13, textAlign: 'center'
        }}>
          {backendError}
        </div>
      )}

      {/* Mobile hamburger */}
      {isMobile && (
        <button
          onClick={() => setMobileMenuOpen(o => !o)}
          style={{
            position: 'fixed', top: appUpdate ? 40 : 8, left: 8, zIndex: 300,
            width: 36, height: 36, borderRadius: 8,
            background: '#f0ede8', border: '1px solid rgba(0,0,0,0.15)',
            color: '#1a1917', fontSize: 18, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
          }}
          aria-label="Menu"
        >
          ☰
        </button>
      )}
      {/* Mobile overlay */}
      {isMobile && mobileMenuOpen && (
        <div onClick={closeMobileMenu} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150
        }} />
      )}

      {/* Mobile settings gear */}
      {isMobile && (
        <button
          onClick={() => setSettingsOpen(o => !o)}
          style={{
            position: 'fixed', top: appUpdate ? 76 : 8, right: 8, zIndex: 300,
            width: 36, height: 36, borderRadius: 8,
            background: '#f0ede8', border: '1px solid rgba(0,0,0,0.15)',
            color: '#3d3a35', fontSize: 18, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
          }}
          aria-label="Settings"
        >
          ⚙️
        </button>
      )}

      {/* Mobile settings modal */}
      {isMobile && settingsOpen && (
        <div onClick={() => setSettingsOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 350,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#ffffff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 12,
            padding: 20, width: '100%', maxWidth: 340, maxHeight: '80vh', overflowY: 'auto'
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1917', marginBottom: 16 }}>Settings</div>

            {[
              { key: 'boot', label: 'Start on device boot', desc: 'Auto-launch when device turns on', val: prefBoot, set: setPrefBoot },
              { key: 'home', label: 'Add to home screen', desc: 'Install as app icon', val: prefHome, set: setPrefHome },
              { key: 'ai', label: 'Keep AI panel open', desc: 'Always show AI Writer and Memory', val: prefAiOpen, set: setPrefAiOpen },
            ].map(row => (
              <div key={row.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)'
              }}>
                <div>
                  <div style={{ fontSize: 13, color: '#3d3a35' }}>{row.label}</div>
                  <div style={{ fontSize: 11, color: '#8a8375', marginTop: 2 }}>{row.desc}</div>
                </div>
                <div onClick={() => {
                  const next = !row.val;
                  row.set(next);
                  localStorage.setItem('chimera_' + row.key, next ? '1' : '0');
                  if (row.key === 'ai' && next) setAiOpen(true);
                }} style={{
                  width: 44, height: 24, borderRadius: 12,
                  background: row.val ? '#00e5ff' : '#f0ede8',
                  border: '1px solid rgba(0,0,0,0.15)',
                  position: 'relative', cursor: 'pointer', transition: '0.2s'
                }}>
                  <div style={{
                    position: 'absolute', top: 2, left: row.val ? 22 : 2,
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    transition: '0.2s'
                  }} />
                </div>
              </div>
            ))}

            <button onClick={() => setSettingsOpen(false)} style={{
              marginTop: 16, width: '100%', padding: '8px 0',
              background: '#f0ede8', color: '#3d3a35',
              border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6,
              fontSize: 13, cursor: 'pointer'
            }}>Close</button>
          </div>
        </div>
      )}

      {/* ─── Left Sidebar ─── */}
      <aside style={{
        ...s.sidebar,
        ...(isMobile ? {
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 200,
          transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
          width: 260, minWidth: 260,
          borderRight: '1px solid rgba(0,0,0,0.15)'
        } : {})
      }}>
        <div style={s.sidebarHeader}>
          <img src="/chimeralogo-header.png" alt="Chimera" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
          <span style={s.logo}>Chimera</span>
        </div>
        {onBack && (
          <button style={s.backBtn} onClick={onBack}>← Back</button>
        )}
        <div style={s.searchBox}>
          <input
            style={s.searchInput}
            placeholder="Search pages..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={s.navHeader}>Outline</div>
        <nav style={s.nav}>
          {Object.entries(groupedDocs).sort((a,b) => a[0].localeCompare(b[0])).map(([cat, items]) => (
            <div key={cat}>
              <div style={s.navCategory}>{cat === '.' ? 'Root' : cat}</div>
              {items.map(doc => {
                const isActive = selectedDoc === doc.id;
                return (
                  <div
                    key={doc.id}
                    style={isActive ? s.navItemActive : s.navItem}
                    onClick={() => {
                      setSelectedDoc(doc.id);
                      loadDoc(doc);
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f0ede8'; e.currentTarget.style.color = '#3d3a35'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b6559'; }}
                  >
                    <span style={s.navIcon}>📄</span>
                    <span style={s.navTitle}>{doc.title}</span>
                    {isActive && <span style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: '#8b6f3a', flexShrink: 0 }} />}
                  </div>
                );
              })}
            </div>
          ))}
          {docs.length === 0 && (
            <div style={s.emptyNav}>No wiki pages yet.<br/>Generate one with AI →</div>
          )}
        </nav>
        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,0.08)', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, color: '#8a8375', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" }}>Hyperswarm</div>

          {/* Scope selector */}
          <div style={{ display: 'flex', gap: 2, background: '#f0ede8', borderRadius: 5, padding: 2, border: '1px solid rgba(0,0,0,0.08)' }}>
            <button
              style={{ flex: 1, padding: '3px 6px', fontSize: 10, borderRadius: 4, border: 'none', cursor: 'pointer', background: swarmScope === 'wiki' ? '#f8f7f4' : 'transparent', color: swarmScope === 'wiki' ? '#3d3a35' : '#8a8375' }}
              onClick={() => setSwarmScope('wiki')}
            >
              Entire Wiki
            </button>
            <button
              style={{ flex: 1, padding: '3px 6px', fontSize: 10, borderRadius: 4, border: 'none', cursor: 'pointer', background: swarmScope === 'page' ? '#f8f7f4' : 'transparent', color: swarmScope === 'page' ? '#3d3a35' : '#8a8375' }}
              onClick={() => setSwarmScope('page')}
            >
              This Page
            </button>
          </div>
          {swarmScope === 'page' && !selectedDoc && (
            <div style={{ fontSize: 9, color: '#fca5a5' }}>⚠ Select a page in the outline first</div>
          )}
          {swarmScope === 'page' && selectedDoc && (
            <div style={{ fontSize: 9, color: '#86efac' }}>📄 {docs.find(d => d.id === selectedDoc)?.title || 'Current page'}</div>
          )}

          <button style={{ ...s.newPageBtn, background: '#dc2626', color: '#fff', borderColor: '#b91c1c' }} onClick={createSwarm}>
            🌐 Create {swarmScope === 'page' ? 'Page' : 'Wiki'} Swarm
          </button>
          {swarmTopic && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 10, color: '#86efac' }}>Topic: {swarmTopic.slice(0, 20)}...</div>
              <button
                style={{ ...s.toolbarBtn, fontSize: 9, padding: '3px 6px' }}
                onClick={() => { navigator.clipboard.writeText(swarmTopic); setSaveStatus('Copied!'); setTimeout(() => setSaveStatus(''), 1500); }}
              >
                📋 Copy Topic
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              style={{ ...s.searchInput, flex: 1, fontSize: 11 }}
              placeholder="Paste topic hex..."
              value={joinTopicInput}
              onChange={e => setJoinTopicInput(e.target.value)}
            />
            <button style={{ ...s.toolbarBtn, padding: '4px 8px', fontSize: 10 }} onClick={joinSwarm}>Join</button>
          </div>
          {swarmPeers > 0 && (
            <div style={{ fontSize: 10, color: '#86efac' }}>🟢 {swarmPeers} peer{swarmPeers !== 1 ? 's' : ''} connected</div>
          )}
          {swarmTopics.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {swarmTopics.map((t, i) => (
                <div key={i} style={{ fontSize: 9, color: t.scope === 'page' ? '#fca5a5' : '#94a3b8' }}>
                  • {t.scope === 'page' ? '📄' : '🌐'} {t.short} {t.title ? `(${t.title})` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,0.08)', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, color: '#8a8375', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" }}>{chimera.walletConnected || chimera.walletAdapterAddress ? 'Wallet connected' : 'Authentication'}</div>
          <div style={{ fontSize: 8, color: '#8a8375', wordBreak: 'break-all' }}>ready:{chimera.ready ? '1' : '0'} auth:{chimera.walletConnected ? '1' : '0'} addr:{chimera.walletAddress ? '1' : '0'}</div>
          {chimera.walletConnected || chimera.walletAdapterAddress ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {chimera.walletAddress && (
                <>
                  <div style={{ fontSize: 9, color: '#8a8375' }}>MPC wallet:</div>
                  <div style={{ fontSize: 10, color: '#86efac', wordBreak: 'break-all' }}>{chimera.walletAddress}</div>
                </>
              )}
              {chimera.walletAdapterAddress && (
                <>
                  <div style={{ fontSize: 9, color: '#8a8375' }}>Connected wallet:</div>
                  <div style={{ fontSize: 10, color: '#86efac', wordBreak: 'break-all' }}>{chimera.walletAdapterAddress}</div>
                </>
              )}
              <div style={{ fontSize: 9, color: '#8a8375' }}>chain: {chimera.walletChain || '?'}</div>
              <button style={{ ...s.toolbarBtn, padding: '4px 8px', fontSize: 10 }} onClick={doSignOut}>Disconnect wallet</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button style={{ ...s.toolbarBtn, padding: '4px 8px', fontSize: 10 }} onClick={() => connectWalletChain('evm')} disabled={!chimera.ready}>EVM wallet</button>
              {!chimera.ready && <div style={{ fontSize: 9, color: '#8a8375' }}>Initializing auth...</div>}
            </div>
          )}
        </div>
        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,0.08)', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, color: '#8a8375', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" }}>Tasker Node</div>
          <div style={{ fontSize: 10, color: nodeRunning ? '#86efac' : '#6b6559', lineHeight: 1.5 }}>
            {nodeRunning ? '🟢 Running — accepting inference tasks' : '⚪ Stopped — start to accept tasks'}
            {nodeStatus?.error && <div style={{ color: '#fca5a5' }}>{nodeStatus.error}</div>}
            {!nodeRunning && !(chimera.walletConnected || chimera.walletAdapterAddress) && (
              <div style={{ color: '#fca5a5', marginTop: 2 }}>Connect wallet first to start mining</div>
            )}
          </div>
          <div style={{ fontSize: 9, color: '#6b6559', lineHeight: 1.4 }}>
            WebGPU: {caps.hasWebGPU ? 'yes' : 'no'} · WebGL: {caps.hasWebGL ? 'yes' : 'no'}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              style={{ flex: 1, padding: '5px 0', fontSize: 10, borderRadius: 5, border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer', background: nodeRunning ? '#166534' : '#f0ede8', color: nodeRunning ? '#86efac' : '#6b6559' }}
              onClick={startNode}
              disabled={nodeRunning || !(chimera.walletConnected || chimera.walletAdapterAddress)}
            >
              ▶ Start
            </button>
            <button
              style={{ flex: 1, padding: '5px 0', fontSize: 10, borderRadius: 5, border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer', background: !nodeRunning ? '#450a0a' : '#f0ede8', color: !nodeRunning ? '#fca5a5' : '#6b6559' }}
              onClick={stopNode}
              disabled={!nodeRunning}
            >
              ⏹ Stop
            </button>
            {nodeRunning && (
              <div style={{ fontSize: 9, color: '#86efac', whiteSpace: 'nowrap' }}>
                {nodeStatus?.jobsProcessed > 0 ? `Jobs: ${nodeStatus.jobsProcessed}` : '●'}
              </div>
            )}
          </div>
        </div>
        <div style={s.sidebarFooter}>
          <button style={s.newPageBtn} onClick={() => { setSelectedDoc(null); setEditorText(''); }}>
            + New Page
          </button>
          <a href="/docs/LOCALCHIMERA.html" style={{ display: 'block', marginTop: 8, fontSize: 12, color: '#6b6559', textDecoration: 'none' }}>
            📖 Documentation
          </a>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main style={{ ...s.main, ...(isMobile ? { minHeight: '100vh' } : {}) }}>
        {/* Toolbar */}
        <div style={{ ...s.toolbar, ...(isMobile ? { flexWrap: 'wrap', gap: 6, padding: '8px 10px 8px 48px' } : {}) }}>
          <div style={{ ...s.toolbarGroup, ...(isMobile ? { flexWrap: 'wrap' } : {}) }}>
            {toolbarBtn('H1', () => insertAtCursor('# '))}
            {toolbarBtn('H2', () => insertAtCursor('## '))}
            {toolbarBtn('H3', () => insertAtCursor('### '))}
            {toolbarBtn('Bold', () => insertAtCursor('**text**'))}
            {toolbarBtn('Italic', () => insertAtCursor('*text*'))}
            {toolbarBtn('Code', () => insertAtCursor('`code`'))}
            {toolbarBtn('Link', () => insertAtCursor('[[Page]]'))}
            {toolbarBtn('List', () => insertAtCursor('- item\n'))}
            {toolbarBtn('Quote', () => insertAtCursor('> quote\n'))}
            {toolbarBtn('Rule', () => insertAtCursor('\n---\n'))}
          </div>
          <div style={s.toolbarGroup}>
            <button style={view === 'edit' ? s.modeBtnActive : s.modeBtn} onClick={() => setView('edit')}>Edit</button>
            {!isMobile && <button style={view === 'split' ? s.modeBtnActive : s.modeBtn} onClick={() => setView('split')}>Split</button>}
            <button style={view === 'preview' ? s.modeBtnActive : s.modeBtn} onClick={() => setView('preview')}>Preview</button>
          </div>
          <div style={s.toolbarGroup}>
            <button style={{ ...s.toolbarBtn, background: '#7f1d1d', color: '#fca5a5', borderColor: '#7f1d1d' }} onClick={handleDelete}>
              🗑 Delete
            </button>
            <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 140, textAlign: 'right' }}>{saveStatus || timeAgo}</span>
          </div>
        </div>

        {/* Editor + Preview */}
        <div
          style={{ ...s.editorPane, ...(isMobile ? { flexDirection: 'column' } : {}) }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dropHover && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(59,130,246,0.1)', border: '2px dashed #3b82f6', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#3b82f6' }}>
              Drop PDFs, links, or files here to analyze
            </div>
          )}
          {(view === 'edit' || view === 'split') && (
            <div style={view === 'split'
              ? { ...s.splitLeft, ...(isMobile ? { width: '100%', minHeight: 200, borderRight: 'none', borderBottom: '1px solid rgba(0,0,0,0.08)' } : {}) }
              : s.full
            }>
              <textarea
                ref={editorRef}
                style={{ ...s.textarea, ...(isMobile ? { padding: '12px 14px', fontSize: 13 } : {}) }}
                value={editorText}
                onChange={e => { setShowInline(false); setEditorText(e.target.value); }}
                onMouseUp={trackSelection}
                onKeyUp={trackSelection}
                spellCheck={false}
                placeholder="Start writing markdown..."
              />
            </div>
          )}
          {(view === 'preview' || view === 'split') && (
            <div style={view === 'split'
              ? { ...s.splitRight, ...(isMobile ? { flexDirection: 'column' } : {}) }
              : s.full
            }>
              <div style={{ ...s.preview, ...(isMobile ? { padding: '14px 16px', fontSize: 13 } : {}) }} dangerouslySetInnerHTML={{ __html: mdToHtml(editorText) }} />
              {toc.length > 0 && (
                <div style={{ ...s.toc, ...(isMobile ? { width: '100%', minWidth: 'auto', borderLeft: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', padding: '12px 14px' } : {}) }}>
                  <div style={s.tocTitle}>Contents</div>
                  {toc.map((item, i) => (
                    <div key={i} style={item.level === 3 ? s.tocItem3 : s.tocItem}>
                      {item.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ─── Inline Selection Toolbar ─── */}
      {showInline && (
        <div style={{ position: 'fixed', top: inlinePos.top, left: inlinePos.left, zIndex: 100, display: 'flex', gap: 4, padding: '4px 6px', background: '#1e1e2e', border: '1px solid #2e2e3e', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
          <button style={s.inlineBtn} onClick={() => aiAction('Rewrite the following text to be more concise. Output ONLY the rewritten text.', 'replace')}>Shorten</button>
          <button style={s.inlineBtn} onClick={() => aiAction('Expand the following text with more detail and examples. Output ONLY the expanded text.', 'replace')}>Expand</button>
          <button style={s.inlineBtn} onClick={() => aiAction('Fix grammar and improve clarity of the following text. Output ONLY the corrected text.', 'replace')}>Fix</button>
          <button style={s.inlineBtn} onClick={() => aiAction('Rewrite the following text to be more formal. Output ONLY the rewritten text.', 'replace')}>Formal</button>
          <button style={s.inlineBtn} onClick={() => aiAction('Continue writing from the end of the following text. Output ONLY the continuation.', 'append')}>Continue</button>
          <button style={s.inlineBtn} onClick={() => aiAction('Explain why this text is weak and suggest improvements. Output ONLY the critique.', 'analyze')}>Critique</button>
        </div>
      )}

      {/* AI overlay (mobile only) */}
      {isMobile && aiMobileOpen && (
        <div onClick={() => setAiMobileOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 210
        }} />
      )}

      {/* ─── Right AI Panel ─── */}
      <aside id="aiPanel" style={{
        ...(isMobile ? {
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '85%', maxWidth: 360, zIndex: 220,
          background: '#ffffff', borderLeft: '1px solid rgba(0,0,0,0.15)',
          transform: aiMobileOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column',
        } : (aiOpen ? s.aiPanel : s.aiPanelCollapsed))
      }}>
        <div style={{ ...s.aiHeader, ...(isMobile ? { flexShrink: 0 } : {}) }} onClick={() => { if (!isMobile) { console.log('[WikiPage] AI header toggle, current aiOpen:', aiOpen); setAiOpen(o => !o); } }}>
          <span>🤖 AI Writer</span>
          <span style={s.aiToggle}>{isMobile ? '›' : (aiOpen ? '›' : '‹')}</span>
        </div>
        <div style={{ ...s.aiBody, ...(isMobile ? { flex: 1, overflowY: 'auto' } : {}) }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 3, borderBottom: '1px solid rgba(0,0,0,0.08)', paddingBottom: 8, ...(isMobile ? { overflowX: 'auto', gap: 2, paddingBottom: 6 } : {}) }}>
              {['generate','edit','draft','analyze','ingest','auto'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setAiTab(tab)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace",
                    ...(tab === 'auto'
                      ? { background: aiTab === tab ? '#dc2626' : '#450a0a', color: aiTab === tab ? '#fff' : '#fca5a5', border: '1px solid #b91c1c' }
                      : aiTab === tab
                        ? { background: '#f8f7f4', color: '#8b6f3a', border: '1px solid rgba(0,0,0,0.15)' }
                        : { background: '#f0ede8', color: '#6b6559', border: '1px solid rgba(0,0,0,0.1)' }
                    )
                  }}
                >
                  {tab === 'auto' ? 'Auto' : tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* On-device AI status */}
            <div style={{ fontSize: 10, color: aiStatus === 'ready' ? '#86efac' : aiStatus === 'error' ? '#fca5a5' : '#6b6559', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.08)', marginBottom: 8 }}>
              {aiStatus === 'loading' && <>Loading AI model {Math.round(aiProgress * 100)}%...</>}
              {aiStatus === 'ready' && <>On-device AI ready {aiEngine === 'wllama' ? '(CPU/wllama)' : caps.hasWebGPU ? '(WebGPU)' : '(WebGL)'}</>}
              {aiStatus === 'inferring' && <>Running inference {aiEngine === 'wllama' ? '(CPU/wllama)' : '(WebGPU)'}...</>}
              {aiStatus === 'error' && <>AI error: {aiError}</>}
              {aiStatus === 'unavailable' && <>AI unavailable: {aiError}</>}
              {aiStatus === 'idle' && <>On-device AI idle</>}
            </div>
            {isMobile && selStart !== selEnd && (
              <div style={{ fontSize: 10, color: '#8b6f3a', padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,0.08)', marginBottom: 8 }}>
                Selection active ({editorText.slice(selStart, selEnd).trim().split(/\s+/).filter(Boolean).length} words)
              </div>
            )}

            {/* ── Generate Tab ── */}
            {aiTab === 'generate' && (
              <>
                <div style={s.aiField}>
                  <label style={s.aiLabel}>Topic / Prompt</label>
                  <textarea style={s.aiTextarea} rows={3} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="Write about distributed systems..." />
                </div>
                <div style={s.aiField}>
                  <label style={s.aiLabel}>Page Title (optional)</label>
                  <input style={s.aiInput} value={aiTitle} onChange={e => setAiTitle(e.target.value)} placeholder="Auto-generated" />
                </div>
                <button style={s.aiBtn} onClick={handleGenerate} disabled={aiLoading || !aiPrompt.trim()}>
                  {aiLoading ? 'Generating...' : 'Generate & Insert'}
                </button>
              </>
            )}

            {/* ── Edit Tab ── */}
            {aiTab === 'edit' && (
              <>
                <div style={s.aiField}>
                  <label style={s.aiLabel}>Style</label>
                  <select style={s.aiInput} value={rewriteStyle} onChange={e => setRewriteStyle(e.target.value)}>
                    <option value="concise">concise</option>
                    <option value="formal">formal</option>
                    <option value="casual">casual</option>
                    <option value="technical">technical</option>
                    <option value="poetic">poetic</option>
                    <option value="expand">expand</option>
                    <option value="summarize">summarize</option>
                  </select>
                </div>
                <button style={{ ...s.aiBtn, background: '#8b5cf6' }} onClick={handleRewrite} disabled={aiLoading}>
                  {aiLoading ? 'Rewriting...' : '✏️ Rewrite Selection'}
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {[
                    ['Shorten','Rewrite more concisely'],
                    ['Expand','Add detail and examples'],
                    ['Simplify','Make it simpler'],
                    ['Grammar','Fix grammar & clarity'],
                    ['Formal','Make formal'],
                    ['Casual','Make casual'],
                    ['Bullets','Convert to bullet points'],
                    ['Paragraph','Convert to paragraph'],
                    ['3 Alt','Give 3 alternatives'],
                    ['Explain','Explain why weak'],
                  ].map(([label, instruction]) => (
                    <button key={label} style={s.miniBtn} onClick={() => aiAction(`${instruction}. Output ONLY the result.`, label === '3 Alt' || label === 'Explain' ? 'analyze' : 'replace')} disabled={aiLoading}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={s.aiHint}>Highlight text in the editor, then click an action.</div>
              </>
            )}

            {/* ── Draft Tab ── */}
            {aiTab === 'draft' && (
              <>
                <div style={s.aiField}>
                  <label style={s.aiLabel}>Outline Topic</label>
                  <input style={s.aiInput} value={draftOutline} onChange={e => setDraftOutline(e.target.value)} placeholder="e.g. Blockchain consensus" />
                </div>
                <button style={s.aiBtn} onClick={() => {
                  if (!draftOutline.trim()) return;
                  docAIAction(`Create a numbered outline for: ${draftOutline}. Output ONLY the outline.`, 'append');
                }} disabled={aiLoading || !draftOutline.trim()}>
                  Generate Outline
                </button>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={s.aiLabel}>Section Writer</span>
                  {['Write intro','Write conclusion','Add objections','Add examples'].map(label => (
                    <button key={label} style={s.miniBtn} onClick={() => docAIAction(`${label} based on the current document. Output ONLY the new section.`, 'append')} disabled={aiLoading}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 8 }}>
                  <button style={s.miniBtn} onClick={() => docAIAction('Summarize the current document into a TL;DR paragraph. Output ONLY the summary.', 'append')} disabled={aiLoading}>
                    TL;DR Summary
                  </button>
                  <button style={s.miniBtn} onClick={() => docAIAction('Convert the current document into a clean set of bullet points. Output ONLY the bullets.', 'replace')} disabled={aiLoading}>
                    Notes to Bullets
                  </button>
                </div>
              </>
            )}

            {/* ── Analyze Tab ── */}
            {aiTab === 'analyze' && (
              <>
                <button style={s.aiBtn} onClick={() => aiAction('Analyze the tone of the following text and describe it in one sentence (e.g. formal, casual, technical, persuasive). Output ONLY the tone description.', 'analyze')} disabled={aiLoading}>
                  Detect Tone
                </button>
                <button style={s.aiBtn} onClick={() => aiAction('Estimate the reading level and readability of the following text (Flesch Reading Ease score and grade level). Output ONLY the score and brief assessment.', 'analyze')} disabled={aiLoading}>
                  Readability Score
                </button>
                <button style={s.aiBtn} onClick={() => aiAction('Flag any overused phrases, repetitions, weak claims, or inconsistencies in the following text. Output ONLY the findings.', 'analyze')} disabled={aiLoading}>
                  Weakness Scan
                </button>
                {analysis && (
                  <div style={{ background: '#f0ede8', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 5, padding: 10, fontSize: 12, color: '#6b6559', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: 4 }}>
                    {analysis}
                  </div>
                )}
              </>
            )}

            {/* ── Ingest Tab ── */}
            {aiTab === 'ingest' && (
              <>
                <div style={{ padding: '8px', background: '#f0ede8', border: '1px dashed rgba(0,0,0,0.15)', borderRadius: 5, textAlign: 'center', fontSize: 12, color: '#8a8375' }}>
                  <div>Drag & drop files onto the editor</div>
                  <div style={{ fontSize: 10, marginTop: 4 }}>PDFs, Word, PowerPoint, images, HTML → Markdown</div>
                </div>
                <div style={s.aiField}>
                  <label style={s.aiLabel}>Or browse files</label>
                  <input
                    type="file"
                    style={{ fontSize: 11, color: '#6b6559' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setSaveStatus('Converting...');
                      const formData = new FormData();
                      formData.append('file', file);
                      try {
                        const res = await fetch(`${API_BASE}/convert-to-md`, { method: 'POST', body: formData });
                        const json = await res.json();
                        if (json.success) {
                          const md = json.data.markdown || '';
                          setEditorText(prev => {
                            const sep = prev.trim().length > 0 ? '\n\n---\n\n' : '';
                            return prev + sep + `## Source: ${file.name}\n\n${md}\n`;
                          });
                          setSaveStatus('Inserted!');
                        } else {
                          setSaveStatus('Conversion failed');
                        }
                      } catch (err) {
                        setSaveStatus('Conversion failed');
                      }
                      setTimeout(() => setSaveStatus(''), 3000);
                    }}
                  />
                </div>
                {dropFiles.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dropFiles.map((f, i) => (
                      <div key={i} style={{ fontSize: 11, color: f.status === 'done' ? '#86efac' : f.status === 'failed' ? '#f87171' : '#94a3b8' }}>
                        {f.status === 'done' ? '✓' : f.status === 'failed' ? '✗' : '⏳'} {f.name}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 8 }}>
                  <div style={s.aiField}>
                    <label style={s.aiLabel}>Repo to Markdown</label>
                    <input
                      style={s.aiInput}
                      value={repoDigestPath}
                      onChange={e => setRepoDigestPath(e.target.value)}
                      placeholder="/path/to/repo or https://github.com/user/repo"
                    />
                  </div>
                  <button
                    style={s.aiBtn}
                    onClick={async () => {
                      if (!repoDigestPath.trim()) return;
                      setSaveStatus('Digesting repo...');
                      try {
                        const isUrl = repoDigestPath.startsWith('http');
                        const res = await fetch(`${API_BASE}/repo-to-md`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(isUrl ? { url: repoDigestPath } : { path: repoDigestPath })
                        });
                        const json = await res.json();
                        if (json.success) {
                          const md = json.data.markdown || '';
                          setEditorText(prev => {
                            const sep = prev.trim().length > 0 ? '\n\n---\n\n' : '';
                            return prev + sep + md;
                          });
                          setSaveStatus(`Digested ${json.data.fileCount} files`);
                          setRepoDigestPath('');
                        } else {
                          setSaveStatus(json.error || 'Digest failed');
                        }
                      } catch (err) {
                        setSaveStatus('Digest failed');
                      }
                      setTimeout(() => setSaveStatus(''), 5000);
                    }}
                    disabled={!repoDigestPath.trim() || aiLoading}
                  >
                    📦 Digest Repo
                  </button>
                  <div style={s.aiHint}>Walks a directory and wraps each file in &lt;file&gt; tags. Ignores node_modules, .git, binaries.</div>
                </div>
              </>
            )}

            {/* ── Auto Tab ── */}
            {aiTab === 'auto' && (
              <>
                <div style={s.aiField}>
                  <label style={s.aiLabel}>Research Topic</label>
                  <input style={s.aiInput} value={autoTopic} onChange={e => setAutoTopic(e.target.value)} placeholder="e.g. Quantum computing" />
                </div>
                {!autoRunning ? (
                  <button style={{ ...s.aiBtn, background: '#dc2626' }} onClick={startAutoresearch} disabled={!autoTopic.trim() || aiLoading}>
                    ▶ Start Autoresearch
                  </button>
                ) : (
                  <button style={{ ...s.aiBtn, background: '#166534' }} onClick={stopAutoresearch}>
                    ⏹ Stop Autoresearch
                  </button>
                )}
                {autoStatus && <div style={{ fontSize: 11, color: '#fbbf24' }}>{autoStatus}</div>}
                <div style={s.aiHint}>Generates new wiki sections every 30 seconds while running.</div>
              </>
            )}
          </div>
        {(aiOpen || isMobile) && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: '#8a8375', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" }}>Chimera Memory</div>
            <div style={{ fontSize: 10, color: '#86efac', lineHeight: 1.5 }}>Unified Memory API</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <button style={{ ...s.toolbarBtn, fontSize: 9, padding: '3px 6px', textAlign: 'left', fontWeight: 600, color: '#3d3a35' }} onClick={() => navigator.clipboard.writeText(`${(typeof window !== 'undefined' && window.__apiOrigin) || window.location.origin}/api/memory`)}>🔗 POST /api/memory</button>
            </div>
            <details style={{ fontSize: 10, color: '#6b6559' }}>
              <summary style={{ cursor: 'pointer', color: '#8a8375', fontWeight: 600 }}>How to connect an AI</summary>
              <div style={{ padding: '6px 0', display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 600, color: '#3d3a35' }}>Unified Memory API</div>
                <div><b style={{ color: '#3d3a35' }}>POST /api/memory</b> — body: {'{action, ...params}'} — single endpoint for all memory functions</div>
                <div style={{ fontSize: 9, color: '#6b6559', paddingLeft: 8 }}>GET /api/memory?action=health — list all available actions</div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '4px 0' }} />
                <div style={{ fontWeight: 600, color: '#3d3a35' }}>Knowledge Base (OpenViking)</div>
                <div><b style={{ color: '#3d3a35' }}>list</b> — list all pages<br/><span style={{ color: '#6b6559' }}>{'{action: "list"}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>read</b> — read page content<br/><span style={{ color: '#6b6559' }}>{'{action: "read", uri: "viking://wiki/page_id"}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>write</b> — create/update page<br/><span style={{ color: '#6b6559' }}>{'{action: "write", uri: "viking://wiki/page_id", content: "# Page content"}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>search</b> — ranked search results<br/><span style={{ color: '#6b6559' }}>{'{action: "search", query: "text", limit: 10}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>relations</b> — links and backlinks<br/><span style={{ color: '#6b6559' }}>{'{action: "relations", uri: "viking://wiki/page_id"}'}</span></div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '4px 0' }} />
                <div style={{ fontWeight: 600, color: '#3d3a35' }}>Conversation Memory (TencentDB Agent Memory)</div>
                <div><b style={{ color: '#3d3a35' }}>tdai.capture</b> — store conversation (L0)<br/><span style={{ color: '#6b6559' }}>{'{action: "tdai.capture", user_content: "...", assistant_content: "...", session_key: "session1"}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>tdai.recall</b> — retrieve relevant memories<br/><span style={{ color: '#6b6559' }}>{'{action: "tdai.recall", query: "topic", session_key: "session1"}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>tdai.searchMemories</b> — search L1 extracted atoms<br/><span style={{ color: '#6b6559' }}>{'{action: "tdai.searchMemories", query: "text", limit: 10}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>tdai.searchConversations</b> — search L0 raw conversations<br/><span style={{ color: '#6b6559' }}>{'{action: "tdai.searchConversations", query: "text", limit: 10}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>tdai.sessionEnd</b> — end session and flush<br/><span style={{ color: '#6b6559' }}>{'{action: "tdai.sessionEnd", session_key: "session1"}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>tdai.extract</b> — get unprocessed L0 for L1 extraction<br/><span style={{ color: '#6b6559' }}>{'{action: "tdai.extract"}'}</span></div>
                <div><b style={{ color: '#3d3a35' }}>tdai.l1Save</b> — save extracted L1 atoms<br/><span style={{ color: '#6b6559' }}>{'{action: "tdai.l1Save", atoms: [...], session_key: "session1", processed_l0_ids: [...]}'}</span></div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '4px 0' }} />
                <div style={{ fontSize: 9, color: '#6b6559' }}>L1 extraction runs automatically on-device using the built-in LLM. No manual trigger needed.</div>
              </div>
            </details>
          </div>
        )}
      </aside>

      {/* Mobile AI float button — toggle sidebar */}
      {isMobile && (
        <button
          onClick={() => {
            setAiMobileOpen(o => {
              const next = !o;
              if (next) {
                const ta = editorRef.current;
                if (ta) {
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  setSelStart(start);
                  setSelEnd(end);
                  ta.blur();
                  setTimeout(() => { ta.selectionStart = ta.selectionEnd = start; }, 0);
                }
              }
              return next;
            });
          }}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 300,
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'linear-gradient(135deg,#00e5ff,#a855f7)',
            color: '#000',
            fontSize: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,229,255,0.3)',
            border: 'none'
          }}
          aria-label="Toggle AI Writer"
        >
          🤖
        </button>
      )}
    </div>
  );
}

/* ─── Styles ─── */
const s = {
  layout: { display: 'flex', height: '100vh', background: '#f8f7f4', color: '#3d3a35', fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", overflow: 'hidden' },

  sidebar: { width: 240, minWidth: 240, background: '#ffffff', borderRight: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarHeader: { padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 10 },
  logo: { fontSize: 16, fontWeight: 700, color: '#1a1917', letterSpacing: '-0.01em' },
  backBtn: { margin: '8px 12px 0', padding: '6px 10px', background: '#f0ede8', color: '#6b6559', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 5, fontSize: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' },
  searchBox: { padding: '10px 12px' },
  searchInput: { width: '100%', background: '#f0ede8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6, padding: '7px 11px', color: '#3d3a35', fontSize: 13, outline: 'none' },
  navHeader: { padding: '8px 14px 4px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8a8375', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },
  nav: { flex: 1, overflowY: 'auto', padding: '0 8px 8px' },
  navCategory: { padding: '8px 6px 2px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8a8375', borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 4, fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },
  navItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderRadius: 5, cursor: 'pointer', fontSize: 13, color: '#6b6559', transition: 'all 0.15s' },
  navItemActive: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderRadius: 5, cursor: 'pointer', fontSize: 13, color: '#8b6f3a', background: '#f0ede8' },
  navIcon: { fontSize: 12, opacity: 0.6 },
  navTitle: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  emptyNav: { padding: '20px 12px', fontSize: 13, color: '#8a8375', textAlign: 'center', lineHeight: 1.6 },
  sidebarFooter: { padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,0.08)' },
  newPageBtn: { width: '100%', padding: '7px 0', background: '#f0ede8', color: '#6b6559', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 5, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' },

  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },

  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#ffffff', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0 },
  toolbarGroup: { display: 'flex', alignItems: 'center', gap: 4 },
  toolbarBtn: { padding: '5px 11px', background: '#f0ede8', color: '#6b6559', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 5, fontSize: 11, cursor: 'pointer', transition: 'all 0.15s', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },
  modeBtn: { padding: '5px 12px', background: 'transparent', color: '#8a8375', border: '1px solid transparent', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", transition: 'all 0.15s' },
  modeBtnActive: { padding: '5px 12px', background: '#f0ede8', color: '#3d3a35', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },

  editorPane: { flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' },
  full: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' },
  splitLeft: { width: '50%', overflow: 'auto', borderRight: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', background: '#f0ede8' },
  splitRight: { flex: 1, overflow: 'auto', display: 'flex', background: '#faf9f6' },

  textarea: { width: '100%', flex: 1, background: '#f0ede8', border: 'none', padding: '18px 22px', color: '#3d3a35', fontSize: 14, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", resize: 'none', outline: 'none' },
  preview: { flex: 1, padding: '18px 26px', fontSize: 14, lineHeight: 1.7, overflow: 'auto', color: '#3d3a35', background: '#faf9f6' },

  toc: { width: 200, minWidth: 200, padding: '16px 14px', borderLeft: '1px solid rgba(0,0,0,0.08)', background: '#ffffff', fontSize: 12 },
  tocTitle: { fontWeight: 700, color: '#6b6559', marginBottom: 8, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },
  tocItem: { padding: '3px 0', color: '#6b6559', cursor: 'pointer' },
  tocItem3: { padding: '3px 0 3px 12px', color: '#8a8375', cursor: 'pointer' },

  aiPanel: { width: 360, minWidth: 360, background: '#ffffff', borderLeft: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  aiPanelCollapsed: { width: 36, minWidth: 36, background: '#ffffff', borderLeft: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  aiHeader: { padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', color: '#3d3a35' },
  aiToggle: { fontSize: 16, color: '#8a8375' },
  aiBody: { flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 },
  aiField: { display: 'flex', flexDirection: 'column', gap: 5 },
  aiLabel: { fontSize: 10, color: '#8a8375', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },
  aiTextarea: { background: '#f0ede8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6, padding: '8px 10px', color: '#3d3a35', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" },
  aiInput: { background: '#f0ede8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6, padding: '7px 10px', color: '#3d3a35', fontSize: 13, outline: 'none' },
  aiBtn: { background: '#8b6f3a', color: '#f8f7f4', border: 'none', padding: '8px 14px', borderRadius: 5, fontSize: 12, cursor: 'pointer', marginTop: 4, fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", transition: 'all 0.15s' },
  aiHint: { fontSize: 11, color: '#8a8375', lineHeight: 1.5, marginTop: 4 },

  tabBtn: { padding: '4px 8px', background: '#f0ede8', color: '#6b6559', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 4, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },
  tabBtnActive: { background: '#f8f7f4', color: '#8b6f3a', border: '1px solid rgba(0,0,0,0.15)' },

  miniBtn: { padding: '5px 8px', background: '#f0ede8', color: '#6b6559', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 4, fontSize: 11, cursor: 'pointer', textAlign: 'left', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },

  inlineBtn: { padding: '4px 8px', background: '#e8e4dc', color: '#3d3a35', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 4, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace" },
};
