import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles, CheckCircle2, Plus, Trash2, X, Play, RefreshCw, Star,
  MapPin, Briefcase, GraduationCap, FlaskConical, FileText, Award, Wrench,
  HandHeart, UsersRound, User as UserIcon, Target, Globe, Coins, CalendarClock,
  ExternalLink, Mail, Code2, Link as LinkIcon, BookOpenText,
} from 'lucide-react'
import {
  api,
  type UserProfileFull, type UserEducation, type UserPublication,
  type UserExperience, type UserAward, type UserReference,
} from '@/lib/api'
import { formatCategory } from '@/lib/categories'
import { useConfirm } from '@/components/ConfirmDialog'

type Kind = 'education' | 'publications' | 'experience' | 'awards' | 'references'

/** Capitalize each word, normalizing underscores to spaces. Short alphabetic
 * tokens (≤3 letters, no digits) become uppercase as acronyms. */
function titleize(s?: string | null): string {
  if (!s) return ''
  return s
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((w) => {
      if (!w) return w
      if (/^\d/.test(w)) return w  // leave "1y", "2y" alone
      if (w.length <= 3) return w.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
}

function emptyProfile(): UserProfileFull {
  return {
    id: 0,
    name: 'Amir Moradi',
    preferred_name: null,
    pronouns: null,
    headshot_url: null,
    email: null,
    current_role: 'Ph.D. candidate',
    affiliation: 'Concordia University',
    country: null,
    city: null,
    research_interests: null,
    research_categories: [],
    methods: [],
    application_domains: [],
    tools_frameworks: [],
    datasets_used: [],
    datasets_created: [],
    programming_languages: [],
    certifications: [],
    reviewing_venues: [],
    education: [],
    publications: [],
    experience: [],
    awards: [],
    references: [],
  }
}

const SECTIONS = [
  { id: 'target',       label: 'Target',         icon: Target },
  { id: 'research',     label: 'Research',       icon: FlaskConical },
  { id: 'experience',   label: 'Experience',     icon: Briefcase },
  { id: 'education',    label: 'Education',      icon: GraduationCap },
  { id: 'publications', label: 'Publications',   icon: BookOpenText },
  { id: 'awards',       label: 'Awards',         icon: Award },
  { id: 'skills',       label: 'Skills',         icon: Wrench },
  { id: 'service',      label: 'Service',        icon: HandHeart },
  { id: 'references',   label: 'References',     icon: UsersRound },
  { id: 'identity',     label: 'Identity',       icon: UserIcon },
] as const

export function Profile() {
  const [data, setData] = useState<UserProfileFull | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [extractOpen, setExtractOpen] = useState(false)

  const reload = async () => {
    try {
      setData(await api.user())
      setErr(null)
    } catch (e: any) {
      setErr(String(e))
      setData((current) => current ?? emptyProfile())
    }
  }
  useEffect(() => {
    reload()
    window.addEventListener('quill:data-changed', reload)
    return () => window.removeEventListener('quill:data-changed', reload)
  }, [])

  const patch = async (payload: Partial<UserProfileFull>) => {
    const next = await api.patchUser(payload)
    setData(next)
  }

  if (!data) return <div className="p-8" style={{ color: 'var(--color-muted)' }}>Loading…</div>

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
      <div className="w-[320px] max-w-full min-w-0 overflow-hidden sm:w-full">
        <Hero data={data} err={err} onPatch={patch} onOpenExtract={() => setExtractOpen(true)} />

        <nav className="mb-2 rounded-md border px-2 py-1.5 flex items-center gap-1 overflow-x-auto text-[11px]"
          style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line-strong)' }}>
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <a key={s.id} href={`#${s.id}`}
                 className="inline-flex items-center gap-1.5 px-2 py-1 rounded whitespace-nowrap transition-colors hover:bg-[color:var(--color-paper)]"
                 style={{ color: 'var(--color-ink-soft)' }}>
                <Icon size={12} />
                {s.label}
              </a>
            )
          })}
        </nav>

        <div className="pb-24 flex flex-col gap-2.5">
        <SectionCard id="target" title="Application target" icon={Target} accent="var(--color-cat-rl)">
          <TargetGrid data={data} onPatch={patch} />
        </SectionCard>

        <SectionCard id="research" title="Research profile" icon={FlaskConical} accent="var(--color-cat-cv)">
          <ResearchBlock data={data} onPatch={patch} />
        </SectionCard>

        <SectionCard id="experience" title="Experience" icon={Briefcase} accent="var(--color-cat-or)"
          right={<AddBtn onClick={() => addChild('experience', setData)} />}>
          <Timeline kind="experience" items={data.experience}
            render={(it, edit) => <ExperienceNode item={it} onEdit={edit} />}
            onDelete={async (id) => { await api.deleteUserItem('experience', id); setData(await api.user()) }}
            onEdit={async (id, p) => { await api.patchUserItem('experience', id, p); setData(await api.user()) }} />
        </SectionCard>

        <SectionCard id="education" title="Education" icon={GraduationCap} accent="var(--color-cat-av)"
          right={<AddBtn onClick={() => addChild('education', setData)} />}>
          <Timeline kind="education" items={data.education}
            render={(it, edit) => <EducationNode item={it} onEdit={edit} />}
            onDelete={async (id) => { await api.deleteUserItem('education', id); setData(await api.user()) }}
            onEdit={async (id, p) => { await api.patchUserItem('education', id, p); setData(await api.user()) }} />
        </SectionCard>

        <SectionCard id="publications" title="Publications" icon={BookOpenText} accent="var(--color-cat-medical)"
          right={<>
            <PubStats pubs={data.publications} />
            <AddBtn onClick={() => addChild('publications', setData)} />
          </>}>
          <PublicationsList pubs={data.publications}
            onDelete={async (id) => { await api.deleteUserItem('publications', id); setData(await api.user()) }}
            onEdit={async (id, p) => { await api.patchUserItem('publications', id, p); setData(await api.user()) }} />
        </SectionCard>

        <SectionCard id="awards" title="Awards & funding" icon={Award} accent="var(--color-cat-renewable)"
          right={<AddBtn onClick={() => addChild('awards', setData)} />}>
          <AwardsGrid items={data.awards}
            onDelete={async (id) => { await api.deleteUserItem('awards', id); setData(await api.user()) }}
            onEdit={async (id, p) => { await api.patchUserItem('awards', id, p); setData(await api.user()) }} />
        </SectionCard>

        <SectionCard id="skills" title="Skills & languages" icon={Wrench} accent="var(--color-cat-theory)">
          <SkillsBlock data={data} onPatch={patch} />
        </SectionCard>

        <SectionCard id="service" title="Service & teaching" icon={HandHeart} accent="var(--color-cat-nlp)">
          <ServiceBlock data={data} onPatch={patch} />
        </SectionCard>

        <SectionCard id="references" title="References" icon={UsersRound} accent="var(--color-cat-robotics)"
          right={<AddBtn onClick={() => addChild('references', setData)} />}>
          <ReferencesGrid items={data.references}
            onDelete={async (id) => { await api.deleteUserItem('references', id); setData(await api.user()) }}
            onEdit={async (id, p) => { await api.patchUserItem('references', id, p); setData(await api.user()) }} />
        </SectionCard>

        <SectionCard id="identity" title="Identity & contact" icon={UserIcon} accent="var(--color-cat-adversarial)">
          <IdentityGrid data={data} onPatch={patch} />
        </SectionCard>
        </div>
      </div>

      {extractOpen && (
        <ExtractDrawer data={data} onClose={() => setExtractOpen(false)}
          onPatch={patch}
          onDone={async () => { setData(await api.user()) }} />
      )}
    </div>
  )
}

