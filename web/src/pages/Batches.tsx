import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArchiveX,
  Building2,
  Calendar,
  CheckCircle2,
  Eye,
  FileText,
  Filter,
  Mail,
  Paperclip,
  RefreshCw,
  Save,
  Send,
  Settings as Cog,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { api, type BatchParams, type DocumentRow } from '@/lib/api'
import { apiUrl } from '@/lib/runtime'
import { formatCategory } from '@/lib/categories'
import { useConfirm } from '@/components/ConfirmDialog'
import { RedraftModal } from '@/components/RedraftModal'

type Batch = {
  batch_num: number
  size: number
  send_date: string
  send_weekday: string
  universities: string[]
  tier_mix: string[]
  category_mix: string[]
  drafts: BatchDraft[]
}

type BatchDraft = {
  draft_id: number
  professor_id: number
  professor_name?: string
  name?: string
  university: string
  tier: string
  category: string
  subject: string
  body?: string
  profile_url?: string
  word_count?: number
  email?: string
  attachment_doc_ids?: number[] | null
  sent_at?: string | null
  send_error?: string | null
}

type BatchData = {
  batches: Batch[]
  batch_size: number
  total_batches: number
  total_eligible: number
  max_per_university: number
  skipped: { draft_id: number; name: string; reasons: string[] }[]
}

