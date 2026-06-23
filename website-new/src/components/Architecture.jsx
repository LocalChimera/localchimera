import React from 'react'
import { motion } from 'framer-motion'

const layers = [
  {
    title: 'Desktop / Mobile UI',
    items: ['Tauri Shell + WebView', 'React Native (Expo)', 'Start/Stop Controls'],
    color: 'border-chimera-cyan/40 bg-chimera-cyan/10',
  },
  {
    title: 'Supervisor & IPC',
    items: ['Go Supervisor Sidecar', 'Docker Orchestration', 'Health Monitoring'],
    color: 'border-purple-500/40 bg-purple-500/10',
  },
  {
    title: 'Container Runtime',
    items: ['Hardened Docker Image', 'Non-root User (chimera)', 'Minimal Attack Surface'],
    color: 'border-green-500/40 bg-green-500/10',
  },
  {
    title: 'Node Core',
    items: ['QVAC Inference Layer', 'Miner Orchestrator', 'P2P Sync (Pear)', 'LLM Wiki API'],
    color: 'border-orange-500/40 bg-orange-500/10',
  },
  {
    title: 'Mining Protocols',
    items: ['Cortensor, Chutes, Fortytwo', 'Earnidle, Routstr, Casper', 'Auto-switching Logic'],
    color: 'border-pink-500/40 bg-pink-500/10',
  },
]

export default function Architecture() {
  return (
    <section id="architecture" className="py-24 relative">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            <span className="gradient-text">Architecture</span>
          </h2>
          <p className="text-lg text-chimera-muted max-w-2xl mx-auto">
            Each layer is isolated and replaceable. Run the full stack in Docker, or use direct Node.js for development.
          </p>
        </motion.div>

        <div className="space-y-4">
          {layers.map((layer, i) => (
            <motion.div
              key={layer.title}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              viewport={{ once: true }}
              className={`p-6 rounded-xl border ${layer.color}`}
            >
              <h3 className="text-lg font-semibold text-white mb-3">{layer.title}</h3>
              <div className="flex flex-wrap gap-2">
                {layer.items.map((item) => (
                  <span
                    key={item}
                    className="px-3 py-1 rounded-full bg-chimera-dark/50 text-sm text-chimera-text border border-chimera-border/50"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="mt-8 text-center"
        >
          <a
            href="https://github.com/LocalChimera/localchimera"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-chimera-cyan hover:text-white transition-colors"
          >
            View full architecture on GitHub
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </a>
        </motion.div>
      </div>
    </section>
  )
}
