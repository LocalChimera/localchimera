import { useState, useEffect } from 'react';
import {
  Smartphone, Zap, CheckCircle, BookOpen, Settings, PenLine,
  FileText, ChevronRight, Lock, Network, Download, Book
} from 'lucide-react';

const isNative = typeof window !== 'undefined' && (window.Capacitor || window.__TAURI__);
const NATIVE_API_BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE
  : 'http://localhost:3002/api';
const API_BASE = isNative
  ? NATIVE_API_BASE
  : (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ? '/api'
    : NATIVE_API_BASE;

export default function AIWriterExample({ onNavigateBack, onNavigateToDashboard }) {
  const [activeScreen, setActiveScreen] = useState('write');
  const [installed, setInstalled] = useState(false);
  const [showSetup, setShowSetup] = useState(true);
  const [evmAddress, setEvmAddress] = useState('');

  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [docs, setDocs] = useState([]);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetchStatus();
    fetchDocs();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/ai-status`);
      const json = await res.json();
      if (json.success) setStatus(json.data);
    } catch (e) {
      setStatus({ available: false, error: e.message });
    }
  };

  const fetchDocs = async () => {
    try {
      const res = await fetch(`${API_BASE}/ai-docs`);
      const json = await res.json();
      if (json.success) setDocs(json.data);
    } catch (e) {
      // ignore
    }
  };

  const downloadFile = (content, filename, mimeType = 'text/plain') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const detectOS = () => {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (ua.indexOf('Win') !== -1) return 'windows';
    if (ua.indexOf('Mac') !== -1) return 'mac';
    return 'linux';
  };

  const handleInstall = () => {
    const address = evmAddress || '0x0000000000000000000000000000000000000000';
    localStorage.setItem('chimeraEvmAddress', address);

    const os = detectOS();
    if (os === 'android') {
      const file = 'install-chimera-android.sh';
      const content = `#!/bin/bash\necho "========================================"\necho "  Chimera LLM Wiki - Android Setup"\necho "========================================"\necho\necho "Install Termux from F-Droid or Play Store, then run:"\necho\necho "  pkg update"\necho "  pkg install git nodejs"\necho "  git clone https://github.com/TerexitariusStomp/qvac-chimera.git"\necho "  cd qvac-chimera/qvac"\necho "  npm install"\necho "  cd frontend && npm install && npm run build && cd .."\necho "  export MACHINE_OWNER_EVM=${address}"\necho "  node src/index.js"\necho\necho "Then open http://localhost:3002 in your browser."\necho "Start/stop mining inside the wiki sidebar."\n`;
      downloadFile(content, file, 'text/plain');
      setInstalled(true);
      return;
    }
    if (os === 'ios') {
      const file = 'install-chimera-ios.txt';
      const content = `Chimera LLM Wiki - iOS Setup\n================================\n\n1. Install a-Shell from the App Store (free terminal app).\n\n2. Inside a-Shell, run:\n\n   git clone https://github.com/TerexitariusStomp/qvac-chimera.git\n   cd qvac-chimera/qvac\n   npm install\n   cd frontend && npm install && npm run build && cd ..\n   export MACHINE_OWNER_EVM=${address}\n   node src/index.js\n\n3. Open Safari to http://localhost:3002\n\nStart/stop mining inside the wiki sidebar.\n`;
      downloadFile(content, file, 'text/plain');
      setInstalled(true);
      return;
    }

    const repo = 'https://github.com/TerexitariusStomp/qvac-chimera.git';
    const folder = 'qvac-chimera';
    let file, content;

    if (os === 'windows') {
      file = 'install-chimera.bat';
      content = `@echo off\r\necho ======================================\r\necho   Chimera LLM Wiki - Setup\r\necho ======================================\r\necho.\r\necho This script downloads and runs the LLM Wiki on your machine.\r\necho Start/stop mining is handled inside the app.\r\necho.\r\necho Checking Node.js...\r\nnode --version >nul 2>&1\r\nif errorlevel 1 (\r\n  echo Node.js not found. Please install from https://nodejs.org/\r\n  pause\r\n  exit /b 1\r\n)\r\necho.\r\necho Downloading Chimera...\r\nif not exist ${folder} (\r\n  git clone ${repo} || (echo Git not found ^& pause ^& exit /b 1)\r\n) else (\r\n  echo Already downloaded, updating...\r\n  cd ${folder}\r\n  git pull\r\n  cd ..\r\n)\r\ncd ${folder}\\qvac\r\necho Installing dependencies...\r\nnpm install\r\ncd frontend\r\nnpm install\r\nnpm run build\r\ncd ..\r\necho Setting EVM address...\r\nset MACHINE_OWNER_EVM=${address}\r\nset APP_ID=protocol-default\r\necho.\r\necho ======================================\r\necho   Ready! Opening http://localhost:3002\r\necho   Start/stop miner inside the wiki sidebar.\r\necho ======================================\r\nstart http://localhost:3002\r\nnode src/index.js\r\n`;
    } else {
      file = 'install-chimera.sh';
      content = `#!/bin/bash\necho "========================================"\necho "  Chimera LLM Wiki - Setup"\necho "========================================"\necho\necho "This script downloads and runs the LLM Wiki on your machine."\necho "Start/stop mining is handled inside the app."\necho\necho "Checking Node.js..."\nif ! command -v node &> /dev/null; then\n  echo "Node.js not found. Install from https://nodejs.org/"\n  exit 1\nfi\nnode --version\necho\necho "Downloading Chimera..."\nif [ ! -d "${folder}" ]; then\n  git clone ${repo} || { echo "Git not found"; exit 1; }\nelse\n  echo "Already downloaded, updating..."\n  cd ${folder}\n  git pull\n  cd ..\nfi\ncd ${folder}/qvac\necho "Installing dependencies..."\nnpm install\ncd frontend\nnpm install\nnpm run build\ncd ..\necho "Setting EVM address..."\nexport MACHINE_OWNER_EVM=${address}\nexport APP_ID=protocol-default\necho\necho "========================================"\necho "  Ready! Opening http://localhost:3002"\necho "  Start/stop miner inside the wiki sidebar."\necho "========================================"\nopen http://localhost:3002 2>/dev/null || xdg-open http://localhost:3002 2>/dev/null || echo "Open http://localhost:3002"\nnode src/index.js\n`;
    }

    downloadFile(content, file, 'text/plain');
    setInstalled(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/ai-write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, title })
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data);
        fetchDocs();
      } else {
        setError(json.error || 'Generation failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const APP_SCREENS = {
    write: {
      title: 'Write',
      icon: PenLine,
      render: () => (
        <div className="h-full overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <PenLine className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm">AI Writer</h3>
              <p className="text-[10px] text-gray-400">Local LLM • Hypercore</p>
            </div>
          </div>

          {!installed && showSetup && (
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-300" />
                <span className="font-semibold text-white text-sm">Contribute & Earn</span>
              </div>
              <p className="text-[11px] text-indigo-100">
                Share idle inference power. 70% to you, 30% to app dev.
              </p>
              <div className="bg-black/20 rounded-lg p-2 space-y-1">
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[8px] font-bold">1</div>
                  <span className="text-[10px] text-white">Enter EVM payout address</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[8px] font-bold">2</div>
                  <span className="text-[10px] text-white">Download auto-detected installer</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[8px] font-bold">3</div>
                  <span className="text-[10px] text-white">Run start script — LLM Wiki + miner on localhost:3002</span>
                </div>
              </div>
              <input
                className="w-full bg-black/30 border border-white/20 rounded px-2 py-1 text-xs text-white placeholder-white/50"
                placeholder="0x... (your payout address)"
                value={evmAddress}
                onChange={e => setEvmAddress(e.target.value)}
              />
              <button
                onClick={handleInstall}
                disabled={!evmAddress.match(/^0x[a-fA-F0-9]{40}$/)}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs font-medium py-1.5 rounded transition-colors flex items-center justify-center gap-1"
              >
                <Download className="w-3 h-3" /> Download & Install
              </button>
              <p className="text-[9px] text-indigo-200/70 text-center">
                {detectOS() === 'android' ? 'Android (.apk)' : detectOS() === 'ios' ? 'iOS (TestFlight)' : detectOS() === 'windows' ? 'Windows (.bat)' : detectOS() === 'mac' ? 'macOS (.sh)' : 'Linux (.sh)'}
              </p>
              <button
                onClick={() => setShowSetup(false)}
                className="w-full text-[10px] text-indigo-200 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          )}

          {installed && (
            <div className="flex items-center gap-2 bg-green-900/40 border border-green-700/50 rounded-lg p-2">
              <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
              <span className="text-[11px] text-green-200">Earning active — idle inference shared</span>
              <button
                onClick={() => { setInstalled(false); setShowSetup(true); }}
                className="ml-auto text-[10px] text-green-300 hover:text-white"
              >
                Reset
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Title (optional)"
            />
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none"
              rows={4}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Write about..."
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Generating...' : 'Generate & Save'}
            </button>
          </form>

          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-gray-800/80 border border-gray-700 rounded-lg p-3">
              <h4 className="text-white font-medium text-sm mb-1">{result.title}</h4>
              <p className="text-[10px] text-gray-400 mb-2">{result.source} • {result.model}</p>
              <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-black/30 rounded p-2 max-h-32 overflow-y-auto">
                {result.body.slice(0, 400)}{result.body.length > 400 ? '...' : ''}
              </pre>
            </div>
          )}
        </div>
      )
    },
    docs: {
      title: 'Docs',
      icon: FileText,
      render: () => (
        <div className="h-full overflow-y-auto p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Generated Docs ({docs.length})</h3>
          {docs.length === 0 ? (
            <p className="text-gray-500 text-xs text-center py-8">No docs yet. Write something!</p>
          ) : (
            <div className="space-y-2">
              {docs.map(d => (
                <div key={d.id} className="bg-gray-800/80 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-white text-xs font-medium">{d.title}</span>
                    <span className="text-[10px] text-gray-500">{new Date(d.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 truncate">{d.slug || d.title.toLowerCase().replace(/\s+/g, '-')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    },
    settings: {
      title: 'Settings',
      icon: Settings,
      render: () => (
        <div className="h-full overflow-y-auto p-4 space-y-4">
          <h3 className="text-white font-semibold text-sm">Settings</h3>

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-300 text-xs">Backend</span>
              <span className={`text-[10px] px-2 py-0.5 rounded ${status?.qvacAvailable ? 'bg-green-900 text-green-300' : 'bg-orange-900 text-orange-300'}`}>
                {status?.qvacAvailable ? 'QVAC' : 'Demo'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300 text-xs">Model</span>
              <span className="text-gray-400 text-[10px]">{status?.model || 'llama-3.2-1b'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300 text-xs">Storage</span>
              <span className="text-gray-400 text-[10px]">Hypercore + Pear P2P</span>
            </div>
          </div>

          <div className="bg-indigo-900/30 border border-indigo-700/50 rounded-lg p-3">
            <p className="text-indigo-200 text-xs font-medium mb-1">Earn while writing</p>
            <p className="text-[10px] text-indigo-300/80">
              Your device contributes idle inference power to the QVAC network. 70% of earnings go to you.
            </p>
          </div>
        </div>
      )
    },
  };

  const bottomNavScreens = ['write', 'docs', 'settings'];

  return (
    <div className="space-y-6">
      {/* Phone Emulator Section */}
      <section id="phone-emulator" className="max-w-6xl mx-auto mb-16">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Smartphone className="w-8 h-8 text-primary-400" />
            Example App: AI Writer
          </h2>
          <p className="text-dark-400 max-w-2xl text-sm">
            This phone emulator shows how the QVAC-Pear inference embed appears inside a third-party app (AI Writer — a local wiki generator). In your own app, users see the same earning prompt. Only an EVM address is required.
          </p>
        </div>

        {/* Phone Frame */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="relative w-[340px] h-[680px] bg-gradient-to-b from-gray-900 to-black rounded-[44px] p-4 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] before:absolute before:top-2 before:left-1/2 before:-translate-x-1/2 before:w-24 before:h-4 before:bg-gray-900 before:rounded-b-xl before:z-10">
              <div className="w-full h-full bg-black rounded-[40px] overflow-hidden relative border border-gray-800">
                {/* Status Bar */}
                <div className="flex items-center justify-between px-4 py-2 bg-black border-b border-gray-800">
                  <span className="text-xs text-white font-medium">9:41</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-2.5 bg-green-400 rounded-sm" />
                    <div className="w-3.5 h-3.5 bg-white rounded-full" />
                    <div className="w-7 h-2.5 bg-white rounded-sm" />
                  </div>
                </div>

                {/* App Content */}
                <div className="h-[calc(100%-60px)] overflow-hidden">
                  {APP_SCREENS[activeScreen]?.render()}
                </div>

                {/* Bottom Nav */}
                <div className="absolute bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 px-2 py-2">
                  <div className="flex justify-around items-center">
                    {bottomNavScreens.map((screen) => {
                      const ScreenIcon = APP_SCREENS[screen].icon;
                      return (
                        <button
                          key={screen}
                          onClick={() => setActiveScreen(screen)}
                          className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
                            activeScreen === screen
                              ? 'text-blue-400'
                              : 'text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          <ScreenIcon className="w-5 h-5" />
                          <span className="text-[10px] font-medium">{APP_SCREENS[screen].title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Home Indicator */}
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-24 h-1 bg-white/30 rounded-full" />
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* Setup / Consent */}
      <section id="embed-earn" className="max-w-6xl mx-auto mb-16">
        <div className="card bg-gradient-to-br from-indigo-900/50 to-purple-900/50 border-indigo-500/30">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            Start Earning in 3 Steps
          </h3>
          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 bg-dark-900/50 rounded-lg">
              <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">1</div>
              <div className="flex-1">
                <h4 className="font-medium text-white mb-1">Enter Your EVM Payout Address</h4>
                <p className="text-sm text-dark-300 mb-2">This is where you receive your 70% share. Protocol multisigs are shared across all apps.</p>
                <div className="flex items-center gap-2 text-xs text-indigo-300">
                  <Lock className="w-3 h-3" />
                  <span>Your EVM address is your payout destination</span>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-dark-900/50 rounded-lg">
              <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">2</div>
              <div className="flex-1">
                <h4 className="font-medium text-white mb-1">Download Installer</h4>
                <p className="text-sm text-dark-300 mb-2">The website auto-detects your OS. Double-click to run — everything happens inside Docker.</p>
                <div className="flex items-center gap-2 text-xs text-indigo-300">
                  <Network className="w-3 h-3" />
                  <span>Earnidle and Fortytwo route directly to your EVM address</span>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-dark-900/50 rounded-lg">
              <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">3</div>
              <div className="flex-1">
                <h4 className="font-medium text-white mb-1">Run & Earn</h4>
                <p className="text-sm text-dark-300 mb-2">The node starts in monitoring mode. When a task arrives, miners compete and you earn.</p>
                <div className="flex items-center gap-2 text-xs text-indigo-300">
                  <Zap className="w-3 h-3" />
                  <span>AI Writer sessions trigger inference tasks automatically</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
