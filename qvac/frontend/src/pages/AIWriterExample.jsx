import { useState, useEffect } from 'react';
import {
  Smartphone, Zap, CheckCircle, BookOpen, Settings, PenLine,
  FileText, ChevronRight, Lock, Network, Download, Book
} from 'lucide-react';

const API_BASE = '/api';

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

  const handleInstall = () => {
    const address = evmAddress || '0x0000000000000000000000000000000000000000';
    localStorage.setItem('chimeraEvmAddress', address);
    window.open('/wiki', '_blank');
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
                  <span className="text-[10px] text-white">Open LLM Wiki — your miner node</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[8px] font-bold">3</div>
                  <span className="text-[10px] text-white">Start mining & earn</span>
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
                <Download className="w-3 h-3" /> Open LLM Wiki
              </button>
              <p className="text-[9px] text-indigo-200/70 text-center">
                Wiki runs the miner node. Start/stop in sidebar.
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
