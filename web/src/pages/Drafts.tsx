import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronRight,
  FileUp,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type Draft, type Professor } from '@/lib/api'
import { apiUrl } from '@/lib/runtime'
import { formatCategory } from '@/lib/categories'
import { useConfirm } from '@/components/ConfirmDialog'
import { RedraftModal } from '@/components/RedraftModal'

type IconComponent = ComponentType<{ size?: number; className?: string; style?: CSSProperties }>

const DRAFT_INSTRUCTIONS_STORAGE_KEY = 'quill.draftInstructions'

const DRAFT_INSTRUCTION_TEMPLATES = [
  {
    label: 'Concise postdoc',
    text:
      'Use a concise postdoc inquiry format: 180-220 words, four short paragraphs, professional tone, one professor paper hook, one paragraph on my strongest publications, one concrete research bridge, and a simple request to discuss opportunities.',
  },
  {
    label: 'Warm but direct',
    text:
      'Write in a warm but direct academic tone. Avoid sounding generic. Use one specific detail from the professor research, keep the opening personal, and make the fit between my work and their lab clear without overclaiming.',
  },
  {
    label: 'Application style',
    text:
      'Write like a formal application email. Follow any contact instructions from the professor page exactly. Mention attached CV. Keep the email structured, factual, and easy to scan.',
  },
]

