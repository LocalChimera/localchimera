import React from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, Zap, Shield, Globe } from 'lucide-react'

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-hero-glow" />
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-chimera-purple/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-chimera-cyan/20 rounded-full blur-[128px]" />
      </div>

      {/* Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-chimera-panel border border-chimera-border mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm text-chimera-muted">v1.0.57 Now Available</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
            <span className="text-white">Local AI That</span>
            <br />
            <span className="gradient-text">Earns When Idle</span>
          </h1>

          <p className="text-lg sm:text-xl text-chimera-muted max-w-2xl mx-auto mb-10 leading-relaxed">
            Run a QVAC inference node on any device. Mine AI tasks from multiple protocols
            and turn your idle hardware into revenue — all in a hardened, privacy-first container.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <a
              href="https://github.com/LocalChimera/localchimera/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-chimera-cyan to-chimera-purple text-chimera-dark font-semibold hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <Zap className="w-5 h-5" />
              Download Now
            </a>
            <a
              href="#architecture"
              className="px-8 py-4 rounded-xl border border-chimera-border text-white hover:bg-chimera-panel transition-colors flex items-center gap-2"
            >
              <Shield className="w-5 h-5" />
              Learn More
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {[
              { icon: Zap, label: '5 Mining Protocols', desc: 'Cortensor, Chutes, Fortytwo, Earnidle, Routstr' },
              { icon: Shield, label: 'Privacy First', desc: 'All inference runs locally on your device' },
              { icon: Globe, label: 'P2P Network', desc: 'Pear P2P swarm sync across devices' },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.1, duration: 0.5 }}
                className="glass-panel p-6 text-left"
              >
                <item.icon className="w-6 h-6 text-chimera-cyan mb-3" />
                <h3 className="text-white font-medium mb-1">{item.label}</h3>
                <p className="text-sm text-chimera-muted">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <a href="#stats" className="text-chimera-muted hover:text-white transition-colors">
            <ArrowDown className="w-6 h-6 animate-bounce" />
          </a>
        </motion.div>
      </div>
    </section>
  )
}
