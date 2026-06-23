import React from 'react'
import { motion } from 'framer-motion'
import { Brain, Coins, Network, Lock, FileText, Timer, Smartphone, Server } from 'lucide-react'

const features = [
  {
    icon: Brain,
    title: 'Local LLM Inference',
    description: 'Run Llama 3.2, Qwen, and other models entirely on-device. No data ever leaves your hardware.',
    color: 'from-cyan-500/20 to-blue-500/20',
    border: 'border-cyan-500/30',
  },
  {
    icon: Coins,
    title: 'Multi-Protocol Mining',
    description: 'Automatically switch between Cortensor, Chutes, Fortytwo, Earnidle, and Routstr to maximize earnings.',
    color: 'from-purple-500/20 to-pink-500/20',
    border: 'border-purple-500/30',
  },
  {
    icon: Network,
    title: 'Pear P2P Sync',
    description: 'Wiki pages and data sync peer-to-peer across your devices without any centralized server.',
    color: 'from-green-500/20 to-emerald-500/20',
    border: 'border-green-500/30',
  },
  {
    icon: Lock,
    title: 'Hardened Container',
    description: 'Runs as non-root in an isolated Docker container with minimal attack surface and health checks.',
    color: 'from-orange-500/20 to-red-500/20',
    border: 'border-orange-500/30',
  },
  {
    icon: FileText,
    title: 'LLM Wiki',
    description: 'Wiki-first interface that opens directly to editing. Auto-saves every 2 seconds with AI writing assistance.',
    color: 'from-blue-500/20 to-indigo-500/20',
    border: 'border-blue-500/30',
  },
  {
    icon: Timer,
    title: 'Idle Detection',
    description: 'Automatically transitions from inference to mining when your device is idle. Zero manual switching.',
    color: 'from-yellow-500/20 to-amber-500/20',
    border: 'border-yellow-500/30',
  },
  {
    icon: Smartphone,
    title: 'Cross-Platform',
    description: 'Desktop (Linux/macOS/Windows), mobile (iOS/Android), and Docker. Every device is its own node.',
    color: 'from-pink-500/20 to-rose-500/20',
    border: 'border-pink-500/30',
  },
  {
    icon: Server,
    title: 'Fleet Orchestration',
    description: 'Commander/worker mode for distributed task execution across multiple nodes in your fleet.',
    color: 'from-teal-500/20 to-cyan-500/20',
    border: 'border-teal-500/30',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            Everything You Need to{' '}
            <span className="gradient-text">Mine &amp; Infer</span>
          </h2>
          <p className="text-lg text-chimera-muted max-w-2xl mx-auto">
            A complete node stack that handles inference, mining, and peer sync — all running locally on your hardware.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
              viewport={{ once: true }}
              className={`group glass-panel p-6 hover:bg-chimera-panel transition-all duration-300 border ${feature.border}`}
            >
              <div
                className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
              >
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-white font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-chimera-muted leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
