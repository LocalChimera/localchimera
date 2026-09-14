import React from 'react'
import { ChimeraWeb3AuthProvider } from '@localchimera/sdk'
import AIWriter from './pages/AIWriter'

function App() {
  return <AIWriter />
}

function WrappedApp() {
  return (
    <ChimeraWeb3AuthProvider>
      <App />
    </ChimeraWeb3AuthProvider>
  )
}

export default WrappedApp
