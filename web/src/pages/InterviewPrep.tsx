import { useEffect, useMemo, useRef, useState } from 'react'
import type { TextareaHTMLAttributes, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  GraduationCap, Loader2, Sparkles, RefreshCw, Trash2, ChevronLeft, ChevronDown,
  MessageSquare, Send, Flag, Check, AlertTriangle, Pencil, Plus, X,
  Target, ListChecks, HelpCircle, MessageCircleQuestion, ClipboardList, Info,
  Mic, Volume2, VolumeX,
} from 'lucide-react'
import { ttsUrl, createRecognizer, type Recognizer } from '@/lib/speech'
import {
  api, type InterviewPrep as Prep, type MockInterview,
  type Briefing, type FitAnalysis, type LikelyQuestion, type TalkingPoint,
} from '@/lib/api'
import { useConfirm } from '@/components/ConfirmDialog'

const MEETING_FORMATS = [
  { value: 'informal_chat', label: 'Informal chat' },
  { value: 'formal_interview', label: 'Formal interview' },
  { value: 'job_talk', label: 'Job talk' },
  { value: 'panel', label: 'Panel' },
] as const

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--color-paper-2)', fg: 'var(--color-muted)', label: 'Draft' },
  ready: { bg: 'var(--color-violet-50)', fg: 'var(--color-violet-700)', label: 'Ready' },
  completed: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', label: 'Completed' },
}

const CATEGORY_STYLE: Record<string, { bg: string; fg: string }> = {
  research:   { bg: 'var(--color-blue-50)',   fg: 'var(--color-blue-700)' },
  background: { bg: 'var(--color-amber-50)',  fg: 'var(--color-amber-700)' },
  motivation: { bg: 'var(--color-violet-50)', fg: 'var(--color-violet-700)' },
  logistics:  { bg: 'var(--color-paper-2)',   fg: 'var(--color-muted)' },
  hard:       { bg: 'var(--color-rose-50)',   fg: 'var(--color-rose-700)' },
}

const PAGE_BG = {
  backgroundColor: 'var(--color-paper)',
  backgroundImage:
    'linear-gradient(rgba(28,34,48,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.055) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
} as const

const SURFACE_TRANSITION = 'transition-all duration-[400ms] ease-out'

