import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  File,
  FileText,
  FileUp,
  FileImage,
  Loader,
  Paperclip,
  Search,
  Sparkles,
  Star,
  Trash2,
  AlertCircle,
} from 'lucide-react'
import { api, type DocumentRow } from '@/lib/api'
import { useConfirm } from '@/components/ConfirmDialog'
import { useQuillRun } from '@/hooks/useQuillRun'

type Icon = ComponentType<{ size?: number; style?: CSSProperties; className?: string }>

const PAGE_BG = {
  backgroundColor: 'var(--color-paper)',
  backgroundImage: 'linear-gradient(rgba(28,34,48,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.055) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
}

const PANEL_TRANSITION = 'transition-all duration-[400ms] ease-out'

const KIND_DEFS = [
  {
    kind: 'cv',
    label: 'CV',
    description: 'Master CV used as the base profile for targeted cover letters and outreach wording.',
    icon: FileText as Icon,
    tone: 'var(--color-brand-600)',
  },
  {
    kind: 'research_statement',
    label: 'Research Statement',
    description: 'Full research narrative for fellowship or lab application context.',
    icon: FileText as Icon,
    tone: 'var(--color-indigo-600)',
  },
  {
    kind: 'sample_paper',
    label: 'Sample Papers',
    description: 'Published papers and arXiv drafts attached for evidence and style references.',
    icon: FileText as Icon,
    tone: 'var(--color-green-700)',
  },
  {
    kind: 'cover_letter_tmpl',
    label: 'Cover Letter Templates',
    description: 'Reusable templates that Quill can repurpose for each professor and institution.',
    icon: FileText as Icon,
    tone: 'var(--color-amber-700)',
  },
  {
    kind: 'transcript',
    label: 'Transcripts',
    description: 'Academic transcripts used for scholarship or fellowship scoring checks.',
    icon: File as Icon,
    tone: 'var(--color-cat-medical)',
  },
  {
    kind: 'other',
    label: 'Other',
    description: 'Miscellaneous docs that still help Quill improve context and recommendations.',
    icon: File as Icon,
    tone: 'var(--color-muted)',
  },
] as const

const KIND_SET = new Set<string>(KIND_DEFS.map((k) => k.kind))
const ACCEPT = '.pdf,.docx,.txt,.md,.tex,.bib,.csv,.json,.yaml,.yml'

