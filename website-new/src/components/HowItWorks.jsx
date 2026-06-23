import React from 'react'
import { motion } from 'framer-motion'
import { Download, Play, Cpu, Wallet } from 'lucide-react'

const steps = [
  {
    icon: Download,
    step: '01',
    title: 'Install',
    description: 'Download the installer for your platform. One package for Linux (.deb/.rpm), macOS, or Windows.',
  },
  {
    icon: Play,
    step: '02',
    title: 'Start',
    description: 'Double-click to start. The app checks for Docker, builds the container, and launches the node.',
  },
  {
    icon: Cpu,
    step: '03',
    title: 'Mine',
    description: 'Your device automatically joins mining pools when idle. Switch between protocols to maximize yield.',
  },
  {
    icon: Wallet,
    step: '04',
    title: 'Earn',
    description: 'Revenue flows to your EVM address. Weekly sweeps and monthly distributions are handled by protocol multisigs.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-chimera-purple/5 to-transparent" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            Start Earning in <span className="gradient-text">4 Steps</span>
          </h2>
          <p className="text-lg text-chimera-muted max-w-2xl mx-auto">
            No complex configuration. No wallet setup across chains. Just install, start, and earn.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((item, i) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="glass-panel p-6 h-full">
                <div className="text-5xl font-bold text-chimera-border mb-4">{item.step}</div>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-chimera-cyan/20 to-chimera-purple/20 flex items-center justify-center mb-4">
                  <item.icon className="w-6 h-6 text-chimera-cyan" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-chimera-muted leading-relaxed">{item.description}</p>
              </div>
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -right-3 w-6 h-[2px] bg-gradient-to-r from-chimera-border to-chimera-cyan/50" />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
