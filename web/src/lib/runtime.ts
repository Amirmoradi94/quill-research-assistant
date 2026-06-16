const BUILD_API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE || '')

declare global {
  interface Window {
    __QUILL_API_BASE__?: string
  }
}

function normalizeApiBase(value: string | null | undefined): string {
  return (value || '').replace(/\/$/, '')
}

export function apiBase(): string {
  const runtimeBase = normalizeApiBase(window.__QUILL_API_BASE__)
  if (runtimeBase) return runtimeBase

  try {
    const storedBase = normalizeApiBase(localStorage.getItem('quill.apiBase'))
    if (storedBase) return storedBase
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return BUILD_API_BASE
}

export function apiUrl(path: string): string {
  const base = apiBase()
  if (!base) return path
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
