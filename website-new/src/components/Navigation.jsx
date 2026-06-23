import React, { useState, useEffect } from 'react'
import { Menu, X, Cpu } from 'lucide-react'

const navLinks = [
  { name: 'Features', href: '#features' },
  { name: 'How It Works', href: '#how-it-works' },
  { name: 'Miners', href: '#miners' },
  { name: 'Platforms', href: '#platforms' },
  { name: 'Architecture', href: '#architecture' },
]

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-chimera-dark/90 backdrop-blur-xl border-b border-chimera-border'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <a href="#" className="flex items-center gap-2 group">
            <Cpu className="w-6 h-6 text-chimera-cyan group-hover:text-chimera-purple transition-colors" />
            <span className="text-xl font-bold text-white">Chimera</span>
          </a>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="text-sm text-chimera-muted hover:text-white transition-colors"
              >
                {link.name}
              </a>
            ))}
            <a
              href="https://github.com/LocalChimera/localchimera"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-chimera-cyan/20 to-chimera-purple/20 border border-chimera-cyan/30 text-sm text-white hover:from-chimera-cyan/30 hover:to-chimera-purple/30 transition-all"
            >
              GitHub
            </a>
          </div>

          <button
            className="md:hidden text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-chimera-dark/95 backdrop-blur-xl border-b border-chimera-border">
          <div className="px-4 py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="block text-chimera-muted hover:text-white transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.name}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
