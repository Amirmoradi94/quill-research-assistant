import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  GraduationCap,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import { api, type SentReply, type SentRow } from '@/lib/api'
import { formatCategory } from '@/lib/categories'
import { useConfirm } from '@/components/ConfirmDialog'

const STATUS_OPTIONS = ['sent', 'no_reply', 'replied', 'interview', 'offer', 'rejected'] as const
type Status = typeof STATUS_OPTIONS[number]

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  sent: { bg: 'var(--color-blue-50)', fg: 'var(--color-blue-700)', label: 'Sent' },
  no_reply: { bg: 'var(--color-amber-50)', fg: 'var(--color-amber-700)', label: 'No reply' },
  replied: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', label: 'Replied' },
  interview: { bg: 'var(--color-violet-50)', fg: 'var(--color-violet-700)', label: 'Interview' },
  offer: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', label: 'Offer' },
  rejected: { bg: 'var(--color-rose-50)', fg: 'var(--color-rose-700)', label: 'Rejected' },
}

const FOLLOWUP_DAYS = 7

const isFollowupDue = (r: SentRow) =>
  r.status === 'sent' &&
  r.reply_count === 0 &&
  (r.days_since_sent ?? 0) >= FOLLOWUP_DAYS

export function Sent() {
  const [rows, setRows] = useState<SentRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Status | 'all' | 'followup'>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [polling, setPolling] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  const reload = () =>
    api.sent().then((next) => {
      setRows(next)
      setErr(null)
    }).catch((e) => setErr(e?.message || String(e)))

  useEffect(() => {
    reload()
    window.addEventListener('quill:data-changed', reload)
    return () => window.removeEventListener('quill:data-changed', reload)
  }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: rows.length,
      followup: 0,
      sent: 0,
      no_reply: 0,
      replied: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
    }
    for (const r of rows) {
      c[r.status] = (c[r.status] || 0) + 1
      if (isFollowupDue(r)) c.followup++
    }
    return c
  }, [rows])

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'followup') return rows.filter(isFollowupDue)
    return rows.filter((r) => r.status === filter)
  }, [rows, filter])

  const selected = useMemo(() => {
    if (!filtered.length) return null
    return filtered.find((r) => r.draft_id === selectedId) || filtered[0]
  }, [filtered, selectedId])

  useEffect(() => {
    if (!filtered.length) return
    if (!filtered.some((r) => r.draft_id === selectedId)) {
      setSelectedId(filtered[0].draft_id)
    }
  }, [filtered, selectedId])

  const checkReplies = async () => {
    setPolling(true)
    setToast(null)
    try {
      const r = await api.checkReplies()
      setToast({
        ok: true,
        text: r.new_replies > 0
          ? `${r.new_replies} new ${r.new_replies === 1 ? 'reply' : 'replies'} across ${r.checked} sent emails.`
          : `Checked ${r.checked} sent emails. No new replies.`,
      })
      if (r.errors.length) console.warn('check-replies errors:', r.errors)
      reload()
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || String(e) })
    } finally {
      setPolling(false)
      setTimeout(() => setToast(null), 8000)
    }
  }

  const changeStatus = async (row: SentRow, status: Status) => {
    if (status === row.status) return
    try {
      await api.patchProfessor(row.professor_id, { status })
      setRows((prev) => prev.map((r) => r.professor_id === row.professor_id ? { ...r, status } : r))
      window.dispatchEvent(new CustomEvent('quill:data-changed'))
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || String(e) })
      setTimeout(() => setToast(null), 6000)
    }
  }

  const repliedCount = rows.filter((r) => r.reply_count > 0).length
  const outcomeCount = counts.interview + counts.offer

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
      <div className="w-[320px] max-w-full min-w-0 overflow-hidden sm:w-full">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-muted)' }}>
              Outreach / Sent
            </div>
            <h1 className="mt-1 font-bold leading-tight tracking-tight" style={{ fontSize: 31, color: 'var(--color-ink)' }}>
              Sent outreach inbox
            </h1>
            <p className="mt-1 max-w-full break-words text-[13px] leading-5 md:max-w-2xl" style={{ color: 'var(--color-muted)' }}>
              Track sent emails, replies, follow-ups, and next-step outcomes from one conversation view.
            </p>
          </div>
          <button onClick={checkReplies} disabled={polling}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium disabled:opacity-60"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}>
            <RefreshCw size={14} className={polling ? 'animate-spin' : ''} />
            {polling ? 'Checking Gmail...' : 'Check replies'}
          </button>
        </div>

        {counts.followup > 0 && filter !== 'followup' && (
          <button
            onClick={() => setFilter('followup')}
            className="mb-3 flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left"
            style={{ background: 'var(--color-amber-50)', borderColor: 'var(--color-amber-200)', color: 'var(--color-amber-700)' }}
          >
            <Bell size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 text-[13px]">
              <strong>{counts.followup}</strong> {counts.followup === 1 ? 'email needs' : 'emails need'} follow-up after {FOLLOWUP_DAYS}+ days without a reply.
            </span>
            <span className="text-[12px] font-medium underline">View</span>
          </button>
        )}

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
          <KpiCard icon={<Mail size={15} />} label="Sent emails" value={counts.all} detail={`${counts.sent + counts.no_reply} still open`} />
          <KpiCard icon={<MessageSquare size={15} />} label="Replied" value={repliedCount} detail={`${counts.replied} active replies`} />
          <KpiCard icon={<Bell size={15} />} label="Follow-up due" value={counts.followup} detail={`${FOLLOWUP_DAYS}+ days no reply`} />
          <KpiCard icon={<GraduationCap size={15} />} label="Outcomes" value={outcomeCount} detail={`${counts.interview} interviews, ${counts.offer} offers`} />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 pb-1">
          <FilterChip label={`All (${counts.all})`} active={filter === 'all'} onClick={() => setFilter('all')} />
          {counts.followup > 0 && (
            <FilterChip label={`Follow-up (${counts.followup})`} active={filter === 'followup'} onClick={() => setFilter('followup')} tone="amber" />
          )}
          {STATUS_OPTIONS.map((s) => counts[s] > 0 ? (
            <FilterChip key={s} label={`${STATUS_STYLE[s].label} (${counts[s]})`} active={filter === s} onClick={() => setFilter(s)} />
          ) : null)}
        </div>

        {err && (
          <div className="mb-3 rounded-md border p-3 text-[13px]"
            style={{ background: 'var(--color-rose-50)', borderColor: 'var(--color-rose-200)', color: 'var(--color-rose-700)' }}>
            {err}
          </div>
        )}

        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
          <section className="min-w-0 overflow-hidden rounded-md border"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            <div className="border-b px-3 py-2.5" style={{ borderColor: 'var(--color-line)' }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>Conversation queue</div>
                  <div className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{filtered.length} visible threads</div>
                </div>
                <Inbox size={16} style={{ color: 'var(--color-brand-700)' }} />
              </div>
            </div>
            <div className="max-h-[650px] overflow-y-auto p-2">
              {filtered.map((row) => (
                <ConversationCard
                  key={row.draft_id}
                  row={row}
                  selected={selected?.draft_id === row.draft_id}
                  onSelect={() => setSelectedId(row.draft_id)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--color-muted)' }}>
                  No sent emails match this filter.
                </div>
              )}
            </div>
          </section>

          <section className="max-w-full min-w-0 overflow-hidden rounded-md border"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            {selected ? (
              <ThreadDetail
                row={selected}
                onStatus={(status) => changeStatus(selected, status)}
                onChanged={reload}
              />
            ) : (
              <div className="px-4 py-12 text-center text-[13px]" style={{ color: 'var(--color-muted)' }}>
                Select a sent conversation.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, detail }: {
  icon: ReactNode
  label: string
  value: ReactNode
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

function FilterChip({ label, active, onClick, tone }: {
  label: string
  active: boolean
  onClick: () => void
  tone?: 'amber'
}) {
  const amber = tone === 'amber'
  return (
    <button onClick={onClick}
      className="shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors"
      style={{
        background: active ? (amber ? 'var(--color-amber-50)' : 'var(--color-white)') : 'var(--color-paper)',
        borderColor: active ? (amber ? 'var(--color-amber-400)' : 'var(--color-line-strong)') : 'var(--color-line)',
        color: active ? (amber ? 'var(--color-amber-700)' : 'var(--color-ink)') : 'var(--color-ink-soft)',
        fontWeight: active ? 600 : 400,
      }}>
      {label}
    </button>
  )
}

function ConversationCard({ row, selected, onSelect }: {
  row: SentRow
  selected: boolean
  onSelect: () => void
}) {
  const style = STATUS_STYLE[row.status] || STATUS_STYLE.sent
  const followupDue = isFollowupDue(row)
  return (
    <button onClick={onSelect}
      className="mb-2 w-full rounded-md border p-3 text-left transition-colors last:mb-0"
      style={{
        background: selected ? 'var(--color-brand-50)' : followupDue ? 'var(--color-amber-50)' : 'var(--color-white)',
        borderColor: selected ? 'var(--color-brand-300)' : followupDue ? 'var(--color-amber-200)' : 'var(--color-line)',
      }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>{row.professor_name}</div>
          <div className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--color-muted)' }}>{row.university || 'Unknown university'}</div>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: style.bg, color: style.fg }}>
          {style.label}
        </span>
      </div>
      <div className="mt-2 line-clamp-2 text-[13px]" style={{ color: 'var(--color-ink-soft)' }}>{row.subject}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
        {row.batch_index && <span>Batch #{row.batch_index}</span>}
        {row.batch_index && <span>·</span>}
        <span>{row.days_since_sent === 0 ? 'today' : `${row.days_since_sent ?? 0}d ago`}</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare size={10} /> {row.reply_count}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {row.tier && <MiniPill>{row.tier}</MiniPill>}
        {row.research_category && <MiniPill color={`var(--color-cat-${row.research_category})`}>{formatCategory(row.research_category)}</MiniPill>}
        {followupDue && <MiniPill tone="amber">Follow-up</MiniPill>}
      </div>
    </button>
  )
}

function ThreadDetail({ row, onStatus, onChanged }: {
  row: SentRow
  onStatus: (s: Status) => void
  onChanged: () => void
}) {
  const followupDue = isFollowupDue(row)
  return (
    <div className="min-w-0">
      <div className="border-b p-3" style={{ borderColor: 'var(--color-line)' }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {row.batch_index && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--color-muted)' }}>Batch #{row.batch_index}</span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>
                <Clock size={10} /> {row.sent_at ? new Date(row.sent_at).toLocaleDateString() : 'No sent date'}
              </span>
              {followupDue && <MiniPill tone="amber">Follow-up due</MiniPill>}
            </div>
            <div className="mt-1 text-[18px] font-semibold leading-tight" style={{ color: 'var(--color-ink)' }}>
              {row.professor_name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-muted)' }}>
              <span>{row.professor_email || 'No email'}</span>
              {row.university && <><span>·</span><span>{row.university}</span></>}
              {row.tier && <MiniPill>{row.tier}</MiniPill>}
              {row.research_category && <MiniPill color={`var(--color-cat-${row.research_category})`}>{formatCategory(row.research_category)}</MiniPill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusSelect value={row.status} onChange={onStatus} />
            <Link to={`/professors/${row.professor_id}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium hover:underline"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-brand-700)' }}>
              Professor <ExternalLink size={12} />
            </Link>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatLabel label="Replies" value={row.reply_count} />
          <StatLabel label="Days since" value={row.days_since_sent ?? '-'} />
          <StatLabel label="Sent via" value={row.sent_via || 'manual'} />
          <StatLabel label="Last reply" value={row.last_reply_at ? new Date(row.last_reply_at).toLocaleDateString() : '-'} />
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div className="rounded-md border p-3" style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
          <div className="mb-1 text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            <Mail size={11} className="mr-1 inline" /> Original email
          </div>
          <div className="mb-2 break-words text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>{row.subject}</div>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 font-sans text-[12px]"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)', lineHeight: 1.55 }}>
            {row.body}
          </pre>
        </div>

        {row.replies.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              <MessageSquare size={11} className="mr-1 inline" /> Replies
            </div>
            {row.replies.map((reply) => (
              <ReplyCard key={reply.id} reply={reply} professorId={row.professor_id} onChanged={onChanged} />
            ))}
          </div>
        ) : (
          <div className="rounded-md border px-3 py-3 text-[13px]"
            style={{ background: followupDue ? 'var(--color-amber-50)' : 'var(--color-paper-2)', borderColor: followupDue ? 'var(--color-amber-200)' : 'var(--color-line)', color: 'var(--color-muted)' }}>
            No replies yet. Use Check replies to pull from Gmail.
          </div>
        )}
      </div>
    </div>
  )
}

function StatusSelect({ value, onChange }: { value: string; onChange: (s: Status) => void }) {
  const style = STATUS_STYLE[value] || STATUS_STYLE.sent
  return (
    <select value={value}
      onChange={(e) => onChange(e.target.value as Status)}
      className="rounded-md border px-2.5 py-1.5 text-[12px] font-medium outline-none"
      style={{ background: style.bg, color: style.fg, borderColor: 'transparent' }}>
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s} style={{ background: 'var(--color-white)', color: 'var(--color-ink)' }}>
          {STATUS_STYLE[s].label}
        </option>
      ))}
    </select>
  )
}

function StatLabel({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border px-2.5 py-2" style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
      <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>{value}</div>
    </div>
  )
}

function MiniPill({ children, color, tone }: { children: ReactNode; color?: string; tone?: 'amber' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
      style={{
        background: tone === 'amber' ? 'var(--color-amber-50)' : 'var(--color-paper-2)',
        borderColor: tone === 'amber' ? 'var(--color-amber-200)' : 'var(--color-line)',
        color: tone === 'amber' ? 'var(--color-amber-700)' : 'var(--color-muted)',
      }}>
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  )
}

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

function ReplyCard({ reply, professorId, onChanged }: {
  reply: SentReply
  professorId: number
  onChanged: () => void
}) {
  const dismissed = !!reply.dismissed_at
  const sent = !!reply.response_sent_at
  const [collapsed, setCollapsed] = useState(dismissed)
  const [instruction, setInstruction] = useState('')
  const [draft, setDraft] = useState(reply.response_draft || '')
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const confirm = useConfirm()

  const askQuill = async () => {
    if (!instruction.trim() || drafting) return
    setDrafting(true)
    setErr(null)
    try {
      const r = await api.draftReplyResponse(reply.id, instruction.trim())
      setDraft(r.response_draft || '')
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setDrafting(false)
    }
  }

  const send = async () => {
    if (!draft.trim() || sending) return
    const ok1 = await confirm({
      variant: 'primary',
      title: 'Review before sending',
      detail: `To: ${reply.from_email || 'the professor'}`,
      message: 'Quill drafted this reply. Read it over before sending a real email from Gmail.',
      confirmLabel: 'Looks good, continue',
      cancelLabel: 'Keep editing',
    })
    if (!ok1) return

    const ok2 = await confirm({
      variant: 'primary',
      title: 'Send this reply now?',
      message: 'Final check. The email goes out the moment you confirm. There is no undo.',
      confirmLabel: 'Send now',
      cancelLabel: 'Cancel',
    })
    if (!ok2) return

    setSending(true)
    setErr(null)
    try {
      await api.patchReply(reply.id, { response_draft: draft })
      await api.sendReplyResponse(reply.id)
      onChanged()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setSending(false)
    }
  }

  const patch = async (p: { read?: boolean; dismissed?: boolean }) => {
    if (busy) return
    setBusy(true)
    try {
      await api.patchReply(reply.id, p)
      onChanged()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  if (dismissed && collapsed) {
    return (
      <button className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-[12px]"
        style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}
        onClick={() => setCollapsed(false)}>
        <X size={12} />
        <span className="min-w-0 flex-1 truncate">Dismissed reply from {reply.from_name || reply.from_email || 'unknown'}</span>
        <span className="underline">Show</span>
      </button>
    )
  }

  return (
    <div className="rounded-md border p-3"
      style={{
        background: dismissed ? 'var(--color-paper-2)' : 'var(--color-green-50)',
        borderColor: dismissed ? 'var(--color-line)' : 'var(--color-green-200)',
        opacity: dismissed ? 0.85 : 1,
      }}>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="min-w-0 text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>
            {reply.from_name || reply.from_email}
            {reply.from_name && reply.from_email && (
              <span className="ml-2 font-normal text-[12px]" style={{ color: 'var(--color-muted)' }}>
                {reply.from_email}
              </span>
            )}
            {!reply.read_at && !dismissed && (
              <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}>
                New
              </span>
            )}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            {reply.received_at ? new Date(reply.received_at).toLocaleString() : ''}
          </div>
        </div>
        {reply.subject && (
          <div className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{reply.subject}</div>
        )}
        <pre className="whitespace-pre-wrap font-sans text-[12px]" style={{ color: 'var(--color-ink-soft)', lineHeight: 1.55 }}>
          {reply.body || reply.snippet}
        </pre>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ReplyActionBtn onClick={() => patch({ read: !reply.read_at })} disabled={busy}>
          <Check size={12} /> {reply.read_at ? 'Mark unread' : 'Mark read'}
        </ReplyActionBtn>
        <ReplyActionBtn onClick={() => {
          if (dismissed) patch({ dismissed: false })
          else {
            patch({ dismissed: true })
            setCollapsed(true)
          }
        }} disabled={busy}>
          <X size={12} /> {dismissed ? 'Restore' : 'Dismiss'}
        </ReplyActionBtn>
        <Link to={`/interview-prep?prof=${professorId}&reply=${reply.id}`}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
          style={reply.meeting_request
            ? { background: 'var(--color-violet-50)', borderColor: 'var(--color-violet-200)', color: 'var(--color-violet-700)' }
            : { background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
          <GraduationCap size={12} /> Prepare interview
        </Link>
      </div>

      {sent ? (
        <div className="mt-3 rounded-md border p-3"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-green-700)' }}>
            <CheckCircle2 size={12} />
            You replied {reply.response_sent_at ? new Date(reply.response_sent_at).toLocaleString() : ''}
          </div>
          {reply.response_subject && (
            <div className="text-[12px] font-semibold" style={{ color: 'var(--color-ink)' }}>{reply.response_subject}</div>
          )}
          <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px]" style={{ color: 'var(--color-ink-soft)', lineHeight: 1.55 }}>
            {reply.response_draft}
          </pre>
        </div>
      ) : (
        <div className="mt-3 rounded-md border p-3"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
          <div className="mb-2 text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            <Sparkles size={11} className="mr-1 inline" /> Draft a reply with Quill
          </div>
          <AutoTextarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Tell Quill what to say..."
            className="w-full rounded-md border px-2.5 py-2 text-[12px] outline-none"
            style={{ borderColor: 'var(--color-line)', minHeight: 56, lineHeight: 1.5 }}
          />
          <div className="mt-2">
            <button onClick={askQuill} disabled={drafting || !instruction.trim()}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--color-brand-600)', color: 'var(--color-white)' }}>
              {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {drafting ? 'Quill is drafting...' : draft ? 'Re-draft with Quill' : 'Ask Quill'}
            </button>
          </div>

          {(draft || drafting) && (
            <>
              <div className="mb-1 mt-3 text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                <Mail size={11} className="mr-1 inline" /> Your reply
              </div>
              <AutoTextarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Your reply will appear here..."
                className="w-full rounded-md border px-2.5 py-2 font-sans text-[12px] outline-none"
                style={{ borderColor: 'var(--color-line)', minHeight: 120, lineHeight: 1.55 }}
              />
              <div className="mt-2">
                <button onClick={send} disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)', boxShadow: '0 6px 16px -6px rgba(220,38,38,0.55)' }}>
                  {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {sending ? 'Sending...' : `Send to ${reply.from_email || 'professor'}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {err && (
        <div className="mt-3 rounded px-2.5 py-1.5 text-[12px]" style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
          {err}
        </div>
      )}
    </div>
  )
}

function ReplyActionBtn({ children, onClick, disabled }: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
      {children}
    </button>
  )
}
