import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

type ConfirmOptions = {
  title?: string
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** "danger" colours the confirm button red. Default for delete actions. */
  variant?: 'danger' | 'primary'
  /** Optional second-line emphasis (e.g. the item title being deleted). */
  detail?: React.ReactNode
}

type Resolver = (ok: boolean) => void

const ConfirmCtx = createContext<(opts?: ConfirmOptions) => Promise<boolean>>(() =>
  Promise.resolve(window.confirm('Are you sure?'))
)

export function useConfirm() {
  return useContext(ConfirmCtx)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: Resolver } | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((opts?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ opts: opts || {}, resolve })
    })
  }, [])

  const close = (ok: boolean) => {
    if (!state) return
    state.resolve(ok)
    setState(null)
  }

  // Esc to cancel, Enter to confirm, autofocus cancel for safety.
  useEffect(() => {
    if (!state) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const opts = state?.opts || {}
  const variant = opts.variant ?? 'danger'
  const confirmBg =
    variant === 'danger'
      ? '#be123c'
      : '#264ba8'

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <div className="quill-type-scale fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in"
          role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => close(false)} />
          <div className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: 'var(--color-white)' }}>
            <button onClick={() => close(false)}
              className="absolute top-3 right-3 p-1 rounded hover:bg-[color:var(--color-paper-2)]"
              style={{ color: 'var(--color-muted)' }} aria-label="Close">
              <X size={16} />
            </button>
            <div className="p-6 flex gap-4">
              <div className="w-11 h-11 rounded-full grid place-items-center flex-shrink-0"
                style={{
                  background: variant === 'danger'
                    ? 'var(--color-rose-50)'
                    : 'var(--color-brand-50)',
                  color: variant === 'danger' ? 'var(--color-rose-700)' : 'var(--color-brand-700)',
                }}>
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[16px] font-semibold leading-tight"
                  style={{ color: 'var(--color-ink)' }}>
                  {opts.title || 'Are you sure?'}
                </h3>
                {opts.detail && (
                  <div className="text-[13px] mt-1 font-mono px-2 py-1 rounded inline-block"
                    style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)' }}>
                    {opts.detail}
                  </div>
                )}
                <div className="text-[13px] mt-2 leading-relaxed"
                  style={{ color: 'var(--color-ink-soft)' }}>
                  {opts.message || (variant === 'danger'
                    ? 'This action cannot be undone.'
                    : 'Please confirm to continue.')}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 flex justify-end gap-2 border-t"
              style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
              <button ref={cancelRef} onClick={() => close(false)}
                className="px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors hover:bg-white"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)', background: 'var(--color-white)' }}>
                {opts.cancelLabel || 'Cancel'}
              </button>
              <button onClick={() => close(true)}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  background: confirmBg,
                  color: '#ffffff',
                  border: '1px solid rgba(255,255,255,0.16)',
                  textShadow: '0 1px 1px rgba(0,0,0,0.18)',
                  opacity: 1,
                  cursor: 'pointer',
                  outlineColor: variant === 'danger' ? '#fecdd3' : '#bfdbfe',
                  boxShadow: variant === 'danger'
                    ? '0 8px 18px -8px rgba(190,18,60,0.55)'
                    : '0 8px 18px -8px rgba(38,75,168,0.55)',
                }}>
                {opts.confirmLabel || (variant === 'danger' ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}