export function Documents() {
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [attaching, setAttaching] = useState(false)
  const confirmDlg = useConfirm()

  const refresh = useCallback(() => {
    api
      .documents()
      .then(setDocs)
      .catch((e) => setErr(String(e)))
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('quill:data-changed', refresh)
    return () => window.removeEventListener('quill:data-changed', refresh)
  }, [refresh])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      docs.filter((d) => {
        if (!q) return true
        return (
          d.title.toLowerCase().includes(q) ||
          d.filename.toLowerCase().includes(q) ||
          d.extension.toLowerCase().includes(q) ||
          d.kind.toLowerCase().includes(q)
        )
      }),
    [docs, q],
  )

  const grouped = useMemo(() => {
    const buckets = new Map<string, DocumentRow[]>()
    for (const doc of filtered) {
      const list = buckets.get(doc.kind) ?? []
      list.push(doc)
      buckets.set(doc.kind, list)
    }

    const ordered = KIND_DEFS.map((def) => ({
      ...def,
      docs: (buckets.get(def.kind) ?? []).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }))

    const extras = [...buckets.keys()]
      .filter((kind) => !KIND_SET.has(kind))
      .map((kind) => ({
        kind,
        label: kind,
        description: 'Backend-defined document category.',
        icon: File as Icon,
        tone: 'var(--color-muted)',
        docs: (buckets.get(kind) ?? []).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      }))

    return [...ordered, ...extras]
  }, [filtered])

  const total = filtered.length
  const indexed = filtered.filter((doc) => doc.has_text).length
  const totalBytes = filtered.reduce((sum, doc) => sum + (doc.size_bytes || 0), 0)
  const defaultCount = filtered.filter((doc) => doc.is_default).length

  const lastUpdated = useMemo(() => {
    const latest = [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    return latest ? relativeDate(latest.updated_at) : 'No documents yet'
  }, [filtered])

  const selectedBytes = useMemo(() => {
    return [...selectedIds]
      .map((id) => filtered.find((doc) => doc.id === id))
      .filter(Boolean)
      .reduce((sum, doc) => sum + (doc?.size_bytes || 0), 0)
  }, [selectedIds, filtered])

  const selected = useMemo(
    () => [...filtered].filter((doc) => selectedIds.has(doc.id)),
    [filtered, selectedIds],
  )

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  const attachSelectedToAllDrafts = async () => {
    if (!selected.length) return
    const ok = await confirmDlg({
      title: `Attach ${selected.length} file${selected.length === 1 ? '' : 's'} to all unsent drafts?`,
      detail: selected.map((doc) => doc.title).join(', '),
      message:
        'Quill will attach every selected document to drafts with drafting status. Existing attachments are preserved.',
      variant: 'primary',
      confirmLabel: 'Attach to drafts',
    })
    if (!ok) return

    setAttaching(true)
    setToast(null)
    try {
      const selectedDocumentIds = selected.map((doc) => doc.id)
      const r = await api.bulkAttachToDrafts(selectedDocumentIds, 'drafting')
      setToast({
        ok: true,
        text: `Attached ${selected.length} file${selected.length === 1 ? '' : 's'} to ${r.modified} draft${r.modified === 1 ? '' : 's'}.`,
      })
      setSelectedIds(new Set())
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || String(e) })
    } finally {
      setAttaching(false)
      setTimeout(() => setToast(null), 10000)
    }
  }

  const attachOneToAllDrafts = async (doc: DocumentRow) => {
    const ok = await confirmDlg({
      title: 'Attach to all unsent drafts?',
      detail: doc.title,
      message: 'This adds the document to every unsent draft. Existing attachments are preserved.',
      variant: 'primary',
      confirmLabel: 'Attach',
    })
    if (!ok) return

    setAttaching(true)
    setToast(null)
    try {
      const r = await api.bulkAttachToDrafts([doc.id], 'drafting')
      setToast({
        ok: true,
        text: `Attached ${doc.title.length > 60 ? `${doc.title.slice(0, 60)}…` : doc.title} to ${r.modified} draft${r.modified === 1 ? '' : 's'}.`,
      })
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || String(e) })
    } finally {
      setAttaching(false)
      setTimeout(() => setToast(null), 10000)
    }
  }

  const recentDocs = useMemo(
    () => [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6),
    [filtered],
  )

  const fileTotals = useMemo(() => {
    const counts = grouped.reduce<Record<string, number>>((acc, bucket) => {
      acc[bucket.label] = bucket.docs.length
      return acc
    }, {})
    return counts
  }, [grouped])

  return (
    <div className="min-h-full" style={PAGE_BG}>
      <div className="mx-auto flex w-full max-w-[1220px] flex-col gap-5 px-4 py-5 sm:px-5 xl:px-6">
        <header className="rounded-xl border px-5 py-5 sm:px-6" style={{ borderColor: 'var(--color-line)', background: 'rgba(255,255,255,0.58)' }}>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-muted)' }}>
                Repository
              </p>
              <h1 className="mt-1 text-[32px] font-bold leading-tight" style={{ color: 'var(--color-ink)' }}>
                Documents
              </h1>
              <p className="mt-1 max-w-3xl text-[15px] leading-7" style={{ color: 'var(--color-ink-soft)' }}>
                Upload reference docs, CVs, papers, and templates for Quill to read before drafting and generating outreach. Every attachment can be routed directly into drafting queues.
              </p>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by title, extension, or kind"
                  className="w-full rounded-md border px-9 py-2.5 text-[14px] outline-none transition-colors placeholder:text-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
                />
              </div>

              <button
                onClick={() => clearSelection()}
                className={`rounded-md border px-3.5 py-2 text-[14px] ${PANEL_TRANSITION}`}
                style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
              >
                Reset view
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total files" value={total} tone="var(--color-ink)" />
            <MetricCard label="Indexed text" value={`${indexed}/${total}`} tone="var(--color-green-700)" />
            <MetricCard label="Total size" value={formatBytes(totalBytes)} tone="var(--color-ink-soft)" />
            <MetricCard label="Default documents" value={defaultCount} tone="var(--color-brand-600)" />
          </div>
        </header>

        {err && (
          <div className="rounded-lg border p-3 text-[14px]" style={{ borderColor: 'var(--color-rose-200)', color: 'var(--color-rose-700)', background: 'var(--color-rose-50)' }}>
            {err}
          </div>
        )}

        {toast && (
          <div
            className={`rounded-lg border p-3 text-[14px] ${PANEL_TRANSITION}`}
            style={{
              borderColor: toast.ok ? 'var(--color-green-200)' : 'var(--color-rose-200)',
              background: toast.ok ? 'var(--color-green-50)' : 'var(--color-rose-50)',
              color: toast.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)',
            }}
          >
            {toast.text}
          </div>
        )}

        {selectedIds.size > 0 && (
          <SurfacePanel title="Selected files" tone="brand" subtitle={`${selectedIds.size} documents ready for batch attach`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-[14px]" style={{ color: 'var(--color-ink-soft)' }}>
                <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>
                  {selectedIds.size} selected
                </span>
                {' · '}
                {formatBytes(selectedBytes)}
                {' · '}
                {selected.map((doc) => doc.title).slice(0, 2).join(', ')}
                {selected.length > 2 ? '…' : ''}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearSelection}
                  className={`rounded-md border px-3 py-1.5 text-[14px] ${PANEL_TRANSITION}`}
                  style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}
                >
                  Clear
                </button>
                <button
                  onClick={attachSelectedToAllDrafts}
                  disabled={attaching || selected.length === 0}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[14px] font-medium text-white ${PANEL_TRANSITION} disabled:opacity-50`}
                  style={{ background: 'linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))' }}
                >
                  {attaching ? <Loader size={14} className="animate-spin" /> : <Paperclip size={14} />}
                  Attach to unsent drafts
                </button>
              </div>
            </div>
          </SurfacePanel>
        )}

        <section className="grid gap-5 xl:grid-cols-[1fr_350px]">
          <div className="grid gap-4 lg:grid-cols-2">
            {grouped.map((bucket) => (
              <DocumentKindPanel
                key={bucket.kind}
                kind={bucket.kind}
                label={bucket.label}
                description={bucket.description}
                docs={bucket.docs}
                tone={bucket.tone}
                Icon={bucket.icon}
                selectedIds={selectedIds}
                onChange={refresh}
                onToggleSelect={toggleSelect}
                onAttachOne={attachOneToAllDrafts}
              />
            ))}
          </div>

          <aside className="space-y-3">
              <SurfacePanel title="Document feed" subtitle="Most recently updated items">
              <ul className="flex flex-col gap-2">
                {recentDocs.length === 0 && <li className="text-[13px] text-[var(--color-muted)]">No documents yet.</li>}
                {recentDocs.map((doc) => (
                  <li key={doc.id} className={`rounded-md border px-3.5 py-2.5 ${PANEL_TRANSITION}`} style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)' }}>
                    <div className="flex items-start gap-2">
                      <ExtIcon ext={doc.extension} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium leading-5" style={{ color: 'var(--color-ink)' }}>{doc.title}</p>
                        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{fileSummaryLine(doc)}</p>
                      </div>
                      <span className="text-[13px] rounded border px-1.5 py-0.5 text-[var(--color-muted)]" style={{ borderColor: 'var(--color-line)' }}>
                        {formatDate(doc.updated_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </SurfacePanel>

            <SurfacePanel title="Workspace stats" subtitle="Snapshot across document kinds">
              <ul className="space-y-2">
                {Object.entries(fileTotals).map(([label, count]) => {
                  const isZero = count === 0
                  return (
                    <li key={label} className="flex items-center justify-between rounded-md border px-3.5 py-2.5" style={{ borderColor: 'var(--color-line)', background: isZero ? 'var(--color-paper-2)' : 'var(--color-white)' }}>
                      <span className="text-[14px]" style={{ color: 'var(--color-ink)' }}>{label}</span>
                      <StatusPill tone={count === 0 ? 'muted' : 'ink'}>{count} files</StatusPill>
                    </li>
                  )
                })}
              </ul>
            </SurfacePanel>

            <SurfacePanel title="Live sync" subtitle={`Updated ${lastUpdated}`}>
              <p className="text-[13px] leading-5" style={{ color: 'var(--color-ink-soft)' }}>
                Document updates trigger Quill context refresh events automatically. If a CV was just uploaded, profile extraction is available per-CV panel.
              </p>
            </SurfacePanel>
          </aside>
        </section>
      </div>
    </div>
  )
}

function DocumentKindPanel({
  kind,
  label,
  description,
  docs,
  tone,
  Icon,
  selectedIds,
  onChange,
  onToggleSelect,
  onAttachOne,
}: {
  kind: string
  label: string
  description: string
  docs: DocumentRow[]
  tone: string
  Icon: Icon
  selectedIds: Set<number>
  onChange: () => void
  onToggleSelect: (id: number) => void
  onAttachOne: (doc: DocumentRow) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoFillNotice, setAutoFillNotice] = useState<string | null>(null)
  const quill = useQuillRun()
  const [showLog, setShowLog] = useState(false)

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (!list.length) return

      setError(null)
      let triggeredAutoFill = false
      for (const file of list) {
        setBusyName(file.name)
        try {
          const uploaded = await api.uploadDocument(kind, file, docs.length === 0)
          if (kind === 'cv' || kind === 'transcript') {
            triggeredAutoFill = true
            if (uploaded.has_text && docs.length === 0) {
              void uploaded.id
            }
          }
        } catch (e: any) {
          setError(e?.message || String(e))
        }
      }
      setBusyName(null)
      onChange()

      if (triggeredAutoFill) {
        setAutoFillNotice(
          kind === 'cv'
            ? 'CV uploaded. Profile autofill is running in the background. Check the Profile page in ~30 seconds.'
            : 'Transcript uploaded. Profile autofill refresh will include the new data on next profile run.',
        )
        setTimeout(() => setAutoFillNotice(null), 12000)
      }
    },
    [docs.length, kind, onChange],
  )

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer.files?.length) {
      upload(e.dataTransfer.files)
    }
  }

  return (
    <SurfacePanel
      tone="soft"
      title={label}
      subtitle={description}
      right={
        <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[13px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
          <Icon size={11} style={{ color: tone }} />
          <span>{docs.length}</span>
        </span>
      }
    >
      <div className="space-y-3.5">
        <div
          onDragEnter={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setDrag(false)
          }}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-md border-2 border-dashed p-5 transition-colors ${PANEL_TRANSITION}`}
          style={{
            borderColor: drag ? tone : 'var(--color-line)',
            background: drag ? 'var(--color-paper-2)' : 'var(--color-paper)',
            color: drag ? tone : 'var(--color-ink-soft)',
          }}
        >
          <div className="flex items-center justify-center gap-2 text-[14px]">
            <FileUp size={16} />
            <span className="font-medium">{busyName ? `Uploading ${busyName}…` : 'Drag files here or click to browse'}</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => e.target.files && upload(e.target.files)}
          />
        </div>

        {error && (
          <div className="rounded-md border px-3.5 py-2.5 text-[13px]" style={{ borderColor: 'var(--color-rose-200)', background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
            <div className="flex items-start gap-2">
              <AlertCircle size={12} className="mt-0.5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {autoFillNotice && (
          <div className="rounded-md border px-3.5 py-2.5 text-[13px]" style={{ borderColor: 'var(--color-brand-200)', background: 'var(--color-brand-50)', color: 'var(--color-brand-700)' }}>
            <div className="flex items-start gap-2">
              <Sparkles size={12} className="mt-0.5" />
              <span>{autoFillNotice}</span>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {docs.length === 0 && <li className="px-1 text-[13px] text-[var(--color-muted)]">No documents yet.</li>}
          {docs.map((doc) => (
            <DocItem
              key={doc.id}
              doc={doc}
              selected={selectedIds.has(doc.id)}
              onChange={onChange}
              onToggleSelect={() => onToggleSelect(doc.id)}
              onAttachToAll={() => onAttachOne(doc)}
            />
          ))}
        </ul>

        {kind === 'cv' && docs.length > 0 && (
          <div className="rounded-md border px-3.5 py-2.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}>
            {quill.state === 'idle' && (
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px]" style={{ color: 'var(--color-ink-soft)' }}>Use the top CV as source for profile autofill.</div>
                <button
                  onClick={() => {
                    const defaultDoc = docs.find((d) => d.is_default) ?? docs[0]
                    quill.start({ workflow: 'extract_profile', document_id: defaultDoc.id })
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-medium ${PANEL_TRANSITION}`}
                  style={{ color: '#fff', background: 'linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))' }}
                >
                  <Sparkles size={12} />
                  Extract profile from CV
                </button>
              </div>
            )}

            {quill.state === 'running' && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--color-brand-600)' }}>
                    <Loader size={12} className="animate-spin" />
                    <span>Extracting profile from CV…</span>
                  </div>
                  <button
                    onClick={() => setShowLog((s) => !s)}
                    className="rounded p-1 text-[13px]"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
                {showLog && (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-white p-2 font-mono text-[13px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
                    {quill.logText}
                  </pre>
                )}
              </div>
            )}

            {quill.state === 'done' && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--color-green-700)' }}>
                  <CheckCircle2 size={12} />
                  Profile updated from CV
                </div>
              </div>
            )}

            {quill.state === 'error' && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--color-rose-700)' }}>
                  <AlertCircle size={12} />
                  {quill.error}
                </div>
                <button onClick={quill.reset} className="text-[13px]" style={{ color: 'var(--color-muted)' }}>Retry</button>
              </div>
            )}
          </div>
        )}
      </div>
    </SurfacePanel>
  )
}

function DocItem({
  doc,
  selected,
  onChange,
  onToggleSelect,
  onAttachToAll,
}: {
  doc: DocumentRow
  selected: boolean
  onChange: () => void
  onToggleSelect: () => void
  onAttachToAll: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  const setDefault = async () => {
    setBusy(true)
    try {
      await api.setDefaultDocument(doc.id)
    } finally {
      setBusy(false)
      onChange()
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this document?',
      detail: doc.title,
      message: 'The file will be removed from disk and removed from draft defaults where referenced.',
      variant: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return

    setBusy(true)
    try {
      await api.deleteDocument(doc.id)
    } finally {
      setBusy(false)
      onChange()
    }
  }

  return (
    <li
      className={`rounded-md border px-3.5 py-3 ${PANEL_TRANSITION}`}
      style={{
        borderColor: selected ? 'var(--color-brand-300)' : doc.is_default ? 'var(--color-brand-200)' : 'var(--color-line)',
        background: selected ? 'var(--color-brand-50)' : doc.is_default ? 'rgba(59,130,246,0.06)' : 'var(--color-white)',
      }}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 size-4 flex-shrink-0"
          title="Select for bulk attach"
        />
        <span className="mt-0.5 flex-shrink-0">
          <ExtIcon ext={doc.extension} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[14px] font-semibold leading-5" style={{ color: 'var(--color-ink)' }}>
            {doc.title}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-muted)' }}>
            <span className="rounded border px-1.5 py-0.5 font-mono uppercase" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
              {doc.extension || 'file'}
            </span>
            <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
              {formatBytes(doc.size_bytes)}
            </span>
            <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
              {new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            {doc.has_text ? (
              <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--color-green-200)', background: 'var(--color-green-50)', color: 'var(--color-green-700)' }}>
                <CheckCircle2 size={11} />
                {Math.round((doc.text_chars || 0) / 100) / 10}k chars
              </span>
            ) : (
              <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>
                not indexed
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          onClick={onAttachToAll}
          title="Attach to unsent drafts"
          disabled={busy}
          className="grid size-8 place-items-center rounded-md border"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-brand-700)' }}
        >
          <Paperclip size={14} />
        </button>
        <button
          onClick={setDefault}
          disabled={busy || doc.is_default}
          title={doc.is_default ? 'Default document' : 'Set as default'}
          className="grid size-8 place-items-center rounded-md border"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: doc.is_default ? 'var(--color-amber-600)' : 'var(--color-muted)' }}
        >
          <Star size={14} fill={doc.is_default ? 'currentColor' : 'none'} />
        </button>
        <a
          href={`/api/documents/${doc.id}/file`}
          title="Download file"
          target="_blank"
          rel="noreferrer"
          className="grid size-8 place-items-center rounded-md border"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-muted)' }}
        >
          <Download size={14} />
        </a>
        <button
          onClick={remove}
          disabled={busy}
          title="Delete"
          className="grid size-8 place-items-center rounded-md border"
          style={{ borderColor: 'var(--color-rose-200)', background: 'var(--color-white)', color: 'var(--color-rose-700)' }}
        >
          {busy ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </li>
  )
}

function SurfacePanel({
  title,
  subtitle,
  right,
  children,
  tone = 'default',
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  tone?: 'default' | 'soft' | 'brand'
}) {
  const toneMap: Record<string, string> = {
    default: 'var(--color-white)',
    soft: 'var(--color-paper-2)',
    brand: 'linear-gradient(120deg, var(--color-brand-50), var(--color-white))',
  }

  return (
    <section className="rounded-xl border p-4.5" style={{ borderColor: 'var(--color-line)', background: toneMap[tone] }}>
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--color-ink)' }}>
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-[13px]" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3.5" style={{ borderColor: 'var(--color-line)', background: 'rgba(255,255,255,0.72)' }}>
      <p className="text-[13px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="mt-1 text-[28px] font-bold" style={{ color: tone || 'var(--color-ink)' }}>{value}</p>
    </div>
  )
}

function StatusPill({ tone = 'ink', children }: { tone?: 'muted' | 'ink'; children: ReactNode }) {
  const style =
    tone === 'muted'
      ? { color: 'var(--color-muted)', background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }
      : { color: 'var(--color-brand-700)', background: 'var(--color-brand-50)', borderColor: 'var(--color-brand-200)' }

  return (
    <span className="inline-flex rounded border px-2 py-0.5 text-[13px]" style={style}>
      {children}
    </span>
  )
}

function ExtIcon({ ext }: { ext: string }) {
  const e = (ext || '').toLowerCase()
  let color = 'var(--color-muted)'
  let Icon: Icon = File

  if (e === 'pdf') {
    color = 'var(--color-rose-500)'
    Icon = FileText
  } else if (e === 'docx' || e === 'doc') {
    color = 'var(--color-brand-600)'
    Icon = FileText
  } else if (e === 'png' || e === 'jpg' || e === 'jpeg') {
    color = 'var(--color-cat-cv)'
    Icon = FileImage
  }

  return <Icon size={17} style={{ color, flexShrink: 0 }} />
}

function formatBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function relativeDate(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const mins = Math.max(0, Math.floor(diff / (1000 * 60)))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 14) return `${days}d ago`
  return formatDate(iso)
}

function fileSummaryLine(doc: DocumentRow): string {
  return `${doc.extension.toUpperCase() || 'FILE'} · ${formatBytes(doc.size_bytes)} · ${doc.has_text ? `${Math.round((doc.text_chars || 0) / 100) / 10}k chars` : 'not indexed'}`
}
