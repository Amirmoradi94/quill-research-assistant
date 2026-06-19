import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, RefreshCw, X } from 'lucide-react'
import { useConfirm } from './ConfirmDialog'
import {
  checkForAppUpdate,
  formatUpdateProgress,
  formatUpdateVersion,
  installAppUpdate,
  markAutomaticUpdateCheck,
  shouldRunAutomaticUpdateCheck,
  type AppUpdate,
  type UpdateProgress,
} from '@/lib/appUpdater'

const STARTUP_CHECK_DELAY_MS = 8_000

export function AppUpdateNotice() {
  const confirm = useConfirm()
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!shouldRunAutomaticUpdateCheck()) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      markAutomaticUpdateCheck()
      checkForAppUpdate()
        .then((next) => {
          if (!cancelled && next) setUpdate(next)
        })
        .catch((e) => {
          if (!cancelled) setError(String(e?.message || e))
        })
    }, STARTUP_CHECK_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  if (!update || dismissedVersion === update.version) return null

  const version = formatUpdateVersion(update)

  const install = async () => {
    const ok = await confirm({
      title: `Install Quill AI ${version}?`,
      message: 'Quill will download the signed update, install it, and relaunch the app.',
      variant: 'primary',
      confirmLabel: 'Install update',
    })
    if (!ok) return

    setInstalling(true)
    setError(null)
    setProgress(null)
    try {
      await installAppUpdate(update, setProgress)
    } catch (e: any) {
      setError(e?.message || String(e))
      setInstalling(false)
    }
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 lg:left-[250px] xl:right-[392px]">
      <div
        className="mx-auto flex max-w-2xl items-start justify-between gap-3 rounded-md border p-3 shadow-lg"
        style={{
          background: 'var(--color-white)',
          borderColor: error ? 'var(--color-rose-200)' : 'var(--color-brand-200)',
          color: 'var(--color-ink)',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.14)',
        }}
      >
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5">
            {error ? (
              <AlertCircle size={16} style={{ color: 'var(--color-rose-700)' }} />
            ) : installing ? (
              <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--color-brand-600)' }} />
            ) : (
              <CheckCircle2 size={16} style={{ color: 'var(--color-brand-600)' }} />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">
              Quill AI {version} is available
            </div>
            <div className="mt-0.5 text-[12px] leading-5" style={{ color: 'var(--color-muted)' }}>
              {error || (installing ? formatUpdateProgress(progress) : 'Install now or continue working and update later.')}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!installing && (
            <button
              onClick={install}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium"
              style={{ background: 'var(--color-brand-600)', color: '#fff' }}
            >
              <Download size={13} />
              Update
            </button>
          )}
          <button
            onClick={() => setDismissedVersion(update.version)}
            disabled={installing}
            className="rounded-md border p-1.5 disabled:opacity-50"
            style={{
              background: 'var(--color-paper-2)',
              borderColor: 'var(--color-line)',
              color: 'var(--color-muted)',
            }}
            aria-label="Dismiss update notice"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
