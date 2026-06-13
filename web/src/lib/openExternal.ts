import { open } from '@tauri-apps/plugin-shell'

export async function openExternalUrl(url?: string | null) {
  if (!url) return
  try {
    await open(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