function shortDateTime(value?: string | null) {
  if (!value) return 'Not scheduled'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatMeetingLabel(value: string) {
  return MEETING_FORMATS.find((f) => f.value === value)?.label || value
}

export function InterviewPrep() {
  const [params, setParams] = useSearchParams()
  const [preps, setPreps] = useState<Prep[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const triggered = useRef(false)

  const profParam = params.get('prof')
  const replyParam = params.get('reply')

  const reload = () => api.listInterviewPreps().then(setPreps).catch((e) => setErr(String(e)))

  useEffect(() => {
    reload()
    window.addEventListener('quill:data-changed', reload)
    return () => window.removeEventListener('quill:data-changed', reload)
  }, [])

  useEffect(() => {
    if (!profParam || triggered.current) return
    const pid = Number(profParam)
    const existing = preps.find((p) => p.professor_id === pid)
    if (existing) {
      triggered.current = true
      setSelected(existing.id)
    } else if (!generating) {
      triggered.current = true
      generate(pid, replyParam ? Number(replyParam) : null)
    }
  }, [preps, profParam, replyParam])

  const generate = async (pid: number, replyId: number | null, format?: string) => {
    setGenerating(true); setErr(null)
    try {
      const prep = await api.generateInterviewPrep(pid, { reply_id: replyId, meeting_format: format })
      await reload()
      setSelected(prep.id)
      window.dispatchEvent(new CustomEvent('quill:data-changed'))
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setGenerating(false)
    }
  }

  const current = useMemo(() => preps.find((p) => p.id === selected) || null, [preps, selected])

  const prepStats = useMemo(() => {
    const ready = preps.filter((p) => p.status === 'ready').length
    const completed = preps.filter((p) => p.status === 'completed').length
    const scheduled = preps.filter((p) => !!p.meeting_at).length
    const active = preps.filter((p) => p.status !== 'completed').length
    return { ready, completed, scheduled, active }
  }, [preps])

  const clearSelection = () => {
    setSelected(null)
    triggered.current = true
    if (profParam || replyParam) setParams({}, { replace: true })
  }

  if (current) {
    return (
      <PageCanvas>
        <PrepDetail
          prep={current}
          onBack={clearSelection}
          onChanged={reload}
          onRegenerate={() => generate(current.professor_id, current.reply_id, current.meeting_format)}
          regenerating={generating}
        />
      </PageCanvas>
    )
  }

  return (
    <PageCanvas>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-muted)' }}>
            Interview Prep
          </div>
          <h1 className="mt-1 text-[31px] font-bold leading-tight" style={{ color: 'var(--color-ink)' }}>
            Interview board
          </h1>
          <p className="mt-1 max-w-3xl text-[14px] leading-6" style={{ color: 'var(--color-muted)' }}>
            {prepStats.active} active prep{prepStats.active === 1 ? '' : 's'}, {prepStats.scheduled} scheduled meeting{prepStats.scheduled === 1 ? '' : 's'}, and {prepStats.ready} ready briefing{prepStats.ready === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill label={generating ? 'Generating' : err ? 'Needs review' : 'Live'} tone={err ? 'amber' : 'green'} />
          <Link to="/sent" className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-paper)] ${SURFACE_TRANSITION}`}
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)', color: 'var(--color-ink)' }}>
            <MessageSquare size={13} />
            Review replies
          </Link>
        </div>
      </div>

      {err && (
        <Banner tone="rose">{err}</Banner>
      )}

      {generating && (
        <Banner tone="violet">
          <Loader2 size={14} className="animate-spin" />
          Quill is preparing your interview materials. This takes a moment.
        </Banner>
      )}

      <section className="mb-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
        <MetricCard label="Total preps" value={preps.length} detail={`${prepStats.active} active`} />
        <MetricCard label="Ready" value={prepStats.ready} detail="Prepared and reviewable" />
        <MetricCard label="Scheduled" value={prepStats.scheduled} detail="With meeting times set" />
        <MetricCard label="Completed" value={prepStats.completed} detail="Sessions already wrapped" />
      </section>

      {preps.length === 0 && !generating ? (
        <SurfacePanel className="px-6 py-12 text-center">
          <GraduationCap size={32} className="mx-auto mb-3" style={{ color: 'var(--color-muted-2)' }} />
          <div className="text-[16px] font-semibold mb-1" style={{ color: 'var(--color-ink)' }}>
            No interviews to prep for yet
          </div>
          <div className="text-[13px] max-w-xl mx-auto leading-6" style={{ color: 'var(--color-muted)' }}>
            When a professor replies wanting to meet, open the reply on the{' '}
            <Link to="/sent" className="underline" style={{ color: 'var(--color-brand-600)' }}>Sent</Link>{' '}
            page and click "Prepare for interview".
          </div>
        </SurfacePanel>
      ) : (
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_320px]">
          <SurfacePanel className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--color-line)' }}>
              <div>
                <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Prep queue</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-muted)' }}>Open an interview pack to review briefing, fit, Q&A, and mock practice.</div>
              </div>
              <div className="text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>{preps.length} items</div>
            </div>
            <div className="grid gap-0">
              {preps.map((p) => {
                const st = STATUS_STYLE[p.status] || STATUS_STYLE.draft
                const logisticsDone = p.logistics.filter((item) => item.done).length
                return (
                  <button key={p.id} onClick={() => setSelected(p.id)}
                    className={`grid gap-3 border-b px-4 py-4 text-left hover:bg-[color:var(--color-paper)] ${SURFACE_TRANSITION} sm:grid-cols-[minmax(0,1fr)_150px_150px]`}
                    style={{ borderColor: 'var(--color-line)' }}>
                    <div className="min-w-0">
                      <div className="flex items-start gap-2.5 flex-wrap">
                        <div className="text-[15px] font-semibold" style={{ color: 'var(--color-ink)' }}>
                          {p.professor_name || 'Untitled prep'}
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
                          style={{ background: st.bg, color: st.fg }}>
                          {st.label}
                        </span>
                      </div>
                      <div className="mt-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                        {[p.university, p.position_type ? `${p.position_type} position` : null].filter(Boolean).join(' · ') || 'University not captured'}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <QueueChip>{formatMeetingLabel(p.meeting_format)}</QueueChip>
                        {p.questions_to_ask.length > 0 && <QueueChip>{p.questions_to_ask.length} questions to ask</QueueChip>}
                        {p.talking_points.length > 0 && <QueueChip>{p.talking_points.length} talking points</QueueChip>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>Meeting</div>
                      <div className="mt-1 text-[13px] font-medium leading-5" style={{ color: 'var(--color-ink)' }}>
                        {shortDateTime(p.meeting_at)}
                      </div>
                      <div className="mt-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                        Updated {shortDateTime(p.updated_at)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>Checklist</div>
                      <div className="mt-1 text-[13px] font-medium" style={{ color: 'var(--color-ink)' }}>
                        {logisticsDone}/{p.logistics.length || 0} done
                      </div>
                      <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-paper-2)' }}>
                        <div className={`h-full rounded-full ${SURFACE_TRANSITION}`}
                          style={{ width: `${p.logistics.length ? Math.round((logisticsDone / p.logistics.length) * 100) : 0}%`, background: 'var(--color-green-700)' }} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </SurfacePanel>

          <div className="grid gap-3">
            <SurfacePanel className="px-4 py-4">
              <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Workflow</div>
              <div className="mt-3 grid gap-2">
                <WorkflowLine step="1" text="Open a reply from Sent when a professor asks to meet." />
                <WorkflowLine step="2" text="Generate or review the briefing and fit analysis." />
                <WorkflowLine step="3" text="Use the mock interview panel to practice answers out loud." />
              </div>
            </SurfacePanel>

            <SurfacePanel className="px-4 py-4">
              <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Queue signals</div>
              <div className="mt-3 grid gap-2">
                <SignalRow label="Ready to review" value={prepStats.ready} />
                <SignalRow label="Meeting scheduled" value={prepStats.scheduled} />
                <SignalRow label="Completed packs" value={prepStats.completed} />
              </div>
            </SurfacePanel>
          </div>
        </section>
      )}
    </PageCanvas>
  )
}

// ─── shared bits ────────────────────────────────────────────────────

function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(resize, [props.value])
  return (
    <textarea {...props} ref={ref} onInput={resize}
      style={{ resize: 'none', overflow: 'hidden', ...(props.style || {}) }} />
  )
}

const editorStyle = {
  background: 'var(--color-paper)',
  borderColor: 'var(--color-line)',
  color: 'var(--color-ink-soft)',
  lineHeight: 1.6,
}

function Prose({ text }: { text: string }) {
  const paras = (text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  if (!paras.length) {
    return <div className="text-[13px] italic" style={{ color: 'var(--color-muted)' }}>Nothing here yet.</div>
  }
  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: '72ch' }}>
      {paras.map((p, i) => (
        <p key={i} className="text-[14px]" style={{ color: 'var(--color-ink-soft)', lineHeight: 1.7 }}>{p}</p>
      ))}
    </div>
  )
}

function EditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
      {editing ? <><Check size={11} /> Done</> : <><Pencil size={11} /> Edit</>}
    </button>
  )
}

function TabPanel({ title, icon: Icon, editing, onEdit, children }: {
  title: string; icon: typeof Target
  editing?: boolean; onEdit?: () => void; children: React.ReactNode
}) {
  return (
    <SurfacePanel className="p-5">
      <div className="flex items-center justify-between mb-3.5">
        <div className="text-[12px] uppercase tracking-wider flex items-center gap-1.5 font-medium"
          style={{ color: 'var(--color-muted-2)' }}>
          <Icon size={13} /> {title}
        </div>
        {onEdit && <EditToggle editing={!!editing} onToggle={onEdit} />}
      </div>
      {children}
    </SurfacePanel>
  )
}

function PageCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full overflow-x-hidden px-5 py-4" style={PAGE_BG}>
      <div className="w-[320px] max-w-full min-w-0 overflow-hidden sm:w-full">
        {children}
      </div>
    </div>
  )
}

function SurfacePanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-md border shadow-[0_1px_2px_rgba(28,34,48,0.03)] ${SURFACE_TRANSITION} ${className}`.trim()}
      style={{ background: 'color-mix(in srgb, var(--color-white) 95%, var(--color-paper))', borderColor: 'var(--color-line-strong)' }}
    >
      {children}
    </section>
  )
}

