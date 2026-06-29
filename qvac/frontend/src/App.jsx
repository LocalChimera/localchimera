import React from 'react'
import WikiPage from './pages/WikiPage'
import DocsPage from './pages/DocsPage'

function App() {
  const path = window.location.pathname
  if (path === '/docs' || path.startsWith('/docs/')) {
    return <DocsPage />
  }
  return <WikiPage />
}

export default App