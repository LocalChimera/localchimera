import { useState, useEffect, useRef } from 'react'
import {
  Zap, Cpu, Network, Database, Code2, Coins, Layers,
  ChevronRight, ArrowRight, Github,
  Terminal, Globe, Shield, Activity, Server,
  PlugZap, Sparkles, Wallet, ServerCrash, BookOpen, Download
} from 'lucide-react'
import AIWriterExample from './AIWriterExample'

// ─── Visual design system ──────────────────────────────────────────────────
function GridOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
      style={{
        backgroundImage: `
          linear-gradient(rgba(0,229,255,1) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,229,255,1) 1px, transparent 1px)
        `,
        backgroundSize: '64px 64px',
      }}
    />
  )
}

function AmbientGlows() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute -top-60 left-1/3 w-[700px] h-[700px] rounded-full bg-cyan-500/8 blur-[140px]" />
      <div className="absolute top-1/2 -right-60 w-[600px] h-[600px] rounded-full bg-purple-600/8 blur-[130px]" />
      <div className="absolute bottom-40 left-0 w-[500px] h-[400px] rounded-full bg-cyan-400/5 blur-[120px]" />
    </div>
  )
}

function FadeUp({ children, delay = 0, className = '' }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true)
    }, { threshold: 0.05, rootMargin: '-40px' })
    observer.observe(el)
    // Fallback: ensure content becomes visible
    const timer = setTimeout(() => setVisible(true), 300 + delay)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [delay])
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(28px)',
        transitionDelay: `${delay}ms`,
        transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {children}
    </div>
  )
}