function Banner({ children, tone }: { children: ReactNode; tone: 'rose' | 'violet' }) {
  const styles = tone === 'rose'
    ? { background: 'var(--color-rose-50)', color: 'var(--color-rose-700)', borderColor: 'var(--color-rose-100, #ffe4e6)' }
    : { background: 'var(--color-violet-50)', color: 'var(--color-violet-700)', borderColor: 'var(--color-violet-100, #ede9fe)' }
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border px-4 py-3 text-[13px]" style={styles}>
      {children}
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <SurfacePanel className="px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="mt-2 text-[34px] font-bold leading-none" style={{ color: 'var(--color-ink)' }}>{value}</div>
      <div className="mt-2 text-[12px]" style={{ color: 'var(--color-muted)' }}>{detail}</div>
    </SurfacePanel>
  )
}

function QueueChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
      {children}
    </span>
  )
}

function WorkflowLine({ step, text }: { step: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[11px] font-semibold"
        style={{ background: 'var(--color-ink)', color: 'white' }}>
        {step}
      </div>
      <div className="text-[13px] leading-5" style={{ color: 'var(--color-ink-soft)' }}>{text}</div>
    </div>
  )
}

function SignalRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>{value}</span>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'amber' }) {
  const color = tone === 'green' ? 'var(--color-green-700)' : 'var(--color-amber-700)'
  const background = tone === 'green' ? 'var(--color-green-50)' : 'var(--color-amber-50)'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-medium"
      style={{ background, borderColor: 'var(--color-line)', color }}>
      <Sparkles size={12} />
      {label}
    </span>
  )
}

// ─── detail view ────────────────────────────────────────────────────

type TabKey = 'briefing' | 'fit' | 'points' | 'qa' | 'logistics' | 'mock'

