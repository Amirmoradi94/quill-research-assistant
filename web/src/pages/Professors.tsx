import { useEffect, useMemo, useState, type ComponentType, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Filter,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { api, type Professor } from '@/lib/api'
import { apiUrl } from '@/lib/runtime'
import { formatCategory } from '@/lib/categories'
import { useConfirm } from '@/components/ConfirmDialog'

type SortKey = 'number' | 'name' | 'university' | 'dept_lab' | 'research_category' | 'tier' | 'status' | 'email' | 'score'
type IconComponent = ComponentType<{ size?: number; className?: string; style?: CSSProperties }>

const STATUS_OPTIONS = ['drafting', 'sent', 'no_reply', 'replied', 'interview', 'offer', 'rejected', 'skipped']

const STATUS_TONES: Record<string, { bg: string; fg: string; border: string }> = {
  drafting: { bg: 'var(--color-paper)', fg: 'var(--color-muted)', border: 'var(--color-line)' },
  sent: { bg: 'var(--color-brand-50)', fg: 'var(--color-brand-700)', border: 'var(--color-brand-200)' },
  no_reply: { bg: 'var(--color-amber-50)', fg: 'var(--color-amber-700)', border: 'var(--color-line-strong)' },
  replied: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', border: 'var(--color-line-strong)' },
  interview: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', border: 'var(--color-line-strong)' },
  offer: { bg: 'var(--color-green-50)', fg: 'var(--color-green-700)', border: 'var(--color-line-strong)' },
  rejected: { bg: 'var(--color-rose-50)', fg: 'var(--color-rose-700)', border: 'var(--color-line-strong)' },
  skipped: { bg: 'var(--color-paper-2)', fg: 'var(--color-muted)', border: 'var(--color-line)' },
}

export function Professors() {
  const confirm = useConfirm()
  const [profs, setProfs] = useState<Professor[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [tier, setTier] = useState<string>('')
  const [university, setUniversity] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [addForm, setAddForm] = useState({
    name: '',
    university: '',
    email: '',
    tier: 'T2',
    research_category: '',
    research_angle: '',
    position_type: 'phd',
  })
  const [adding, setAdding] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const reload = () => {
    api.professors({ q: q || undefined, category: category || undefined, status: status || undefined })
      .then((rows) => {
        setProfs(rows)
        setErr(null)
      })
      .catch((e) => setErr(String(e)))
  }

  useEffect(() => {
    reload()
    window.addEventListener('quill:data-changed', reload)
    return () => window.removeEventListener('quill:data-changed', reload)
  }, [q, category, status])

  const counts = useMemo(() => {
    const byCat: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    const byTier: Record<string, number> = {}
    const byUni: Record<string, number> = {}
    for (const p of profs) {
      if (p.research_category) byCat[p.research_category] = (byCat[p.research_category] || 0) + 1
      if (p.status) byStatus[p.status] = (byStatus[p.status] || 0) + 1
      if (p.tier) byTier[p.tier] = (byTier[p.tier] || 0) + 1
      if (p.university) byUni[p.university] = (byUni[p.university] || 0) + 1
    }
    return { byCat, byStatus, byTier, byUni }
  }, [profs])

  const categories = useMemo(() => Object.keys(counts.byCat).sort(), [counts.byCat])
  const tiers = useMemo(() => Object.keys(counts.byTier).sort(), [counts.byTier])
  const universities = useMemo(
    () => Object.entries(counts.byUni).sort(([, a], [, b]) => b - a).map(([k]) => k),
    [counts.byUni],
  )

  const visible = useMemo(() => {
    let list = profs
    if (tier) list = list.filter((p) => p.tier === tier)
    if (university) list = list.filter((p) => p.university === university)

    const dir = sortDir === 'asc' ? 1 : -1
    const get = (p: Professor): string | number => {
      if (sortKey === 'number') return (p.number ?? p.id) as number
      if (sortKey === 'score') return p.match_score ?? p.relevance_score ?? -1
      const v = p[sortKey as keyof Professor]
      return (v as string | number | null | undefined) ?? ''
    }
    return [...list].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir
    })
  }, [profs, tier, university, sortKey, sortDir])

  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !visible.some((p) => p.id === selectedId)) setSelectedId(visible[0].id)
  }, [selectedId, visible])

  const selected = visible.find((p) => p.id === selectedId) ?? visible[0] ?? null
  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible])
  const checkedVisibleCount = visibleIds.filter((id) => checkedIds.has(id)).length
  const allVisibleChecked = visibleIds.length > 0 && checkedVisibleCount === visibleIds.length

  useEffect(() => {
    setCheckedIds((current) => {
      const visibleSet = new Set(visibleIds)
      const next = new Set([...current].filter((id) => visibleSet.has(id)))
      return next.size === current.size ? current : next
    })
  }, [visibleIds])

  const metrics = useMemo(() => {
    const scored = profs.map(scoreFor).filter((n): n is number => typeof n === 'number')
    const avgScore = scored.length ? Math.round(scored.reduce((sum, n) => sum + n, 0) / scored.length) : null
    const active = profs.filter((p) => !['rejected', 'skipped'].includes(p.status || '')).length
    const priority = profs.filter((p) => p.tier === 'T1' || (scoreFor(p) ?? 0) >= 75).length
    const contacted = profs.filter((p) => ['sent', 'no_reply', 'replied', 'interview', 'offer'].includes(p.status || '')).length
    return { avgScore, active, priority, contacted }
  }, [profs])

  const rescoreAll = async () => {
    setScoring(true)
    try {
      await api.scoreAllProfessors()
      reload()
    } catch (e) {
      setErr(String(e))
    } finally {
      setScoring(false)
    }
  }

  const addProfessor = async () => {
    if (!addForm.name.trim()) return
    setAdding(true)
    try {
      await fetch(apiUrl('/api/professors'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      setAddForm({ name: '', university: '', email: '', tier: 'T2', research_category: '', research_angle: '', position_type: 'phd' })
      setShowAdd(false)
      reload()
    } catch (e) {
      setErr(String(e))
    } finally {
      setAdding(false)
    }
  }

  const patchProfessor = async (id: number, patch: Record<string, unknown>) => {
    try {
      const updated = await api.patchProfessor(id, patch)
      setProfs((rows) => rows.map((p) => (p.id === id ? updated : p)))
    } catch (e) {
      setErr(String(e))
    }
  }

  const scoreProfessor = async (prof: Professor) => {
    setBusyAction(`score-${prof.id}`)
    try {
      const result = await api.scoreProfessor(prof.id)
      setProfs((rows) => rows.map((p) => (
        p.id === prof.id
          ? { ...p, relevance_score: result.relevance_score, relevance_breakdown: result.relevance_breakdown, relevance_scored_at: new Date().toISOString() }
          : p
      )))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusyAction(null)
    }
  }

  const deleteProfessor = async (prof: Professor) => {
    const ok = await confirm({
      title: 'Delete professor?',
      detail: prof.name,
      message: 'This removes the target and its related local records from the dashboard.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    setBusyAction(`delete-${prof.id}`)
    try {
      await api.deleteProfessor(prof.id)
      setProfs((rows) => rows.filter((p) => p.id !== prof.id))
      setCheckedIds((ids) => {
        const next = new Set(ids)
        next.delete(prof.id)
        return next
      })
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusyAction(null)
    }
  }

  const toggleChecked = (id: number) => {
    setCheckedIds((ids) => {
      const next = new Set(ids)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setCheckedIds((ids) => {
      if (allVisibleChecked) return new Set()
      const next = new Set(ids)
      visibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  const bulkPatchStatus = async (nextStatus: string) => {
    const ids = [...checkedIds]
    if (ids.length === 0) return
    setBusyAction('bulk-status')
    try {
      const updated = await Promise.all(ids.map((id) => api.patchProfessor(id, { status: nextStatus })))
      const byId = new Map(updated.map((p) => [p.id, p]))
      setProfs((rows) => rows.map((p) => byId.get(p.id) ?? p))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusyAction(null)
    }
  }

  const bulkScore = async () => {
    const ids = [...checkedIds]
    if (ids.length === 0) return
    setBusyAction('bulk-score')
    try {
      const scored = await Promise.all(ids.map((id) => api.scoreProfessor(id)))
      const byId = new Map(scored.map((s) => [s.id, s]))
      setProfs((rows) => rows.map((p) => {
        const result = byId.get(p.id)
        return result
          ? { ...p, relevance_score: result.relevance_score, relevance_breakdown: result.relevance_breakdown, relevance_scored_at: new Date().toISOString() }
          : p
      }))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusyAction(null)
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir(key === 'score' ? 'desc' : 'asc')
    }
  }

  const clearFilters = () => {
    setQ('')
    setCategory('')
    setTier('')
    setUniversity('')
    setStatus('')
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
              Application Pipeline
            </div>
            <h1 className="text-[31px] leading-none font-bold tracking-tight mt-1" style={{ color: 'var(--color-ink)' }}>
              Professors
            </h1>
            <p className="text-[13px] mt-1 max-w-full sm:max-w-[560px] leading-relaxed break-words" style={{ color: 'var(--color-ink-soft)' }}>
              Review, score, and move faculty targets through the outreach pipeline.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={rescoreAll}
              disabled={scoring}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-60"
              style={{ background: 'var(--color-ink)', color: 'white' }}
            >
              <RefreshCw size={13} className={scoring ? 'animate-spin' : ''} />
              {scoring ? 'Scoring' : 'Rescore all'}
            </button>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[12px] font-medium"
              style={{
                background: showAdd ? 'var(--color-brand-50)' : 'var(--color-white)',
                borderColor: showAdd ? 'var(--color-brand-400)' : 'var(--color-line)',
                color: showAdd ? 'var(--color-brand-700)' : 'var(--color-ink-soft)',
              }}
            >
              {showAdd ? <X size={13} /> : <Plus size={13} />}
              {showAdd ? 'Close add' : 'Add target'}
            </button>
          </div>
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <MetricCard label="Total" value={profs.length} sub={`${metrics.active} active`} icon={Users} />
          <MetricCard label="Visible" value={visible.length} sub={visible.length === profs.length ? 'unfiltered' : 'filtered'} icon={Filter} />
          <MetricCard label="Priority" value={metrics.priority} sub="T1 or high score" icon={Target} tone="green" />
          <MetricCard label="Avg match" value={metrics.avgScore ?? '-'} sub={`${metrics.contacted} contacted`} icon={Sparkles} tone="amber" />
        </section>

        {showAdd && (
          <AddPanel
            addForm={addForm}
            setAddForm={setAddForm}
            adding={adding}
            onAdd={addProfessor}
            onClose={() => setShowAdd(false)}
          />
        )}

        {err && (
          <div className="mb-3 p-3 rounded-md border text-[13px]"
            style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)', borderColor: 'var(--color-line-strong)' }}>
            {err}
          </div>
        )}

        <FilterBar
          q={q}
          setQ={setQ}
          category={category}
          setCategory={setCategory}
          tier={tier}
          setTier={setTier}
          university={university}
          setUniversity={setUniversity}
          status={status}
          setStatus={setStatus}
          categories={categories}
          tiers={tiers}
          universities={universities}
          counts={counts}
          total={profs.length}
          onClear={clearFilters}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_318px] gap-3 items-start">
          <section className="rounded-md border overflow-hidden"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            <div className="px-3 py-2 border-b flex items-center justify-between gap-2"
              style={{ borderColor: 'var(--color-line)', background: 'color-mix(in srgb, var(--color-paper) 70%, var(--color-white))' }}>
              <div className="min-w-0">
                <h2 className="text-[13px] font-bold" style={{ color: 'var(--color-ink)' }}>Ranked targets</h2>
                <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  {visible.length ? `${visible.length} professors ready for review` : 'No matching professors'}
                </div>
              </div>
              <SortMenu sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </div>

            {checkedIds.size > 0 && (
              <BulkToolbar
                count={checkedIds.size}
                busy={busyAction === 'bulk-status' || busyAction === 'bulk-score'}
                onStatus={bulkPatchStatus}
                onScore={bulkScore}
                onClear={() => setCheckedIds(new Set())}
              />
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.08em] border-b"
                    style={{ color: 'var(--color-muted)', borderColor: 'var(--color-line)' }}>
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={allVisibleChecked}
                        onChange={toggleAllVisible}
                        aria-label="Select all visible professors"
                      />
                    </th>
                    <SortableTh label="#" sortKey="number" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Professor" sortKey="name" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="University" sortKey="university" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Focus" sortKey="research_category" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Score" sortKey="score" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Tier" sortKey="tier" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Status" sortKey="status" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Contact" sortKey="email" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <ProfessorRow
                      key={p.id}
                      p={p}
                      selected={selected?.id === p.id}
                      checked={checkedIds.has(p.id)}
                      onSelect={() => setSelectedId(p.id)}
                      onChecked={() => toggleChecked(p.id)}
                      onStatus={(next) => patchProfessor(p.id, { status: next })}
                    />
                  ))}
                  {visible.length === 0 && !err && (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-[13px]" style={{ color: 'var(--color-muted)' }}>
                        No professors match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <ProfessorPreview
            p={selected}
            busyAction={busyAction}
            onStatus={(next) => selected && patchProfessor(selected.id, { status: next })}
            onScore={scoreProfessor}
            onDelete={deleteProfessor}
          />
        </div>
      </div>
    </div>
  )
}

function AddPanel({ addForm, setAddForm, adding, onAdd, onClose }: {
  addForm: {
    name: string
    university: string
    email: string
    tier: string
    research_category: string
    research_angle: string
    position_type: string
  }
  setAddForm: Dispatch<SetStateAction<{
    name: string
    university: string
    email: string
    tier: string
    research_category: string
    research_angle: string
    position_type: string
  }>>
  adding: boolean
  onAdd: () => void
  onClose: () => void
}) {
  return (
    <section className="rounded-md border mb-3 overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="px-3 py-2 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
        <div className="inline-flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--color-ink)' }}>
          <Plus size={14} /> Add professor
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-[color:var(--color-paper-2)]" aria-label="Close add professor">
          <X size={14} style={{ color: 'var(--color-muted)' }} />
        </button>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <AddField label="Name *" value={addForm.name} onChange={(v) => setAddForm((f) => ({ ...f, name: v }))} />
          <AddField label="University" value={addForm.university} onChange={(v) => setAddForm((f) => ({ ...f, university: v }))} />
          <AddField label="Email" value={addForm.email} onChange={(v) => setAddForm((f) => ({ ...f, email: v }))} />
          <AddField label="Research angle" value={addForm.research_angle} onChange={(v) => setAddForm((f) => ({ ...f, research_angle: v }))} />
          <AddField label="Category" value={addForm.research_category} onChange={(v) => setAddForm((f) => ({ ...f, research_category: v }))} placeholder="cv, robotics, structural..." />
          <SelectField label="Tier" value={addForm.tier} onChange={(v) => setAddForm((f) => ({ ...f, tier: v }))} options={['T1', 'T2', 'T3']} />
          <SelectField label="Position type" value={addForm.position_type} onChange={(v) => setAddForm((f) => ({ ...f, position_type: v }))} options={['phd', 'postdoc', 'master']} />
        </div>
        <button
          onClick={onAdd}
          disabled={adding || !addForm.name.trim()}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--color-ink)', color: 'white' }}
        >
          <Plus size={13} />
          {adding ? 'Adding' : 'Add professor'}
        </button>
      </div>
    </section>
  )
}

function FilterBar({
  q,
  setQ,
  category,
  setCategory,
  tier,
  setTier,
  university,
  setUniversity,
  status,
  setStatus,
  categories,
  tiers,
  universities,
  counts,
  total,
  onClear,
}: {
  q: string
  setQ: (v: string) => void
  category: string
  setCategory: (v: string) => void
  tier: string
  setTier: (v: string) => void
  university: string
  setUniversity: (v: string) => void
  status: string
  setStatus: (v: string) => void
  categories: string[]
  tiers: string[]
  universities: string[]
  counts: { byCat: Record<string, number>; byStatus: Record<string, number>; byTier: Record<string, number>; byUni: Record<string, number> }
  total: number
  onClear: () => void
}) {
  const filtered = q || category || tier || university || status

  return (
    <section className="rounded-md border mb-3 overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="p-3 flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:flex-1 sm:min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, lab, notes..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md border text-[13px] outline-none"
            style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          />
        </div>
        <FilterSelect label="Tier" value={tier} onChange={setTier}
          options={tiers.map((t) => ({ value: t, label: `${t} (${counts.byTier[t]})` }))} />
        <FilterSelect label="University" value={university} onChange={setUniversity}
          options={universities.slice(0, 40).map((u) => ({ value: u, label: `${u} (${counts.byUni[u]})` }))} />
        <FilterSelect label="Status" value={status} onChange={setStatus}
          options={Object.keys(counts.byStatus).sort().map((s) => ({ value: s, label: `${s} (${counts.byStatus[s]})` }))} />
        {filtered && (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium"
            style={{ color: 'var(--color-ink-soft)' }}
          >
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
            count={counts.byCat[c]}
            color={`var(--color-cat-${c})`}
          />
        ))}
      </div>
    </section>
  )
}

function BulkToolbar({ count, busy, onStatus, onScore, onClear }: {
  count: number
  busy: boolean
  onStatus: (status: string) => void
  onScore: () => void
  onClear: () => void
}) {
  return (
    <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-brand-50)' }}>
      <span className="text-[12px] font-semibold" style={{ color: 'var(--color-brand-700)' }}>
        {count} selected
      </span>
      <button
        onClick={onScore}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium disabled:opacity-60"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-brand-200)', color: 'var(--color-brand-700)' }}
      >
        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
        Score selected
      </button>
      <select
        onChange={(e) => {
          if (!e.target.value) return
          onStatus(e.target.value)
          e.target.value = ''
        }}
        disabled={busy}
        className="rounded-md border px-2.5 py-1.5 text-[11px] outline-none disabled:opacity-60"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-brand-200)', color: 'var(--color-ink-soft)' }}
        defaultValue=""
      >
        <option value="">Set status...</option>
        {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <button
        onClick={onClear}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium disabled:opacity-60"
        style={{ color: 'var(--color-ink-soft)' }}
      >
        <X size={12} /> Clear
      </button>
    </div>
  )
}

function ProfessorRow({ p, selected, checked, onSelect, onChecked, onStatus }: {
  p: Professor
  selected: boolean
  checked: boolean
  onSelect: () => void
  onChecked: () => void
  onStatus: (status: string) => void
}) {
  const score = scoreFor(p)

  return (
    <tr
      onClick={onSelect}
      className="border-b last:border-b-0 cursor-pointer"
      style={{
        borderColor: 'var(--color-line)',
        background: selected ? 'var(--color-brand-50)' : 'transparent',
      }}
    >
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChecked}
          aria-label={`Select ${p.name}`}
        />
      </td>
      <td className="px-3 py-2 font-mono text-[12px]" style={{ color: 'var(--color-muted)' }}>
        {p.number ?? p.id}
      </td>
      <td className="px-3 py-2">
        <div className="font-semibold truncate max-w-[180px]" style={{ color: 'var(--color-ink)' }}>{p.name}</div>
        <div className="text-[11px] truncate max-w-[220px]" style={{ color: 'var(--color-muted)' }}>{p.dept_lab || p.position_type || 'No lab recorded'}</div>
      </td>
      <td className="px-3 py-2 max-w-[150px] truncate" style={{ color: 'var(--color-ink-soft)' }}>{p.university || '-'}</td>
      <td className="px-3 py-2">{p.research_category ? <CatChip cat={p.research_category} /> : <MutedDash />}</td>
      <td className="px-3 py-2">
        <ScorePill value={score} />
      </td>
      <td className="px-3 py-2 font-mono text-[12px]" style={{ color: 'var(--color-ink-soft)' }}>{p.tier || '-'}</td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <select
          value={p.status || 'drafting'}
          onChange={(e) => onStatus(e.target.value)}
          className="max-w-[108px] rounded border px-1.5 py-1 text-[12px] outline-none"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-3 py-2 text-[12px]">
        {p.email ? (
          <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--color-brand-700)' }}>
            <Mail size={12} /> email
          </a>
        ) : <MutedDash />}
      </td>
    </tr>
  )
}

function ProfessorPreview({ p, busyAction, onStatus, onScore, onDelete }: {
  p: Professor | null
  busyAction: string | null
  onStatus: (status: string) => void
  onScore: (prof: Professor) => void
  onDelete: (prof: Professor) => void
}) {
  if (!p) {
    return (
      <aside className="rounded-md border min-h-[276px] flex items-center justify-center text-center p-6"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
        <div>
          <Users size={28} className="mx-auto" style={{ color: 'var(--color-brand-600)' }} />
          <div className="text-[14px] font-semibold mt-3" style={{ color: 'var(--color-ink)' }}>No target selected</div>
          <div className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>Adjust filters or add a professor.</div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="rounded-md border overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
        <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>Selected target</div>
        <h2 className="text-[18px] leading-tight font-bold mt-1" style={{ color: 'var(--color-ink)' }}>{p.name}</h2>
        <div className="text-[12px] mt-1" style={{ color: 'var(--color-ink-soft)' }}>
          {[p.university, p.dept_lab].filter(Boolean).join(' - ') || 'No affiliation recorded'}
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {p.research_category && <CatPill cat={p.research_category} />}
          {p.tier && <SimpleBadge label={p.tier} />}
          <StatusBadge status={p.status || 'drafting'} />
          <ScorePill value={scoreFor(p)} />
        </div>

        <PreviewField icon={Target} label="Research angle">
          {p.research_angle || p.research_interests || p.notes || 'No research angle recorded yet.'}
        </PreviewField>

        <div className="grid grid-cols-2 gap-2">
          <MiniFact label="Email" value={p.email ? 'Available' : 'Missing'} tone={p.email ? 'green' : 'muted'} />
          <MiniFact label="Hiring" value={hasHiringSignal(p) ? 'Signal' : 'Unknown'} tone={hasHiringSignal(p) ? 'green' : 'muted'} />
        </div>

        {p.hiring_notes && (
          <div className="rounded border px-2 py-2 text-[12px] leading-relaxed"
            style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
            {p.hiring_notes}
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] mb-1" style={{ color: 'var(--color-muted)' }}>Status</div>
          <select
            value={p.status || 'drafting'}
            onChange={(e) => onStatus(e.target.value)}
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
            style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Link
            to={`/professors/${p.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-semibold"
            style={{ background: 'var(--color-ink)', color: 'white' }}
          >
            Open detail <ArrowRight size={13} />
          </Link>
          <button
            onClick={() => onScore(p)}
            disabled={busyAction === `score-${p.id}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-brand-700)' }}
          >
            <RefreshCw size={12} className={busyAction === `score-${p.id}` ? 'animate-spin' : ''} />
            Score
          </button>
          {p.email && (
            <a
              href={`mailto:${p.email}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              <Mail size={12} /> Email
            </a>
          )}
          {p.profile_url && <ExternalButton href={p.profile_url}>Profile</ExternalButton>}
          {p.scholar_url && <ExternalButton href={p.scholar_url}>Scholar</ExternalButton>}
          {p.lab_url && <ExternalButton href={p.lab_url}>Lab</ExternalButton>}
          <button
            onClick={() => onDelete(p)}
            disabled={busyAction === `delete-${p.id}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
            style={{ background: 'var(--color-rose-50)', borderColor: 'var(--color-line-strong)', color: 'var(--color-rose-700)' }}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      </div>
    </aside>
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

function SortMenu({ sortKey, sortDir, onSort }: { sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (key: SortKey) => void }) {
  return (
    <button
      onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
    >
      {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {sortKey === 'score' ? 'Score' : sortKey}
    </button>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-muted)' }}>
      <span className="uppercase tracking-[0.08em]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[170px] px-2 py-1 rounded-md border text-[12px] outline-none"
        style={{
          background: 'var(--color-paper)',
          borderColor: value ? 'var(--color-line-strong)' : 'var(--color-line)',
          color: 'var(--color-ink-soft)',
          fontWeight: value ? 600 : 400,
        }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

function SortableTh({ label, sortKey, current, dir, onClick }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: 'asc' | 'desc'
  onClick: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th
      onClick={() => onClick(sortKey)}
      className="text-left px-3 py-2 font-semibold cursor-pointer select-none hover:bg-[color:var(--color-paper)]"
    >
      <span className="inline-flex items-center gap-1" style={{ color: active ? 'var(--color-ink)' : undefined }}>
        {label}
        {active && (dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
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
      className="shrink-0 px-2.5 py-1 rounded-full border text-[12px] flex items-center gap-1.5 transition-colors"
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
    <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--color-ink-soft)' }}>
      <span className="w-2 h-2 rounded-full" style={{ background: `var(--color-cat-${cat})` }} />
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

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.drafting
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold"
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.border }}>
      <CheckCircle2 size={11} />
      {status}
    </span>
  )
}

function ScorePill({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-[12px]" style={{ color: 'var(--color-muted)' }}>-</span>
  const color = value >= 75 ? 'var(--color-green-700)' : value >= 45 ? 'var(--color-amber-700)' : 'var(--color-muted)'
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[12px] font-semibold" style={{ color }}>
      {value}
    </span>
  )
}

function SimpleBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-mono"
      style={{ background: 'var(--color-paper)', color: 'var(--color-ink-soft)', borderColor: 'var(--color-line)' }}>
      {label}
    </span>
  )
}

function PreviewField({ icon: Icon, label, children }: { icon: IconComponent; label: string; children: ReactNode }) {
  return (
    <div>
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] mb-1"
        style={{ color: 'var(--color-muted)' }}>
        <Icon size={12} /> {label}
      </div>
      <div className="text-[12px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>{children}</div>
    </div>
  )
}

function MiniFact({ label, value, tone }: { label: string; value: string; tone: 'green' | 'muted' }) {
  return (
    <div className="rounded border px-2 py-1.5"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="text-[13px] font-semibold mt-0.5"
        style={{ color: tone === 'green' ? 'var(--color-green-700)' : 'var(--color-ink-soft)' }}>
        {value}
      </div>
    </div>
  )
}

function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] font-medium"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
    >
      <ExternalLink size={12} /> {children}
    </a>
  )
}

function AddField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.08em] mb-1" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded-md border text-[13px] outline-none"
        style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.08em] mb-1" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-md border text-[13px] outline-none"
        style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  )
}

function MutedDash() {
  return <span className="font-mono text-[12px]" style={{ color: 'var(--color-muted)' }}>-</span>
}

function scoreFor(p: Professor): number | null {
  const raw = p.match_score ?? p.relevance_score
  if (raw === null || raw === undefined || Number.isNaN(Number(raw))) return null
  return Math.round(Number(raw))
}

function hasHiringSignal(p: Professor): boolean {
  if (p.hiring_notes || p.prospective_url) return true
  if (!p.hiring_signals) return false
  return Object.values(p.hiring_signals).some(Boolean)
}
