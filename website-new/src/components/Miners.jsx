import React from 'react'
import { motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'

const miners = [
  {
    name: 'Cortensor',
    description: 'Decentralized AI network for proof-of-useful-work tasks. Earn by contributing inference capacity.',
    color: 'from-blue-500/20 to-cyan-500/20',
    border: 'border-blue-500/30',
    url: '#',
  },
  {
    name: 'Chutes',
    description: 'GPU mining system with automatic validation. Optimized for high-throughput inference workloads.',
    color: 'from-purple-500/20 to-pink-500/20',
    border: 'border-purple-500/30',
    url: '#',
  },
  {
    name: 'Fortytwo',
    description: 'Planetary-scale decentralized AI inference. Earn FOR points for contributing compute.',
    color: 'from-green-500/20 to-emerald-500/20',
    border: 'border-green-500/30',
    url: '#',
  },
  {
    name: 'Earnidle',
    description: 'Put idle compute to work across multiple venues. Simple, passive earnings for any hardware.',
    color: 'from-yellow-500/20 to-orange-500/20',
    border: 'border-yellow-500/30',
    url: '#',
  },
  {
    name: 'Routstr',
    description: 'Nostr-based routing protocol. Earn for relaying and processing decentralized AI requests.',
    color: 'from-red-500/20 to-rose-500/20',
    border: 'border-red-500/30',
    url: '#',
  },
  {
    name: 'Casper',
    description: 'Smart contract-based compute marketplace. On-chain escrow and reputation for secure transactions.',
    color: 'from-teal-500/20 to-cyan-500/20',
    border: 'border-teal-500/30',
    url: '#',
  },
]

export default function Miners() {
  return (
    <section id="miners" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            Supported <span className="gradient-text">Mining Protocols</span>
          </h2>
          <p className="text-lg text-chimera-muted max-w-2xl mx-auto">
            Chimera automatically switches between protocols to maximize your earnings based on your hardware and market conditions.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {miners.map((miner, i) => (
            <motion.div
              key={miner.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
              viewport={{ once: true }}
              className={`glass-panel p-6 border ${miner.border} hover:border-opacity-60 transition-all group`}
            >
              <div className="flex items-start justify-between mb-4">
                <div
                  className={`w-10 h-10 rounded-lg bg-gradient-to-br ${miner.color} flex items-center justify-center`}
                >
                  <span className="text-lg font-bold text-white">{miner.name[0]}</span>
                </div>
                <ExternalLink className="w-4 h-4 text-chimera-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <h3 className="text-white font-semibold mb-2">{miner.name}</h3>
              <p className="text-sm text-chimera-muted leading-relaxed">{miner.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
