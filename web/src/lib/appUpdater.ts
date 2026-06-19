import type { Update } from '@tauri-apps/plugin-updater'

export type AppUpdate = Update

export type UpdateProgress = {
  phase: 'started' | 'progress' | 'finished'
  downloadedBytes: number
  totalBytes: number | null
}

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const LAST_AUTO_CHECK_KEY = 'quill.updater.lastAutoCheck'

export function isTauriRuntime() {
  if (typeof window === 'undefined') return false
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

export function shouldRunAutomaticUpdateCheck(now = Date.now()) {
  if (!isTauriRuntime()) return false
  try {
    const last = Number(localStorage.getItem(LAST_AUTO_CHECK_KEY))
    return !Number.isFinite(last) || now - last > AUTO_CHECK_INTERVAL_MS
  } catch {
    return true
  }
}

export function markAutomaticUpdateCheck(now = Date.now()) {
  try {
    localStorage.setItem(LAST_AUTO_CHECK_KEY, String(now))
  } catch {}
}

export async function checkForAppUpdate() {
  if (!isTauriRuntime()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  return check({ timeout: 30_000 })
}

export async function installAppUpdate(
  update: AppUpdate,
  onProgress?: (progress: UpdateProgress) => void,
) {
  let downloadedBytes = 0
  let totalBytes: number | null = null

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        downloadedBytes = 0
        totalBytes = event.data.contentLength ?? null
        onProgress?.({ phase: 'started', downloadedBytes, totalBytes })
        break
      case 'Progress':
        downloadedBytes += event.data.chunkLength
        onProgress?.({ phase: 'progress', downloadedBytes, totalBytes })
        break
      case 'Finished':
        onProgress?.({ phase: 'finished', downloadedBytes, totalBytes })
        break
    }
  })

  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

export function formatUpdateVersion(update: AppUpdate) {
  return update.version || 'new version'
}

export function formatUpdateProgress(progress: UpdateProgress | null) {
  if (!progress) return 'Preparing download...'
  if (progress.phase === 'finished') return 'Installing update...'
  if (!progress.totalBytes || progress.totalBytes <= 0) {
    return `${formatBytes(progress.downloadedBytes)} downloaded`
  }
  const percent = Math.min(99, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
  return `${percent}% downloaded`
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  const kb = value / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
