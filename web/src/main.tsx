import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { apiBase } from './lib/runtime'

function installQuillButtonPressFeedback() {
  const feedbackClass = 'quill-click-feedback'
  const selector = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]'

  window.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element)) return

    const target = event.target.closest<HTMLElement>(selector)
    if (!target) return
    if (target.matches(':disabled, [aria-disabled="true"]')) return

    target.classList.remove(feedbackClass)
    void target.offsetWidth
    target.classList.add(feedbackClass)
    window.setTimeout(() => target.classList.remove(feedbackClass), 180)
  }, { passive: true })
}

const originalFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const base = apiBase()
  if (base) {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return originalFetch(`${base}${input}`, init)
    }
    if (input instanceof Request && input.url.startsWith(`${window.location.origin}/api`)) {
      const next = new Request(input.url.replace(window.location.origin, base), input)
      return originalFetch(next, init)
    }
  }
  return originalFetch(input as RequestInfo | URL, init)
}

installQuillButtonPressFeedback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
