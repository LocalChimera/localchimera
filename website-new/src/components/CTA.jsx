import React from 'react'
import { motion } from 'framer-motion'
import { Github, Download, MessageCircle } from 'lucide-react'

export default function CTA() {
  return (
    <section className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-t from-chimera-purple/10 via-transparent to-transparent" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-panel p-8 sm:p-12 text-center border border-chimera-cyan/30"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to Turn Idle Hardware into{' '}
            <span className="gradient-text">Revenue</span>?
          </h2>
          <p className="text-lg text-chimera-muted mb-8 max-w-xl mx-auto">
            Join the network of decentralized AI inference nodes. Install Chimera today and start earning while contributing to open AI infrastructure.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://github.com/LocalChimera/localchimera/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-chimera-cyan to-chimera-purple text-chimera-dark font-semibold hover:opacity-90 transition-opacity flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              <Download className="w-5 h-5" />
              Download v1.0.57
            </a>
            <a
              href="https://github.com/LocalChimera/localchimera"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 rounded-xl border border-chimera-border text-white hover:bg-chimera-panel transition-colors flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              <Github className="w-5 h-5" />
              View on GitHub
            </a>
          </div>
          <div className="mt-6 text-sm text-chimera-muted">
            Open source · MIT License · No account required
          </div>
        </motion.div>
      </div>
    </section>
  )
}
