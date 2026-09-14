import React from 'react'
import { ChimeraWeb3AuthProvider } from '@localchimera/sdk'
import WikiPage from './pages/WikiPage'
import DocsPage from './pages/DocsPage'

function App() {
  const path = window.location.pathname
  if (path === '/docs' || path.startsWith('/docs/')) {
    return <DocsPage />
  }
  return <WikiPage />
}

function WrappedApp() {
  return (
    <ChimeraWeb3AuthProvider>
      <App />
    </ChimeraWeb3AuthProvider>
  )
}

export default WrappedApp
