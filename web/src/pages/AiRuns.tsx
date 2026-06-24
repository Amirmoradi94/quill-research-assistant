import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader, CheckCircle2, AlertCircle, XCircle, X, RotateCcw, Wand2, Clock3 } from 'lucide-react'
import { api, type AIRun } from '@/lib/api'
import { apiUrl } from '@/lib/runtime'

const STATUS_ICON: Record<string, React.ReactNode> = {
  done:      <CheckCircle2 size={13} style={{ color: 'var(--color-green-700)' }} />,
  failed:    <AlertCircle  size={13} style={{ color: 'var(--color-rose-700)' }} />,
  cancelled: <XCircle      size={13} style={{ color: 'var(--color-muted)' }} />,
  interrupted: <AlertCircle size={13} style={{ color: 'var(--color-amber-600)' }} />,
  deferred: <Clock3 size={13} style={{ color: 'var(--color-amber-600)' }} />,
  retried: <RotateCcw size={13} style={{ color: 'var(--color-muted)' }} />,
  running:   <Loader       size={13} className="animate-spin" style={{ color: 'var(--color-amber-600)' }} />,
  queued:    <Loader       size={13} style={{ color: 'var(--color-muted)' }} />,
}

function fmt(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtCost(usd: number | null) {
  if (usd == null) return '—'
  return `$${usd.toFixed(4)}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function isRecoveryRun(run: AIRun) {
  return run.status === 'deferred'
    || (run.status === 'failed' && (run.error_type === 'rate_limit' || run.error_type === 'quota_limit'))
}

function isRetryable(run: AIRun) {
  return run.status === 'failed' || run.status === 'cancelled' || run.status === 'deferred'
}

export function AiRuns() {
  const [runs, setRuns] = useState<AIRun[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = () => api.aiRuns(100).then(setRuns).catch((e) => setErr(String(e)))

  const cancelRun = async (id: number) => {
    setCancelling(id)
    try {
      await fetch(apiUrl(`/api/ai/runs/${id}/cancel`), { method: 'POST', credentials: 'include' })
      load()
    } finally {
      setCancelling(null)
    }
  }

  const retryRun = async (run: AIRun, fallback: boolean) => {
    const key = `${run.id}:${fallback ? 'fallback' : 'same'}`
    setRetrying(key)
    setErr(null)
    try {
      const next = await api.retryAiRun(run.id, fallback)
      setExpandedId(next.id)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRetrying(null)
    }
  }

  useEffect(() => {
    load()
    window.addEventListener('quill:data-changed', load)
    return () => window.removeEventListener('quill:data-changed', load)
  }, [])

  const totalCost = runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const doneCount = runs.filter((r) => r.status === 'done').length
  const recoveryRuns = runs.filter(isRecoveryRun)
  const historyRuns = runs.filter((run) => !isRecoveryRun(run))

  const renderRun = (run: AIRun) => {
    const expanded = expandedId === run.id
    return (
      <div key={run.id} className="border-b last:border-b-0"
        style={{ borderColor: 'var(--color-line)' }}>
        <div className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[color:var(--color-paper-2)] transition-colors">
          <button
            className="flex flex-1 min-w-0 items-center gap-3 text-left"
            onClick={() => setExpandedId(expanded ? null : run.id)}
          >
            <span className="flex-shrink-0">{STATUS_ICON[run.status] ?? STATUS_ICON.queued}</span>
            {expanded ? <ChevronDown size={12} style={{ color: 'var(--color-muted)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-muted)', flexShrink: 0 }} />}

            <span className="flex-1 min-w-0">
              <span className="font-medium text-[14px]" style={{ color: 'var(--color-ink)' }}>
                {run.workflow.replace(/_/g, ' ')}
              </span>
              {run.retry_of_run_id && (
                <span className="ml-2 text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
                  retry of #{run.retry_of_run_id}
                </span>
              )}
            </span>
          </button>

          <div className="flex items-center gap-4 text-[12px] font-mono flex-shrink-0"
            style={{ color: 'var(--color-muted)' }}>
            {run.error_type && (run.status === 'failed' || run.status === 'deferred') && (
              <span className="rounded px-1.5 py-0.5"
                style={{ background: run.status === 'deferred' ? 'var(--color-amber-50)' : 'var(--color-rose-50)', color: run.status === 'deferred' ? 'var(--color-amber-700)' : 'var(--color-rose-700)' }}>
                {run.error_type.replace(/_/g, ' ')}
              </span>
            )}
            <span>{fmtCost(run.cost_usd)}</span>
            <span>{fmt(run.duration_ms)}</span>
            <span>{relativeTime(run.created_at)}</span>
            {isRetryable(run) && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => retryRun(run, false)}
                  disabled={retrying === `${run.id}:same`}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-[12px] transition-colors hover:bg-[color:var(--color-white)]"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
                  title="Retry this run"
                >
                  {retrying === `${run.id}:same` ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  Retry
                </button>
                <button
                  onClick={() => retryRun(run, true)}
                  disabled={retrying === `${run.id}:fallback`}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-[12px] transition-colors hover:bg-[color:var(--color-white)]"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-brand-700)' }}
                  title="Retry with fallback handling"
                >
                  {retrying === `${run.id}:fallback` ? <Loader size={12} className="animate-spin" /> : <Wand2 size={12} />}
                  Fallback
                </button>
              </div>
            )}
            {(run.status === 'running' || run.status === 'queued') && (
              <button
                onClick={() => cancelRun(run.id)}
                disabled={cancelling === run.id}
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-rose-100 transition-colors"
                style={{ color: 'var(--color-rose-700)' }}
                title="Cancel run"
              >
                {cancelling === run.id
                  ? <Loader size={11} className="animate-spin" />
                  : <X size={11} />}
              </button>
            )}
          </div>
        </div>

        {expanded && (run.output || run.error_message) && (
          <div className="px-4 pb-4 pt-1">
            {run.error_message && (
              <div className="mb-2 rounded-md border p-3 text-[12px]"
                style={{ background: run.status === 'deferred' ? 'var(--color-amber-50)' : 'var(--color-rose-50)', borderColor: 'var(--color-line)', color: run.status === 'deferred' ? 'var(--color-amber-700)' : 'var(--color-rose-700)', lineHeight: 1.5 }}>
                {run.error_message}
              </div>
            )}
            {run.output && (
              <div className="rounded-md p-3 text-[12px] font-mono whitespace-pre-wrap max-h-64 overflow-auto"
                style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)', lineHeight: 1.5 }}>
                {run.output}
              </div>
            )}
            {(run.tokens_in != null || run.tokens_out != null) && (
              <div className="mt-2 text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
                {run.tokens_in != null && `in: ${run.tokens_in.toLocaleString()} tokens`}
                {run.tokens_in != null && run.tokens_out != null && ' · '}
                {run.tokens_out != null && `out: ${run.tokens_out.toLocaleString()} tokens`}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderList = (items: AIRun[], emptyText: string) => (
    <div className="rounded-md border overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
      {items.length === 0 && (
        <div className="px-4 py-8 text-center text-[14px]" style={{ color: 'var(--color-muted)' }}>
          {emptyText}
        </div>
      )}
      {items.map(renderRun)}
    </div>
  )

  return (
    <div className="px-8 py-6">
      <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>Home / AI Runs</div>
      <div className="flex items-baseline justify-between mb-5">
        <h1 className="font-bold tracking-tight" style={{ fontSize: 36, color: 'var(--color-ink)' }}>
          AI Runs
        </h1>
        <div className="flex items-center gap-4 text-[13px] font-mono" style={{ color: 'var(--color-muted)' }}>
          <span>{doneCount} completed</span>
          <span>{recoveryRuns.length} in recovery</span>
          <span>total cost {fmtCost(totalCost)}</span>
        </div>
      </div>

      {err && (
        <div className="mb-4 p-3 rounded text-[14px]"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>{err}</div>
      )}

      <section className="mb-6">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <h2 className="text-[17px] font-semibold" style={{ color: 'var(--color-ink)' }}>Recovery Queue</h2>
            <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
              Tasks paused by AI limits stay here until you rerun them or use fallback handling.
            </p>
          </div>
          <span className="text-[12px] font-mono" style={{ color: 'var(--color-muted)' }}>
            {recoveryRuns.length} task{recoveryRuns.length === 1 ? '' : 's'}
          </span>
        </div>
        {renderList(recoveryRuns, 'No paused tasks. AI-limit interruptions will appear here.')}
      </section>

      <section>
        <div className="mb-2 flex items-end justify-between">
          <h2 className="text-[17px] font-semibold" style={{ color: 'var(--color-ink)' }}>Run History</h2>
          <span className="text-[12px] font-mono" style={{ color: 'var(--color-muted)' }}>{historyRuns.length} runs</span>
        </div>
        {renderList(historyRuns, runs.length === 0 && !err
          ? "No AI runs yet. Use Quill or trigger a workflow from a professor's page."
          : 'No other AI runs.')}
      </section>
    </div>
  )
}