const ALL_TIERS = ['T1', 'T2', 'T3']
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Batches() {
  const [params, setParams] = useState<BatchParams>({
    batch_size: 12,
    max_per_university: 2,
    start_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    weekdays: [1, 2, 3],
    tiers: [],
    categories: [],
    universities: [],
  })
  const [data, setData] = useState<BatchData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedBatchNum, setSelectedBatchNum] = useState<number | null>(1)
  const [busy, setBusy] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [previewDraft, setPreviewDraft] = useState<BatchDraft | null>(null)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [defaultCvDocId, setDefaultCvDocId] = useState<number | null>(null)
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [sendingBatch, setSendingBatch] = useState<number | null>(null)
  const [sendProgress, setSendProgress] = useState<Record<number, 'pending' | 'sending' | 'sent' | 'error'>>({})
  const [sendErrors, setSendErrors] = useState<Record<number, string>>({})
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const confirm = useConfirm()

  useEffect(() => {
    api.settings().then((s) => {
      setGmailConnected(!!s.gmail_connected)
      if (s.batch_defaults) setParams((p) => ({ ...p, ...s.batch_defaults }))
    }).catch(() => {})
    api.user().then((u) => setDefaultCvDocId(u.cv_doc_id || null)).catch(() => {})
    api.documents().then(setDocs).catch(() => {})
  }, [])

  const refresh = async (nextParams?: BatchParams) => {
    setBusy(true)
    try {
      const next = await api.batches(nextParams || params)
      setData(next)
      setErr(null)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { refresh(params) }, [JSON.stringify(params)]) // eslint-disable-line

  useEffect(() => {
    const onChange = () => refresh()
    window.addEventListener('quill:data-changed', onChange)
    return () => window.removeEventListener('quill:data-changed', onChange)
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!previewDraft || !data) return
    for (const b of data.batches) {
      const match = b.drafts.find((d) => d.draft_id === previewDraft.draft_id)
      if (match && (
        match.subject !== previewDraft.subject ||
        match.body !== previewDraft.body ||
        JSON.stringify(match.attachment_doc_ids) !== JSON.stringify(previewDraft.attachment_doc_ids)
      )) {
        setPreviewDraft(match)
        return
      }
    }
  }, [data]) // eslint-disable-line

  const universesAll = useMemo(() => {
    const s = new Set<string>()
    data?.batches.forEach((b) => b.drafts.forEach((d) => d.university && s.add(d.university)))
    return [...s].sort()
  }, [data])

  const catsAll = useMemo(() => {
    const s = new Set<string>()
    data?.batches.forEach((b) => b.drafts.forEach((d) => d.category && s.add(d.category)))
    return [...s].sort()
  }, [data])

  const selectedBatch = useMemo(() => {
    if (!data?.batches.length) return null
    return data.batches.find((b) => b.batch_num === selectedBatchNum) || data.batches[0]
  }, [data, selectedBatchNum])

  useEffect(() => {
    if (!data?.batches.length) return
    if (!data.batches.some((b) => b.batch_num === selectedBatchNum)) {
      setSelectedBatchNum(data.batches[0].batch_num)
    }
  }, [data, selectedBatchNum])

  const filterCount = (params.tiers?.length || 0) + (params.categories?.length || 0) + (params.universities?.length || 0)
  const selectedDrafts = selectedBatch?.drafts || []
  const selectedUnsent = selectedDrafts.filter((d) => !d.sent_at).length
  const selectedAttachments = selectedDrafts.filter((d) => {
    const ids = d.attachment_doc_ids
    return ids === null || ids === undefined || ids.length > 0
  }).length

  const skipDraft = async (id: number) => {
    await api.skipDraft(id)
    refresh()
  }

  const unskipDraft = async (id: number) => {
    await api.unskipDraft(id)
    refresh()
  }

  const markSent = async (b: Batch) => {
    const ok = await confirm({
      title: `Mark batch ${b.batch_num} as sent?`,
      detail: `${b.size} drafts · ${b.send_date}`,
      message: 'This advances each professor status to "sent" without sending email. Use Send batch to send through Gmail.',
      variant: 'primary',
      confirmLabel: 'Mark sent',
    })
    if (!ok) return
    await api.markBatchSent(b.drafts.map((d) => d.draft_id), b.send_date)
    refresh()
  }

  const sendBatch = async (b: Batch) => {
    const pending = b.drafts.filter((d) => !d.sent_at)
    if (!pending.length) {
      setToast({ ok: true, text: `Batch ${b.batch_num} has no unsent drafts.` })
      return
    }
    const ok = await confirm({
      title: `Send batch ${b.batch_num} via Gmail?`,
      detail: `${pending.length} email${pending.length === 1 ? '' : 's'} will be sent now.`,
      message: (
        <>This dispatches <strong>{pending.length}</strong> email{pending.length === 1 ? '' : 's'} through your connected Gmail account and advances each professor to sent. <strong>This action cannot be undone.</strong></>
      ) as any,
      variant: 'danger',
      confirmLabel: `Send all ${pending.length} now`,
    })
    if (!ok) return

    setSendingBatch(b.batch_num)
    const init: Record<number, 'pending' | 'sending' | 'sent' | 'error'> = {}
    pending.forEach((d) => { init[d.draft_id] = 'pending' })
    setSendProgress(init)
    setSendErrors({})
    setToast(null)

    let okCount = 0
    let failCount = 0
    for (const d of pending) {
      setSendProgress((prev) => ({ ...prev, [d.draft_id]: 'sending' }))
      try {
        await api.sendDraft(d.draft_id)
        setSendProgress((prev) => ({ ...prev, [d.draft_id]: 'sent' }))
        okCount++
      } catch (e: any) {
        setSendProgress((prev) => ({ ...prev, [d.draft_id]: 'error' }))
        setSendErrors((prev) => ({ ...prev, [d.draft_id]: e?.message || String(e) }))
        failCount++
      }
    }
    setSendingBatch(null)
    setToast({
      ok: failCount === 0,
      text: failCount === 0
        ? `Sent all ${okCount} emails in batch ${b.batch_num}.`
        : `Batch ${b.batch_num}: ${okCount} sent, ${failCount} failed.`,
    })
    setTimeout(() => setToast(null), 12000)
    refresh()
  }

  const patchDraft = async (draftId: number, patch: { subject?: string; body?: string; attachment_doc_ids?: number[] | null }) => {
    const r = await fetch(apiUrl(`/api/drafts/${draftId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} · /api/drafts/${draftId}`)
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        batches: prev.batches.map((b) => ({
          ...b,
          drafts: b.drafts.map((d) => d.draft_id === draftId ? { ...d, ...patch } : d),
        })),
      }
    })
    setPreviewDraft((cur) => cur && cur.draft_id === draftId ? { ...cur, ...patch } : cur)
    window.dispatchEvent(new CustomEvent('quill:data-changed'))
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden px-4 py-4 sm:px-5"
      style={{
        boxSizing: 'border-box',
        backgroundColor: 'var(--color-paper)',
        backgroundImage:
          'linear-gradient(rgba(28,34,48,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.055) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div
        className="w-[320px] max-w-full min-w-0 overflow-hidden sm:w-full"
        style={{ boxSizing: 'border-box' }}
      >
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-muted)' }}>
              Outreach / Batches
            </div>
            <h1 className="mt-1 font-bold leading-tight tracking-tight" style={{ fontSize: 31, color: 'var(--color-ink)' }}>
              Send batch planner
            </h1>
            <p className="mt-1 max-w-full break-words text-[13px] leading-5 md:max-w-2xl" style={{ color: 'var(--color-muted)' }}>
              Review safe daily send groups before any email leaves Gmail.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {gmailConnected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                style={{ background: 'var(--color-green-50)', borderColor: 'var(--color-green-200)', color: 'var(--color-green-700)' }}>
                <CheckCircle2 size={12} /> Gmail connected
              </span>
            ) : (
              <a href="/settings" className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium hover:underline"
                style={{ background: 'var(--color-amber-50)', borderColor: 'var(--color-amber-200)', color: 'var(--color-amber-700)' }}>
                <AlertCircle size={12} /> Connect Gmail
              </a>
            )}
            <button onClick={() => refresh()} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium disabled:opacity-60"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}>
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              Recompute
            </button>
          </div>
        </div>

        {toast && (
          <div className="mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]"
            style={{
              background: toast.ok ? 'var(--color-green-50)' : 'var(--color-rose-50)',
              borderColor: toast.ok ? 'var(--color-green-200)' : 'var(--color-rose-200)',
              color: toast.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)',
            }}>
            {toast.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
            <span>{toast.text}</span>
          </div>
        )}

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
          <KpiCard icon={<Calendar size={15} />} label="Planned batches" value={data ? data.total_batches : '...'}
            detail={data ? `${data.total_eligible} eligible drafts` : 'Loading'} />
          <KpiCard icon={<Mail size={15} />} label="Selected queue" value={selectedBatch ? selectedBatch.size : 0}
            detail={selectedBatch ? `${selectedUnsent} unsent emails` : 'No batch'} />
          <KpiCard icon={<Building2 size={15} />} label="University spread" value={selectedBatch?.universities.length || 0}
            detail={`Max ${params.max_per_university || 0} per university`} />
          <KpiCard icon={<ArchiveX size={15} />} label="Excluded drafts" value={data?.skipped?.length || 0}
            detail={filterCount ? `${filterCount} active filters` : 'No filters'} />
        </div>

        <div className="mb-3 min-w-0 overflow-hidden rounded-md border p-3"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md"
                style={{ background: 'var(--color-brand-50)', color: 'var(--color-brand-700)' }}>
                <SlidersHorizontal size={15} />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>Planning rules</div>
                <div className="break-words text-[12px]" style={{ color: 'var(--color-muted)' }}>
                  Department/lab separation, university cap, weekday schedule.
                </div>
              </div>
            </div>
            <button onClick={() => setShowFilters(!showFilters)}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px]"
              style={{
                background: showFilters ? 'var(--color-brand-50)' : 'var(--color-paper-2)',
                borderColor: showFilters ? 'var(--color-brand-200)' : 'var(--color-line)',
                color: 'var(--color-ink-soft)',
              }}>
              <Filter size={13} />
              Filters {filterCount > 0 ? `(${filterCount})` : ''}
            </button>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_170px_1.8fr]">
            <NumberField label="Batch size" value={params.batch_size!}
              min={1} max={30}
              onChange={(v) => setParams({ ...params, batch_size: v })} />
            <NumberField label="Max per university" value={params.max_per_university!}
              min={1} max={10}
              onChange={(v) => setParams({ ...params, max_per_university: v })} />
            <div>
              <Lbl>Start date</Lbl>
              <input type="date" value={params.start_date}
                onChange={(e) => setParams({ ...params, start_date: e.target.value })}
                className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
                style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }} />
            </div>
            <div>
              <Lbl>Send days</Lbl>
              <div className="flex flex-wrap items-center gap-1">
                {WEEKDAY_LABELS.map((d, i) => {
                  const on = params.weekdays!.includes(i)
                  return (
                    <button key={i}
                      onClick={() => {
                        const next = on ? params.weekdays!.filter((x) => x !== i)
                          : [...params.weekdays!, i].sort()
                        setParams({ ...params, weekdays: next })
                      }}
                      className="h-8 min-w-9 rounded-md border px-2 text-[12px] transition-colors"
                      style={{
                        background: on ? 'var(--color-brand-50)' : 'var(--color-paper-2)',
                        borderColor: on ? 'var(--color-brand-500)' : 'var(--color-line)',
                        color: on ? 'var(--color-brand-700)' : 'var(--color-muted)',
                        fontWeight: on ? 600 : 400,
                      }}>
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {showFilters && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border p-3"
              style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
              <ChipRow label="Tier" all={ALL_TIERS} value={params.tiers || []}
                onChange={(v) => setParams({ ...params, tiers: v })} />
              <ChipRow label="Category" all={catsAll} value={params.categories || []}
                onChange={(v) => setParams({ ...params, categories: v })}
                colorVar={(v) => `var(--color-cat-${v})`} />
              {universesAll.length > 0 && (
                <ChipRow label="University" all={universesAll} value={params.universities || []}
                  onChange={(v) => setParams({ ...params, universities: v })} />
              )}
            </div>
          )}
        </div>

        {err && (
          <div className="mb-3 rounded-md border p-3 text-[13px]"
            style={{ background: 'var(--color-rose-50)', borderColor: 'var(--color-rose-200)', color: 'var(--color-rose-700)' }}>
            {err}
          </div>
        )}

        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="min-w-0 overflow-hidden rounded-md border"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            <div className="border-b px-3 py-2.5" style={{ borderColor: 'var(--color-line)' }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>Batch queue</div>
                  <div className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
                    {data ? `${data.total_batches} planned send day${data.total_batches === 1 ? '' : 's'}` : 'Loading batches'}
                  </div>
                </div>
                <ShieldCheck size={16} style={{ color: 'var(--color-green-700)' }} />
              </div>
            </div>
            <div className="max-h-[620px] overflow-y-auto p-2">
              {data?.batches.map((b) => {
                const selected = selectedBatch?.batch_num === b.batch_num
                const unsent = b.drafts.filter((d) => !d.sent_at).length
                return (
                  <button key={b.batch_num} onClick={() => setSelectedBatchNum(b.batch_num)}
                    className="mb-2 w-full rounded-md border p-3 text-left transition-colors last:mb-0"
                    style={{
                      background: selected ? 'var(--color-brand-50)' : 'var(--color-white)',
                      borderColor: selected ? 'var(--color-brand-300)' : 'var(--color-line)',
                    }}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[11px]" style={{ color: 'var(--color-muted)' }}>Batch #{b.batch_num}</div>
                        <div className="mt-0.5 text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>
                          {b.send_weekday}, {b.send_date}
                        </div>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: unsent ? 'var(--color-amber-50)' : 'var(--color-green-50)',
                          color: unsent ? 'var(--color-amber-700)' : 'var(--color-green-700)',
                        }}>
                        {unsent ? `${unsent} unsent` : 'sent'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                      <span>{b.size} drafts</span>
                      <span>·</span>
                      <span>{b.universities.length} universities</span>
                      <span>·</span>
                      <span>{b.tier_mix.join('/') || 'No tier'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {b.category_mix.slice(0, 4).map((c) => (
                        <MiniPill key={c} color={`var(--color-cat-${c})`}>{formatCategory(c)}</MiniPill>
                      ))}
                      {b.category_mix.length > 4 && <MiniPill>+{b.category_mix.length - 4}</MiniPill>}
                    </div>
                  </button>
                )
              })}
              {data?.batches.length === 0 && (
                <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--color-muted)' }}>
                  No eligible drafts after current filters.
                </div>
              )}
              {!data && (
                <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--color-muted)' }}>
                  Loading batch plan...
                </div>
              )}
            </div>
          </div>

          <div className="max-w-full min-w-0 overflow-hidden rounded-md border"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            {selectedBatch ? (
              <>
                <div className="border-b p-3" style={{ borderColor: 'var(--color-line)' }}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px]" style={{ color: 'var(--color-muted)' }}>Batch #{selectedBatch.batch_num}</span>
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                          style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>
                          <Calendar size={10} /> {selectedBatch.send_weekday}, {selectedBatch.send_date}
                        </span>
                      </div>
                      <div className="mt-1 text-[17px] font-semibold leading-tight" style={{ color: 'var(--color-ink)' }}>
                        {selectedBatch.size} emails across {selectedBatch.universities.length} universities
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {selectedBatch.category_mix.map((c) => (
                          <MiniPill key={c} color={`var(--color-cat-${c})`}>{formatCategory(c)}</MiniPill>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => sendBatch(selectedBatch)}
                        disabled={!gmailConnected || sendingBatch === selectedBatch.batch_num || selectedUnsent === 0}
                        title={!gmailConnected ? 'Connect Gmail in Settings first' : `Send ${selectedUnsent} unsent emails immediately`}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                        style={{
                          background: 'linear-gradient(135deg, #dc2626, #991b1b)',
                          boxShadow: '0 6px 16px -6px rgba(220,38,38,0.55)',
                        }}>
                        <Send size={13} />
                        {sendingBatch === selectedBatch.batch_num ? 'Sending...' : 'Send batch'}
                      </button>
                      <button onClick={() => markSent(selectedBatch)}
                        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium"
                        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
                        <CheckCircle2 size={13} />
                        Mark sent only
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <StatLabel label="Unsent" value={selectedUnsent} />
                    <StatLabel label="With attachment" value={selectedAttachments} />
                    <StatLabel label="Tiers" value={selectedBatch.tier_mix.join(', ') || '-'} />
                    <StatLabel label="Batch cap" value={params.batch_size || '-'} />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-[13px]">
                    <thead>
                      <tr className="border-b text-left" style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
                        <th className="px-3 py-2 font-medium">Professor</th>
                        <th className="px-3 py-2 font-medium">University</th>
                        <th className="px-3 py-2 font-medium">Area</th>
                        <th className="px-3 py-2 font-medium">Subject</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBatch.drafts.map((d) => (
                        <tr key={d.draft_id} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-line)' }}>
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px]"
                                style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>{d.tier}</span>
                              <div className="min-w-0">
                                {d.profile_url ? (
                                  <a href={d.profile_url} target="_blank" rel="noreferrer"
                                    className="font-medium hover:underline"
                                    style={{ color: 'var(--color-brand-700)' }}>
                                    {d.professor_name || d.name}
                                  </a>
                                ) : (
                                  <span className="font-medium" style={{ color: 'var(--color-ink)' }}>
                                    {d.professor_name || d.name}
                                  </span>
                                )}
                                <div className="font-mono text-[11px]" style={{ color: 'var(--color-muted)' }}>
                                  {d.email || 'No email'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top" style={{ color: 'var(--color-muted)' }}>{d.university}</td>
                          <td className="px-3 py-2 align-top">
                            <span className="inline-flex items-center gap-1 text-[12px]">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--color-cat-${d.category})` }} />
                              <span style={{ color: 'var(--color-muted)' }}>{formatCategory(d.category)}</span>
                            </span>
                          </td>
                          <td className="max-w-[260px] px-3 py-2 align-top">
                            <button onClick={() => setPreviewDraft(d)}
                              className="line-clamp-2 text-left font-medium hover:underline"
                              style={{ color: 'var(--color-ink-soft)' }}
                              title="Open email editor">
                              {d.subject}
                            </button>
                            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                              {d.word_count || 0} words
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <SendStatus state={sendProgress[d.draft_id]} sent={!!d.sent_at} error={sendErrors[d.draft_id] || d.send_error} />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => setPreviewDraft(d)}
                                title="Preview and edit"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
                                style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
                                <Eye size={13} />
                              </button>
                              <button onClick={() => skipDraft(d.draft_id)}
                                title="Skip this draft"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
                                style={{ background: 'var(--color-rose-50)', borderColor: 'var(--color-rose-200)', color: 'var(--color-rose-700)' }}>
                                <X size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t px-3 py-2 text-[12px] leading-5" style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
                  <ShieldCheck size={13} className="mr-1 inline" />
                  No duplicate department/lab and no more than {params.max_per_university} professor{params.max_per_university === 1 ? '' : 's'} per university.
                </div>
              </>
            ) : (
              <div className="px-4 py-12 text-center text-[13px]" style={{ color: 'var(--color-muted)' }}>
                No batch is available with the current rules.
              </div>
            )}
          </div>
        </div>

        {data && data.skipped && data.skipped.length > 0 && (
          <details className="mt-3 rounded-md border px-3 py-2.5"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold"
              style={{ color: 'var(--color-ink-soft)' }}>
              <AlertCircle size={14} style={{ color: 'var(--color-amber-700)' }} />
              {data.skipped.length} excluded draft{data.skipped.length === 1 ? '' : 's'}
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
              {data.skipped.map((sk) => (
                <div key={sk.draft_id} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px]"
                  style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" style={{ color: 'var(--color-ink-soft)' }}>{sk.name}</div>
                    <div className="truncate" style={{ color: 'var(--color-muted)' }}>{sk.reasons.join(', ')}</div>
                  </div>
                  {sk.reasons.includes('skipped by user') && (
                    <button onClick={() => unskipDraft(sk.draft_id)}
                      className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium"
                      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-brand-700)' }}>
                      Unskip
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        <p className="mt-3 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-muted)' }}>
          <Cog size={12} /> Save default batch rules in <a href="/settings" className="hover:underline" style={{ color: 'var(--color-brand-600)' }}>Settings</a>.
        </p>

        {previewDraft && (
          <DraftEditorModal
            draft={previewDraft}
            docs={docs}
            defaultCvDocId={defaultCvDocId}
            onClose={() => setPreviewDraft(null)}
            onPatch={(patch) => patchDraft(previewDraft.draft_id, patch)}
            onUpload={async (file) => {
              const r = await api.uploadDraftAttachment(previewDraft.draft_id, file)
              api.documents().then(setDocs).catch(() => {})
              setData((prev) => prev && {
                ...prev,
                batches: prev.batches.map((b) => ({
                  ...b,
                  drafts: b.drafts.map((d) => d.draft_id === previewDraft.draft_id
                    ? { ...d, attachment_doc_ids: r.attachment_doc_ids } : d),
                })),
              })
              setPreviewDraft((cur) => cur && cur.draft_id === previewDraft.draft_id
                ? { ...cur, attachment_doc_ids: r.attachment_doc_ids } : cur)
              return r.uploaded_document
            }}
            onSend={async () => {
              if (!gmailConnected) {
                setToast({ ok: false, text: 'Connect Gmail in Settings first.' })
                return
              }
              const ok = await confirm({
                title: 'Send this email now?',
                detail: `${previewDraft.professor_name || previewDraft.name} · ${previewDraft.email || 'no email'}`,
                message: (
                  <>Dispatches via your connected Gmail immediately, advances the professor status to sent, and attaches the files listed in this modal. <strong>This action cannot be undone.</strong></>
                ) as any,
                variant: 'danger',
                confirmLabel: 'Send now',
              })
              if (!ok) return
              try {
                const r = await api.sendDraft(previewDraft.draft_id)
                setToast({ ok: true, text: `Sent to ${r.to} at ${new Date(r.sent_at).toLocaleTimeString()}` })
                setPreviewDraft(null)
                refresh()
              } catch (e: any) {
                setToast({ ok: false, text: e?.message || String(e) })
              }
            }}
            gmailConnected={gmailConnected}
          />
        )}
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, detail }: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  detail: string
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border p-3" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
        <span style={{ color: 'var(--color-brand-700)' }}>{icon}</span>
      </div>
      <div className="text-[24px] font-bold leading-none" style={{ color: 'var(--color-ink)' }}>{value}</div>
      <div className="mt-1 truncate text-[12px]" style={{ color: 'var(--color-muted)' }}>{detail}</div>
    </div>
  )
}

function StatLabel({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border px-2.5 py-2" style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
      <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>{value}</div>
    </div>
  )
}

function MiniPill({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
      style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  )
}

function NumberField({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="min-w-0">
      <Lbl>{label}</Lbl>
      <div className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border px-2"
        style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
        <input type="range" min={min} max={max} value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="w-full min-w-0 flex-1" />
        <span className="w-7 text-right font-mono text-[13px]" style={{ color: 'var(--color-ink)' }}>{value}</span>
      </div>
    </div>
  )
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
      {children}
    </div>
  )
}

function ChipRow({ label, all, value, onChange, colorVar }: {
  label: string
  all: string[]
  value: string[]
  onChange: (v: string[]) => void
  colorVar?: (v: string) => string
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="w-20 text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</span>
      {all.map((v) => {
        const on = value.includes(v)
        return (
          <button key={v}
            onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
            className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] transition-colors"
            style={{
              background: on ? 'var(--color-white)' : 'var(--color-paper)',
              borderColor: on ? 'var(--color-line-strong)' : 'var(--color-line)',
              color: 'var(--color-ink-soft)',
              fontWeight: on ? 600 : 400,
            }}>
            {colorVar && <span className="h-2 w-2 rounded-full" style={{ background: colorVar(v) }} />}
            {colorVar ? formatCategory(v) : v}
          </button>
        )
      })}
      {value.length > 0 && (
        <button onClick={() => onChange([])}
          className="ml-1 text-[11px] underline" style={{ color: 'var(--color-muted)' }}>
          clear
        </button>
      )}
    </div>
  )
}

function DraftEditorModal({ draft, docs, defaultCvDocId, onClose, onPatch, onSend, onUpload, gmailConnected }: {
  draft: BatchDraft
  docs: DocumentRow[]
  defaultCvDocId: number | null
  onClose: () => void
  onPatch: (patch: { subject?: string; body?: string; attachment_doc_ids?: number[] | null }) => Promise<void>
  onSend: () => Promise<void>
  onUpload: (file: File) => Promise<DocumentRow>
  gmailConnected: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [uploading, setUploading] = useState(false)
  const [subject, setSubject] = useState(draft.subject || '')
  const [body, setBody] = useState(draft.body || '')
  const [adding, setAdding] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [showRedraft, setShowRedraft] = useState(false)
  const [redraftToast, setRedraftToast] = useState<{ ok: boolean; text: string } | null>(null)

  const resolvedIds: number[] = draft.attachment_doc_ids !== undefined && draft.attachment_doc_ids !== null
    ? draft.attachment_doc_ids
    : (defaultCvDocId ? [defaultCvDocId] : [])
  const usingDefault = draft.attachment_doc_ids === undefined || draft.attachment_doc_ids === null
  const attachedDocs = resolvedIds.map((id) => docs.find((d) => d.id === id)).filter(Boolean) as DocumentRow[]
  const docOptions = docs.filter((d) => !resolvedIds.includes(d.id))

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [body])

  useEffect(() => {
    setSubject(draft.subject || '')
    setBody(draft.body || '')
  }, [draft.draft_id])

  const subjectDirty = subject !== (draft.subject || '')
  const bodyDirty = body !== (draft.body || '')
  const dirty = subjectDirty || bodyDirty

  const saveText = async () => {
    const patch: { subject?: string; body?: string } = {}
    if (subjectDirty) patch.subject = subject
    if (bodyDirty) patch.body = body
    if (!Object.keys(patch).length) return
    await onPatch(patch)
    setSavedAt(Date.now())
  }

  const addAttachment = async (docId: number) => {
    await onPatch({ attachment_doc_ids: [...resolvedIds, docId] })
    setAdding(false)
  }

  const removeAttachment = async (docId: number) => {
    await onPatch({ attachment_doc_ids: resolvedIds.filter((id) => id !== docId) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="my-auto flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg shadow-xl"
        style={{ background: 'var(--color-white)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3" style={{ borderColor: 'var(--color-line)' }}>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>To</div>
            <div className="text-[14px] font-medium" style={{ color: 'var(--color-ink)' }}>
              {draft.professor_name || draft.name}
              {draft.tier && (
                <span className="ml-2 rounded px-1.5 py-0.5 align-middle font-mono text-[10px]"
                  style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)', border: '1px solid var(--color-line)' }}>
                  {draft.tier}
                </span>
              )}
              <span className="ml-2 font-normal" style={{ color: 'var(--color-muted)' }}>· {draft.university}</span>
              {draft.email && (
                <span className="ml-2 font-mono text-[12px] font-normal" style={{ color: 'var(--color-muted)' }}>
                  &lt;{draft.email}&gt;
                </span>
              )}
            </div>
            {draft.sent_at && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                style={{ background: 'var(--color-green-50)', color: 'var(--color-green-700)' }}>
                <CheckCircle2 size={10} /> Sent {new Date(draft.sent_at).toLocaleString()}
              </div>
            )}
            {draft.send_error && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
                <AlertCircle size={10} /> {draft.send_error.slice(0, 100)}
              </div>
            )}
          </div>
          <button onClick={onClose}
            className="rounded p-1 hover:bg-[color:var(--color-paper-2)]"
            style={{ color: 'var(--color-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3">
            <Lbl>Subject</Lbl>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              onBlur={saveText}
              className="w-full rounded-md border px-3 py-2 text-[15px] font-semibold outline-none"
              style={{ background: 'var(--color-white)', borderColor: subjectDirty ? 'var(--color-brand-400)' : 'var(--color-line)' }} />
          </div>

          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              <span>Body</span>
              <span className="font-mono normal-case">{body.split(/\s+/).filter(Boolean).length} words</span>
            </div>
            <textarea ref={bodyRef} value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={saveText}
              className="w-full rounded-md border px-3 py-2 font-sans text-[14px] leading-relaxed outline-none"
              style={{
                background: 'var(--color-white)',
                borderColor: bodyDirty ? 'var(--color-brand-400)' : 'var(--color-line)',
                minHeight: 240,
                resize: 'none',
                overflow: 'hidden',
              }} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              <span className="inline-flex items-center gap-1.5">
                <Paperclip size={11} /> Attachments {usingDefault && '(default)'}
              </span>
              {!usingDefault && (
                <button onClick={() => onPatch({ attachment_doc_ids: null })}
                  className="text-[10px] underline normal-case" style={{ color: 'var(--color-muted)' }}>
                  Reset to default CV
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {attachedDocs.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]"
                  style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
                  <FileText size={11} style={{ color: 'var(--color-muted)' }} />
                  <span style={{ color: 'var(--color-ink-soft)' }}>{d.title}</span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
                    {(d.size_bytes / 1024).toFixed(0)}kB
                  </span>
                  <button onClick={() => removeAttachment(d.id)} title="Remove" style={{ color: 'var(--color-muted)' }}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              {attachedDocs.length === 0 && (
                <span className="text-[12px] italic" style={{ color: 'var(--color-muted-2)' }}>
                  No files attached.
                </span>
              )}
              {!adding && docOptions.length > 0 && (
                <button onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-brand-700)' }}>
                  <Paperclip size={11} /> Pick from Documents
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-brand-500)' }}>
                {uploading ? <RefreshCw size={11} className="animate-spin" /> : <Paperclip size={11} />}
                {uploading ? 'Uploading...' : 'Upload new file'}
              </button>
              <input ref={fileInputRef} type="file" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  e.target.value = ''
                  setUploading(true)
                  try { await onUpload(f) }
                  finally { setUploading(false) }
                }} />
              {adding && (
                <select autoFocus onBlur={() => setAdding(false)}
                  onChange={(e) => e.target.value && addAttachment(parseInt(e.target.value))}
                  className="rounded border px-2 py-1 text-[12px]"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
                  <option value="">Pick from Documents</option>
                  {docOptions.map((d) => (
                    <option key={d.id} value={d.id}>[{d.kind}] {d.title}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {dirty && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-amber-700)' }}>
              <AlertCircle size={10} /> Unsaved edits.
            </div>
          )}
          {savedAt > 0 && Date.now() - savedAt < 2500 && !dirty && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-green-700)' }}>
              <CheckCircle2 size={10} /> Saved
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}>
          <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            {dirty ? 'Save required before sending.' : draft.sent_at ? 'Already sent.' : gmailConnected ? 'Ready to send.' : 'Connect Gmail in Settings first.'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <button onClick={saveText}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]"
                style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
                <Save size={12} /> Save
              </button>
            )}
            {!draft.sent_at && (
              <button onClick={() => setShowRedraft(true)}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]"
                style={{
                  background: 'color-mix(in srgb, var(--color-cat-cv) 8%, var(--color-white))',
                  borderColor: 'color-mix(in srgb, var(--color-cat-cv) 40%, var(--color-line))',
                  color: 'color-mix(in srgb, var(--color-cat-cv) 70%, var(--color-ink))',
                }}>
                <Sparkles size={12} /> Redraft with Quill
              </button>
            )}
            <button onClick={onSend}
              disabled={!gmailConnected || !!draft.sent_at || dirty || !draft.email}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)', boxShadow: '0 6px 16px -6px rgba(220,38,38,0.55)' }}>
              <Send size={12} /> Send via Gmail
            </button>
          </div>
        </div>
      </div>

      {redraftToast && (
        <div className="fixed right-6 top-6 z-[70] max-w-md rounded-lg px-4 py-2 text-[13px] shadow-lg"
          style={{
            background: redraftToast.ok ? 'var(--color-green-50)' : 'var(--color-rose-50)',
            color: redraftToast.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)',
          }}
          onClick={() => setRedraftToast(null)}>
          {redraftToast.text}
        </div>
      )}

      {showRedraft && (
        <RedraftModal
          professorId={draft.professor_id}
          professorName={draft.professor_name || draft.name}
          onClose={() => setShowRedraft(false)}
          onDone={(ok, msg) => {
            setRedraftToast({ ok, text: msg })
            setTimeout(() => setRedraftToast(null), 10000)
          }}
        />
      )}
    </div>
  )
}

function SendStatus({ state, sent, error }: {
  state?: 'pending' | 'sending' | 'sent' | 'error'
  sent: boolean
  error?: string | null
}) {
  if (state === 'sending') return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-brand-700)' }}>
    <RefreshCw size={10} className="animate-spin" /> Sending
  </span>
  if (state === 'sent' || sent) return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-green-700)' }}>
    <CheckCircle2 size={10} /> Sent
  </span>
  if (state === 'error' || error) return <span title={error || ''} className="inline-flex cursor-help items-center gap-1 text-[11px]" style={{ color: 'var(--color-rose-700)' }}>
    <AlertCircle size={10} /> Failed
  </span>
  if (state === 'pending') return <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>queued</span>
  return <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>ready</span>
}