function Label({ children, color = 'cyan' }) {
  const styles = {
    cyan: 'border-cyan-400/20 bg-cyan-400/5 text-cyan-400',
    purple: 'border-purple-400/20 bg-purple-400/5 text-purple-400',
    amber: 'border-amber-400/20 bg-amber-400/5 text-amber-400',
  }
  const dot = {
    cyan: 'bg-cyan-400 shadow-[0_0_6px_#00e5ff]',
    purple: 'bg-purple-400 shadow-[0_0_6px_#a855f7]',
    amber: 'bg-amber-400 shadow-[0_0_6px_#fbbf24]',
  }
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border mb-5 ${styles[color]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[color]}`} />
      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", fontSize: '15px', letterSpacing: '0.1em' }} className="uppercase">
        {children}
      </span>
    </div>
  )
}

function Divider() {
  return <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
}

function GlassCard({ children, className = '', hoverColor = '' }) {
  const hoverMap = {
    cyan: 'hover:border-cyan-400/25 hover:shadow-[0_0_28px_-8px_#00e5ff40]',
    purple: 'hover:border-purple-400/25 hover:shadow-[0_0_28px_-8px_#a855f740]',
    amber: 'hover:border-amber-400/25 hover:shadow-[0_0_28px_-8px_#fbbf2440]',
    '': 'hover:border-white/15',
  }
  return (
    <div
      className={`rounded-xl border border-white/8 p-6 transition-all duration-300 ${hoverMap[hoverColor] || hoverMap['']} ${className}`}
      style={{ background: 'rgba(10,10,20,0.75)', backdropFilter: 'blur(12px)' }}
    >
      {children}
    </div>
  )
}

export default function Landing({ onNavigateToDashboard, onNavigateToMiner, onNavigateToWiki }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [mobileOS, setMobileOS] = useState(null)

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const ua = navigator.userAgent
    if (/Android/i.test(ua)) setMobileOS('android')
    else if (/iPhone|iPad|iPod/i.test(ua)) setMobileOS('ios')

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }

  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

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

  const handleDownload = () => {
    const address = localStorage.getItem('chimeraEvmAddress') || '0x0000000000000000000000000000000000000000';
    const os = detectOS();
    const repo = 'https://github.com/TerexitariusStomp/qvac-chimera.git';
    const folder = 'qvac-chimera';

    if (os === 'android') {
      const content = `#!/bin/bash\necho "========================================"\necho "  Chimera - Android Setup"\necho "========================================"\necho\necho "Install Termux from F-Droid or Play Store, then run:"\necho\necho "  pkg update"\necho "  pkg install git nodejs"\necho "  git clone ${repo}"\necho "  cd qvac-chimera/qvac"\necho "  npm install"\necho "  cd frontend && npm install && npm run build && cd .."\necho "  export MACHINE_OWNER_EVM=${address}"\necho "  node src/index.js"\necho\necho "Then open http://localhost:3002 in your browser."\necho "Start/stop mining inside the app sidebar."\n`;
      downloadFile(content, 'install-chimera-android.sh', 'text/plain');
      return;
    }
    if (os === 'ios') {
      const content = `Chimera - iOS Setup\n================================\n\n1. Install a-Shell from the App Store (free terminal app).\n\n2. Inside a-Shell, run:\n\n   git clone ${repo}\n   cd qvac-chimera/qvac\n   npm install\n   cd frontend && npm install && npm run build && cd ..\n   export MACHINE_OWNER_EVM=${address}\n   node src/index.js\n\n3. Open Safari to http://localhost:3002\n\nStart/stop mining inside the app sidebar.\n`;
      downloadFile(content, 'install-chimera-ios.txt', 'text/plain');
      return;
    }

    let file, content;
    if (os === 'windows') {
      file = 'install-chimera.bat';
      content = `@echo off\r\necho ======================================\r\necho   Chimera - Setup\r\necho ======================================\r\necho.\r\necho This script downloads and runs Chimera on your machine.\r\necho Start/stop mining is handled inside the app.\r\necho.\r\necho Checking Node.js...\r\nnode --version >nul 2>&1\r\nif errorlevel 1 (\r\n  echo Node.js not found. Please install from https://nodejs.org/\r\n  pause\r\n  exit /b 1\r\n)\r\necho.\r\necho Downloading Chimera...\r\nif not exist ${folder} (\r\n  git clone ${repo} || (echo Git not found ^& pause ^& exit /b 1)\r\n) else (\r\n  echo Already downloaded, updating...\r\n  cd ${folder}\r\n  git pull\r\n  cd ..\r\n)\r\ncd ${folder}\\qvac\r\necho Installing dependencies...\r\nnpm install\r\ncd frontend\r\nnpm install\r\nnpm run build\r\ncd ..\r\necho Setting EVM address...\r\nset MACHINE_OWNER_EVM=${address}\r\nset APP_ID=protocol-default\r\necho.\r\necho ======================================\r\necho   Ready! Opening http://localhost:3002\r\necho   Start/stop miner inside the app sidebar.\r\necho ======================================\r\nstart http://localhost:3002\r\nnode src/index.js\r\n`;
    } else {
      file = 'install-chimera.sh';
      content = `#!/bin/bash\necho "========================================"\necho "  Chimera - Setup"\necho "========================================"\necho\necho "This script downloads and runs Chimera on your machine."\necho "Start/stop mining is handled inside the app."\necho\necho "Checking Node.js..."\nif ! command -v node &> /dev/null; then\n  echo "Node.js not found. Install from https://nodejs.org/"\n  exit 1\nfi\nnode --version\necho\necho "Downloading Chimera..."\nif [ ! -d "${folder}" ]; then\n  git clone ${repo} || { echo "Git not found"; exit 1; }\nelse\n  echo "Already downloaded, updating..."\n  cd ${folder}\n  git pull\n  cd ..\nfi\ncd ${folder}/qvac\necho "Installing dependencies..."\nnpm install\ncd frontend\nnpm install\nnpm run build\ncd ..\necho "Setting EVM address..."\nexport MACHINE_OWNER_EVM=${address}\nexport APP_ID=protocol-default\necho\necho "========================================"\necho "  Ready! Opening http://localhost:3002"\necho "  Start/stop miner inside the app sidebar."\necho "========================================"\nopen http://localhost:3002 2>/dev/null || xdg-open http://localhost:3002 2>/dev/null || echo "Open http://localhost:3002"\nnode src/index.js\n`;
    }
    downloadFile(content, file, 'text/plain');
  };

  return (
    <div className="relative min-h-screen" style={{ background: '#04040a' }}>
      <GridOverlay />
      <AmbientGlows />

      <div className="relative z-10">
        {/* Navigation */}
        <header
          className="fixed top-0 inset-x-0 z-50 transition-all duration-500"
          style={{
            background: scrolled ? 'rgba(4,4,10,0.88)' : 'transparent',
            backdropFilter: scrolled ? 'blur(20px)' : 'none',
            borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}
        >
          <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center shadow-[0_0_16px_#00e5ff40]">
                <Cpu size={13} className="text-black" strokeWidth={2.5} />
              </div>
              <span style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: '17px', letterSpacing: '0.04em' }} className="text-white">
                Chimera
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.open('/wiki', '_blank')}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-white/45 hover:text-white/70 transition-colors text-sm"
              >
                Wiki
              </button>
              <a
                href="https://github.com/TerexitariusStomp/qvac-chimera"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-white/45 hover:text-white/70 transition-colors text-sm"
              >
                <Github size={14} />
                GitHub
              </a>
              <a
                href="https://x.com/LocalChimera"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:border-white/20 hover:text-white/80 transition-all text-sm"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Twitter
              </a>
            </div>
          </nav>
        </header>

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-24 pb-16">
        <FadeUp delay={50}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/8 bg-white/3 mb-8 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_#4ade80] animate-pulse" />
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", fontSize: '15px' }} className="text-white/50">Open source · Permissionless</span>
          </div>
        </FadeUp>

        <FadeUp delay={150}>
          <h1
            style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 800, fontSize: 'clamp(40px, 7vw, 80px)', lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff' }}
            className="mb-6 max-w-4xl"
          >
            Local AI apps<br />
            <span className="bg-gradient-to-r from-cyan-400 via-cyan-300 to-purple-400 bg-clip-text text-transparent">
              that earn when idle.
            </span>
          </h1>
        </FadeUp>

        <FadeUp delay={250}>
          <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: 'clamp(17px, 2.2vw, 21px)', lineHeight: 1.75 }} className="text-white/70 max-w-2xl mb-10">
            QVAC already powers AI inside the app. This layer makes that local inference capacity available to outside task networks whenever the app is not using it.
          </p>
        </FadeUp>

        <FadeUp delay={350}>
          <div className="flex items-center gap-4 flex-wrap justify-center mb-20">
            <button
              onClick={handleDownload}
              className="group flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 text-black text-sm font-semibold hover:from-cyan-300 hover:to-cyan-200 transition-all shadow-[0_0_24px_#00e5ff28] hover:shadow-[0_0_36px_#00e5ff45]"
            >
              <Download size={14} />
              Download
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </FadeUp>

        <FadeUp delay={450} className="w-full max-w-3xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                icon: Code2,
                who: 'For app developers',
                line: 'Ship private, local AI with QVAC. When user devices are idle, unused inference capacity can be routed to external networks, creating shared revenue for the app and the inference provider.',
                color: 'cyan',
              },
              {
                icon: Coins,
                who: 'For inference providers',
                line: 'Run a local node on your machine. Use it for your own AI apps first, then let outside task networks use spare capacity and earn rewards for completed inference work.',
                color: 'purple',
              },
            ].map(c => (
              <div
                key={c.who}
                className={`rounded-xl border p-5 text-left transition-all duration-300 ${c.color === 'cyan' ? 'border-cyan-400/15 bg-cyan-400/4 hover:border-cyan-400/25' : 'border-purple-400/15 bg-purple-400/4 hover:border-purple-400/25'}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <c.icon size={14} className={c.color === 'cyan' ? 'text-cyan-400' : 'text-purple-400'} />
                  <span style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 600, fontSize: '15px' }} className="text-white/80">
                    {c.who}
                  </span>
                </div>
                <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px', lineHeight: 1.65 }} className="text-white/40">
                  {c.line}
                </p>
              </div>
            ))}
          </div>
        </FadeUp>

        <div aria-hidden className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-[#04040a] to-transparent pointer-events-none" />
      </section>

      {/* Mobile Download Banner */}
      {mobileOS && (
        <section className="relative py-16 px-6">
          <div className="max-w-2xl mx-auto">
            <GlassCard hoverColor="purple">
              <div className="flex items-center gap-3 mb-3">
                <Cpu size={20} className="text-purple-400" />
                <h2 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: '18px' }} className="text-white">
                  {mobileOS === 'android' ? 'Download Chimera Miner for Android' : 'Get Chimera Miner for iPhone'}
                </h2>
              </div>
              <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px' }} className="text-white/40 mb-4">
                {mobileOS === 'android'
                  ? 'Install via Termux script. The wiki runs natively and auto-configures miners.'
                  : 'Install via a-Shell. The iOS build connects directly to the mining network via Pear P2P.'}
              </p>
              <p style={{ fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", fontSize: '15px' }} className="text-white/25">
                Use the emulator below to get your setup script.
              </p>
            </GlassCard>
          </div>
        </section>
      )}

      {/* Key Features */}
      <section className="relative py-32 px-6">
        <Divider />
        <div className="max-w-6xl mx-auto">
          <FadeUp className="text-center mb-16">
            <Label color="purple">Key Features</Label>
            <h2 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.1 }} className="text-white mb-4">
              One node.<br />
              <span className="bg-gradient-to-r from-purple-400 to-purple-200 bg-clip-text text-transparent">Two jobs.</span>
            </h2>
          </FadeUp>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Zap, title: 'One node. Two jobs.', desc: 'Use the same local node to power AI inside the app and to serve outside task networks when that compute is idle.', accent: 'cyan' },
              { icon: Zap, title: 'QVAC integration', desc: 'QVAC handles local AI inference inside the app, so users get private, on-device AI without relying on centralized infrastructure.', accent: 'cyan' },
              { icon: Network, title: 'Pear P2P', desc: 'Pear provides the peer-to-peer runtime and distribution layer, so apps and nodes can connect directly without traditional server infrastructure.', accent: 'purple' },
              { icon: Database, title: 'Hypercore storage', desc: 'Hypercore provides a secure, distributed append-only log with built-in replication, integrity, and synchronization.', accent: 'amber' },
              { icon: Cpu, title: 'Multi-network support', desc: 'A single node can watch multiple outside task networks and use available inference capacity wherever work appears.', accent: 'cyan' },
              { icon: Activity, title: 'Real-time task monitor', desc: 'The node watches for available tasks in real time, so spare inference capacity can be routed to outside networks as soon as the app is idle.', accent: 'amber' },
            ].map((f, i) => (
              <FadeUp key={f.title} delay={i * 80}>
                <GlassCard hoverColor={f.accent} className="h-full">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${f.accent === 'cyan' ? 'bg-cyan-400/10' : f.accent === 'purple' ? 'bg-purple-400/10' : 'bg-amber-400/10'}`}>
                    <f.icon size={20} strokeWidth={1.7} className={f.accent === 'cyan' ? 'text-cyan-400' : f.accent === 'purple' ? 'text-purple-400' : 'text-amber-400'} />
                  </div>
                  <h3 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 600, fontSize: '17px' }} className="text-white mb-2">{f.title}</h3>
                  <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px', lineHeight: 1.65 }} className="text-white/40">{f.desc}</p>
                </GlassCard>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture Section */}
      <section className="relative py-32 px-6">
        <Divider />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-950/15 to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto relative">
          <FadeUp className="text-center mb-16">
            <Label color="cyan">Architecture</Label>
            <h2 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.1 }} className="text-white">
              Local AI first.<br />
              <span className="bg-gradient-to-r from-cyan-400 to-cyan-200 bg-clip-text text-transparent">Shared capacity second.</span>
            </h2>
            <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '18px' }} className="text-white/40 max-w-2xl mx-auto mt-4">
              The core stack combines QVAC for inference, Pear for peer-to-peer networking, Hypercore for distributed data, the LLM Wiki for local AI memory, and a task monitor that detects outside work opportunities.
            </p>
            <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '16px' }} className="text-white/30 max-w-2xl mx-auto mt-3">
              When the app needs inference, the node serves the app first. When that capacity is free, the same node can make it available to supported task networks.
            </p>
          </FadeUp>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <FadeUp delay={100}>
              <GlassCard className="h-full">
                <h3 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 600, fontSize: '16px' }} className="text-white mb-5 flex items-center gap-2">
                  <Server size={16} className="text-cyan-400" />
                  Core components
                </h3>
                <div className="space-y-3">
                  {[
                    { icon: Zap, title: 'QVAC inference layer', desc: 'Local AI processing for the app.', accent: 'cyan' },
                    { icon: Database, title: 'Hypercore data store', desc: 'Distributed append-only storage with replication.', accent: 'green' },
                    { icon: Network, title: 'Pear P2P network', desc: 'Direct peer-to-peer app and node communication.', accent: 'blue' },
                    { icon: Activity, title: 'Task monitor', desc: 'Real-time detection of outside network tasks.', accent: 'purple' },
                  ].map(c => (
                    <div key={c.title} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <c.icon size={14} className={c.accent === 'cyan' ? 'text-cyan-400' : c.accent === 'green' ? 'text-green-400' : c.accent === 'blue' ? 'text-blue-400' : c.accent === 'orange' ? 'text-orange-400' : 'text-purple-400'} />
                      <div className="flex-1">
                        <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px' }} className="text-white/80">{c.title}</p>
                        <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '14px' }} className="text-white/30">{c.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </FadeUp>

            <FadeUp delay={200}>
              <GlassCard className="h-full">
                <h3 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 600, fontSize: '16px' }} className="text-white mb-5 flex items-center gap-2">
                  <Cpu size={16} className="text-purple-400" />
                  Supported task networks
                </h3>
                <div className="space-y-3">
                  {[
                    { icon: Zap, name: 'Cortensor', desc: 'Decentralized AI network', color: 'purple', url: 'https://cortensor.network/' },
                    { icon: Cpu, name: 'Chutes', desc: 'GPU compute validation', color: 'blue', url: 'https://chutes.ai/' },
                    { icon: Activity, name: 'Fortytwo', desc: 'AI inference network', color: 'green', url: 'https://fortytwo.network/' },
                    { icon: Sparkles, name: 'Earnidle', desc: 'Idle compute protocol', color: 'orange', url: 'https://earnidle.ai/' },
                    { icon: Zap, name: 'Routstr', desc: 'Decentralized AI inference router', color: 'yellow', url: 'https://routstr.com/' },
                  ].map(m => (
                    <div key={m.name} className="flex items-center gap-3 p-3 rounded-lg group hover:bg-white/[0.04] transition-colors" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div className={`w-8 h-8 rounded flex items-center justify-center ${m.color === 'purple' ? 'bg-purple-500/15' : m.color === 'blue' ? 'bg-blue-500/15' : m.color === 'green' ? 'bg-green-500/15' : m.color === 'orange' ? 'bg-orange-500/15' : 'bg-yellow-500/15'}`}>
                        <m.icon size={14} className={m.color === 'purple' ? 'text-purple-400' : m.color === 'blue' ? 'text-blue-400' : m.color === 'green' ? 'text-green-400' : m.color === 'orange' ? 'text-orange-400' : 'text-yellow-400'} />
                      </div>
                      <div className="flex-1">
                        <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px' }} className="text-white/80 hover:text-cyan-300 transition-colors">{m.name}</a>
                        <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '14px' }} className="text-white/30">{m.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-4 rounded-xl border border-cyan-400/15 bg-cyan-400/5">
                  <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px' }} className="text-cyan-300/70">
                    <span className="text-cyan-400 font-medium">Parallel mode:</span> the node can monitor multiple supported networks at once and direct spare inference capacity to available work.
                  </p>
                </div>
              </GlassCard>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* Get Started — AI Writer Example */}
      <section className="relative py-32 px-6">
        <Divider />
        <div className="max-w-6xl mx-auto">
          <FadeUp className="text-center mb-16">
            <Label color="amber">Get Started</Label>
            <h2 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.1 }} className="text-white mb-4">
              Download & run locally.
            </h2>
            <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '18px' }} className="text-white/40 max-w-xl mx-auto">
              Enter your EVM payout address and download the installer for your platform. The example app runs on localhost with node controls in the sidebar.
            </p>
          </FadeUp>
          <AIWriterExample onNavigateBack={() => {}} onNavigateToDashboard={onNavigateToDashboard} />
        </div>
      </section>

      {/* Example app */}
      <section className="relative py-24 px-6">
        <Divider />
        <div className="max-w-3xl mx-auto text-center">
          <FadeUp>
            <Label color="cyan">Example app</Label>
            <h2 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: 'clamp(24px, 3.5vw, 36px)', lineHeight: 1.1 }} className="text-white mb-4">
              AI Writer
            </h2>
            <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '17px', lineHeight: 1.7 }} className="text-white/40 mb-6">
              This demo shows how a local AI app can use QVAC for its own inference while also giving users the option to share idle capacity with outside task networks.
            </p>
            <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px' }} className="text-white/25">
              In your own app, users get the same simple setup flow. Only an EVM address is required for payouts.
            </p>
          </FadeUp>
        </div>
      </section>

      {/* 3 Steps */}
      <section className="relative py-24 px-6">
        <Divider />
        <div className="max-w-4xl mx-auto">
          <FadeUp className="text-center mb-12">
            <Label color="purple">Start earning in 3 steps</Label>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { num: '1', title: 'Enter your EVM payout address', desc: 'This is where your share of completed inference work is sent.' },
              { num: '2', title: 'Download the installer', desc: 'The installer detects your operating system and sets up the node locally.' },
              { num: '3', title: 'Run the node', desc: 'The app uses local AI when needed. When it is idle, spare inference capacity can be used by supported outside task networks.' },
            ].map((step, i) => (
              <FadeUp key={step.num} delay={i * 100}>
                <div className="rounded-xl border border-white/8 p-6 text-left h-full" style={{ background: 'rgba(10,10,20,0.75)', backdropFilter: 'blur(12px)' }}>
                  <div style={{ fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", fontSize: '28px', fontWeight: 700, color: '#c9a96e' }} className="mb-3">{step.num}</div>
                  <h3 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 600, fontSize: '17px' }} className="text-white mb-2">{step.title}</h3>
                  <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px', lineHeight: 1.65 }} className="text-white/40">{step.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* How rewards work */}
      <section className="relative py-24 px-6">
        <Divider />
        <div className="max-w-3xl mx-auto text-center">
          <FadeUp>
            <Label color="amber">How rewards work</Label>
            <div className="text-left mt-8 space-y-4">
              {[
                { text: 'Your device serves your own local AI apps first.' },
                { text: 'When capacity is unused, the node can accept external inference tasks.' },
                { text: 'When those tasks are completed, rewards go to the inference provider, with revenue sharing available for the app that enabled the node.' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-white/8 p-5" style={{ background: 'rgba(10,10,20,0.75)', backdropFilter: 'blur(12px)' }}>
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", fontSize: '15px', color: '#c9a96e' }} className="mt-0.5 shrink-0">—</span>
                  <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '15px', lineHeight: 1.65 }} className="text-white/60">{item.text}</p>
                </div>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section className="relative py-32 px-6">
        <Divider />
        <div className="max-w-6xl mx-auto">
          <FadeUp className="text-center mb-16">
            <Label>Technology Stack</Label>
            <h2 style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.1 }} className="text-white">
              Built on proven local-first and P2P infrastructure.
            </h2>
          </FadeUp>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
            {[
              { icon: Terminal, name: 'Node.js', role: 'Runtime', accent: 'green' },
              { icon: Zap, name: 'QVAC', role: 'AI Inference', accent: 'cyan' },
              { icon: Network, name: 'Pear', role: 'P2P Network', accent: 'purple' },
              { icon: Database, name: 'Hypercore', role: 'Data Storage', accent: 'orange' },
              { icon: Cpu, name: 'Chimera', role: 'Node Infrastructure', accent: 'cyan' },
            ].map((t, i) => (
              <FadeUp key={t.name} delay={i * 80}>
                <div className="rounded-xl border border-white/8 p-6 text-center transition-all duration-300 hover:border-white/15" style={{ background: 'rgba(10,10,20,0.75)', backdropFilter: 'blur(12px)' }}>
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-3 ${t.accent === 'cyan' ? 'bg-cyan-400/10' : t.accent === 'purple' ? 'bg-purple-400/10' : t.accent === 'green' ? 'bg-green-400/10' : 'bg-amber-400/10'}`}>
                    <t.icon size={20} strokeWidth={1.5} className={t.accent === 'cyan' ? 'text-cyan-400' : t.accent === 'purple' ? 'text-purple-400' : t.accent === 'green' ? 'text-green-400' : 'text-amber-400'} />
                  </div>
                  <div style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: '16px' }} className="text-white mb-1">{t.name}</div>
                  <div style={{ fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace", fontSize: '12px' }} className="text-white/30 uppercase tracking-wider">{t.role}</div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-10 px-6 border-t border-white/6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center shadow-[0_0_10px_#00e5ff30]">
              <Cpu size={10} className="text-black" strokeWidth={2.5} />
            </div>
            <span style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 700, fontSize: '15px' }} className="text-white/50">Chimera</span>
          </div>
          <p style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontSize: '14px' }} className="text-white/22">
            Decentralized local AI infrastructure · Open source · Permissionless
          </p>
          <div className="flex gap-4">
            <a href="https://github.com/TerexitariusStomp/qvac-chimera" target="_blank" rel="noopener noreferrer" className="text-white/25 hover:text-white/55 transition-colors">
              <Github size={15} />
            </a>
          </div>
        </div>
      </footer>
      </div>
    </div>
  )
}
