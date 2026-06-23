import React from 'react'
import { motion } from 'framer-motion'
import { Monitor, Smartphone, Container, Apple, Terminal, Package } from 'lucide-react'

const platforms = [
  {
    icon: Monitor,
    name: 'Linux',
    formats: '.deb, .rpm, binary',
    status: 'Ready',
    color: 'text-yellow-400',
  },
  {
    icon: Apple,
    name: 'macOS',
    formats: '.dmg, .app',
    status: 'Build from source',
    color: 'text-gray-400',
  },
  {
    icon: Terminal,
    name: 'Windows',
    formats: '.msi',
    status: 'Build from source',
    color: 'text-blue-400',
  },
  {
    icon: Smartphone,
    name: 'iOS',
    formats: '.ipa (App Store)',
    status: 'Xcode build ready',
    color: 'text-gray-300',
  },
  {
    icon: Package,
    name: 'Android',
    formats: '.apk, Play Store',
    status: 'CI building',
    color: 'text-green-400',
  },
  {
    icon: Container,
    name: 'Docker',
    formats: 'Docker Compose',
    status: 'Ready',
    color: 'text-cyan-400',
  },
]

export default function Platforms() {
  return (
    <section id="platforms" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-chimera-cyan/5 to-transparent" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            Runs <span className="gradient-text">Everywhere</span>
          </h2>
          <p className="text-lg text-chimera-muted max-w-2xl mx-auto">
            Desktop, mobile, container — every device becomes its own autonomous Chimera node.
          </p>
        </motion.div>

        <div className="glass-panel p-8 sm:p-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {platforms.map((platform, i) => (
              <motion.div
                key={platform.name}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                viewport={{ once: true }}
                className="flex items-center gap-4 p-4 rounded-xl bg-chimera-dark/50 border border-chimera-border/50 hover:border-chimera-border transition-colors"
              >
                <platform.icon className={`w-8 h-8 ${platform.color} shrink-0`} />
                <div>
                  <h3 className="text-white font-medium">{platform.name}</h3>
                  <p className="text-xs text-chimera-muted">{platform.formats}</p>
                  <span className="text-xs text-chimera-cyan">{platform.status}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