// ─── HERO ──────────────────────────────────────────────────────────
function Hero({ data, err, onPatch, onOpenExtract }: {
  data: UserProfileFull
  err?: string | null
  onPatch: (p: Partial<UserProfileFull>) => Promise<void>
  onOpenExtract: () => void
}) {
  const stats = useMemo(() => {
    const pubsPublished = data.publications.filter((p) => p.status === 'published' || p.status === 'accepted').length
    const pubsReview = data.publications.filter((p) => p.status === 'under_review' || p.status === 'in_prep').length
    const yearsResearch = (() => {
      const start = data.experience.map((e) => e.start_date).filter(Boolean) as string[]
      if (!start.length) return null
      const earliest = start.sort()[0]
      const y = new Date(earliest).getFullYear()
      const now = new Date().getFullYear()
      return Number.isFinite(y) ? now - y + 1 : null
    })()
    return [
      { label: 'Publications', value: data.publications.length, sub: pubsPublished ? `${pubsPublished} published · ${pubsReview} review` : undefined },
      { label: 'Education',    value: data.education.length,    sub: data.education[0]?.degree_level || undefined },
      { label: 'Awards',       value: data.awards.length },
      { label: 'Years',        value: yearsResearch ?? '—', sub: yearsResearch ? 'In research' : undefined },
    ]
  }, [data])

  return (
    <header className="mb-2">
      {/* Gradient background */}
      <div className="hidden"
        style={{
          background: `
            radial-gradient(800px 400px at 15% 15%, color-mix(in srgb, var(--color-cat-cv) 35%, transparent), transparent),
            radial-gradient(700px 500px at 95% 30%, color-mix(in srgb, var(--color-brand-500) 22%, transparent), transparent),
            linear-gradient(180deg, var(--color-paper-2), var(--color-paper))
          `,
        }} />
      {/* Subtle grid */}
      <div className="hidden"
        style={{
          backgroundImage: 'linear-gradient(var(--color-ink) 1px, transparent 1px), linear-gradient(90deg, var(--color-ink) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />

      <div>
        <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-muted)' }}>
            Profile
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {err && (
              <span className="rounded border px-2 py-1 text-[10px] uppercase tracking-[0.08em]"
                title={`Backend data unavailable: ${err}`}
                style={{ background: 'var(--color-amber-50)', borderColor: 'var(--color-line-strong)', color: 'var(--color-amber-700)' }}>
                Offline data
              </span>
            )}
            <AutoFillCTA data={data} onOpen={onOpenExtract} />
          </div>
        </div>

        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          {/* Avatar */}
          <div className="flex-1 min-w-0">
            <Inline value={data.preferred_name || data.name}
              placeholder="Your name"
              className="text-[40px] font-bold tracking-tight leading-none"
              onSave={(v) => onPatch({ preferred_name: v })} />
            <div className="text-[16px] mt-2 flex flex-wrap items-center gap-x-2"
              style={{ color: 'var(--color-ink-soft)' }}>
              <Inline value={data.current_role} placeholder="Current role"
                onSave={(v) => onPatch({ current_role: v })} />
              {(data.current_role && data.affiliation) && <span style={{ color: 'var(--color-muted-2)' }}>·</span>}
              <Inline value={data.affiliation} placeholder="Affiliation"
                onSave={(v) => onPatch({ affiliation: v })} />
            </div>

            <div className="text-[14px] mt-2 max-w-[720px] leading-6"
              style={{ color: 'var(--color-muted)' }}>
              <Inline value={data.headline}
                placeholder="One-sentence research pitch..."
                onSave={(v) => onPatch({ headline: v })} />
            </div>

            {/* Quick links / contacts */}
            <div className="mt-2 grid max-w-full min-w-0 grid-cols-1 gap-1.5 sm:flex sm:flex-wrap sm:gap-1.5 text-[12px] overflow-hidden">
              {(data.city || data.country) && (
                <Pill icon={MapPin}>{[data.city, data.country].filter(Boolean).join(', ')}</Pill>
              )}
              {data.email && (
                <Pill icon={Mail} href={`mailto:${data.email}`}>{data.email}</Pill>
              )}
              {data.orcid && <Pill icon={LinkIcon} href={`https://orcid.org/${data.orcid}`}>ORCID</Pill>}
              {data.scholar_url && <Pill icon={GraduationCap} href={data.scholar_url}>Google Scholar</Pill>}
              {data.github && <Pill icon={Code2} href={data.github}>GitHub</Pill>}
              {data.linkedin && <Pill icon={Briefcase} href={data.linkedin}>LinkedIn</Pill>}
              {data.website && <Pill icon={Globe} href={data.website}>Website</Pill>}
            </div>
          </div>

          <div
            className="grid shrink-0 w-full xl:w-auto gap-2 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            {stats.map((s) => (
              <div key={s.label}
                className="w-full min-h-[92px] rounded-md border px-3 py-3"
                style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line-strong)' }}>
                <div className="text-[11px] uppercase tracking-[0.14em] leading-4 break-words" style={{ color: 'var(--color-muted)' }}>
                  {s.label}
                </div>
                <div className="text-[42px] font-bold tracking-tight leading-none mt-2" style={{ color: 'var(--color-ink)' }}>
                  {s.value}
                </div>
                {s.sub && <div className="text-[12px] mt-2 leading-5 break-words" style={{ color: 'var(--color-muted)' }}>{s.sub}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Category chips row — the visual identity */}
        {(data.research_categories?.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 min-w-0 overflow-x-auto pb-1">
            {(data.research_categories || []).map((c) => (
              <span key={c}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border"
                style={{
                  background: `color-mix(in srgb, var(--color-cat-${c}) 10%, var(--color-white))`,
                  borderColor: `color-mix(in srgb, var(--color-cat-${c}) 40%, var(--color-line))`,
                  color: `color-mix(in srgb, var(--color-cat-${c}) 80%, var(--color-ink))`,
                }}>
                <span className="w-2 h-2 rounded-full" style={{ background: `var(--color-cat-${c})` }} />
                {formatCategory(c)}
              </span>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}

function AutoFillCTA({ data, onOpen }: { data: UserProfileFull; onOpen: () => void }) {
  const hasCV = !!data.cv_doc_id
  const lastRun = data.cv_last_extracted_at
    ? new Date(data.cv_last_extracted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null
  return (
    <div className="flex-shrink-0 flex items-center justify-end gap-2">
      <button onClick={onOpen}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium text-[11px]"
        style={{
          background: hasCV ? 'var(--color-ink)' : 'var(--color-amber-50)',
          color: hasCV ? 'white' : 'var(--color-amber-700)',
          borderColor: hasCV ? 'var(--color-ink)' : 'var(--color-line-strong)',
        }}>
        <Sparkles size={12} />
        {hasCV ? (lastRun ? 'Re-run auto-fill' : 'Auto-fill from CV') : 'Upload a CV to auto-fill'}
      </button>
      {lastRun && (
        <div className="text-[10px] flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
          <CheckCircle2 size={11} style={{ color: 'var(--color-green-700)' }} />
          {lastRun}
        </div>
      )}
    </div>
  )
}

function Pill({ icon: Icon, href, children }: {
  icon: React.ComponentType<{ size?: number }>; href?: string; children: React.ReactNode
}) {
  const inner = (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 px-2.5 py-1 rounded border bg-white/70 hover:bg-white transition-colors"
      style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
      <Icon size={12} />
      <span className="truncate text-[12px]">{children}</span>
    </span>
  )
  return href ? <a className="max-w-full min-w-0" href={href} target="_blank" rel="noopener">{inner}</a> : inner
}

// ─── Section card wrapper ──────────────────────────────────────────
function SectionCard({ id, title, icon: Icon, accent, right, children }: {
  id: string; title: string
  icon: React.ComponentType<{ size?: number }>
  accent: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="rounded-md border overflow-hidden"
      style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line-strong)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b"
        style={{
          borderColor: 'var(--color-line)',
          background: 'transparent',
        }}>
        <h2 className="font-semibold text-[15px] flex items-center gap-2"
          style={{ color: 'var(--color-ink)' }}>
          <span className="w-5 h-5 rounded grid place-items-center"
            style={{ color: accent }}>
            <Icon size={14} />
          </span>
          {title}
        </h2>
        <div className="flex items-center gap-2">{right}</div>
      </div>
      <div className="p-2.5">{children}</div>
    </section>
  )
}

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[13px] hover:bg-[color:var(--color-paper-2)]"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-ink-soft)' }}>
      <Plus size={12} /> Add
    </button>
  )
}

function PubStats({ pubs }: { pubs: UserPublication[] }) {
  const sig = pubs.filter((p) => p.is_signature).length
  if (!pubs.length) return null
  return (
    <span className="text-[12px] font-mono px-2 py-1 rounded-full"
      style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>
      {pubs.length} · ★ {sig}
    </span>
  )
}

// ─── TARGET GRID ───────────────────────────────────────────────────
function TargetGrid({ data, onPatch }: {
  data: UserProfileFull; onPatch: (p: Partial<UserProfileFull>) => Promise<void>
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
      <div className="md:col-span-2">
        <BigSelect icon={Target} label="Position type" value={data.target_position_type}
          options={['postdoc','phd','master']}
          onSave={(v) => onPatch({ target_position_type: v })} />
      </div>
      <div className="md:col-span-2">
        <BigSelect icon={Coins} label="Funding status" value={data.funding_status}
          options={['have_scholarship','need_funded','self_funded','flexible']}
          onSave={(v) => onPatch({ funding_status: v })} />
      </div>
      <div className="md:col-span-2">
        <BigSelect icon={CalendarClock} label="Commitment" value={data.commitment_length}
          options={['1y','2y','open']}
          onSave={(v) => onPatch({ commitment_length: v })} />
      </div>
      <div className="md:col-span-2">
        <BigField icon={CalendarClock} label="Target start" value={data.target_start_date}
          placeholder="YYYY-MM-DD" onSave={(v) => onPatch({ target_start_date: v })} />
      </div>
      <div className="md:col-span-4">
        <ChipField label="Preferred universities" values={data.target_universities_preferred || []}
          onSave={(v) => onPatch({ target_universities_preferred: v })} icon={GraduationCap} compact />
      </div>
      <div className="md:col-span-4">
        <ChipField label="Target countries"  values={data.target_countries || []}
          onSave={(v) => onPatch({ target_countries: v })} icon={Globe} compact />
      </div>
      <div className="md:col-span-4">
        <BigField icon={CalendarClock} label="Earliest available" value={data.earliest_available_date}
          placeholder="YYYY-MM-DD" onSave={(v) => onPatch({ earliest_available_date: v })} />
      </div>
      <div className="md:col-span-4">
        <ChipField label="Excluded institutions" values={data.excluded_institutions || []}
          onSave={(v) => onPatch({ excluded_institutions: v })} icon={X} compact />
      </div>
    </div>
  )
}

// ─── RESEARCH BLOCK ────────────────────────────────────────────────
function ResearchBlock({ data, onPatch }: {
  data: UserProfileFull; onPatch: (p: Partial<UserProfileFull>) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <TextareaField label="Long bio / research interests" value={data.research_interests}
        onSave={(v) => onPatch({ research_interests: v })} rows={2} />
      <ChipField label="Research categories" values={data.research_categories || []}
        onSave={(v) => onPatch({ research_categories: v })}
        renderChip={(c) => (
          <span className="inline-flex items-center gap-1.5"
            style={{ color: `color-mix(in srgb, var(--color-cat-${c}) 70%, var(--color-ink))` }}>
            <span className="w-2 h-2 rounded-full" style={{ background: `var(--color-cat-${c})` }} />
            {formatCategory(c)}
          </span>
        )}
        chipStyle={(c) => ({
          background: `color-mix(in srgb, var(--color-cat-${c}) 12%, var(--color-white))`,
          borderColor: `color-mix(in srgb, var(--color-cat-${c}) 35%, var(--color-line))`,
        })} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <ChipField label="Methods"            values={data.methods || []}            onSave={(v) => onPatch({ methods: v })} />
        <ChipField label="Application domains" values={data.application_domains || []} onSave={(v) => onPatch({ application_domains: v })} />
        <ChipField label="Tools / frameworks" values={data.tools_frameworks || []}   onSave={(v) => onPatch({ tools_frameworks: v })} />
        <ChipField label="Datasets used"      values={data.datasets_used || []}      onSave={(v) => onPatch({ datasets_used: v })} />
      </div>
      {(data.datasets_created?.length ?? 0) > 0 && (
        <div>
          <Label>Datasets I created</Label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {(data.datasets_created || []).map((d, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[13px]"
                style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
                {d.name}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: d.status === 'public' ? 'var(--color-green-50)' : 'var(--color-amber-50)',
                           color: d.status === 'public' ? 'var(--color-green-700)' : 'var(--color-amber-700)' }}>
                  {d.status || '?'}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TIMELINE (education + experience) ─────────────────────────────
function Timeline<T extends { id: number; title?: string | null; degree_level?: string | null; institution?: string | null }>({ items, render, onDelete, onEdit, kind }: {
  items: T[]
  render: (item: T, edit: (p: Partial<T>) => Promise<void>) => React.ReactNode
  onDelete: (id: number) => Promise<void>
  onEdit:  (id: number, p: Partial<T>) => Promise<void>
  kind: 'education' | 'experience'
}) {
  const confirm = useConfirm()
  if (!items.length) return <EmptyHint />
  return (
    <ol className="relative pl-7 border-l-2" style={{ borderColor: 'var(--color-line)' }}>
      {items.map((it) => {
        const label = (it as any).degree_level
          ? `${(it as any).degree_level}${(it as any).institution ? ' · ' + (it as any).institution : ''}`
          : (it as any).title || 'this item'
        return (
          <li key={it.id} className="pb-6 last:pb-0 relative">
            <span className="absolute -left-[34px] top-1 w-4 h-4 rounded-full ring-4 ring-white"
              style={{ background: 'var(--color-brand-500)' }} />
            <div className="rounded-xl border p-4 relative"
              style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
              <button onClick={async () => {
                if (await confirm({
                  title: `Delete this ${kind} entry?`,
                  detail: label,
                  message: 'This action cannot be undone.',
                })) onDelete(it.id)
              }}
                className="absolute top-3 right-3 p-1 rounded hover:bg-[color:var(--color-paper-2)]"
                style={{ color: 'var(--color-muted-2)' }} title="Delete">
                <Trash2 size={13} />
              </button>
              {render(it, (p) => onEdit(it.id, p))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function EducationNode({ item, onEdit }: { item: UserEducation; onEdit: (p: Partial<UserEducation>) => Promise<void> }) {
  const yrs = (item.start_date || item.end_date)
    ? `${item.start_date?.slice(0,4) || '?'} – ${item.end_date?.slice(0,4) || 'Present'}`
    : ''
  return (
    <div className="pr-7">
      <div className="flex items-baseline gap-2 flex-wrap">
        <Inline value={item.degree_level} className="text-[16px] font-semibold"
          onSave={(v) => onEdit({ degree_level: v })} />
        <span className="text-[13px]" style={{ color: 'var(--color-muted)' }}>·</span>
        <Inline value={item.field} placeholder="Field"
          className="text-[16px]" onSave={(v) => onEdit({ field: v })} />
      </div>
      <div className="text-[14px] mt-0.5 flex items-baseline gap-2 flex-wrap"
        style={{ color: 'var(--color-ink-soft)' }}>
        <Inline value={item.institution} placeholder="Institution"
          onSave={(v) => onEdit({ institution: v })} />
        {item.department && <span style={{ color: 'var(--color-muted-2)' }}>·</span>}
        <Inline value={item.department} placeholder=""
          onSave={(v) => onEdit({ department: v })} />
        {yrs && <span className="font-mono text-[12px] px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>{yrs}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 text-[13px]">
        <KV label="Advisor"    value={item.advisor_name}    onSave={(v) => onEdit({ advisor_name: v })} />
        <KV label="Co-advisor" value={item.co_advisor_name} onSave={(v) => onEdit({ co_advisor_name: v })} />
        <KV label="GPA"        value={item.gpa != null ? `${item.gpa}${item.gpa_scale ? '/' + item.gpa_scale : ''}` : null}
          onSave={(v) => {
            const m = v?.match(/^([\d.]+)(?:\/([\d.]+))?$/)
            onEdit({ gpa: m ? parseFloat(m[1]) : null, gpa_scale: m?.[2] ? parseFloat(m[2]) : item.gpa_scale })
          }} />
      </div>
      {(item.thesis_title || true) && (
        <div className="mt-3">
          <Label>Thesis title</Label>
          <Inline value={item.thesis_title} placeholder="—"
            onSave={(v) => onEdit({ thesis_title: v })} className="text-[14px] italic" />
        </div>
      )}
    </div>
  )
}

function ExperienceNode({ item, onEdit }: { item: UserExperience; onEdit: (p: Partial<UserExperience>) => Promise<void> }) {
  const yrs = (item.start_date || item.end_date)
    ? `${item.start_date?.slice(0,4) || '?'} – ${item.end_date?.slice(0,4) || (item.is_current ? 'Now' : 'Present')}`
    : ''
  return (
    <div className="pr-7">
      <div className="flex items-baseline gap-2 flex-wrap">
        <Inline value={item.title} className="text-[16px] font-semibold"
          placeholder="Role title" onSave={(v) => onEdit({ title: v })} />
        {yrs && <span className="font-mono text-[12px] px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>{yrs}</span>}
      </div>
      <div className="text-[14px] flex items-baseline gap-2 flex-wrap mt-0.5"
        style={{ color: 'var(--color-ink-soft)' }}>
        <Inline value={item.employer} placeholder="Employer"
          onSave={(v) => onEdit({ employer: v })} />
        {item.lab_or_group && <span style={{ color: 'var(--color-muted-2)' }}>·</span>}
        <Inline value={item.lab_or_group} placeholder=""
          onSave={(v) => onEdit({ lab_or_group: v })} />
        {item.location && <span style={{ color: 'var(--color-muted-2)' }}>·</span>}
        <Inline value={item.location} placeholder=""
          onSave={(v) => onEdit({ location: v })} />
      </div>
      {item.supervisor && (
        <div className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>
          Supervisor: <Inline value={item.supervisor} onSave={(v) => onEdit({ supervisor: v })} />
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-1.5 text-[13px]"
        style={{ color: 'var(--color-ink-soft)' }}>
        {(item.bullets || []).map((b, i) => (
          <li key={i} className="flex gap-2">
            <span style={{ color: 'var(--color-cat-or)' }}>▸</span> {b}
          </li>
        ))}
      </ul>
      <TextareaField label="" placeholder="Add bullets (one per line)"
        value={(item.bullets || []).join('\n')}
        onSave={(v) => onEdit({ bullets: v.split('\n').filter(Boolean) })} rows={2} />
    </div>
  )
}

// ─── PUBLICATIONS ──────────────────────────────────────────────────
function PublicationsList({ pubs, onEdit, onDelete }: {
  pubs: UserPublication[]
  onEdit: (id: number, p: Partial<UserPublication>) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  if (!pubs.length) return <EmptyHint />
  const sorted = [...pubs].sort((a, b) => Number(b.is_signature ?? 0) - Number(a.is_signature ?? 0)
    || (b.year ?? 0) - (a.year ?? 0))
  return (
    <div className="flex flex-col gap-3">
      {sorted.map((p) => <PublicationCard key={p.id} pub={p}
        onEdit={(patch) => onEdit(p.id, patch)} onDelete={() => onDelete(p.id)} />)}
    </div>
  )
}

function PublicationCard({ pub, onEdit, onDelete }: {
  pub: UserPublication
  onEdit: (p: Partial<UserPublication>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const confirm = useConfirm()
  const statusColor: Record<string, string> = {
    published: 'var(--color-green-700)',
    accepted: 'var(--color-green-700)',
    under_review: 'var(--color-amber-700)',
    in_prep: 'var(--color-muted)',
  }
  const statusBg: Record<string, string> = {
    published: 'var(--color-green-50)',
    accepted: 'var(--color-green-50)',
    under_review: 'var(--color-amber-50)',
    in_prep: 'var(--color-paper-2)',
  }
  const s = pub.status || 'published'
  return (
    <div className="rounded-xl border p-4 transition-colors hover:bg-[color:var(--color-paper-2)] relative"
      style={{
        background: pub.is_signature ? 'linear-gradient(90deg, color-mix(in srgb, var(--color-amber-50) 80%, var(--color-white)), var(--color-white) 80%)' : 'var(--color-paper)',
        borderColor: pub.is_signature ? 'var(--color-amber-500)' : 'var(--color-line)',
      }}>
      <button onClick={async () => {
          if (await confirm({
            title: 'Delete this publication?',
            detail: pub.title,
            message: 'This action cannot be undone.',
          })) onDelete()
        }}
        className="absolute top-3 right-3 p-1 rounded hover:bg-[color:var(--color-paper-3)]"
        style={{ color: 'var(--color-muted-2)' }} title="Delete">
        <Trash2 size={13} />
      </button>
      <div className="flex items-start gap-3 pr-7">
        <button onClick={() => onEdit({ is_signature: !pub.is_signature })}
          className="mt-0.5 flex-shrink-0 transition-transform hover:scale-110"
          title={pub.is_signature ? 'Signature publication' : 'Flag as signature'}
          style={{ color: pub.is_signature ? 'var(--color-amber-600)' : 'var(--color-muted-2)' }}>
          <Star size={16} fill={pub.is_signature ? 'currentColor' : 'none'} />
        </button>
        <div className="flex-1 min-w-0">
          <Inline value={pub.title} placeholder="Title" className="text-[15px] font-semibold leading-snug"
            onSave={(v) => onEdit({ title: v })} />
          <Inline value={pub.authors} placeholder="Authors"
            onSave={(v) => onEdit({ authors: v })}
            className="text-[12px] block mt-0.5" />
          <div className="mt-2 flex items-center gap-2 flex-wrap text-[12px]">
            <span style={{ color: 'var(--color-ink-soft)' }} className="italic">
              <Inline value={pub.venue_full_name} placeholder="Venue (full name)"
                onSave={(v) => onEdit({ venue_full_name: v })} />
            </span>
            <span className="font-mono px-2 py-0.5 rounded-full"
              style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>
              <Inline value={pub.year?.toString()} placeholder="Year"
                onSave={(v) => onEdit({ year: v ? parseInt(v) : null })} />
            </span>
            <span className="px-2 py-0.5 rounded-full uppercase tracking-wider text-[10px] font-medium"
              style={{ background: statusBg[s], color: statusColor[s] }}>
              {s.replace('_', ' ')}
            </span>
            {pub.citation_count != null && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--color-muted)' }}>
                {pub.citation_count} Citations
              </span>
            )}
            {pub.url && <a href={pub.url} target="_blank" rel="noopener"
              style={{ color: 'var(--color-brand-700)' }}
              className="inline-flex items-center gap-0.5 hover:underline">
              Link <ExternalLink size={10} />
            </a>}
          </div>
          {pub.your_role && (
            <div className="mt-1.5 text-[12px]" style={{ color: 'var(--color-muted)' }}>
              <span className="uppercase tracking-wider text-[10px] font-medium">Role: </span>
              <Inline value={pub.your_role} onSave={(v) => onEdit({ your_role: v })} />
            </div>
          )}
          {pub.one_line_takeaway && (
            <div className="mt-2 text-[13px] italic px-3 py-2 rounded-md border-l-4"
              style={{ borderColor: 'var(--color-cat-medical)', background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)' }}>
              "<Inline value={pub.one_line_takeaway} onSave={(v) => onEdit({ one_line_takeaway: v })} />"
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── AWARDS ────────────────────────────────────────────────────────
function AwardsGrid({ items, onEdit, onDelete }: {
  items: UserAward[]
  onEdit: (id: number, p: Partial<UserAward>) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  const confirm = useConfirm()
  if (!items.length) return <EmptyHint />
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((a) => (
        <div key={a.id} className="rounded-xl border p-4 relative"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
          <button onClick={async () => {
              if (await confirm({
                title: 'Delete this award?',
                detail: a.name,
                message: 'This action cannot be undone.',
              })) onDelete(a.id)
            }}
            className="absolute top-3 right-3 p-1 rounded hover:bg-[color:var(--color-paper-2)]"
            style={{ color: 'var(--color-muted-2)' }}>
            <Trash2 size={13} />
          </button>
          <div className="flex items-start gap-3 pr-7">
            <div className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0"
              style={{ background: 'color-mix(in srgb, var(--color-cat-renewable) 18%, var(--color-paper-2))', color: 'var(--color-cat-renewable)' }}>
              <Award size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <Inline value={a.name} className="text-[14px] font-semibold"
                onSave={(v) => onEdit(a.id, { name: v })} />
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-ink-soft)' }}>
                <Inline value={a.granting_body} placeholder="Granting body"
                  onSave={(v) => onEdit(a.id, { granting_body: v })} />
              </div>
              <div className="text-[12px] mt-1 flex items-center gap-2 flex-wrap">
                {a.year && <span className="font-mono px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>{a.year}</span>}
                {a.amount != null && <span className="font-mono"
                  style={{ color: 'var(--color-green-700)' }}>{a.currency || 'USD'} {a.amount.toLocaleString()}</span>}
                {a.type && <span className="px-2 py-0.5 rounded-full uppercase text-[10px] tracking-wider"
                  style={{ background: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>{a.type.replace('_', ' ')}</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── REFERENCES ────────────────────────────────────────────────────
function ReferencesGrid({ items, onEdit, onDelete }: {
  items: UserReference[]
  onEdit: (id: number, p: Partial<UserReference>) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  const confirm = useConfirm()
  if (!items.length) return <EmptyHint />
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((r) => (
        <div key={r.id} className="rounded-xl border p-4 relative"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
          <button onClick={async () => {
              if (await confirm({
                title: 'Delete this reference?',
                detail: r.name,
                message: 'This action cannot be undone.',
              })) onDelete(r.id)
            }}
            className="absolute top-3 right-3 p-1 rounded hover:bg-[color:var(--color-paper-2)]"
            style={{ color: 'var(--color-muted-2)' }}>
            <Trash2 size={13} />
          </button>
          <div className="flex items-start gap-3 pr-7">
            <div className="w-10 h-10 rounded-full grid place-items-center text-white font-bold text-[13px] flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--color-cat-robotics), var(--color-brand-700))' }}>
              {(r.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <Inline value={r.name} className="text-[14px] font-semibold"
                onSave={(v) => onEdit(r.id, { name: v })} />
              <div className="text-[12px]" style={{ color: 'var(--color-ink-soft)' }}>
                <Inline value={r.title} placeholder="Title"
                  onSave={(v) => onEdit(r.id, { title: v })} /> ·{' '}
                <Inline value={r.institution} placeholder="Institution"
                  onSave={(v) => onEdit(r.id, { institution: v })} />
              </div>
              <div className="text-[12px] mt-1.5 flex items-center gap-2 flex-wrap"
                style={{ color: 'var(--color-muted)' }}>
                {r.email && <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:underline">
                  <Mail size={11} /> {r.email}
                </a>}
                {r.relationship_type && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider"
                  style={{ background: 'var(--color-paper-2)' }}>{r.relationship_type}</span>}
                {r.years_known && <span className="font-mono">{r.years_known}y Known</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── SKILLS / SERVICE / IDENTITY ───────────────────────────────────
function SkillsBlock({ data, onPatch }: { data: UserProfileFull; onPatch: (p: Partial<UserProfileFull>) => Promise<void> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <ChipField label="Programming languages"
        values={(data.programming_languages || []).map((l) => `${l.name}${l.proficiency ? ` (${l.proficiency})` : ''}`)}
        onSave={(arr) => onPatch({
          programming_languages: arr.map((s) => {
            const m = s.match(/^(.+?)(?:\s*\((.+)\))?$/)
            return { name: (m?.[1] || s).trim(), proficiency: (m?.[2] || '').trim() || undefined }
          }),
        })} />
      <ChipField label="Spoken languages"
        values={(data.languages || []).map((l) => `${l.lang}${l.level ? ` (${l.level})` : ''}`)}
        onSave={(arr) => onPatch({
          languages: arr.map((s) => {
            const m = s.match(/^(.+?)(?:\s*\((.+)\))?$/)
            return { lang: (m?.[1] || s).trim(), level: (m?.[2] || '').trim() }
          }),
        })} />
      <div className="col-span-2">
        <ChipField label="Certifications" values={data.certifications || []}
          onSave={(v) => onPatch({ certifications: v })} />
      </div>
    </div>
  )
}

function ServiceBlock({ data, onPatch }: { data: UserProfileFull; onPatch: (p: Partial<UserProfileFull>) => Promise<void> }) {
  return (
    <div className="flex flex-col gap-5">
      <ChipField label="Reviewing venues" values={data.reviewing_venues || []}
        onSave={(v) => onPatch({ reviewing_venues: v })} />
      <TextareaField label="Teaching summary" value={data.teaching_summary}
        onSave={(v) => onPatch({ teaching_summary: v })} rows={3} />
    </div>
  )
}

function IdentityGrid({ data, onPatch }: { data: UserProfileFull; onPatch: (p: Partial<UserProfileFull>) => Promise<void> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-4">
      <BigField icon={UserIcon}  label="Legal name"      value={data.name}            onSave={(v) => onPatch({ name: v })} prov={data.field_provenance?.name} fieldName="name" />
      <BigField icon={UserIcon}  label="Preferred name"  value={data.preferred_name}  onSave={(v) => onPatch({ preferred_name: v })} />
      <BigField icon={UserIcon}  label="Pronouns"        value={data.pronouns}        onSave={(v) => onPatch({ pronouns: v })} />
      <BigField icon={Mail}      label="Email"           value={data.email}           onSave={(v) => onPatch({ email: v })} prov={data.field_provenance?.email} fieldName="email" />
      <BigField icon={Mail}      label="Secondary email" value={data.email_secondary} onSave={(v) => onPatch({ email_secondary: v })} />
      <BigField icon={Mail}      label="Phone"           value={data.phone}           onSave={(v) => onPatch({ phone: v })} />
      <BigField icon={MapPin}    label="City"            value={data.city}            onSave={(v) => onPatch({ city: v })} />
      <BigField icon={Globe}     label="Country"         value={data.country}         onSave={(v) => onPatch({ country: v })} />
      <BigField icon={Globe}     label="Nationality"     value={data.nationality}     onSave={(v) => onPatch({ nationality: v })} />
      <BigField icon={LinkIcon}  label="ORCID"           value={data.orcid}           onSave={(v) => onPatch({ orcid: v })} />
      <BigField icon={GraduationCap} label="Scholar"     value={data.scholar_url}     onSave={(v) => onPatch({ scholar_url: v })} />
      <BigField icon={Code2}    label="GitHub"          value={data.github}          onSave={(v) => onPatch({ github: v })} />
      <BigField icon={Briefcase}  label="LinkedIn"        value={data.linkedin}        onSave={(v) => onPatch({ linkedin: v })} />
      <BigField icon={Globe}     label="Website"         value={data.website}         onSave={(v) => onPatch({ website: v })} />
      <BigField icon={LinkIcon}  label="Twitter / X"     value={data.twitter}         onSave={(v) => onPatch({ twitter: v })} />
    </div>
  )
}

// ─── EXTRACT DRAWER (right-side panel) ─────────────────────────────
function ExtractDrawer({ data, onClose, onPatch, onDone }: {
  data: UserProfileFull
  onClose: () => void
  onPatch: (p: Partial<UserProfileFull>) => Promise<void>
  onDone: () => Promise<void>
}) {
  const [docs, setDocs]   = useState<any[]>([])
  const [log, setLog]     = useState<string[]>([])
  const [busy, setBusy]   = useState(false)
  useEffect(() => { api.documents().then(setDocs).catch(() => {}) }, [])
  const cvDocs = docs.filter((d) => d.kind === 'cv')
  const transcriptDocs = docs.filter((d) => d.kind === 'transcript')

  const run = async () => {
    setBusy(true); setLog([])
    try {
      await api.extractUserProfile((evt, d) => {
        if (evt === 'text' && d.text) setLog((l) => [...l, d.text])
        if (evt === 'done')  setLog((l) => [...l, '\n✅ done\n'])
        if (evt === 'error') setLog((l) => [...l, `\n❌ ${d.error || d.message}\n`])
      })
      await onDone()
    } catch (e: any) {
      setLog((l) => [...l, `\n${e}`])
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="w-[420px] h-full flex flex-col"
        style={{ background: 'var(--color-paper)', boxShadow: '-20px 0 40px -10px rgba(0,0,0,0.15)' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--color-line)' }}>
          <div className="flex items-center gap-2">
            <Sparkles size={16} style={{ color: 'var(--color-brand-500)' }} />
            <h3 className="font-semibold text-[16px]">Auto-fill from documents</h3>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4 flex-1 overflow-y-auto">
          <p className="text-[13px]" style={{ color: 'var(--color-muted)' }}>
            Quill will read your CV and transcripts and populate every section.
            Fields you've marked as ✓ verified are left untouched.
          </p>

          <div>
            <Label>CV <span style={{ color: 'var(--color-rose-500)' }}>*</span></Label>
            <select value={data.cv_doc_id || ''}
              onChange={(e) => onPatch({ cv_doc_id: e.target.value ? parseInt(e.target.value) : null })}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-[13px]"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
              <option value="">— select a CV from Documents —</option>
              {cvDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            {data.cv_last_extracted_at && (
              <div className="text-[11px] mt-1.5 flex items-center gap-1"
                style={{ color: 'var(--color-muted)' }}>
                <CheckCircle2 size={11} style={{ color: 'var(--color-green-700)' }} />
                Last extracted {new Date(data.cv_last_extracted_at).toLocaleString()}
              </div>
            )}
          </div>

          <div>
            <Label>Transcripts (optional)</Label>
            <div className="mt-1 flex flex-col gap-1 text-[13px]">
              {transcriptDocs.map((d) => {
                const on = (data.transcript_doc_ids || []).includes(d.id)
                return (
                  <label key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:bg-[color:var(--color-paper-2)]"
                    style={{ background: on ? 'var(--color-paper-2)' : 'var(--color-white)', borderColor: on ? 'var(--color-brand-500)' : 'var(--color-line)' }}>
                    <input type="checkbox" checked={on}
                      onChange={() => {
                        const cur = new Set(data.transcript_doc_ids || [])
                        if (on) cur.delete(d.id); else cur.add(d.id)
                        onPatch({ transcript_doc_ids: [...cur] })
                      }} />
                    <FileText size={12} style={{ color: 'var(--color-muted)' }} />
                    <span className="truncate">{d.title}</span>
                  </label>
                )
              })}
              {!transcriptDocs.length && <div className="px-3 py-2 italic text-[12px]"
                style={{ color: 'var(--color-muted)' }}>None yet — upload via the Documents page.</div>}
            </div>
          </div>

          <button onClick={run} disabled={busy || !data.cv_doc_id}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-[14px] disabled:opacity-50 transition-transform hover:-translate-y-0.5"
            style={{
              background: busy ? 'var(--color-paper-2)' : 'linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))',
              color: busy ? 'var(--color-muted)' : 'white',
              boxShadow: busy ? undefined : '0 6px 16px -6px rgba(47,92,203,0.5)',
            }}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {busy ? 'Extracting…' : 'Run extraction'}
          </button>

          {log.length > 0 && (
            <pre className="text-[11px] flex-1 min-h-32 max-h-96 overflow-auto rounded-lg p-3 font-mono whitespace-pre-wrap"
              style={{ background: 'var(--color-ink)', color: '#d4e4ff' }}>
              {log.join('')}
            </pre>
          )}
        </div>
      </aside>
    </div>
  )
}

// ─── Primitives ────────────────────────────────────────────────────
async function addChild(kind: Kind, setData: React.Dispatch<React.SetStateAction<UserProfileFull | null>>) {
  const defaults: Record<Kind, any> = {
    education:    { degree_level: 'PhD' },
    publications: { title: 'New publication', status: 'in_prep' },
    experience:   { title: 'New role' },
    awards:       { name: 'New award' },
    references:   { name: 'New reference' },
  }
  await api.addUserItem(kind, defaults[kind])
  setData(await api.user())
}

function EmptyHint() {
  return (
    <div className="text-center py-3 text-[12px] italic" style={{ color: 'var(--color-muted-2)' }}>
      Nothing here yet. Click <span className="font-semibold">+ Add</span>, or
      run <span className="font-semibold">✨ Auto-fill</span> to populate from your CV.
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.12em] font-semibold leading-4 break-words"
    style={{ color: 'var(--color-muted-2)' }}>{children}</div>
}

function BigField({ icon: Icon, label, value, onSave, prov, fieldName, placeholder }: {
  icon?: React.ComponentType<{ size?: number }>
  label: string; value?: string | null; onSave: (v: any) => void
  prov?: any; fieldName?: string; placeholder?: string
}) {
  return (
    <div className="rounded border px-2.5 py-2 flex flex-col gap-1.5 transition-colors hover:bg-[color:var(--color-paper-2)]"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <div className="flex items-center gap-1 min-w-0">
        {Icon && <Icon size={10} />}
        <Label>{label}</Label>
        {prov && <ProvBadge prov={prov} fieldName={fieldName} />}
      </div>
      <Inline value={value || ''} placeholder={placeholder || '—'}
        onSave={onSave} className="text-[13px] leading-6 block truncate" />
    </div>
  )
}

function BigSelect({ icon: Icon, label, value, options, onSave }: {
  icon?: React.ComponentType<{ size?: number }>
  label: string; value?: string | null; options: string[]; onSave: (v: string) => void
}) {
  return (
    <div className="rounded border px-2.5 py-2 flex flex-col gap-1.5"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <div className="flex items-center gap-1 min-w-0">
        {Icon && <Icon size={10} />}
        <Label>{label}</Label>
      </div>
      <select value={value || ''} onChange={(e) => onSave(e.target.value)}
        className="h-8 px-2 rounded border text-[13px] outline-none min-w-0"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{titleize(o)}</option>)}
      </select>
    </div>
  )
}

function KV({ label, value, onSave }: { label: string; value?: string | null; onSave: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Inline value={value || ''} placeholder="—" onSave={onSave} className="text-[14px]" />
    </div>
  )
}

function TextareaField({ label, placeholder, value, onSave, rows = 3 }: {
  label: string; placeholder?: string; value?: string | null; onSave: (v: string) => void; rows?: number
}) {
  const [v, setV] = useState(value || '')
  const dirty = v !== (value || '')
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setV(value || ''), [value])
  // Auto-grow to fit content
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [v])
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          {dirty && (
            <button onClick={() => onSave(v)} className="text-[12px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: 'var(--color-brand-50)', color: 'var(--color-brand-700)' }}>
              save
            </button>
          )}
        </div>
      )}
      <textarea ref={taRef} value={v} rows={rows} onChange={(e) => setV(e.target.value)}
        onBlur={() => dirty && onSave(v)}
        placeholder={placeholder}
        className="px-2.5 py-2 rounded border text-[13px] outline-none leading-6"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', resize: 'none', overflow: 'hidden' }} />
    </div>
  )
}

function ChipField({ label, values, onSave, renderChip, chipStyle, icon: Icon, compact = false }: {
  label: string; values: string[]; onSave: (v: string[]) => void
  renderChip?: (v: string) => React.ReactNode
  chipStyle?: (v: string) => React.CSSProperties
  icon?: React.ComponentType<{ size?: number }>
  compact?: boolean
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (!values.includes(v)) onSave([...values, v])
    setDraft('')
  }
  const remove = (v: string) => onSave(values.filter((x) => x !== v))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 min-w-0">
        {Icon && <Icon size={10} />}
        <Label>{label}</Label>
      </div>
      <div className={`flex flex-wrap items-center gap-1 rounded border ${compact ? 'min-h-[34px] px-2.5 py-1.5' : 'min-h-[40px] px-2.5 py-2'}`}
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[12px]"
            style={chipStyle ? chipStyle(v) : { background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}>
            {renderChip ? renderChip(v) : v}
            <button onClick={() => remove(v)} style={{ color: 'var(--color-muted)' }} className="hover:opacity-100 opacity-60">
              <X size={10} />
            </button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          onBlur={() => draft.trim() && add()}
          placeholder={values.length ? '+ add' : 'Type and press Enter…'}
          className="px-1 py-0 text-[13px] outline-none flex-1 min-w-[80px] bg-transparent" />
      </div>
    </div>
  )
}

function Inline({ value, placeholder, className, onSave }: {
  value?: string | null; placeholder?: string; className?: string; onSave: (v: string) => void
}) {
  const [v, setV] = useState(value || '')
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setV(value || ''), [value])
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  if (editing) {
    return (
      <input ref={ref} value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); if (v !== (value || '')) onSave(v) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value || ''); setEditing(false) } }}
        className={`px-1 -mx-1 py-0 rounded border outline-none bg-white ${className || ''}`}
        style={{ borderColor: 'var(--color-brand-500)' }} />
    )
  }
  return (
    <span onClick={() => setEditing(true)}
      className={`cursor-text rounded -mx-1 px-1 hover:bg-[color:var(--color-paper-2)] transition-colors ${className || ''}`}
      style={{ color: value ? undefined : 'var(--color-muted-2)' }}>
      {value || placeholder || '—'}
    </span>
  )
}

function ProvBadge({ prov, fieldName }: { prov: any; fieldName?: string }) {
  if (!prov) return null
  const verified = prov.verified_by_user
  const verify = async () => {
    if (!fieldName) return
    await api.verifyUserField(fieldName)
  }
  return (
    <span title={`source=${prov.source || '?'} · confidence=${prov.confidence ?? '?'}${prov.extracted_at ? ` · ${prov.extracted_at}` : ''}`}
      onClick={verify}
      className="inline-flex items-center cursor-pointer"
      style={{ color: verified ? 'var(--color-green-700)' : 'var(--color-amber-600)' }}>
      {verified ? <CheckCircle2 size={11} /> : <Sparkles size={11} />}
    </span>
  )
}
