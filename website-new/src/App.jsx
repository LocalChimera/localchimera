import React from 'react'
import Navigation from './components/Navigation'
import Hero from './components/Hero'
import Stats from './components/Stats'
import Features from './components/Features'
import HowItWorks from './components/HowItWorks'
import Miners from './components/Miners'
import Platforms from './components/Platforms'
import Architecture from './components/Architecture'
import CTA from './components/CTA'
import Footer from './components/Footer'

function App() {
  return (
    <div className="min-h-screen bg-chimera-dark overflow-x-hidden">
      <Navigation />
      <Hero />
      <Stats />
      <Features />
      <HowItWorks />
      <Miners />
      <Platforms />
      <Architecture />
      <CTA />
      <Footer />
    </div>
  )
}

export default App