function PrepDetail({ prep, onBack, onChanged, onRegenerate, regenerating }: {
  prep: Prep; onBack: () => void; onChanged: () => void
  onRegenerate: () => void; regenerating: boolean
}) {
  const confirm = useConfirm()
  const [tab, setTab] = useState<TabKey>('briefing')
  const [err, setErr] = useState<string | null>(null)

  const save = async (patch: Parameters<typeof api.patchInterviewPrep>[1]) => {
    try {
      await api.patchInterviewPrep(prep.id, patch)
      onChanged()
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  const regenerate = async () => {
    const ok = await confirm({
      variant: 'primary',
      title: 'Regenerate prep?',
      message: 'Quill will rebuild every section from scratch. Your edits to this prep will be overwritten.',
      confirmLabel: 'Regenerate', cancelLabel: 'Keep current',
    })
    if (ok) onRegenerate()
  }

  const remove = async () => {
    const ok = await confirm({
      variant: 'danger',
      title: 'Delete this interview prep?',
      message: 'This removes the prep and any mock interview sessions for it.',
      confirmLabel: 'Delete', cancelLabel: 'Cancel',
    })
    if (!ok) return
    await api.deleteInterviewPrep(prep.id)
    onChanged()
    onBack()
  }

  const st = STATUS_STYLE[prep.status] || STATUS_STYLE.draft
  const doneCount = prep.logistics.filter((l) => l.done).length

  const TABS: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'briefing', label: 'Briefing' },
    { key: 'fit', label: 'Fit' },
    { key: 'points', label: 'Talking points', badge: prep.talking_points.length },
    { key: 'qa', label: 'Q & A', badge: prep.likely_questions.length },
    { key: 'logistics', label: 'Logistics', badge: prep.logistics.length },
    { key: 'mock', label: 'Mock interview' },
  ]

  return (
    <div className="flex flex-col gap-3">
      <button onClick={onBack}
        className={`inline-flex items-center gap-1 self-start text-[13px] ${SURFACE_TRANSITION}`}
        style={{ color: 'var(--color-brand-600)' }}>
        <ChevronLeft size={14} /> All interviews
      </button>

      <SurfacePanel className="px-4 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[30px] font-bold tracking-tight" style={{ color: 'var(--color-ink)' }}>
                {prep.professor_name}
              </h1>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{ background: st.bg, color: st.fg }}>
                {st.label}
              </span>
            </div>
            <div className="mt-1 text-[13px]" style={{ color: 'var(--color-muted)' }}>
              {[prep.university, prep.position_type ? `${prep.position_type} position` : null].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <QueueChip>{formatMeetingLabel(prep.meeting_format)}</QueueChip>
              <QueueChip>{shortDateTime(prep.meeting_at)}</QueueChip>
              <QueueChip>{prep.talking_points.length} talking points</QueueChip>
              <QueueChip>{prep.likely_questions.length} likely questions</QueueChip>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {prep.status !== 'completed' && (
              <button onClick={() => save({ status: 'completed' })}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium hover:bg-[color:var(--color-green-50)] ${SURFACE_TRANSITION}`}
                style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-green-700)' }}>
                <Check size={12} /> Mark done
              </button>
            )}
            <button onClick={regenerate} disabled={regenerating}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium disabled:opacity-50 hover:bg-[color:var(--color-paper)] ${SURFACE_TRANSITION}`}
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
              {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button onClick={remove}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium hover:bg-[color:var(--color-rose-50)] ${SURFACE_TRANSITION}`}
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-rose-700)' }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      </SurfacePanel>

      {err && <Banner tone="rose">{err}</Banner>}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="grid gap-3 min-w-0">
          <SurfacePanel className="px-3 py-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {TABS.map((t) => {
                const active = tab === t.key
                return (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] ${SURFACE_TRANSITION}`}
                    style={{
                      background: active ? 'var(--color-ink)' : 'var(--color-white)',
                      color: active ? 'var(--color-white)' : 'var(--color-ink-soft)',
                      border: `1px solid ${active ? 'var(--color-ink)' : 'var(--color-line)'}`,
                      fontWeight: active ? 600 : 500,
                    }}>
                    {t.label}
                    {t.badge !== undefined && t.badge > 0 && (
                      <span className="rounded-full px-1.5 text-[10px] font-mono"
                        style={{
                          background: active ? 'rgba(255,255,255,0.18)' : 'var(--color-paper-2)',
                          color: active ? 'var(--color-white)' : 'var(--color-muted)',
                        }}>
                        {t.key === 'logistics' ? `${doneCount}/${t.badge}` : t.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </SurfacePanel>

          {tab === 'briefing' && <BriefingTab prep={prep} save={save} />}
          {tab === 'fit' && <FitTab prep={prep} save={save} />}
          {tab === 'points' && <PointsTab prep={prep} save={save} />}
          {tab === 'qa' && <QATab prep={prep} save={save} />}
          {tab === 'logistics' && <LogisticsTab prep={prep} save={save} />}
          {tab === 'mock' && (
            <MockInterviewPanel prepId={prep.id} professorName={prep.professor_name || 'the professor'} />
          )}
        </div>

        <div className="grid gap-3">
          <SurfacePanel className="px-4 py-4">
            <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Meeting controls</div>
            <div className="mt-3 grid gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-muted-2)' }}>Format</span>
                <select value={prep.meeting_format}
                  onChange={(e) => save({ meeting_format: e.target.value })}
                  className="rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)' }}>
                  {MEETING_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-muted-2)' }}>Meeting time</span>
                <input type="datetime-local"
                  defaultValue={prep.meeting_at ? prep.meeting_at.slice(0, 16) : ''}
                  onChange={(e) => save({ meeting_at: e.target.value || null })}
                  className="rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)' }} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-muted-2)' }}>Logistics notes</span>
                <input type="text" defaultValue={prep.meeting_notes || ''}
                  placeholder="Platform, timezone, links…"
                  onBlur={(e) => e.target.value !== (prep.meeting_notes || '') && save({ meeting_notes: e.target.value })}
                  className="rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)' }} />
              </label>
            </div>
          </SurfacePanel>

          <SurfacePanel className="px-4 py-4">
            <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Prep signals</div>
            <div className="mt-3 grid gap-2">
              <SignalRow label="Generated" value={shortDateTime(prep.generated_at)} />
              <SignalRow label="Updated" value={shortDateTime(prep.updated_at)} />
              <SignalRow label="Checklist" value={`${doneCount}/${prep.logistics.length || 0}`} />
            </div>
          </SurfacePanel>
        </div>
      </div>
    </div>
  )
}

type SaveFn = (patch: Parameters<typeof api.patchInterviewPrep>[1]) => Promise<void>

// ─── Briefing tab ───────────────────────────────────────────────────

function BriefingTab({ prep, save }: { prep: Prep; save: SaveFn }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Briefing>(prep.briefing)

  useEffect(() => { setDraft(prep.briefing); setEditing(false) }, [prep.id, prep.briefing])

  const commit = (next: Briefing) => { setDraft(next); save({ briefing: next }) }

  return (
    <TabPanel title="Briefing" icon={Info} editing={editing}
      onEdit={() => { if (editing) commit(draft); setEditing(!editing) }}>
      {/* Key facts */}
      {editing ? (
        <div className="flex flex-col gap-2 mb-4">
          {draft.key_facts.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={f.label} placeholder="Label"
                onChange={(e) => {
                  const next = [...draft.key_facts]; next[i] = { ...f, label: e.target.value }
                  setDraft({ ...draft, key_facts: next })
                }}
                className="px-2 py-1 rounded border text-[12px] outline-none w-32"
                style={{ borderColor: 'var(--color-line)' }} />
              <input value={f.value} placeholder="Value"
                onChange={(e) => {
                  const next = [...draft.key_facts]; next[i] = { ...f, value: e.target.value }
                  setDraft({ ...draft, key_facts: next })
                }}
                className="px-2 py-1 rounded border text-[12px] outline-none flex-1"
                style={{ borderColor: 'var(--color-line)' }} />
              <button onClick={() => setDraft({ ...draft, key_facts: draft.key_facts.filter((_, j) => j !== i) })}
                style={{ color: 'var(--color-muted)' }}>
                <X size={13} />
              </button>
            </div>
          ))}
          <button onClick={() => setDraft({ ...draft, key_facts: [...draft.key_facts, { label: '', value: '' }] })}
            className="inline-flex items-center gap-1 text-[12px] self-start"
            style={{ color: 'var(--color-brand-600)' }}>
            <Plus size={12} /> Add fact
          </button>
        </div>
      ) : (
        prep.briefing.key_facts.length > 0 && (
          <div className="grid gap-2 mb-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {prep.briefing.key_facts.map((f, i) => (
              <div key={i} className="rounded-md border px-3 py-2"
                style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--color-muted-2)' }}>
                  {f.label}
                </div>
                <div className="text-[13px] font-medium" style={{ color: 'var(--color-ink)' }}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Summary */}
      {editing ? (
        <AutoTextarea value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          className="w-full text-[13px] px-3 py-2 rounded border outline-none font-sans mb-3"
          style={{ ...editorStyle, minHeight: 120 }} />
      ) : (
        <Prose text={prep.briefing.summary} />
      )}

      {/* What to expect */}
      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted-2)' }}>
          What to expect
        </div>
        {editing ? (
          <AutoTextarea value={draft.what_to_expect}
            onChange={(e) => setDraft({ ...draft, what_to_expect: e.target.value })}
            className="w-full text-[13px] px-3 py-2 rounded border outline-none font-sans"
            style={{ ...editorStyle, minHeight: 70 }} />
        ) : (
          <div className="rounded-md px-3 py-2.5 text-[13px]"
            style={{ background: 'var(--color-blue-50)', color: 'var(--color-blue-700)', lineHeight: 1.6 }}>
            {prep.briefing.what_to_expect || 'Not specified.'}
          </div>
        )}
      </div>
    </TabPanel>
  )
}

// ─── Fit tab ────────────────────────────────────────────────────────

function FitTab({ prep, save }: { prep: Prep; save: SaveFn }) {
  const [editing, setEditing] = useState(false)
  const [strengths, setStrengths] = useState(prep.fit_analysis.strengths.join('\n'))
  const [gaps, setGaps] = useState(prep.fit_analysis.gaps.join('\n'))
  const [verdict, setVerdict] = useState(prep.fit_analysis.verdict)

  useEffect(() => {
    setStrengths(prep.fit_analysis.strengths.join('\n'))
    setGaps(prep.fit_analysis.gaps.join('\n'))
    setVerdict(prep.fit_analysis.verdict)
    setEditing(false)
  }, [prep.id, prep.fit_analysis])

  const commit = () => {
    const next: FitAnalysis = {
      strengths: strengths.split('\n').map((s) => s.trim()).filter(Boolean),
      gaps: gaps.split('\n').map((s) => s.trim()).filter(Boolean),
      verdict: verdict.trim(),
    }
    save({ fit_analysis: next })
  }

  const fit = prep.fit_analysis

  return (
    <TabPanel title="Fit analysis" icon={Target} editing={editing}
      onEdit={() => { if (editing) commit(); setEditing(!editing) }}>
      {editing ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-green-700)' }}>
              Strengths (one per line)
            </div>
            <AutoTextarea value={strengths} onChange={(e) => setStrengths(e.target.value)}
              className="w-full text-[13px] px-3 py-2 rounded border outline-none font-sans"
              style={{ ...editorStyle, minHeight: 100 }} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-amber-700)' }}>
              Gaps to prepare for (one per line)
            </div>
            <AutoTextarea value={gaps} onChange={(e) => setGaps(e.target.value)}
              className="w-full text-[13px] px-3 py-2 rounded border outline-none font-sans"
              style={{ ...editorStyle, minHeight: 100 }} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted-2)' }}>
              Verdict
            </div>
            <AutoTextarea value={verdict} onChange={(e) => setVerdict(e.target.value)}
              className="w-full text-[13px] px-3 py-2 rounded border outline-none font-sans"
              style={{ ...editorStyle, minHeight: 60 }} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="text-[11px] uppercase tracking-wider mb-2 flex items-center gap-1"
                style={{ color: 'var(--color-green-700)' }}>
                <Check size={12} /> Strengths
              </div>
              <div className="flex flex-col gap-1.5">
                {fit.strengths.map((s, i) => (
                  <div key={i} className="rounded-md px-3 py-2 text-[13px] flex gap-2"
                    style={{ background: 'var(--color-green-50)', color: 'var(--color-green-700)', lineHeight: 1.55 }}>
                    <Check size={14} className="flex-shrink-0 mt-0.5" />
                    <span>{s}</span>
                  </div>
                ))}
                {!fit.strengths.length && (
                  <div className="text-[12px] italic" style={{ color: 'var(--color-muted)' }}>None listed.</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider mb-2 flex items-center gap-1"
                style={{ color: 'var(--color-amber-700)' }}>
                <AlertTriangle size={12} /> Gaps to prepare for
              </div>
              <div className="flex flex-col gap-1.5">
                {fit.gaps.map((g, i) => (
                  <div key={i} className="rounded-md px-3 py-2 text-[13px] flex gap-2"
                    style={{ background: 'var(--color-amber-50)', color: 'var(--color-amber-700)', lineHeight: 1.55 }}>
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>{g}</span>
                  </div>
                ))}
                {!fit.gaps.length && (
                  <div className="text-[12px] italic" style={{ color: 'var(--color-muted)' }}>None listed.</div>
                )}
              </div>
            </div>
          </div>
          {fit.verdict && (
            <div className="rounded-md border-l-4 px-3 py-2.5 text-[13px]"
              style={{
                background: 'var(--color-violet-50)', borderColor: 'var(--color-violet-700)',
                color: 'var(--color-violet-700)', lineHeight: 1.6,
              }}>
              <span className="font-semibold">Verdict: </span>{fit.verdict}
            </div>
          )}
        </>
      )}
    </TabPanel>
  )
}

