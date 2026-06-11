import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DollarSign, ExternalLink, Plus, X, Search, CalendarDays, BadgeDollarSign, Target } from 'lucide-react'
import { api, type Grant } from '@/lib/api'
import { apiUrl } from '@/lib/runtime'

const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  pending: { bg: 'var(--color-paper-2)', fg: 'var(--color-muted)', border: 'var(--color-line)' },
  researching: { bg: 'var(--color-amber-50)', fg: 'var(--color-amber-700)', border: 'var(--color-amber-200)' },
  applying: { bg: 'var(--color-brand-50)', fg: 'var(--color-brand-700)', border: 'var(--color-brand-200, #bfdbfe)' },
  submitted: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', border: 'var(--color-green-200, #bbf7d0)' },
  rejected: { bg: 'var(--color-rose-50)', fg: 'var(--color-rose-700)', border: 'var(--color-rose-200, #fecdd3)' },
  awarded: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', border: 'var(--color-green-200, #bbf7d0)' },
}

const PAGE_BG = {
  backgroundColor: 'var(--color-paper)',
  backgroundImage:
    'linear-gradient(rgba(28,34,48,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.055) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
} as const

const SURFACE_TRANSITION = 'transition-all duration-[400ms] ease-out'

function deadlineSort(a: Grant, b: Grant): number {
  const normalize = (s?: string) => {
    if (!s || s === 'TBD' || s.toLowerCase().startsWith('rolling') || s.toLowerCase().includes('est')) return '9999-99-99'
    return s
  }
  return normalize(a.deadline).localeCompare(normalize(b.deadline))
}

function shortDate(value?: string | null) {
  if (!value) return 'TBD'
  const lower = value.toLowerCase()
  if (value === 'TBD' || lower.startsWith('rolling') || lower.includes('est')) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function daysUntil(value?: string | null) {
  if (!value) return null
  const lower = value.toLowerCase()
  if (value === 'TBD' || lower.startsWith('rolling') || lower.includes('est')) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}

function formatStatusLabel(status?: string) {
  const value = status || 'pending'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function deadlineTone(days: number | null) {
  if (days === null) return 'muted'
  if (days < 0) return 'rose'
  if (days <= 21) return 'amber'
  return 'ink'
}

const EMPTY_FORM = { name: '', deadline: '', amount: '', eligibility: '', status: 'pending', notes: '', url: '' }

export function Grants() {
  const [grants, setGrants] = useState<Grant[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'deadline' | 'awarded'>('all')
  const [selected, setSelected] = useState<number | null>(null)

  const reload = () => api.grants().then(setGrants).catch((e) => setErr(String(e)))
  useEffect(() => {
    reload()
    const h = () => reload()
    window.addEventListener('quill:data-changed', h)
    return () => window.removeEventListener('quill:data-changed', h)
  }, [])

  const sorted = useMemo(() => [...grants].sort(deadlineSort), [grants])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sorted.filter((g) => {
      const text = [g.name, g.eligibility, g.notes, g.amount, g.region, ...(g.discipline_tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (q && !text.includes(q)) return false
      const days = daysUntil(g.deadline)
      if (filter === 'active' && ['submitted', 'rejected', 'awarded'].includes(g.status || 'pending')) return false
      if (filter === 'deadline' && (days === null || days > 30 || days < 0)) return false
      if (filter === 'awarded' && (g.status || 'pending') !== 'awarded') return false
      return true
    })
  }, [filter, query, sorted])

  useEffect(() => {
    if (!filtered.length) {
      setSelected(null)
      return
    }
    if (selected === null || !filtered.some((g) => g.id === selected)) {
      setSelected(filtered[0].id)
    }
  }, [filtered, selected])

  const current = filtered.find((g) => g.id === selected) || null

  const stats = useMemo(() => {
    const dueSoon = grants.filter((g) => {
      const d = daysUntil(g.deadline)
      return d !== null && d >= 0 && d <= 30
    }).length
    const applying = grants.filter((g) => ['researching', 'applying'].includes(g.status || 'pending')).length
    const submitted = grants.filter((g) => (g.status || 'pending') === 'submitted').length
    const awarded = grants.filter((g) => (g.status || 'pending') === 'awarded').length
    return { dueSoon, applying, submitted, awarded }
  }, [grants])

  const addGrant = async () => {
    if (!form.name.trim()) return
    setAdding(true)
    try {
      const r = await fetch(apiUrl('/api/grants'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      setForm(EMPTY_FORM)
      setShowAdd(false)
      reload()
    } catch (e) {
      setErr(String(e))
    } finally {
      setAdding(false)
    }
  }

  const updateStatus = async (g: Grant, status: string) => {
    try {
      const r = await fetch(apiUrl(`/api/grants/${g.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      reload()
    } catch (e) {
      setErr(String(e))
    }
  }

  return (
    <div className="min-h-full overflow-x-hidden px-5 py-4" style={PAGE_BG}>
      <div className="w-[320px] max-w-full min-w-0 overflow-hidden sm:w-full">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-muted)' }}>
              Grants
            </div>
            <h1 className="mt-1 text-[31px] font-bold leading-tight" style={{ color: 'var(--color-ink)' }}>
              Funding pipeline
            </h1>
            <p className="mt-1 max-w-3xl text-[14px] leading-6" style={{ color: 'var(--color-muted)' }}>
              {grants.length} opportunities tracked, {stats.dueSoon} due within 30 days, and {stats.applying} currently in research or application work.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill label={err ? 'Needs review' : 'Live'} tone={err ? 'amber' : 'green'} />
            <button onClick={() => setShowAdd((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-paper)] ${SURFACE_TRANSITION}`}
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)', color: 'var(--color-ink)' }}>
              {showAdd ? <X size={13} /> : <Plus size={13} />}
              {showAdd ? 'Close form' : 'Add grant'}
            </button>
          </div>
        </div>

        {err && (
          <Banner>{err}</Banner>
        )}

        <section className="mb-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
          <MetricCard label="Tracked" value={grants.length} detail="All saved opportunities" />
          <MetricCard label="Due soon" value={stats.dueSoon} detail="Within the next 30 days" />
          <MetricCard label="In progress" value={stats.applying} detail="Researching or applying" />
          <MetricCard label="Awarded" value={stats.awarded} detail={`${stats.submitted} also submitted`} />
        </section>

        {showAdd && (
          <SurfacePanel className="mb-3 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Add grant or fellowship</div>
                <div className="mt-0.5 text-[12px]" style={{ color: 'var(--color-muted)' }}>Capture the opportunity, deadline, funding amount, and application notes.</div>
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-md p-1" style={{ color: 'var(--color-muted)' }}>
                <X size={14} />
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Name *">
                <input value={form.name} placeholder="e.g. NSF GRFP"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
              </Field>
              <Field label="Deadline">
                <input value={form.deadline} placeholder='YYYY-MM-DD or "Rolling"'
                  onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                  className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
              </Field>
              <Field label="Amount">
                <input value={form.amount} placeholder="e.g. $37,000/year"
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
              </Field>
              <Field label="URL">
                <input value={form.url} placeholder="https://..."
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
              </Field>
              <Field label="Eligibility">
                <input value={form.eligibility} placeholder="Who can apply"
                  onChange={(e) => setForm((f) => ({ ...f, eligibility: e.target.value }))}
                  className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
              </Field>
              <Field label="Status">
                <select value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
                  <option value="pending">pending</option>
                  <option value="researching">researching</option>
                  <option value="applying">applying</option>
                  <option value="submitted">submitted</option>
                  <option value="rejected">rejected</option>
                  <option value="awarded">awarded</option>
                </select>
              </Field>
              <Field className="md:col-span-2" label="Notes">
                <textarea value={form.notes} rows={3}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none font-sans"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
              </Field>
            </div>
            <button onClick={addGrant} disabled={adding || !form.name.trim()}
              className="mt-4 rounded-md px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-ink)' }}>
              {adding ? 'Adding…' : 'Add grant'}
            </button>
          </SurfacePanel>
        )}

        <section className="grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_340px]">
          <div className="grid gap-3 min-w-0">
            <SurfacePanel className="px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative min-w-0 flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by grant, region, notes, discipline, or eligibility"
                    className="w-full rounded-md border py-2 pl-9 pr-3 text-[13px] outline-none"
                    style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterPill>
                  <FilterPill active={filter === 'active'} onClick={() => setFilter('active')}>Active</FilterPill>
                  <FilterPill active={filter === 'deadline'} onClick={() => setFilter('deadline')}>Due soon</FilterPill>
                  <FilterPill active={filter === 'awarded'} onClick={() => setFilter('awarded')}>Awarded</FilterPill>
                </div>
              </div>
            </SurfacePanel>

            <SurfacePanel className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--color-line)' }}>
                <div>
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Grant queue</div>
                  <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-muted)' }}>Track deadlines, move status forward, and keep the strongest opportunities visible.</div>
                </div>
                <div className="text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>{filtered.length} shown</div>
              </div>

              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-[14px]" style={{ color: 'var(--color-muted)' }}>
                  {grants.length === 0 ? 'No grants yet.' : 'No grants match the current filters.'}
                </div>
              ) : (
                <div className="grid gap-0">
                  {filtered.map((g) => {
                    const status = STATUS_COLORS[g.status || 'pending'] || STATUS_COLORS.pending
                    const days = daysUntil(g.deadline)
                    const tone = deadlineTone(days)
                    const deadlineColor = tone === 'rose'
                      ? 'var(--color-rose-700)'
                      : tone === 'amber'
                        ? 'var(--color-amber-700)'
                        : tone === 'ink'
                          ? 'var(--color-ink)'
                          : 'var(--color-muted)'
                    return (
                      <button key={g.id} onClick={() => setSelected(g.id)}
                        className={`grid gap-3 border-b px-4 py-4 text-left hover:bg-[color:var(--color-paper)] ${SURFACE_TRANSITION} md:grid-cols-[minmax(0,1fr)_130px_120px]`}
                        style={{
                          borderColor: 'var(--color-line)',
                          background: selected === g.id ? 'color-mix(in srgb, var(--color-brand-50) 40%, var(--color-white))' : undefined,
                        }}>
                        <div className="min-w-0">
                          <div className="flex items-start gap-2.5 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              <DollarSign size={14} style={{ color: 'var(--color-amber-700)', flexShrink: 0 }} />
                              <div className="truncate text-[15px] font-semibold" style={{ color: 'var(--color-ink)' }}>
                                {g.name}
                              </div>
                            </div>
                            <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                              style={{ background: status.bg, color: status.fg, borderColor: status.border }}>
                              {formatStatusLabel(g.status)}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                            {g.eligibility || g.notes || 'No eligibility or notes captured yet.'}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {g.amount && <QueueChip>{g.amount}</QueueChip>}
                            {g.region && <QueueChip>{g.region}</QueueChip>}
                            {(g.discipline_tags || []).slice(0, 2).map((tag) => (
                              <QueueChip key={tag}>{tag}</QueueChip>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>Deadline</div>
                          <div className="mt-1 text-[13px] font-semibold" style={{ color: deadlineColor }}>
                            {shortDate(g.deadline)}
                          </div>
                          <div className="mt-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                            {days === null ? 'Flexible or TBD' : days < 0 ? `${Math.abs(days)} days ago` : `${days} days left`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>Fit</div>
                          <div className="mt-1 text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>
                            {g.match_score ?? '—'}
                          </div>
                          <div className="mt-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                            {g.url ? 'Source linked' : 'No source link'}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </SurfacePanel>
          </div>

          <div className="grid gap-3">
            {current ? (
              <>
                <SurfacePanel className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[18px] font-bold leading-tight" style={{ color: 'var(--color-ink)' }}>{current.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={current.status || 'pending'} />
                        {current.region && <QueueChip>{current.region}</QueueChip>}
                      </div>
                    </div>
                    {current.url && (
                      <a href={current.url} target="_blank" rel="noreferrer"
                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[12px] font-medium hover:bg-[color:var(--color-paper)] ${SURFACE_TRANSITION}`}
                        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-brand-700)' }}>
                        <ExternalLink size={12} />
                        Source
                      </a>
                    )}
                  </div>

                  <div className="mt-4 grid gap-2">
                    <SignalRow icon={CalendarDays} label="Deadline" value={shortDate(current.deadline)} detail={(() => {
                      const d = daysUntil(current.deadline)
                      if (d === null) return 'Flexible or TBD'
                      return d < 0 ? `${Math.abs(d)} days ago` : `${d} days remaining`
                    })()} />
                    <SignalRow icon={BadgeDollarSign} label="Amount" value={current.amount || 'Not captured'} />
                    <SignalRow icon={Target} label="Match score" value={current.match_score ?? '—'} />
                  </div>
                </SurfacePanel>

                <SurfacePanel className="px-4 py-4">
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Pipeline status</div>
                  <div className="mt-3">
                    <select value={current.status || 'pending'}
                      onChange={(e) => updateStatus(current, e.target.value)}
                      className="w-full rounded-md border px-2.5 py-2 text-[13px] outline-none"
                      style={{
                        borderColor: 'var(--color-line)',
                        background: 'var(--color-white)',
                        color: (STATUS_COLORS[current.status || 'pending'] || STATUS_COLORS.pending).fg,
                      }}>
                      <option value="pending">pending</option>
                      <option value="researching">researching</option>
                      <option value="applying">applying</option>
                      <option value="submitted">submitted</option>
                      <option value="rejected">rejected</option>
                      <option value="awarded">awarded</option>
                    </select>
                  </div>
                </SurfacePanel>

                <SurfacePanel className="px-4 py-4">
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Eligibility</div>
                  <div className="mt-2 text-[13px] leading-6" style={{ color: 'var(--color-ink-soft)' }}>
                    {current.eligibility || 'No eligibility notes captured.'}
                  </div>
                </SurfacePanel>

                <SurfacePanel className="px-4 py-4">
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>Notes</div>
                  <div className="mt-2 text-[13px] leading-6 whitespace-pre-wrap" style={{ color: 'var(--color-ink-soft)' }}>
                    {current.notes || 'No notes captured.'}
                  </div>
                  {(current.discipline_tags || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(current.discipline_tags || []).map((tag) => (
                        <QueueChip key={tag}>{tag}</QueueChip>
                      ))}
                    </div>
                  )}
                </SurfacePanel>
              </>
            ) : (
              <SurfacePanel className="px-4 py-10 text-center">
                <div className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>No grant selected</div>
                <div className="mt-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>Choose an opportunity from the queue to inspect its funding details and update status.</div>
              </SurfacePanel>
            )}
          </div>
        </section>
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

function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <SurfacePanel className="px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="mt-2 text-[34px] font-bold leading-none" style={{ color: 'var(--color-ink)' }}>{value}</div>
      <div className="mt-2 text-[12px]" style={{ color: 'var(--color-muted)' }}>{detail}</div>
    </SurfacePanel>
  )
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-md border px-4 py-3 text-[13px]"
      style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)', borderColor: 'var(--color-rose-100, #ffe4e6)' }}>
      {children}
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'amber' }) {
  const color = tone === 'green' ? 'var(--color-green-700)' : 'var(--color-amber-700)'
  const background = tone === 'green' ? 'var(--color-green-50)' : 'var(--color-amber-50)'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-medium"
      style={{ background, borderColor: 'var(--color-line)', color }}>
      <DollarSign size={12} />
      {label}
    </span>
  )
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      {children}
    </div>
  )
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-[12px] font-medium ${SURFACE_TRANSITION}`}
      style={{
        background: active ? 'var(--color-ink)' : 'var(--color-white)',
        borderColor: active ? 'var(--color-ink)' : 'var(--color-line)',
        color: active ? 'white' : 'var(--color-ink-soft)',
      }}>
      {children}
    </button>
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

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_COLORS[status] || STATUS_COLORS.pending
  return (
    <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium"
      style={{ background: style.bg, color: style.fg, borderColor: style.border }}>
      {formatStatusLabel(status)}
    </span>
  )
}

function SignalRow({ icon: Icon, label, value, detail }: {
  icon: typeof CalendarDays
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <div className="rounded-md border px-3 py-2.5"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <div className="flex items-start gap-2">
        <Icon size={14} style={{ color: 'var(--color-muted)', marginTop: 2, flexShrink: 0 }} />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
          <div className="mt-1 text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>{value}</div>
          {detail && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>{detail}</div>}
        </div>
      </div>
    </div>
  )
}