export function Drafts() {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [draftTargets, setDraftTargets] = useState<Professor[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [showSkipped, setShowSkipped] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [sendingId, setSendingId] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [generatingDrafts, setGeneratingDrafts] = useState(false)
  const [draftBatchSize, setDraftBatchSize] = useState(5)
  const [draftInstructions, setDraftInstructions] = useState('')
  const [redraftFor, setRedraftFor] = useState<Draft | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const reloadSeqRef = useRef(0)
  const confirm = useConfirm()

  const reload = async () => {
    const requestId = reloadSeqRef.current + 1
    reloadSeqRef.current = requestId
    setRefreshing(true)
    const settingsPromise = api.settings().catch(() => null)
    try {
      const rows = await api.drafts()
      if (requestId !== reloadSeqRef.current) return
      setDrafts(rows)
      setErr(null)

      const activeDraftProfessorIds = new Set(rows.filter((d) => !d.sent_at).map((d) => d.professor_id))
      try {
        const professors = await api.professors({ status: 'drafting' })
        if (requestId !== reloadSeqRef.current) return
        setDraftTargets(professors.filter((p) => (
          !p.is_suggested
          && !p.dismissed_at
          && !activeDraftProfessorIds.has(p.id)
        )))
      } catch (e) {
        setDraftTargets([])
        setErr(`Drafts loaded, but the draft creation queue could not refresh. ${errorMessage(e)}`)
      }
    } catch (e) {
      if (requestId !== reloadSeqRef.current) return
      setErr(errorMessage(e))
    } finally {
      const settings = await settingsPromise
      if (requestId === reloadSeqRef.current) {
        if (settings) setGmailConnected(!!settings.gmail_connected)
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_INSTRUCTIONS_STORAGE_KEY)
      if (saved) setDraftInstructions(saved)
    } catch {
      // Local storage is optional; drafting still works without persistence.
    }
    reload()
    window.addEventListener('quill:data-changed', reload)
    return () => window.removeEventListener('quill:data-changed', reload)
  }, [])

  useEffect(() => {
    try {
      const value = draftInstructions.trim()
      if (value) window.localStorage.setItem(DRAFT_INSTRUCTIONS_STORAGE_KEY, draftInstructions)
      else window.localStorage.removeItem(DRAFT_INSTRUCTIONS_STORAGE_KEY)
    } catch {
      // Ignore persistence failures; the textarea state is still sent with the run.
    }
  }, [draftInstructions])

  const activeDrafts = useMemo(() => drafts.filter((d) => !d.sent_at), [drafts])
  const categories = useMemo(() => {
    const s = new Set<string>()
    for (const d of activeDrafts) if (d.professor_research_category) s.add(d.professor_research_category)
    return [...s].sort()
  }, [activeDrafts])

  const filtered = useMemo(() => activeDrafts.filter((d) => {
    if (!showSkipped && d.skipped_at) return false
    if (category && d.professor_research_category !== category) return false
    if (!q) return true
    const lq = q.toLowerCase()
    return (
      (d.professor_name || '').toLowerCase().includes(lq)
      || (d.professor_university || '').toLowerCase().includes(lq)
      || (d.subject || '').toLowerCase().includes(lq)
      || (d.body || '').toLowerCase().includes(lq)
    )
  }), [activeDrafts, category, q, showSkipped])

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !filtered.some((d) => d.id === selectedId)) setSelectedId(filtered[0].id)
  }, [filtered, selectedId])

  const selected = filtered.find((d) => d.id === selectedId) ?? filtered[0] ?? null

  const metrics = useMemo(() => {
    const skipped = activeDrafts.filter((d) => d.skipped_at).length
    const sendable = activeDrafts.filter((d) => !d.skipped_at && !!d.professor_email && d.professor_status === 'drafting').length
    const attached = activeDrafts.filter((d) => (d.attachment_doc_ids?.length ?? 0) > 0).length
    return { skipped, sendable, attached }
  }, [activeDrafts])

  const setToastTimed = (next: { ok: boolean; text: string }) => {
    setToast(next)
    setTimeout(() => setToast(null), 10000)
  }

  const patchDraftInState = (updated: Draft) => {
    setDrafts((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)))
  }

  const createDraftBatch = async () => {
    const batch = draftTargets.slice(0, draftBatchSize)
    if (batch.length === 0) return
    const instructionText = draftInstructions.trim()
    const ok = await confirm({
      title: `Create ${batch.length} draft${batch.length === 1 ? '' : 's'} with Quill?`,
      detail: `${draftTargets.length} accepted professor${draftTargets.length === 1 ? '' : 's'} need drafts`,
      message: instructionText
        ? 'Quill will start background AI runs and apply your email instructions/template to each draft.'
        : 'Quill will start background AI runs for the next batch. Drafts appear here as each run finishes.',
      variant: 'primary',
      confirmLabel: 'Create drafts',
    })
    if (!ok) return
    setGeneratingDrafts(true)
    try {
      const result = await api.generateDrafts({
        professor_ids: batch.map((p) => p.id),
        limit: batch.length,
        user_instructions: instructionText || undefined,
      })
      setToastTimed({
        ok: true,
        text: result.started
          ? `Started ${result.started} draft generation run${result.started === 1 ? '' : 's'}.`
          : 'No eligible professors need drafts.',
      })
      reload()
    } catch (e: any) {
      setToastTimed({ ok: false, text: e?.message || String(e) })
    } finally {
      setGeneratingDrafts(false)
    }
  }

  const markSent = async (draft: Draft) => {
    const ok = await confirm({
      title: 'Mark as sent?',
      detail: draft.professor_name,
      message: 'This advances the professor status without actually sending an email. Use Gmail Send if you want to dispatch the message.',
      variant: 'primary',
      confirmLabel: 'Mark sent',
    })
    if (!ok) return
    setBusyAction(`mark-${draft.id}`)
    try {
      await fetch(apiUrl(`/api/drafts/${draft.id}/mark_sent`), { method: 'POST' })
      setToastTimed({ ok: true, text: `Marked ${draft.professor_name || 'draft'} as sent.` })
      reload()
    } catch (e) {
      setToastTimed({ ok: false, text: String(e) })
    } finally {
      setBusyAction(null)
    }
  }

  const sendViaGmail = async (draft: Draft) => {
    const ok = await confirm({
      title: 'Send this email via Gmail?',
      detail: `${draft.professor_name} - ${draft.professor_email || 'no email'}`,
      message: (
        <>
          This will dispatch the email right now through your Gmail account and advance the professor status to sent.
          This action cannot be undone.
        </>
      ),
      variant: 'danger',
      confirmLabel: 'Send now',
    })
    if (!ok) return
    setSendingId(draft.id)
    setToast(null)
    try {
      const r = await api.sendDraft(draft.id)
      setToastTimed({ ok: true, text: `Sent to ${r.to} at ${new Date(r.sent_at).toLocaleTimeString()}` })
      reload()
    } catch (e: any) {
      setToastTimed({ ok: false, text: e?.message || String(e) })
    } finally {
      setSendingId(null)
    }
  }

  const toggleSkip = async (draft: Draft) => {
    const skipping = !draft.skipped_at
    setBusyAction(`skip-${draft.id}`)
    try {
      if (skipping) await api.skipDraft(draft.id)
      else await api.unskipDraft(draft.id)
      setToastTimed({ ok: true, text: skipping ? 'Draft skipped from batches.' : 'Draft restored to batches.' })
      reload()
    } catch (e: any) {
      setToastTimed({ ok: false, text: e?.message || String(e) })
    } finally {
      setBusyAction(null)
    }
  }

  const deleteDraft = async (draft: Draft) => {
    const ok = await confirm({
      title: 'Delete draft?',
      detail: draft.professor_name || draft.subject,
      message: 'This removes the local email draft. The professor record stays in the pipeline.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    setBusyAction(`delete-${draft.id}`)
    try {
      await api.deleteDraft(draft.id)
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
      setToastTimed({ ok: true, text: 'Draft deleted.' })
    } catch (e: any) {
      setToastTimed({ ok: false, text: e?.message || String(e) })
    } finally {
      setBusyAction(null)
    }
  }

  const uploadAttachment = async (draft: Draft, file: File) => {
    setBusyAction(`upload-${draft.id}`)
    try {
      const result = await api.uploadDraftAttachment(draft.id, file)
      setDrafts((prev) => prev.map((d) => (
        d.id === draft.id ? { ...d, attachment_doc_ids: result.attachment_doc_ids } : d
      )))
      setToastTimed({ ok: true, text: `Attached ${result.uploaded_document.filename || file.name}.` })
    } catch (e: any) {
      setToastTimed({ ok: false, text: e?.message || String(e) })
    } finally {
      setBusyAction(null)
    }
  }

  const clearFilters = () => {
    setQ('')
    setCategory('')
    setShowSkipped(false)
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden px-5 py-4"
      style={{
        backgroundColor: 'var(--color-paper)',
        backgroundImage:
          'linear-gradient(rgba(28,34,48,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.055) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div className="w-full min-w-0 overflow-hidden">
        <div className="mb-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>
              Outreach Queue
            </div>
            <h1 className="text-[31px] leading-none font-bold tracking-tight mt-1" style={{ color: 'var(--color-ink)' }}>
              Drafts
            </h1>
            <p className="text-[13px] mt-1 max-w-full sm:max-w-[560px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
              Review, revise, attach files, and send outreach drafts.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {gmailConnected ? (
              <StatusChip tone="green" icon={CheckCircle2}>Gmail connected</StatusChip>
            ) : (
              <Link to="/settings">
                <StatusChip tone="amber" icon={AlertCircle}>Connect Gmail</StatusChip>
              </Link>
            )}
            <button
              onClick={() => { void reload() }}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[12px] font-medium disabled:opacity-60"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <MetricCard label="Active drafts" value={activeDrafts.length} sub={`${filtered.length} visible`} icon={Mail} />
          <MetricCard label="Ready to send" value={metrics.sendable} sub={gmailConnected ? 'Gmail enabled' : 'connect Gmail'} icon={Send} tone="green" />
          <MetricCard label="Attachments" value={metrics.attached} sub="custom draft files" icon={Paperclip} />
          <MetricCard label="Skipped" value={metrics.skipped} sub="excluded from batches" icon={Archive} tone="amber" />
        </section>

        {toast && <Toast ok={toast.ok} text={toast.text} />}
        {err && (
          <div className="mb-3 p-3 rounded-md border text-[13px]"
            style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)', borderColor: 'var(--color-line-strong)' }}>
            {err}
          </div>
        )}

        <DraftGenerationPanel
          targets={draftTargets}
          generating={generatingDrafts}
          batchSize={draftBatchSize}
          instructions={draftInstructions}
          onBatchSizeChange={setDraftBatchSize}
          onInstructionsChange={setDraftInstructions}
          onApplyTemplate={(text) => setDraftInstructions(text)}
          onCreate={createDraftBatch}
        />

        <FilterBar
          q={q}
          setQ={setQ}
          category={category}
          setCategory={setCategory}
          showSkipped={showSkipped}
          setShowSkipped={setShowSkipped}
          categories={categories}
          counts={categoryCounts(activeDrafts)}
          total={activeDrafts.length}
          onClear={clearFilters}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)] gap-3 items-start">
          <DraftQueue drafts={filtered} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          <DraftPanel
            draft={selected}
            gmailConnected={gmailConnected}
            sending={selected ? sendingId === selected.id : false}
            busyAction={busyAction}
            onSaved={patchDraftInState}
            onRedraft={(draft) => setRedraftFor(draft)}
            onSend={sendViaGmail}
            onMarkSent={markSent}
            onSkip={toggleSkip}
            onDelete={deleteDraft}
            onUpload={uploadAttachment}
          />
        </div>
      </div>

      {redraftFor && (
        <RedraftModal
          professorId={redraftFor.professor_id}
          professorName={redraftFor.professor_name}
          onClose={() => setRedraftFor(null)}
          onDone={(ok, msg) => {
            setToastTimed({ ok, text: msg })
            reload()
          }}
        />
      )}
    </div>
  )
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function DraftGenerationPanel({
  targets,
  generating,
  batchSize,
  instructions,
  onBatchSizeChange,
  onInstructionsChange,
  onApplyTemplate,
  onCreate,
}: {
  targets: Professor[]
  generating: boolean
  batchSize: number
  instructions: string
  onBatchSizeChange: (n: number) => void
  onInstructionsChange: (value: string) => void
  onApplyTemplate: (value: string) => void
  onCreate: () => void
}) {
  const nextCount = Math.min(batchSize, targets.length)
  const hasInstructions = instructions.trim().length > 0
  return (
    <section className="rounded-md border p-3 mb-3"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: 'var(--color-brand-600)' }} />
            <h2 className="text-[13px] font-bold" style={{ color: 'var(--color-ink)' }}>
              Create drafts with Quill
            </h2>
          </div>
          <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            {targets.length > 0
              ? `${targets.length} accepted professor${targets.length === 1 ? '' : 's'} do not have email drafts yet.`
              : 'All accepted professors currently have drafts, or no accepted professors are ready for drafting.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>
            Batch
          </label>
          <select
            value={batchSize}
            onChange={(e) => onBatchSizeChange(Number(e.target.value))}
            disabled={generating}
            className="rounded-md border px-2 py-1.5 text-[12px] outline-none disabled:opacity-60"
            style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          >
            {[1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={onCreate}
            disabled={generating || targets.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-[12px] font-medium disabled:opacity-50"
            style={{
              background: targets.length > 0 ? 'var(--color-ink)' : 'var(--color-paper-2)',
              borderColor: 'var(--color-line)',
              color: targets.length > 0 ? 'var(--color-white)' : 'var(--color-muted)',
            }}
          >
            {generating ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {generating ? 'Starting...' : targets.length > 0 ? `Create next ${nextCount}` : 'No drafts needed'}
          </button>
        </div>
      </div>
      <div className="mt-3 rounded-md border p-3"
        style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-[11px] uppercase tracking-[0.08em] font-medium" style={{ color: 'var(--color-muted)' }}>
            Email instructions / template
          </label>
          <span className="ml-auto text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
            {hasInstructions ? `${wordCount(instructions)} words` : 'optional'}
          </span>
        </div>
        <textarea
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          disabled={generating}
          rows={5}
          className="w-full resize-y rounded-md border px-3 py-2 text-[13px] outline-none disabled:opacity-60"
          style={{
            background: 'var(--color-white)',
            borderColor: 'var(--color-line)',
            color: 'var(--color-ink)',
            lineHeight: 1.45,
            minHeight: 120,
          }}
          placeholder="Paste rules or a full email template. Example: keep under 200 words, mention one recent paper, emphasize my autonomous driving research, use a formal postdoc inquiry structure."
        />
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {DRAFT_INSTRUCTION_TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => onApplyTemplate(template.text)}
              disabled={generating}
              className="px-2.5 py-1.5 rounded-md border text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              {template.label}
            </button>
          ))}
          {hasInstructions && (
            <button
              type="button"
              onClick={() => onInstructionsChange('')}
              disabled={generating}
              className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
              style={{ color: 'var(--color-muted)' }}
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function FilterBar({
  q,
  setQ,
  category,
  setCategory,
  showSkipped,
  setShowSkipped,
  categories,
  counts,
  total,
  onClear,
}: {
  q: string
  setQ: (v: string) => void
  category: string
  setCategory: (v: string) => void
  showSkipped: boolean
  setShowSkipped: (v: boolean) => void
  categories: string[]
  counts: Record<string, number>
  total: number
  onClear: () => void
}) {
  const filtered = q || category || showSkipped
  return (
    <section className="rounded-md border mb-3 overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="p-3 flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:flex-1 sm:min-w-[240px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search professor, subject, body..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md border text-[13px] outline-none"
            style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          />
        </div>
        <label className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px]"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
          <input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />
          Show skipped
        </label>
        {filtered && (
          <button onClick={onClear}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium"
            style={{ color: 'var(--color-ink-soft)' }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>
      <div className="px-3 pb-3 pt-2 border-t flex items-center gap-1.5 flex-nowrap overflow-x-auto"
        style={{ borderColor: 'var(--color-line)' }}>
        <span className="text-[11px] uppercase tracking-[0.08em] shrink-0 mr-1" style={{ color: 'var(--color-muted)' }}>
          Category
        </span>
        <Pill active={!category} onClick={() => setCategory('')} label="All" count={total} />
        {categories.map((c) => (
          <Pill
            key={c}
            active={category === c}
            onClick={() => setCategory(category === c ? '' : c)}
            label={formatCategory(c)}
            count={counts[c] ?? 0}
            color={`var(--color-cat-${c})`}
          />
        ))}
      </div>
    </section>
  )
}

function DraftQueue({ drafts, selectedId, onSelect }: { drafts: Draft[]; selectedId: number | null; onSelect: (id: number) => void }) {
  return (
    <section className="rounded-md border overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
        <h2 className="text-[13px] font-bold" style={{ color: 'var(--color-ink)' }}>Draft queue</h2>
        <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {drafts.length ? `${drafts.length} drafts ready for review` : 'No matching drafts'}
        </div>
      </div>
      <div>
        {drafts.map((draft) => (
          <button
            key={draft.id}
            onClick={() => onSelect(draft.id)}
            className="w-full border-b last:border-b-0 px-3 py-3 text-left hover:bg-[color:var(--color-paper-2)]"
            style={{
              borderColor: 'var(--color-line)',
              background: selectedId === draft.id ? 'var(--color-brand-50)' : 'transparent',
            }}
          >
            <div className="flex items-start gap-2">
              <Mail size={14} className="mt-1 shrink-0" style={{ color: 'var(--color-brand-600)' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-[13px] truncate" style={{ color: 'var(--color-ink)' }}>
                    {draft.professor_name || `Professor #${draft.professor_id}`}
                  </span>
                  {draft.skipped_at && <SmallBadge label="skipped" tone="amber" />}
                  {(draft.attachment_doc_ids?.length ?? 0) > 0 && <Paperclip size={12} style={{ color: 'var(--color-muted)' }} />}
                  <ChevronRight size={13} className="ml-auto shrink-0" style={{ color: 'var(--color-muted)' }} />
                </div>
                <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-ink-soft)' }}>{draft.subject || '(no subject)'}</div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {draft.professor_research_category && <CatChip cat={draft.professor_research_category} />}
                  {draft.professor_university && <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{draft.professor_university}</span>}
                  <span className="text-[11px] font-mono ml-auto" style={{ color: 'var(--color-muted)' }}>{shortDate(draft.updated_at)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
        {drafts.length === 0 && (
          <div className="px-6 py-10 text-center">
            <Mail size={26} className="mx-auto" style={{ color: 'var(--color-brand-600)' }} />
            <div className="text-[14px] font-semibold mt-3" style={{ color: 'var(--color-ink)' }}>No drafts match</div>
            <div className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>Adjust filters or generate drafts from professor detail.</div>
          </div>
        )}
      </div>
    </section>
  )
}

function DraftPanel({
  draft,
  gmailConnected,
  sending,
  busyAction,
  onSaved,
  onRedraft,
  onSend,
  onMarkSent,
  onSkip,
  onDelete,
  onUpload,
}: {
  draft: Draft | null
  gmailConnected: boolean
  sending: boolean
  busyAction: string | null
  onSaved: (draft: Draft) => void
  onRedraft: (draft: Draft) => void
  onSend: (draft: Draft) => void
  onMarkSent: (draft: Draft) => void
  onSkip: (draft: Draft) => void
  onDelete: (draft: Draft) => void
  onUpload: (draft: Draft, file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  if (!draft) {
    return (
      <aside className="rounded-md border min-h-[340px] grid place-items-center text-center p-6"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
        <div>
          <Mail size={28} className="mx-auto" style={{ color: 'var(--color-brand-600)' }} />
          <div className="text-[15px] font-semibold mt-3" style={{ color: 'var(--color-ink)' }}>No draft selected</div>
          <div className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>Select a draft from the queue.</div>
        </div>
      </aside>
    )
  }

  const attachmentCount = draft.attachment_doc_ids?.length ?? 0
  const canSend = gmailConnected && !!draft.professor_email && !draft.skipped_at

  return (
    <aside className="rounded-md border overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
        <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>Selected draft</div>
        <h2 className="text-[18px] leading-tight font-bold mt-1" style={{ color: 'var(--color-ink)' }}>
          {draft.professor_name || `Professor #${draft.professor_id}`}
        </h2>
        <div className="text-[12px] mt-1" style={{ color: 'var(--color-ink-soft)' }}>
          {[draft.professor_university, draft.professor_email].filter(Boolean).join(' - ') || 'No recipient metadata'}
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {draft.professor_research_category && <CatPill cat={draft.professor_research_category} />}
          <SmallBadge label={draft.professor_status || 'drafting'} tone={draft.professor_status === 'drafting' ? 'muted' : 'green'} />
          {draft.skipped_at && <SmallBadge label="skipped" tone="amber" />}
          <SmallBadge label={`${wordCount(draft.body)} words`} tone="muted" />
          <SmallBadge label={`${attachmentCount} attachments`} tone={attachmentCount ? 'green' : 'muted'} />
        </div>

        <DraftEditor draft={draft} onSaved={onSaved} />

        <div className="mt-3 rounded-md border px-3 py-2"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
          <div className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{ color: 'var(--color-muted)' }}>Actions</div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onRedraft(draft)}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium"
              style={{
                background: 'color-mix(in srgb, var(--color-cat-cv) 8%, var(--color-white))',
                borderColor: 'color-mix(in srgb, var(--color-cat-cv) 40%, var(--color-line))',
                color: 'color-mix(in srgb, var(--color-cat-cv) 70%, var(--color-ink))',
              }}
            >
              <Sparkles size={12} /> Redraft
            </button>
            <button
              onClick={() => onSend(draft)}
              disabled={!canSend || sending}
              title={!gmailConnected ? 'Connect Gmail in Settings first' : !draft.professor_email ? 'Professor has no email on file' : draft.skipped_at ? 'Unskip this draft before sending' : 'Send via Gmail now'}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--color-ink)' }}
            >
              <Send size={12} /> {sending ? 'Sending' : 'Send Gmail'}
            </button>
            <button
              onClick={() => onMarkSent(draft)}
              disabled={busyAction === `mark-${draft.id}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              <CheckCircle2 size={12} /> Mark sent
            </button>
            <button
              onClick={() => onSkip(draft)}
              disabled={busyAction === `skip-${draft.id}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              <Archive size={12} /> {draft.skipped_at ? 'Unskip' : 'Skip'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busyAction === `upload-${draft.id}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-brand-700)' }}
            >
              <FileUp size={12} /> Attach
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onUpload(draft, file)
              }}
            />
            <button
              onClick={() => onDelete(draft)}
              disabled={busyAction === `delete-${draft.id}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
              style={{ background: 'var(--color-rose-50)', borderColor: 'var(--color-line-strong)', color: 'var(--color-rose-700)' }}
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
          <div className="text-[11px] mt-2" style={{ color: 'var(--color-muted)' }}>
            Created {shortDate(draft.created_at)} - Updated {shortDate(draft.updated_at)}
          </div>
        </div>
      </div>
    </aside>
  )
}

function DraftEditor({ draft, onSaved }: { draft: Draft; onSaved: (d: Draft) => void }) {
  const [subject, setSubject] = useState(draft.subject || '')
  const [body, setBody] = useState(draft.body || '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setSubject(draft.subject || '')
    setBody(draft.body || '')
    setStatus('idle')
  }, [draft.id, draft.updated_at])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 220)}px`
  }, [body])

  const save = async (patch: { subject?: string; body?: string }) => {
    const subjectChanged = patch.subject !== undefined && patch.subject !== (draft.subject || '')
    const bodyChanged = patch.body !== undefined && patch.body !== (draft.body || '')
    if (!subjectChanged && !bodyChanged) return
    setStatus('saving')
    setErrMsg('')
    try {
      const updated = await api.patchDraft(draft.id, patch)
      onSaved({ ...draft, ...updated })
      window.dispatchEvent(new CustomEvent('quill:data-changed'))
      setStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 1800)
    } catch (e: any) {
      setStatus('error')
      setErrMsg(e?.message || String(e))
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-[11px] uppercase tracking-[0.08em] font-medium" style={{ color: 'var(--color-muted)' }}>
          Subject
        </label>
        <div className="ml-auto text-[11px] font-mono" style={{
          color: status === 'error' ? 'var(--color-rose-700)'
            : status === 'saved' ? 'var(--color-green-700)'
            : 'var(--color-muted)',
        }}>
          {status === 'saving' && 'Saving'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && `Save failed: ${errMsg.slice(0, 80)}`}
        </div>
      </div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        onBlur={() => save({ subject })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="w-full px-3 py-2 rounded-md border text-[13px] font-medium outline-none"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
      />
      <label className="text-[11px] uppercase tracking-[0.08em] font-medium block mt-3 mb-1" style={{ color: 'var(--color-muted)' }}>
        Body
      </label>
      <textarea
        ref={taRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => save({ body })}
        className="w-full px-3 py-2 rounded-md border text-[13px] font-sans outline-none"
        style={{
          background: 'var(--color-paper)',
          borderColor: 'var(--color-line)',
          color: 'var(--color-ink-soft)',
          lineHeight: 1.55,
          resize: 'none',
          overflow: 'hidden',
          minHeight: 220,
        }}
      />
    </div>
  )
}

function MetricCard({ label, value, sub, icon: Icon, tone = 'default' }: {
  label: string
  value: ReactNode
  sub: string
  icon: IconComponent
  tone?: 'default' | 'green' | 'amber'
}) {
  const color = tone === 'green' ? 'var(--color-green-700)' : tone === 'amber' ? 'var(--color-amber-700)' : 'var(--color-ink)'
  return (
    <section className="rounded-md border p-3 min-h-[92px]"
      style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line-strong)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
        <Icon size={14} style={{ color }} />
      </div>
      <div className="text-[28px] font-bold leading-none mt-2" style={{ color }}>{value}</div>
      <div className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>{sub}</div>
    </section>
  )
}

function StatusChip({ children, icon: Icon, tone }: { children: ReactNode; icon: IconComponent; tone: 'green' | 'amber' }) {
  const color = tone === 'green' ? 'var(--color-green-700)' : 'var(--color-amber-700)'
  const background = tone === 'green' ? 'var(--color-green-50)' : 'var(--color-amber-50)'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[12px] font-medium"
      style={{ background, borderColor: 'var(--color-line)', color }}>
      <Icon size={12} />
      {children}
    </span>
  )
}

function Toast({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="mb-3 px-3 py-2 rounded-md border text-[13px] flex items-start gap-2"
      style={{
        background: ok ? 'var(--color-green-50)' : 'var(--color-rose-50)',
        borderColor: 'var(--color-line-strong)',
        color: ok ? 'var(--color-green-700)' : 'var(--color-rose-700)',
      }}>
      {ok ? <CheckCircle2 size={14} className="mt-0.5" /> : <AlertCircle size={14} className="mt-0.5" />}
      <span>{text}</span>
    </div>
  )
}

function Pill({ active, onClick, label, count, color }: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 px-2.5 py-1 rounded-full border text-[12px] flex items-center gap-1.5"
      style={{
        background: active ? 'var(--color-white)' : 'var(--color-paper-2)',
        borderColor: active ? 'var(--color-line-strong)' : 'var(--color-line)',
        color: 'var(--color-ink-soft)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
      <span>{label}</span>
      {count !== undefined && <span className="font-mono" style={{ color: 'var(--color-muted)' }}>{count}</span>}
    </button>
  )
}

function CatChip({ cat }: { cat: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: `var(--color-cat-${cat})` }} />
      {formatCategory(cat)}
    </span>
  )
}

function CatPill({ cat }: { cat: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium"
      style={{
        background: `color-mix(in srgb, var(--color-cat-${cat}) 10%, var(--color-white))`,
        borderColor: `color-mix(in srgb, var(--color-cat-${cat}) 40%, var(--color-line))`,
        color: `color-mix(in srgb, var(--color-cat-${cat}) 80%, var(--color-ink))`,
      }}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: `var(--color-cat-${cat})` }} />
      {formatCategory(cat)}
    </span>
  )
}

function SmallBadge({ label, tone }: { label: string; tone: 'green' | 'amber' | 'muted' }) {
  const color = tone === 'green' ? 'var(--color-green-700)' : tone === 'amber' ? 'var(--color-amber-700)' : 'var(--color-muted)'
  const background = tone === 'amber' ? 'var(--color-amber-50)' : tone === 'green' ? 'var(--color-green-50)' : 'var(--color-paper)'
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium"
      style={{ background, color, borderColor: 'var(--color-line)' }}>
      {label}
    </span>
  )
}

function categoryCounts(drafts: Draft[]): Record<string, number> {
  return drafts.reduce<Record<string, number>>((acc, draft) => {
    const cat = draft.professor_research_category
    if (cat) acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {})
}

function shortDate(value?: string | null) {
  if (!value) return 'No date'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function wordCount(value?: string | null) {
  return (value || '').trim().split(/\s+/).filter(Boolean).length
}