// ─── Talking points tab ─────────────────────────────────────────────

function PointsTab({ prep, save }: { prep: Prep; save: SaveFn }) {
  const [editing, setEditing] = useState(false)
  const [points, setPoints] = useState<TalkingPoint[]>(prep.talking_points)
  const [open, setOpen] = useState<number | null>(0)

  useEffect(() => { setPoints(prep.talking_points); setEditing(false) }, [prep.id, prep.talking_points])

  const commit = () => save({
    talking_points: points
      .map((p) => ({ point: p.point.trim(), detail: p.detail.trim() }))
      .filter((p) => p.point),
  })

  if (editing) {
    return (
      <TabPanel title="Talking points" icon={ListChecks} editing
        onEdit={() => { commit(); setEditing(false) }}>
        <div className="flex flex-col gap-3">
          {points.map((p, i) => (
            <div key={i} className="rounded-md border p-3 flex flex-col gap-2"
              style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
              <div className="flex items-center gap-2">
                <input value={p.point} placeholder="Talking point headline"
                  onChange={(e) => {
                    const next = [...points]; next[i] = { ...p, point: e.target.value }; setPoints(next)
                  }}
                  className="px-2 py-1 rounded border text-[13px] font-medium outline-none flex-1"
                  style={{ borderColor: 'var(--color-line)' }} />
                <button onClick={() => setPoints(points.filter((_, j) => j !== i))}
                  style={{ color: 'var(--color-muted)' }}>
                  <X size={14} />
                </button>
              </div>
              <AutoTextarea value={p.detail} placeholder="How to make this point and what it ties to…"
                onChange={(e) => {
                  const next = [...points]; next[i] = { ...p, detail: e.target.value }; setPoints(next)
                }}
                className="w-full text-[12px] px-2 py-1.5 rounded border outline-none font-sans"
                style={{ ...editorStyle, background: 'var(--color-white)', minHeight: 56 }} />
            </div>
          ))}
          <button onClick={() => setPoints([...points, { point: '', detail: '' }])}
            className="inline-flex items-center gap-1 text-[12px] self-start"
            style={{ color: 'var(--color-brand-600)' }}>
            <Plus size={12} /> Add talking point
          </button>
        </div>
      </TabPanel>
    )
  }

  return (
    <TabPanel title="Talking points" icon={ListChecks}
      onEdit={() => setEditing(true)}>
      <div className="text-[12px] mb-3" style={{ color: 'var(--color-muted)' }}>
        Click a point to see how to make it.
      </div>
      <div className="flex flex-col gap-2">
        {prep.talking_points.map((p, i) => {
          const isOpen = open === i
          return (
            <div key={i} className="rounded-md border overflow-hidden"
              style={{ borderColor: 'var(--color-line)' }}>
              <button onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                style={{ background: isOpen ? 'var(--color-paper)' : 'var(--color-white)' }}>
                <div className="flex-shrink-0 w-6 h-6 rounded-full grid place-items-center text-[12px] font-semibold text-white"
                  style={{ background: 'var(--color-brand-600)' }}>
                  {i + 1}
                </div>
                <span className="text-[13px] font-medium flex-1" style={{ color: 'var(--color-ink)' }}>
                  {p.point}
                </span>
                <ChevronDown size={15}
                  style={{
                    color: 'var(--color-muted)',
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s',
                  }} />
              </button>
              {isOpen && (
                <div className="px-3 py-2.5 border-t text-[13px]"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)', lineHeight: 1.65 }}>
                  {p.detail || <span className="italic" style={{ color: 'var(--color-muted)' }}>No explanation yet. Regenerate the prep to add one.</span>}
                </div>
              )}
            </div>
          )
        })}
        {!prep.talking_points.length && (
          <div className="text-[12px] italic" style={{ color: 'var(--color-muted)' }}>None generated.</div>
        )}
      </div>
    </TabPanel>
  )
}

