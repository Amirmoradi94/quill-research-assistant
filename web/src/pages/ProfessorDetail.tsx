import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Mail, Edit2, Check, X, Sparkles, Loader, ChevronDown, ChevronUp, AlertCircle, BookOpen, Building2, Tag, GraduationCap, Lightbulb, MessageCircle, FileText, Briefcase } from 'lucide-react'
import { api, type Professor, type UserProfile } from '@/lib/api'
import { apiUrl } from '@/lib/runtime'
import { formatCategory } from '@/lib/categories'
import { useQuillRun } from '@/hooks/useQuillRun'

const STATUSES = ['drafting', 'sent', 'no_reply', 'replied', 'interview', 'offer', 'rejected', 'skipped']
const TIERS = ['T1', 'T2', 'T3']

const STATUS_COLORS: Record<string, string> = {
  drafting:  'var(--color-muted)',
  sent:      'var(--color-brand-600)',
  no_reply:  'var(--color-amber-600)',
  replied:   'var(--color-green-700)',
  interview: 'var(--color-green-500)',
  offer:     'var(--color-green-500)',
  rejected:  'var(--color-rose-700)',
  skipped:   'var(--color-muted)',
}

const capitalizeCategory = formatCategory


export function ProfessorDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [prof, setProf] = useState<Professor | null>(null)
  const [draft, setDraft] = useState<{ id: number; subject: string; body: string } | null>(null)
  const [papers, setPapers] = useState<any[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'publications' | 'draft'>('overview')
  const researchRun = useQuillRun()
  const draftRun = useQuillRun()
  const [showResearchLog, setShowResearchLog] = useState(false)
  const [showDraftLog, setShowDraftLog] = useState(false)

  const reload = async () => {
    if (!id) return
    try {
      const [p, d, papersList] = await Promise.all([
        api.professor(Number(id)),
        fetch(apiUrl(`/api/professors/${id}/draft`)).then((r) => r.ok ? r.json() : null),
        api.professorPapers(Number(id)),
      ])
      setProf(p)
      setDraft(d)
      setPapers(papersList)
    } catch (e) { setErr(String(e)) }
  }

  useEffect(() => {
    reload()
    const h = () => reload()
    window.addEventListener('quill:data-changed', h)
    return () => window.removeEventListener('quill:data-changed', h)
  }, [id])
  useEffect(() => { api.profile().then(setUserProfile).catch(() => {}) }, [])

  // Derive the user's target position for this professor. Per-prof override
  // (prof.position_type) wins; otherwise infer from the user's current_role.
  const targetPos: 'postdoc' | 'phd' | 'master' = (() => {
    const explicit = prof?.position_type?.toLowerCase()
    if (explicit === 'postdoc' || explicit === 'phd' || explicit === 'master') return explicit
    const role = (userProfile?.current_role || '').toLowerCase()
    if (role.includes('postdoc')) return 'postdoc'
    if (role.includes('master') || role.includes('msc') || role.includes('m.sc')) return 'master'
    return 'phd'
  })()

  const patch = async (field: string, value: string) => {
    if (!prof) return
    const r = await fetch(apiUrl(`/api/professors/${prof.id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (r.ok) { setEditing(null); reload() }
  }

  if (err) return (
    <div className="px-8 py-6">
      <div className="p-3 rounded text-[14px]" style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>{err}</div>
    </div>
  )
  if (!prof) return <div className="px-8 py-6 text-[14px]" style={{ color: 'var(--color-muted)' }}>Loading…</div>

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--color-paper)' }}>
      {/* Header */}
      <div className="px-8 py-4 border-b" style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)' }}>
        <div className="text-[14px] mb-2" style={{ color: 'var(--color-muted)' }}>
          <Link to="/professors" style={{ color: 'var(--color-muted)' }}>Professors</Link> / {prof.name}
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <button onClick={() => navigate('/professors')} className="inline-flex items-center gap-1 text-[14px] mb-2"
              style={{ color: 'var(--color-muted)' }}>
              <ArrowLeft size={13} /> Back
            </button>
            <h1 className="font-bold tracking-tight" style={{ fontSize: 36, color: 'var(--color-ink)' }}>{prof.name}</h1>
            <div className="text-[16px] mt-1" style={{ color: 'var(--color-ink-soft)' }}>
              {prof.university} {prof.dept_lab ? `· ${prof.dept_lab}` : ''}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            <button
              disabled={researchRun.state === 'running'}
              onClick={() => researchRun.start({ workflow: 'research_professor', professor_id: prof.id }).then(reload)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] font-medium border"
              style={{ borderColor: 'var(--color-brand-400)', color: 'var(--color-brand-700)', background: 'var(--color-brand-50)' }}>
              {researchRun.state === 'running'
                ? <><Loader size={12} className="animate-spin" /> Researching…</>
                : <><Sparkles size={12} /> Research</>}
            </button>
            <button
              disabled={draftRun.state === 'running'}
              onClick={() => draftRun.start({ workflow: 'draft_email', professor_id: prof.id }).then(reload)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] font-medium border"
              style={{ borderColor: 'var(--color-brand-400)', color: 'var(--color-brand-700)', background: 'var(--color-brand-50)' }}>
              {draftRun.state === 'running'
                ? <><Loader size={12} className="animate-spin" /> Drafting…</>
                : <><Mail size={12} /> Draft email</>}
            </button>
            <select value={prof.tier || 'T3'}
              onChange={(e) => patch('tier', e.target.value)}
              className="text-[13px] px-2 py-1 rounded border outline-none font-mono"
              style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}>
              {TIERS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={prof.status || 'drafting'}
              onChange={(e) => patch('status', e.target.value)}
              className="text-[13px] px-2 py-1 rounded border outline-none"
              style={{
                borderColor: 'var(--color-line)',
                background: 'var(--color-paper-2)',
                color: STATUS_COLORS[prof.status || 'drafting'],
              }}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 mt-4 border-b" style={{ borderColor: 'var(--color-line)' }}>
          <button onClick={() => setActiveTab('overview')}
            className="pb-2 text-[15px] font-medium border-b-2 transition-colors"
            style={{
              borderColor: activeTab === 'overview' ? 'var(--color-brand-600)' : 'transparent',
              color: activeTab === 'overview' ? 'var(--color-brand-600)' : 'var(--color-muted)'
            }}>
            Overview
          </button>
          <button onClick={() => setActiveTab('publications')}
            className="pb-2 text-[15px] font-medium border-b-2 transition-colors inline-flex items-center gap-1.5"
            style={{
              borderColor: activeTab === 'publications' ? 'var(--color-brand-600)' : 'transparent',
              color: activeTab === 'publications' ? 'var(--color-brand-600)' : 'var(--color-muted)'
            }}>
            <BookOpen size={14} /> Publications ({Math.min(5, papers.length)})
          </button>
          {draft && (
            <button onClick={() => setActiveTab('draft')}
              className="pb-2 text-[15px] font-medium border-b-2 transition-colors"
              style={{
                borderColor: activeTab === 'draft' ? 'var(--color-brand-600)' : 'transparent',
                color: activeTab === 'draft' ? 'var(--color-brand-600)' : 'var(--color-muted)'
              }}>
              Draft
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Main Content - Tabs */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="max-w-4xl">
              {researchRun.state !== 'idle' && (
                <div className="rounded-md border px-3 py-2.5 mb-4 text-[13px]"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
                  {researchRun.state === 'running' && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5" style={{ color: 'var(--color-brand-600)' }}>
                        <Loader size={11} className="animate-spin" /> Quill is scraping the professor's page…
                      </div>
                      <button onClick={() => setShowResearchLog(!showResearchLog)} style={{ color: 'var(--color-muted)' }}>
                        {showResearchLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                  )}
                  {researchRun.state === 'done' && (
                    <span style={{ color: 'var(--color-green-700)' }}>Research complete — profile updated</span>
                  )}
                  {researchRun.state === 'error' && (
                    <div className="flex items-center gap-1.5" style={{ color: 'var(--color-rose-700)' }}>
                      <AlertCircle size={11} /> {researchRun.error}
                    </div>
                  )}
                  {showResearchLog && researchRun.logText && (
                    <pre className="text-[12px] max-h-32 overflow-auto whitespace-pre-wrap font-mono mt-2 p-2 rounded"
                      style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)' }}>
                      {researchRun.logText}
                    </pre>
                  )}
                </div>
              )}
              <div className="space-y-5 mb-6">
                {/* Hero: relevance score + key chips */}
                {/* <RelevanceHero prof={prof} /> */}

                {/* Contact card: email + faculty profile + scholar in one place */}
                <SectionCard icon={<Mail size={15} />} title="Contact & links">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FieldRow label="Email" icon={<Mail size={13} />}>
                      <InlineEdit value={prof.email || ''} field="email" editing={editing} editVal={editVal}
                        onEdit={(f, v) => { setEditing(f); setEditVal(v) }}
                        onChange={setEditVal} onSave={patch} onCancel={() => setEditing(null)} />
                    </FieldRow>
                    <FieldRow label="Faculty page" icon={<Building2 size={13} />}>
                      {prof.profile_url
                        ? <a href={prof.profile_url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[14px] font-medium"
                            style={{ color: 'var(--color-brand-600)' }}>
                            Visit <ExternalLink size={11} />
                          </a>
                        : <span className="text-[14px]" style={{ color: 'var(--color-muted)' }}>—</span>}
                    </FieldRow>
                    {prof.scholar_url && (
                      <FieldRow label="Google Scholar" icon={<GraduationCap size={13} />}>
                        <a href={prof.scholar_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[14px] font-medium"
                          style={{ color: 'var(--color-brand-600)' }}>
                          Profile <ExternalLink size={11} />
                        </a>
                      </FieldRow>
                    )}
                    {prof.lab_url && (
                      <FieldRow label="Lab / group" icon={<Briefcase size={13} />}>
                        <a href={prof.lab_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[14px] font-medium"
                          style={{ color: 'var(--color-brand-600)' }}>
                          Open <ExternalLink size={11} />
                        </a>
                      </FieldRow>
                    )}
                    <FieldRow label="Research category" icon={<Tag size={13} />}>
                      <InlineEdit value={capitalizeCategory(prof.research_category)} field="research_category" editing={editing} editVal={editVal}
                        onEdit={(f, v) => { setEditing(f); setEditVal(v) }}
                        onChange={setEditVal} onSave={patch} onCancel={() => setEditing(null)} />
                    </FieldRow>
                  </div>
                </SectionCard>

                {/* Research angle — full width, eye-catching */}
                {prof.research_angle && (
                  <SectionCard icon={<Lightbulb size={15} />} title="Research angle" accent="indigo">
                    <p className="text-[14.5px]" style={{ color: 'var(--color-ink-soft)', lineHeight: 1.65 }}>
                      {prof.research_angle}
                    </p>
                  </SectionCard>
                )}

                {/* Hiring intelligence — amber accent for actionable AI-extracted info.
                    Shows only the section matching the user's target position, with
                    a toggle to peek at other positions. */}
                {(prof.contact_instructions || prof.hiring_notes || prof.hiring_intel) && (
                  <SectionCard icon={<MessageCircle size={15} />} title="Hiring intelligence" accent="amber">
                    <HiringIntel
                      prof={prof}
                      targetPos={targetPos}
                      onSaveNotes={(v) => patch('hiring_notes', v)}
                      onSaveContact={(v) => patch('contact_instructions', v)}
                    />
                  </SectionCard>
                )}

                {/* Personal notes */}
                <SectionCard icon={<FileText size={15} />} title="Personal notes">
                  <AutoTextarea
                    value={prof.notes || ''}
                    onSave={(v) => patch('notes', v)}
                    placeholder="Add your thoughts, follow-up reminders, conversation history…"
                    minRows={4}
                    color="var(--color-ink-soft)"
                  />
                </SectionCard>
              </div>
            </div>
          )}

          {activeTab === 'publications' && (
            <div className="max-w-4xl">
              {papers.length === 0 ? (
                <div className="text-center py-12" style={{ color: 'var(--color-muted)' }}>
                  <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
                  <div className="text-[15px]">No publications found</div>
                </div>
              ) : (
                <div>
                  <div className="mb-4 text-[14px]" style={{ color: 'var(--color-muted)' }}>
                    Showing top {Math.min(5, papers.length)} most recent and relevant publications
                  </div>
                  <div className="space-y-4">
                    {papers.slice(0, 5).map((paper) => (
                      <div key={paper.id} className="rounded-md border p-4"
                        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <a href={paper.url || '#'} target="_blank" rel="noreferrer"
                              className="text-[15px] font-semibold block mb-2 hover:underline"
                              style={{ color: paper.url ? 'var(--color-brand-600)' : 'var(--color-ink)', lineHeight: 1.4 }}>
                              {paper.title}
                            </a>
                            {paper.venue && (
                              <div className="text-[13px] mb-3" style={{ color: 'var(--color-muted)' }}>
                                {paper.venue} {paper.year && `· ${paper.year}`}
                              </div>
                            )}
                          </div>
                          {paper.relevance_score !== null && (
                            <div className="text-[13px] font-mono px-2 py-1 rounded flex-shrink-0"
                              style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)' }}>
                              {paper.relevance_score}%
                            </div>
                          )}
                        </div>
                        {(paper.relevance_summary || paper.abstract) && (
                          <div className="text-[14px] mb-3 p-3 rounded"
                            style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)', lineHeight: 1.6 }}>
                            💡 <span style={{ fontWeight: 500 }}>Summary:</span> {
                              paper.relevance_summary ? paper.relevance_summary : (paper.abstract ? paper.abstract : '')
                            }
                          </div>
                        )}
                        {(paper.url || paper.pdf_url) && (
                          <div className="flex gap-3">
                            {paper.url && (
                              <a href={paper.url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[14px]" style={{ color: 'var(--color-brand-600)' }}>
                                Read paper <ExternalLink size={11} />
                              </a>
                            )}
                            {paper.pdf_url && (
                              <a href={paper.pdf_url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[14px]" style={{ color: 'var(--color-brand-600)' }}>
                                Download PDF <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'draft' && draft && (
            <div className="max-w-4xl">
              {draftRun.state !== 'idle' && (
                <div className="rounded-md border px-3 py-2.5 mb-4 text-[13px]"
                  style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
                  {draftRun.state === 'running' && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5" style={{ color: 'var(--color-brand-600)' }}>
                        <Loader size={11} className="animate-spin" /> Quill is drafting the email…
                      </div>
                      <button onClick={() => setShowDraftLog(!showDraftLog)} style={{ color: 'var(--color-muted)' }}>
                        {showDraftLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                  )}
                  {draftRun.state === 'done' && (
                    <span style={{ color: 'var(--color-green-700)' }}>Email draft ready</span>
                  )}
                  {draftRun.state === 'error' && (
                    <div className="flex items-center gap-1.5" style={{ color: 'var(--color-rose-700)' }}>
                      <AlertCircle size={11} /> {draftRun.error}
                    </div>
                  )}
                  {showDraftLog && draftRun.logText && (
                    <pre className="text-[12px] max-h-32 overflow-auto whitespace-pre-wrap font-mono mt-2 p-2 rounded"
                      style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)' }}>
                      {draftRun.logText}
                    </pre>
                  )}
                </div>
              )}
              <div className="rounded-md border p-4"
                style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Mail size={14} style={{ color: 'var(--color-brand-600)' }} />
                  <div className="text-[15px] font-semibold" style={{ color: 'var(--color-ink)' }}>Draft email</div>
                  <div className="text-[14px] ml-auto" style={{ color: 'var(--color-muted)' }}>{draft.subject}</div>
                </div>
                <pre className="text-[15px] whitespace-pre-wrap font-sans max-h-96 overflow-y-auto"
                  style={{ color: 'var(--color-ink-soft)', lineHeight: 1.55 }}>
                  {draft.body}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionCard({ icon, title, accent, children }: {
  icon?: React.ReactNode; title: string; accent?: 'amber' | 'indigo'; children: React.ReactNode
}) {
  const accentStyles =
    accent === 'amber'  ? { bg: 'rgba(252, 211, 77, 0.08)', border: 'rgba(217, 119, 6, 0.25)', iconColor: '#b45309' } :
    accent === 'indigo' ? { bg: 'rgba(99, 102, 241, 0.05)', border: 'rgba(99, 102, 241, 0.2)',  iconColor: '#4f46e5' } :
                          { bg: 'var(--color-white)',       border: 'var(--color-line)',         iconColor: 'var(--color-muted)' }
  return (
    <div className="rounded-xl border"
      style={{ background: accentStyles.bg, borderColor: accentStyles.border }}>
      <div className="px-5 py-3 border-b flex items-center gap-2"
        style={{ borderColor: accentStyles.border }}>
        {icon && <span style={{ color: accentStyles.iconColor }}>{icon}</span>}
        <h3 className="text-[13px] font-semibold uppercase tracking-wider"
          style={{ color: accentStyles.iconColor }}>
          {title}
        </h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function HiringIntel({ prof, targetPos, onSaveNotes, onSaveContact }: {
  prof: Professor
  targetPos: 'postdoc' | 'phd' | 'master'
  onSaveNotes: (v: string) => void
  onSaveContact: (v: string) => void
}) {
  const [activePos, setActivePos] = useState<'postdoc' | 'phd' | 'master'>(targetPos)
  useEffect(() => { setActivePos(targetPos) }, [targetPos])

  const intel = prof.hiring_intel
  const hasIntel = !!intel && (intel.postdoc || intel.phd || intel.master || intel.general)

  const posLabel: Record<string, string> = { postdoc: 'Postdoc', phd: 'PhD', master: "Master's" }
  const amber = 'var(--color-amber-700, #92400e)'

  return (
    <div className="space-y-4">
      {prof.contact_instructions && (
        <div>
          <div className="text-[11px] uppercase tracking-wider mb-1.5 font-medium" style={{ color: amber }}>
            How to reach out
          </div>
          <AutoTextarea
            value={prof.contact_instructions}
            onSave={onSaveContact}
            color="var(--color-ink)"
          />
        </div>
      )}

      {hasIntel ? (
        <>
          {/* Position tab selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider mr-1" style={{ color: amber }}>
              Openings for
            </span>
            {(['postdoc', 'phd', 'master'] as const).map((p) => {
              const has = !!intel?.[p]?.trim()
              const isActive = activePos === p
              const isTarget = p === targetPos
              return (
                <button
                  key={p}
                  onClick={() => setActivePos(p)}
                  className="px-2.5 py-1 rounded-full border text-[12px] flex items-center gap-1"
                  style={{
                    background: isActive ? 'var(--color-white)' : 'var(--color-paper-2)',
                    borderColor: isActive ? amber : 'var(--color-line)',
                    color: 'var(--color-ink-soft)',
                    fontWeight: isActive ? 500 : 400,
                    opacity: has ? 1 : 0.5,
                  }}
                >
                  {posLabel[p]}
                  {isTarget && <span className="text-[9px]" style={{ color: amber }}>★ you</span>}
                  {!has && <span style={{ color: 'var(--color-muted)' }}>—</span>}
                </button>
              )
            })}
          </div>

          {/* Active position's content */}
          <div>
            <div className="text-[15px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--color-ink)' }}>
              {intel?.[activePos]?.trim()
                ? intel[activePos]
                : <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>
                    No {posLabel[activePos].toLowerCase()}-specific information found on this professor's pages.
                  </span>
              }
            </div>
          </div>

          {/* General info — always shown if present */}
          {intel?.general?.trim() && (
            <div>
              <div className="text-[11px] uppercase tracking-wider mb-1.5 font-medium" style={{ color: amber }}>
                General lab info
              </div>
              <div className="text-[14px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                {intel.general}
              </div>
            </div>
          )}
        </>
      ) : (
        prof.hiring_notes && (
          <div>
            <div className="text-[11px] uppercase tracking-wider mb-1.5 font-medium" style={{ color: amber }}>
              Hiring notes
            </div>
            <AutoTextarea
              value={prof.hiring_notes}
              onSave={onSaveNotes}
              color="var(--color-ink)"
            />
          </div>
        )
      )}
    </div>
  )
}

function FieldRow({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium"
        style={{ color: 'var(--color-muted)' }}>
        {icon}<span>{label}</span>
      </div>
      <div>{children}</div>
    </div>
  )
}

function AutoTextarea({
  value,
  onSave,
  placeholder,
  minRows = 1,
  color = 'var(--color-ink-soft)',
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  minRows?: number
  color?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [local, setLocal] = useState(value)

  // Keep local state in sync if parent value changes (e.g. after AI run completes)
  useEffect(() => { setLocal(value) }, [value])

  // Auto-size: set height to content's scrollHeight on every change/mount
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [local])

  return (
    <textarea
      ref={ref}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => { if (e.target.value !== value) onSave(e.target.value) }}
      placeholder={placeholder}
      rows={minRows}
      className="w-full text-[14px] outline-none resize-none font-sans overflow-hidden"
      style={{ background: 'transparent', color, lineHeight: 1.6 }}
    />
  )
}

function InlineEdit({ value, field, editing, editVal, onEdit, onChange, onSave, onCancel }: {
  value: string; field: string; editing: string | null; editVal: string;
  onEdit: (f: string, v: string) => void; onChange: (v: string) => void;
  onSave: (f: string, v: string) => void; onCancel: () => void;
}) {
  if (editing === field) {
    return (
      <div className="flex items-center gap-1">
        <input value={editVal} onChange={(e) => onChange(e.target.value)} autoFocus
          className="flex-1 text-[15px] px-1.5 py-0.5 rounded border outline-none"
          style={{ borderColor: 'var(--color-brand-500)', background: 'var(--color-paper)' }} />
        <button onClick={() => onSave(field, editVal)} style={{ color: 'var(--color-green-700)' }}><Check size={14} /></button>
        <button onClick={onCancel} style={{ color: 'var(--color-muted)' }}><X size={14} /></button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 group">
      <span className="text-[15px]" style={{ color: 'var(--color-ink-soft)' }}>{value || '—'}</span>
      <button onClick={() => onEdit(field, value)}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--color-muted)' }}>
        <Edit2 size={12} />
      </button>
    </div>
  )
}
