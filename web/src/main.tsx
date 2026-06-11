import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const apiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
if (apiBase) {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return originalFetch(`${apiBase}${input}`, init)
    }
    if (input instanceof Request && input.url.startsWith(`${window.location.origin}/api`)) {
      const next = new Request(input.url.replace(window.location.origin, apiBase), input)
      return originalFetch(next, init)
    }
    return originalFetch(input as RequestInfo | URL, init)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