// ─── Q & A tab ──────────────────────────────────────────────────────

function QATab({ prep, save }: { prep: Prep; save: SaveFn }) {
  const [questions, setQuestions] = useState<LikelyQuestion[]>(prep.likely_questions)
  const [open, setOpen] = useState<number | null>(null)
  const [asks, setAsks] = useState(prep.questions_to_ask.join('\n'))
  const [editAsks, setEditAsks] = useState(false)

  useEffect(() => {
    setQuestions(prep.likely_questions)
    setAsks(prep.questions_to_ask.join('\n'))
  }, [prep.id, prep.likely_questions, prep.questions_to_ask])

  return (
    <div className="flex flex-col gap-4">
      <TabPanel title="Likely questions and your answers" icon={HelpCircle}>
        <div className="flex flex-col gap-2">
          {questions.length === 0 && (
            <div className="text-[12px] italic" style={{ color: 'var(--color-muted)' }}>None generated.</div>
          )}
          {questions.map((q, i) => {
            const cat = CATEGORY_STYLE[q.category] || CATEGORY_STYLE.logistics
            const isOpen = open === i
            return (
              <div key={i} className="rounded-md border overflow-hidden"
                style={{ borderColor: 'var(--color-line)' }}>
                <button onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                  style={{ background: isOpen ? 'var(--color-paper)' : 'var(--color-white)' }}>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase whitespace-nowrap"
                    style={{ background: cat.bg, color: cat.fg }}>
                    {q.category}
                  </span>
                  <span className="text-[13px] font-medium flex-1" style={{ color: 'var(--color-ink)' }}>
                    {q.question}
                  </span>
                  <ChevronDown size={15}
                    style={{
                      color: 'var(--color-muted)',
                      transform: isOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.15s',
                    }} />
                </button>
                {isOpen && (
                  <div className="px-3 py-2.5 border-t" style={{ borderColor: 'var(--color-line)' }}>
                    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted-2)' }}>
                      Your answer (editable)
                    </div>
                    <AutoTextarea
                      value={q.draft_answer}
                      onChange={(e) => {
                        const next = [...questions]; next[i] = { ...q, draft_answer: e.target.value }
                        setQuestions(next)
                      }}
                      onBlur={() => save({ likely_questions: questions })}
                      className="w-full text-[13px] px-2.5 py-2 rounded border outline-none font-sans"
                      style={{ ...editorStyle, background: 'var(--color-white)', minHeight: 90 }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </TabPanel>

      <TabPanel title="Questions to ask them" icon={MessageCircleQuestion} editing={editAsks}
        onEdit={() => {
          if (editAsks) save({ questions_to_ask: asks.split('\n').map((s) => s.trim()).filter(Boolean) })
          setEditAsks(!editAsks)
        }}>
        {editAsks ? (
          <AutoTextarea value={asks} onChange={(e) => setAsks(e.target.value)}
            placeholder="One question per line…"
            className="w-full text-[13px] px-3 py-2 rounded border outline-none font-sans"
            style={{ ...editorStyle, minHeight: 120 }} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {prep.questions_to_ask.map((q, i) => (
              <li key={i} className="flex gap-2 text-[13px]" style={{ color: 'var(--color-ink-soft)', lineHeight: 1.6 }}>
                <MessageCircleQuestion size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-brand-600)' }} />
                <span>{q}</span>
              </li>
            ))}
            {!prep.questions_to_ask.length && (
              <div className="text-[12px] italic" style={{ color: 'var(--color-muted)' }}>None generated.</div>
            )}
          </ul>
        )}
      </TabPanel>
    </div>
  )
}

// ─── Logistics tab ──────────────────────────────────────────────────

function LogisticsTab({ prep, save }: { prep: Prep; save: SaveFn }) {
  const [items, setItems] = useState(prep.logistics)
  useEffect(() => { setItems(prep.logistics) }, [prep.id, prep.logistics])

  const done = items.filter((i) => i.done).length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0

  return (
    <TabPanel title="Logistics checklist" icon={ClipboardList}>
      {items.length > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>
            <span>{done} of {items.length} done</span><span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-paper-2)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: 'var(--color-green-700)' }} />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {items.length === 0 && (
          <div className="text-[12px] italic" style={{ color: 'var(--color-muted)' }}>Nothing to check off.</div>
        )}
        {items.map((it, i) => (
          <label key={i} className="flex items-center gap-2.5 text-[13px] cursor-pointer rounded-md px-2 py-1.5"
            style={{ color: 'var(--color-ink-soft)', background: it.done ? 'var(--color-green-50)' : 'transparent' }}>
            <input type="checkbox" checked={!!it.done}
              onChange={() => {
                const next = items.map((x, j) => j === i ? { ...x, done: !x.done } : x)
                setItems(next)
                save({ logistics: next })
              }} />
            <span style={{ textDecoration: it.done ? 'line-through' : 'none', opacity: it.done ? 0.65 : 1 }}>
              {it.item}
            </span>
          </label>
        ))}
      </div>
    </TabPanel>
  )
}

// ─── Mock interview ─────────────────────────────────────────────────

type ConvoPhase = 'idle' | 'speaking' | 'listening' | 'thinking'

function MockInterviewPanel({ prepId, professorName }: { prepId: number; professorName: string }) {
  const [mock, setMock] = useState<MockInterview | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [convoMode, setConvoMode] = useState(true)
  const [listening, setListening] = useState(false)
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recRef = useRef<Recognizer | null>(null)
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sttBaseRef = useRef('')
  const playedIdxRef = useRef(-1)
  // Refs mirror state so the audio / recognition callbacks (created once)
  // always see current values instead of stale closures.
  const answerRef = useRef('')
  const mockRef = useRef<MockInterview | null>(null)
  const convoRef = useRef(true)
  const busyRef = useRef(false)
  const doneRef = useRef(false)

  const done = mock?.status === 'completed'
  doneRef.current = done
  convoRef.current = convoMode
  busyRef.current = busy

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mock?.transcript?.length])

  const clearSilence = () => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null }
  }
  const stopMic = () => { try { recRef.current?.stop() } catch { /* noop */ } }

  // Stop any audio / mic / timer when the panel unmounts.
  useEffect(() => () => {
    audioRef.current?.pause()
    clearSilence()
    try { recRef.current?.abort() } catch { /* noop */ }
  }, [])

  const updateAnswer = (t: string) => { answerRef.current = t; setAnswer(t) }
  const applyMock = (m: MockInterview) => { mockRef.current = m; setMock(m) }

  // Submit the current answer and pull the professor's next turn.
  const submitAnswer = async () => {
    const m = mockRef.current
    const a = answerRef.current.trim()
    if (!m || !a || busyRef.current || m.status === 'completed') return
    clearSilence(); stopMic()
    audioRef.current?.pause()
    setBusy(true); busyRef.current = true; setErr(null)
    try {
      applyMock(await api.mockInterviewTurn(m.id, a))
      updateAnswer('')
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false); busyRef.current = false }
  }

  // Open the mic and transcribe live. A pause of ~2.8s ends the turn; in
  // conversation mode that auto-submits the answer (see onend).
  const beginListening = () => {
    if (doneRef.current || busyRef.current) return
    const rec = createRecognizer()
    if (!rec) {
      setErr('Voice input needs Chrome or Edge. You can still type your answer.')
      return
    }
    recRef.current = rec
    sttBaseRef.current = answerRef.current ? answerRef.current.trimEnd() + ' ' : ''
    let finalText = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      updateAnswer(sttBaseRef.current + finalText + interim)
      clearSilence()
      silenceRef.current = setTimeout(stopMic, 2800)
    }
    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setErr(`Microphone error: ${e.error}`)
      }
      setListening(false)
    }
    rec.onend = () => {
      setListening(false)
      clearSilence()
      if (convoRef.current && !busyRef.current && answerRef.current.trim()) {
        submitAnswer()
      }
    }
    try { rec.start(); setListening(true) } catch { /* already running */ }
  }

  const speak = (text: string, idx: number | null) => {
    audioRef.current?.pause()
    clearSilence()
    const a = new Audio(ttsUrl(text))
    audioRef.current = a
    setSpeakingIdx(idx)
    const clear = () => setSpeakingIdx((cur) => (cur === idx ? null : cur))
    a.onended = () => {
      clear()
      // Hand the turn to the applicant: open the mic automatically.
      if (convoRef.current && !doneRef.current) beginListening()
    }
    a.onerror = clear
    a.play().catch(clear)
  }

  // Auto-play the newest professor question. In conversation mode speak()'s
  // onended chains straight into listening, so this drives the whole loop.
  useEffect(() => {
    if (!convoMode) return
    const tr = mock?.transcript || []
    let idx = -1
    for (let i = tr.length - 1; i >= 0; i--) {
      if (tr[i].role === 'professor') { idx = i; break }
    }
    if (idx > playedIdxRef.current) {
      playedIdxRef.current = idx
      speak(tr[idx].text, idx)
    }
  }, [mock?.transcript?.length, convoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMic = () => {
    if (listening) { clearSilence(); stopMic() }
    else beginListening()
  }

  const start = async () => {
    setBusy(true); busyRef.current = true; setErr(null)
    playedIdxRef.current = -1
    try { applyMock(await api.startMockInterview(prepId)) }
    catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false); busyRef.current = false }
  }

  const finish = async () => {
    const m = mockRef.current
    if (!m || busyRef.current) return
    clearSilence(); stopMic()
    audioRef.current?.pause()
    setBusy(true); busyRef.current = true; setErr(null)
    try { applyMock(await api.finishMockInterview(m.id)) }
    catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false); busyRef.current = false }
  }

  const phase: ConvoPhase =
    busy ? 'thinking'
    : speakingIdx !== null ? 'speaking'
    : listening ? 'listening'
    : 'idle'

  return (
    <TabPanel title="Mock interview" icon={MessageSquare}>
      {!mock ? (
        <div>
          <div className="text-[13px] mb-3" style={{ color: 'var(--color-muted)' }}>
            Practice with Quill role-playing {professorName}. In conversation mode it
            is fully hands-free: the question is read aloud, the mic opens for your
            answer, and your turn is sent automatically when you pause.
          </div>
          <button onClick={start} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[13px] font-medium disabled:opacity-50"
            style={{ background: 'var(--color-brand-600)', color: 'var(--color-white)' }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy ? 'Starting…' : 'Start mock interview'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            {!done ? <PhaseBadge phase={phase} professorName={professorName} convoMode={convoMode} />
                   : <span />}
            <button onClick={() => setConvoMode((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border flex-shrink-0"
              style={{
                background: convoMode ? 'var(--color-brand-50)' : 'var(--color-white)',
                borderColor: 'var(--color-line)',
                color: convoMode ? 'var(--color-brand-700)' : 'var(--color-muted)',
              }}
              title={convoMode
                ? 'Hands-free: questions are spoken and answers auto-send'
                : 'Manual: type and send answers yourself'}>
              {convoMode ? <Volume2 size={11} /> : <VolumeX size={11} />}
              {convoMode ? 'Conversation' : 'Manual'}
            </button>
          </div>
          {(mock.transcript || []).map((t, i) => (
            <div key={i} className={t.role === 'applicant' ? 'self-end' : 'self-start'}
              style={{ maxWidth: '85%' }}>
              {t.role === 'feedback' ? (
                <div className="rounded-md px-3 py-2 text-[12px]"
                  style={{ background: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>
                  <span className="font-medium">Feedback: </span>{t.text}
                </div>
              ) : (
                <div className="rounded-md px-3 py-2 text-[13px]"
                  style={{
                    background: t.role === 'applicant' ? 'var(--color-brand-600)' : 'var(--color-paper-2)',
                    color: t.role === 'applicant' ? 'var(--color-white)' : 'var(--color-ink)',
                  }}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.7 }}>
                      {t.role === 'applicant' ? 'You' : professorName}
                    </div>
                    {t.role === 'professor' && (
                      <button onClick={() => speak(t.text, i)}
                        title="Play this question"
                        className="flex-shrink-0 -my-0.5 p-0.5 rounded hover:opacity-70">
                        {speakingIdx === i
                          ? <Volume2 size={12} className="animate-pulse" style={{ color: 'var(--color-brand-600)' }} />
                          : <Volume2 size={12} style={{ color: 'var(--color-muted)' }} />}
                      </button>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap" style={{ lineHeight: 1.55 }}>{t.text}</div>
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />

          {mock.summary && (
            <div className="rounded-md border p-3 text-[13px]"
              style={{ background: 'var(--color-green-50)', borderColor: 'var(--color-green-200, #bbf7d0)', color: 'var(--color-green-700)' }}>
              <div className="text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1">
                <Flag size={11} /> Session summary
              </div>
              <div className="whitespace-pre-wrap" style={{ lineHeight: 1.6 }}>{mock.summary}</div>
            </div>
          )}

          {!done && (
            <>
              <div className="relative">
                <AutoTextarea value={answer} onChange={(e) => updateAnswer(e.target.value)}
                  placeholder={listening ? 'Listening… speak your answer' : 'Type or speak your answer…'}
                  className="w-full text-[13px] px-3 py-2 pr-10 rounded border outline-none font-sans"
                  style={{
                    ...editorStyle, background: 'var(--color-white)', minHeight: 70,
                    borderColor: listening ? 'var(--color-rose-400, #fb7185)' : undefined,
                  }} />
                <button onClick={toggleMic} disabled={busy}
                  title={listening ? 'Stop and send' : 'Answer by voice'}
                  className="absolute top-2 right-2 p-1.5 rounded-md disabled:opacity-40"
                  style={{
                    background: listening ? 'var(--color-rose-600)' : 'var(--color-paper-2)',
                    color: listening ? 'var(--color-white)' : 'var(--color-muted)',
                  }}>
                  <Mic size={13} className={listening ? 'animate-pulse' : ''} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={submitAnswer} disabled={busy || !answer.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--color-brand-600)' }}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {busy ? 'Quill is responding…' : 'Send answer'}
                </button>
                <button onClick={finish} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border disabled:opacity-50"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
                  <Flag size={12} /> Finish and get feedback
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {err && (
        <div className="mt-2 text-[12px] px-2.5 py-1.5 rounded"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
          {err}
        </div>
      )}
    </TabPanel>
  )
}

function PhaseBadge({ phase, professorName, convoMode }: {
  phase: ConvoPhase; professorName: string; convoMode: boolean
}) {
  const map: Record<ConvoPhase, { label: string; icon: ReactNode; color: string; bg: string }> = {
    thinking:  { label: 'Quill is thinking…', icon: <Loader2 size={11} className="animate-spin" />,
                 color: 'var(--color-amber-700)', bg: 'var(--color-amber-50)' },
    speaking:  { label: `${professorName} is speaking…`, icon: <Volume2 size={11} className="animate-pulse" />,
                 color: 'var(--color-brand-700)', bg: 'var(--color-brand-50)' },
    listening: { label: 'Listening… pause when you are done', icon: <Mic size={11} className="animate-pulse" />,
                 color: 'var(--color-rose-700)', bg: 'var(--color-rose-50)' },
    idle:      { label: convoMode ? 'Tap the mic to answer' : 'Type your answer', icon: <MessageSquare size={11} />,
                 color: 'var(--color-muted)', bg: 'var(--color-paper-2)' },
  }
  const s = map[phase]
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium"
      style={{ background: s.bg, color: s.color }}>
      {s.icon}{s.label}
    </span>
  )
}
