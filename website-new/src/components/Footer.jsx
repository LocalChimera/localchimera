import React from 'react'
import { Cpu, Github, Twitter, MessageCircle } from 'lucide-react'

const footerLinks = {
  Product: [
    { name: 'Features', href: '#features' },
    { name: 'Download', href: 'https://github.com/LocalChimera/localchimera/releases' },
    { name: 'Changelog', href: 'https://github.com/LocalChimera/localchimera/releases' },
  ],
  Developers: [
    { name: 'GitHub', href: 'https://github.com/LocalChimera/localchimera' },
    { name: 'SDK', href: 'https://github.com/LocalChimera/localchimera/tree/main/sdk' },
    { name: 'Documentation', href: 'https://github.com/LocalChimera/localchimera/tree/main/docs' },
  ],
  Community: [
    { name: 'Twitter / X', href: 'https://x.com/LocalChimera' },
    { name: 'Discord', href: '#' },
    { name: 'Issues', href: 'https://github.com/LocalChimera/localchimera/issues' },
  ],
}

export default function Footer() {
  return (
    <footer className="border-t border-chimera-border bg-chimera-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="w-6 h-6 text-chimera-cyan" />
              <span className="text-xl font-bold text-white">Chimera</span>
            </div>
            <p className="text-sm text-chimera-muted max-w-sm mb-6">
              Local AI inference node that earns when idle. Run on any device — desktop, mobile, or container.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/LocalChimera/localchimera"
                target="_blank"
                rel="noopener noreferrer"
                className="text-chimera-muted hover:text-white transition-colors"
              >
                <Github className="w-5 h-5" />
              </a>
              <a
                href="https://x.com/LocalChimera"
                target="_blank"
                rel="noopener noreferrer"
                className="text-chimera-muted hover:text-white transition-colors"
              >
                <Twitter className="w-5 h-5" />
              </a>
            </div>
          </div>

          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-white font-semibold mb-4">{category}</h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.name}>
                    <a
                      href={link.href}
                      target={link.href.startsWith('http') ? '_blank' : undefined}
                      rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                      className="text-sm text-chimera-muted hover:text-white transition-colors"
                    >
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-chimera-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-chimera-muted">
            &copy; {new Date().getFullYear()} Chimera. Open source under MIT License.
          </p>
          <p className="text-sm text-chimera-muted">
            Built with QVAC, Pear P2P, and Tauri.
          </p>
        </div>
      </div>
    </footer>
  )
}
