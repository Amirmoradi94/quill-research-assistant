import { useEffect, useRef, useState } from 'react'
import { Sparkles, RefreshCw, X } from 'lucide-react'
import { apiUrl } from '@/lib/runtime'

export function RedraftModal({ professorId, professorName, onClose, onDone }: {
  professorId: number
  professorName?: string | null
  onClose: () => void
  onDone: (ok: boolean, message: string) => void
}) {
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { setTimeout(() => taRef.current?.focus(), 100) }, [])
  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current) }, [])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [instructions])

  const run = async () => {
    setBusy(true)
    setProgress([])
    setElapsed(0)
    tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)

    const payload: any = {
      workflow: 'draft_email',
      professor_id: professorId,
      params: {},
      timeout_s: 240,
    }
    if (instructions.trim()) payload.params.user_instructions = instructions.trim()

    let okFlag = false
    let errMsg = ''

    try {
      const r = await fetch(apiUrl('/api/ai/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const reader = r.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let lastEvt = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('event:')) lastEvt = line.slice(6).trim()
          else if (line.startsWith('data:')) {
            try {
              const d = JSON.parse(line.slice(5).trim() || '{}')
              if (lastEvt === 'text' && d.text) {
                setProgress((p) => [...p.slice(-200), d.text])
              } else if (lastEvt === 'done') {
                okFlag = !!d.ok
                if (!okFlag) errMsg = d.error || d.result || 'draft_email failed'
              } else if (lastEvt === 'error') {
                okFlag = false
                errMsg = d.error || d.message || 'error'
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (e: any) {
      okFlag = false
      errMsg = e?.message || String(e)
    } finally {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      setBusy(false)
    }

    onDone(okFlag,
      okFlag
        ? (professorName ? `Redrafted email to ${professorName} ✓` : 'Redrafted email ✓')
        : `Redraft failed: ${errMsg.slice(0, 200)}`,
    )
    if (okFlag) {
      window.dispatchEvent(new CustomEvent('quill:data-changed'))
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={busy ? undefined : onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        style={{ background: 'var(--color-white)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="p-5 flex items-start gap-3 border-b"
          style={{ borderColor: 'var(--color-line)' }}>
          <div className="w-10 h-10 rounded-full grid place-items-center flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--color-cat-cv) 18%, var(--color-paper-2))',
              color: 'var(--color-cat-cv)',
            }}>
            <Sparkles size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[16px] font-semibold leading-tight"
              style={{ color: 'var(--color-ink)' }}>
              Redraft with Quill
            </h3>
            <p className="text-[12px] mt-0.5"
              style={{ color: 'var(--color-muted)' }}>
              Quill will re-read your profile and{' '}
              <strong>{professorName || 'this contact'}</strong>'s
              page (research summary, papers, hiring intel), then generate a
              fresh draft. The current draft is preserved as a backup.
            </p>
          </div>
          <button onClick={onClose} disabled={busy}
            className="p-1 rounded hover:bg-[color:var(--color-paper-2)] disabled:opacity-40"
            style={{ color: 'var(--color-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider font-medium"
              style={{ color: 'var(--color-muted-2)' }}>
              Special instructions (optional)
            </label>
            <textarea ref={taRef} value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={busy}
              placeholder={'e.g. "Make the opening more personal — mention their recent paper", "Keep it under 200 words", "Emphasize the strongest research fit"'}
              rows={3}
              className="w-full mt-1.5 px-3 py-2 rounded-lg border text-[13px] outline-none font-sans leading-relaxed disabled:opacity-60"
              style={{
                background: 'var(--color-paper)',
                borderColor: 'var(--color-line)',
                resize: 'none', overflow: 'hidden',
              }} />
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--color-muted)' }}>
              Leave blank to let Quill regenerate from scratch using your
              defaults. Anything you write here is treated as an override for
              this draft only.
            </div>
          </div>

          {busy && (
            <div className="rounded-lg border p-3 flex flex-col gap-1"
              style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}>
              <div className="text-[12px] flex items-center gap-2"
                style={{ color: 'var(--color-brand-700)' }}>
                <RefreshCw size={12} className="animate-spin" />
                <span>Drafting — usually takes 15-90 seconds</span>
                <span className="ml-auto font-mono">{elapsed}s</span>
              </div>
              {progress.length > 0 && (
                <pre className="text-[10px] mt-1 font-mono max-h-32 overflow-auto whitespace-pre-wrap"
                  style={{ color: 'var(--color-muted)' }}>
                  {progress.join('').slice(-1500)}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end gap-2 border-t"
          style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-lg text-[13px] font-medium border disabled:opacity-50"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)', background: 'var(--color-white)' }}>
            Cancel
          </button>
          <button onClick={run} disabled={busy}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-white disabled:opacity-50 inline-flex items-center gap-1.5 transition-transform hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))',
              boxShadow: '0 6px 16px -6px rgba(47,92,203,0.45)',
            }}>
            {busy ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy ? 'Drafting…' : 'Redraft now'}
          </button>
        </div>
      </div>
    </div>
  )
}
