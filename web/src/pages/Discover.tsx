import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Compass, Sparkles, Check, X, Loader, ChevronDown, ChevronUp,
  AlertCircle, RefreshCw, SlidersHorizontal, ExternalLink, CircleDot,
  MapPin, BookOpen, BadgeDollarSign, Filter, Users, Square,
} from 'lucide-react'
import { api, type Professor, type UserProfileFull } from '@/lib/api'
import { formatCategory } from '@/lib/categories'
import { useQuillRun } from '@/hooks/useQuillRun'
import { openExternalUrl } from '@/lib/openExternal'

// ─── settings type ─────────────────────────────────────────────────

type PositionType = 'postdoc' | 'phd' | 'master'
type ProfRank = 'assistant' | 'associate' | 'full'
type FundingType = 'fully_funded' | 'ta_ra' | 'fellowship' | 'any'
type SortBy = 'match_score' | 'hiring' | 'location'

type DiscoverySettings = {
  // position & timeline
  position_type: PositionType
  start_date: string            // e.g. "Fall 2026", "Spring 2027", "Rolling"
  duration: string              // postdoc only: "1 year", "2 years", "3+ years", "any"

  // geography
  countries: string             // comma list
  exclude_countries: string
  language_english_only: boolean

  // research focus
  primary_keywords: string
  adjacent_areas: string
  methods_techniques: string
  application_domain: string
  focus_mode: 'supplement' | 'override'   // supplement = add to profile, override = replace

  // professor profile
  prof_ranks: ProfRank[]        // which ranks to include
  pub_recency_years: number     // must have published within last N years (0 = no filter)
  require_email: boolean
  prefer_international_lab: boolean

  // hiring & funding
  hiring_signals_only: boolean
  funding_type: FundingType
  min_stipend_hint: string      // hint like "$30k+"

  // results & quality
  count: number
  min_match_score: number       // front-end display filter
  max_per_university: number
  sort_by: SortBy

  // pipeline exclusions
  skip_existing_universities: boolean
  skip_dismissed: boolean
  exclude_disciplines: string

  // department scoping
  target_departments: string
}

type DiscoveryBatchProgress = {
  current: number
  total: number
  batchSize: number
  target: number
}

const DISCOVERY_BATCH_SIZE = 10
const DISCOVERY_BATCH_TIMEOUT_S = 600

const DEFAULT: DiscoverySettings = {
  position_type: 'phd',
  start_date: '',
  duration: 'any',
  countries: '',
  exclude_countries: '',
  language_english_only: false,
  primary_keywords: '',
  adjacent_areas: '',
  methods_techniques: '',
  application_domain: '',
  focus_mode: 'supplement',
  prof_ranks: ['assistant', 'associate', 'full'],
  pub_recency_years: 3,
  require_email: false,
  prefer_international_lab: false,
  hiring_signals_only: false,
  funding_type: 'any',
  min_stipend_hint: '',
  count: 10,
  min_match_score: 0,
  max_per_university: 2,
  sort_by: 'match_score',
  skip_existing_universities: true,
  skip_dismissed: true,
  exclude_disciplines: '',
  target_departments: '',
}

// ─── helpers ───────────────────────────────────────────────────────

const POSITION_LABELS: Record<PositionType, string> = {
  postdoc: 'Postdoc', phd: 'PhD', master: "Master's",
}

const RANK_LABELS: Record<ProfRank, string> = {
  assistant: 'Asst.', associate: 'Assoc.', full: 'Full',
}

const FUNDING_LABELS: Record<FundingType, string> = {
  fully_funded: 'Fully funded', ta_ra: 'TA / RA', fellowship: 'Fellowship', any: 'Any',
}

const START_DATE_OPTIONS = ['', 'Fall 2026', 'Spring 2027', 'Fall 2027', 'Spring 2028', 'Rolling']
const DURATION_OPTIONS = ['any', '1 year', '2 years', '3+ years']
const PUB_RECENCY_OPTIONS = [
  { label: 'No filter', value: 0 },
  { label: 'Last year', value: 1 },
  { label: 'Last 2 yrs', value: 2 },
  { label: 'Last 3 yrs', value: 3 },
  { label: 'Last 5 yrs', value: 5 },
]
const SORT_LABELS: Record<SortBy, string> = {
  match_score: 'Match score', hiring: 'Hiring likelihood', location: 'Location',
}

function buildPromptParams(
  s: DiscoverySettings,
  existingUniversities: Set<string>,
  dismissedIds: number[],
  batch?: DiscoveryBatchProgress & { excludeCandidates: string[] },
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    position_type: s.position_type,
    count: batch?.batchSize ?? s.count,
    max_per_university: s.max_per_university,
  }

  if (batch) {
    params.discovery_batch = batch.current
    params.discovery_total_batches = batch.total
    params.discovery_total_target = batch.target
    if (batch.excludeCandidates.length > 0) {
      params.exclude_candidates = batch.excludeCandidates.slice(0, 250).join('\n')
    }
  }

  if (s.start_date) params.start_date = s.start_date
  if (s.position_type === 'postdoc' && s.duration !== 'any') params.duration = s.duration
  if (s.countries.trim()) params.target_countries = s.countries.trim()
  if (s.exclude_countries.trim()) params.exclude_countries = s.exclude_countries.trim()
  if (s.language_english_only) params.language_english_only = true

  const keywordParts = []
  if (s.primary_keywords.trim()) keywordParts.push(s.primary_keywords.trim())
  if (s.adjacent_areas.trim()) keywordParts.push(`adjacent areas: ${s.adjacent_areas.trim()}`)
  if (s.methods_techniques.trim()) keywordParts.push(`methods/techniques: ${s.methods_techniques.trim()}`)
  if (s.application_domain.trim()) keywordParts.push(`application domain: ${s.application_domain.trim()}`)
  if (keywordParts.length > 0) {
    params[s.focus_mode === 'override' ? 'focus_override' : 'focus_supplement'] = keywordParts.join('\n')
  }

  if (s.prof_ranks.length < 3) params.prof_ranks = s.prof_ranks.join(', ')
  if (s.pub_recency_years > 0) params.pub_recency_years = s.pub_recency_years
  if (s.require_email) params.require_email = true
  if (s.prefer_international_lab) params.prefer_international_lab = true
  if (s.hiring_signals_only) params.hiring_signals_only = true
  if (s.funding_type !== 'any') params.funding_type = s.funding_type
  if (s.min_stipend_hint.trim()) params.min_stipend_hint = s.min_stipend_hint.trim()

  if (s.skip_existing_universities && existingUniversities.size > 0) {
    params.exclude_universities = [...existingUniversities].join(', ')
  }
  if (s.skip_dismissed && dismissedIds.length > 0) {
    params.skip_professor_ids = dismissedIds.join(', ')
  }
  if (s.exclude_disciplines.trim()) params.exclude_disciplines = s.exclude_disciplines.trim()
  if (s.target_departments.trim()) params.target_departments = s.target_departments.trim()

  return params
}

// ─── settings panel ─────────────────────────────────────────────────

type SectionId = 'position' | 'geography' | 'research' | 'professor' | 'funding' | 'results' | 'exclusions'

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: 'position',   label: 'Position & Timeline', icon: <Sparkles size={13} /> },
  { id: 'geography',  label: 'Geography',           icon: <MapPin size={13} /> },
  { id: 'research',   label: 'Research focus',      icon: <BookOpen size={13} /> },
  { id: 'professor',  label: 'Professor profile',   icon: <Users size={13} /> },
  { id: 'funding',    label: 'Hiring & funding',    icon: <BadgeDollarSign size={13} /> },
  { id: 'results',    label: 'Results & quality',   icon: <Filter size={13} /> },
  { id: 'exclusions', label: 'Exclusions',          icon: <X size={13} /> },
]

function SettingsPanel({ settings: s, onChange, onRun, running }: {
  settings: DiscoverySettings
  onChange: (s: DiscoverySettings) => void
  onRun: () => void
  running: boolean
}) {
  const [open, setOpen] = useState<Set<SectionId>>(new Set(['position', 'research']))
  const [autoFilling, setAutoFilling] = useState(false)
  const [autoFillMessage, setAutoFillMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const set = <K extends keyof DiscoverySettings>(k: K, v: DiscoverySettings[K]) =>
    onChange({ ...s, [k]: v })

  const toggleSection = (id: SectionId) => {
    const next = new Set(open)
    next.has(id) ? next.delete(id) : next.add(id)
    setOpen(next)
  }

  const toggleRank = (rank: ProfRank) => {
    const next = s.prof_ranks.includes(rank)
      ? s.prof_ranks.filter((r) => r !== rank)
      : [...s.prof_ranks, rank]
    if (next.length > 0) set('prof_ranks', next)
  }

  const autoFillResearchFocus = async () => {
    setAutoFilling(true)
    setAutoFillMessage(null)
    try {
      let profile = await api.user()
      const docs = await api.documents('cv')
      const defaultCv = docs.find((doc) => doc.is_default) || docs[0] || null
      if (!defaultCv) throw new Error('Upload a CV first, then use auto-fill.')

      if (!profile.cv_doc_id) {
        profile = await api.patchUser({ cv_doc_id: defaultCv.id })
      }

      if (!hasResearchFocus(profile)) {
        await api.extractUserProfile(() => {})
        profile = await api.user()
      }

      const filled = researchSettingsFromProfile(profile)
      if (!hasFilledResearchSettings(filled)) {
        throw new Error('Quill could not find enough research-focus details in the CV yet. Add a few keywords manually or try again after extraction finishes.')
      }

      onChange({ ...s, ...filled })
      setAutoFillMessage({ ok: true, text: 'Filled from your CV profile. Review the fields before running discovery.' })
    } catch (e) {
      setAutoFillMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAutoFilling(false)
    }
  }

  return (
    <div className="rounded-lg border mb-5 overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
      {/* Panel header */}
      <div className="px-5 py-3 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
        <SlidersHorizontal size={14} style={{ color: 'var(--color-muted)' }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>
          Discovery settings
        </span>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--color-muted)' }}>
          Click sections to expand
        </span>
      </div>

      <div>
        {SECTIONS.map(({ id, label, icon }) => (
          <div key={id} className="border-t first:border-t-0" style={{ borderColor: 'var(--color-line)' }}>
            <button
              onClick={() => toggleSection(id)}
              className="w-full px-5 py-2.5 flex items-center gap-2 text-left hover:bg-[color:var(--color-paper-2)] transition-colors">
              <span style={{ color: 'var(--color-muted)' }}>{icon}</span>
              <span className="text-[13px] font-medium flex-1" style={{ color: 'var(--color-ink)' }}>
                {label}
              </span>
              {open.has(id)
                ? <ChevronUp size={13} style={{ color: 'var(--color-muted)' }} />
                : <ChevronDown size={13} style={{ color: 'var(--color-muted)' }} />}
            </button>

            {open.has(id) && (
              <div className="px-5 pb-4 pt-1 flex flex-col gap-3"
                style={{ background: 'var(--color-paper)' }}>

                {/* ── Position & Timeline ── */}
                {id === 'position' && (
                  <>
                    <Row label="Position type">
                      <div className="flex gap-1.5">
                        {(['postdoc', 'phd', 'master'] as PositionType[]).map((pt) => (
                          <Pill key={pt} active={s.position_type === pt}
                            onClick={() => set('position_type', pt)}>
                            {POSITION_LABELS[pt]}
                          </Pill>
                        ))}
                      </div>
                    </Row>
                    <Row label="Start date">
                      <select value={s.start_date} onChange={(e) => set('start_date', e.target.value)}
                        className="px-2.5 py-1.5 rounded-md border text-[12px] outline-none"
                        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}>
                        {START_DATE_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o || 'Any / not specified'}</option>
                        ))}
                      </select>
                    </Row>
                    {s.position_type === 'postdoc' && (
                      <Row label="Duration">
                        <div className="flex gap-1.5 flex-wrap">
                          {DURATION_OPTIONS.map((d) => (
                            <Pill key={d} active={s.duration === d}
                              onClick={() => set('duration', d)}>
                              {d === 'any' ? 'Any' : d}
                            </Pill>
                          ))}
                        </div>
                      </Row>
                    )}
                  </>
                )}

                {/* ── Geography ── */}
                {id === 'geography' && (
                  <>
                    <Row label="Countries / regions">
                      <input value={s.countries}
                        onChange={(e) => set('countries', e.target.value)}
                        placeholder="US, Canada, EU, Switzerland, UK…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Exclude countries">
                      <input value={s.exclude_countries}
                        onChange={(e) => set('exclude_countries', e.target.value)}
                        placeholder="e.g. China, Russia…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="">
                      <Toggle checked={s.language_english_only}
                        onChange={(v) => set('language_english_only', v)}
                        label="English instruction only" />
                    </Row>
                  </>
                )}

                {/* ── Research focus ── */}
                {id === 'research' && (
                  <>
                    <Row label="">
                      <button
                        onClick={autoFillResearchFocus}
                        disabled={autoFilling}
                        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-opacity disabled:opacity-60"
                        style={{
                          borderColor: 'var(--color-brand-500)',
                          background: 'var(--color-brand-50)',
                          color: 'var(--color-brand-700)',
                        }}
                      >
                        {autoFilling ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
                        {autoFilling ? 'Auto-filling...' : 'Auto-fill with Quill'}
                      </button>
                      {autoFillMessage && (
                        <span
                          className="text-[11px]"
                          style={{ color: autoFillMessage.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)' }}
                        >
                          {autoFillMessage.text}
                        </span>
                      )}
                    </Row>
                    <Row label="Mode">
                      <div className="flex gap-1.5">
                        <Pill active={s.focus_mode === 'supplement'}
                          onClick={() => set('focus_mode', 'supplement')}>
                          Add to my profile
                        </Pill>
                        <Pill active={s.focus_mode === 'override'}
                          onClick={() => set('focus_mode', 'override')}>
                          Replace my profile
                        </Pill>
                      </div>
                    </Row>
                    <Row label="Keywords">
                      <input value={s.primary_keywords}
                        onChange={(e) => set('primary_keywords', e.target.value)}
                        placeholder="e.g. structural health monitoring, graph neural networks…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Adjacent areas">
                      <input value={s.adjacent_areas}
                        onChange={(e) => set('adjacent_areas', e.target.value)}
                        placeholder="e.g. signal processing, computer vision…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Methods / tools">
                      <input value={s.methods_techniques}
                        onChange={(e) => set('methods_techniques', e.target.value)}
                        placeholder="e.g. LSTM, finite element analysis, fMRI…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Application domain">
                      <input value={s.application_domain}
                        onChange={(e) => set('application_domain', e.target.value)}
                        placeholder="e.g. healthcare, autonomous vehicles, climate…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Departments">
                      <input value={s.target_departments}
                        onChange={(e) => set('target_departments', e.target.value)}
                        placeholder="e.g. Civil Engineering, Mechanical Engineering, Mila…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                      <span className="text-[11px] ml-2" style={{ color: 'var(--color-muted)' }}>
                        scope to specific departments / schools / institutes
                      </span>
                    </Row>
                  </>
                )}

                {/* ── Professor profile ── */}
                {id === 'professor' && (
                  <>
                    <Row label="Academic rank">
                      <div className="flex gap-1.5">
                        {(['assistant', 'associate', 'full'] as ProfRank[]).map((r) => (
                          <Pill key={r} active={s.prof_ranks.includes(r)}
                            onClick={() => toggleRank(r)}>
                            {RANK_LABELS[r]}
                          </Pill>
                        ))}
                      </div>
                    </Row>
                    <Row label="Publication recency">
                      <div className="flex gap-1.5 flex-wrap">
                        {PUB_RECENCY_OPTIONS.map(({ label, value }) => (
                          <Pill key={value} active={s.pub_recency_years === value}
                            onClick={() => set('pub_recency_years', value)}>
                            {label}
                          </Pill>
                        ))}
                      </div>
                    </Row>
                    <Row label="">
                      <div className="flex flex-col gap-1.5">
                        <Toggle checked={s.require_email}
                          onChange={(v) => set('require_email', v)}
                          label="Only include professors with findable email" />
                        <Toggle checked={s.prefer_international_lab}
                          onChange={(v) => set('prefer_international_lab', v)}
                          label="Prefer labs with international students" />
                      </div>
                    </Row>
                  </>
                )}

                {/* ── Hiring & funding ── */}
                {id === 'funding' && (
                  <>
                    <Row label="">
                      <Toggle checked={s.hiring_signals_only}
                        onChange={(v) => set('hiring_signals_only', v)}
                        label="Only show professors with active hiring signals" />
                    </Row>
                    <Row label="Funding type">
                      <div className="flex gap-1.5 flex-wrap">
                        {(['any', 'fully_funded', 'ta_ra', 'fellowship'] as FundingType[]).map((f) => (
                          <Pill key={f} active={s.funding_type === f}
                            onClick={() => set('funding_type', f)}>
                            {FUNDING_LABELS[f]}
                          </Pill>
                        ))}
                      </div>
                    </Row>
                    <Row label="Stipend hint">
                      <input value={s.min_stipend_hint}
                        onChange={(e) => set('min_stipend_hint', e.target.value)}
                        placeholder="e.g. $30k+, €24k…"
                        className="w-36 px-2.5 py-1.5 rounded-md border text-[12px] outline-none"
                        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                        used as a search hint
                      </span>
                    </Row>
                  </>
                )}

                {/* ── Results & quality ── */}
                {id === 'results' && (
                  <>
                    <Row label={
                      <span>Professors to find <b style={{ color: 'var(--color-brand-600)' }}>{s.count}</b></span>
                    }>
                      <div className="flex-1">
                        <input type="range" min={5} max={100} step={5} value={s.count}
                          onChange={(e) => set('count', parseInt(e.target.value))}
                          className="w-full" />
                        <div className="flex justify-between text-[10px] mt-0.5"
                          style={{ color: 'var(--color-muted)' }}>
                          <span>5</span><span>100</span>
                        </div>
                      </div>
                    </Row>
                    <Row label="Max per university">
                      <div className="flex gap-1.5 flex-wrap">
                        {[1, 2, 3, 4, 5, 10].map((n) => (
                          <Pill key={n} active={s.max_per_university === n}
                            onClick={() => set('max_per_university', n)}>
                            {n}
                          </Pill>
                        ))}
                        <Pill active={s.max_per_university === 0}
                          onClick={() => set('max_per_university', 0)}>
                          No limit
                        </Pill>
                      </div>
                    </Row>
                    <Row label={
                      <span>Min match score <b style={{ color: 'var(--color-brand-600)' }}>
                        {s.min_match_score > 0 ? `${s.min_match_score}+` : 'off'}
                      </b></span>
                    }>
                      <div className="flex-1">
                        <input type="range" min={0} max={90} step={10} value={s.min_match_score}
                          onChange={(e) => set('min_match_score', parseInt(e.target.value))}
                          className="w-full" />
                        <div className="flex justify-between text-[10px] mt-0.5"
                          style={{ color: 'var(--color-muted)' }}>
                          <span>off</span><span>90+</span>
                        </div>
                      </div>
                    </Row>
                    <Row label="Sort by">
                      <div className="flex gap-1.5 flex-wrap">
                        {(['match_score', 'hiring', 'location'] as SortBy[]).map((sb) => (
                          <Pill key={sb} active={s.sort_by === sb}
                            onClick={() => set('sort_by', sb)}>
                            {SORT_LABELS[sb]}
                          </Pill>
                        ))}
                      </div>
                    </Row>
                  </>
                )}

                {/* ── Exclusions ── */}
                {id === 'exclusions' && (
                  <>
                    <Row label="">
                      <div className="flex flex-col gap-1.5">
                        <Toggle checked={s.skip_existing_universities}
                          onChange={(v) => set('skip_existing_universities', v)}
                          label="Skip universities already in my pipeline" />
                        <Toggle checked={s.skip_dismissed}
                          onChange={(v) => set('skip_dismissed', v)}
                          label="Skip professors I've previously dismissed" />
                      </div>
                    </Row>
                    <Row label="Exclude disciplines">
                      <input value={s.exclude_disciplines}
                        onChange={(e) => set('exclude_disciplines', e.target.value)}
                        placeholder="e.g. pure theory, bioinformatics…"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Run button */}
      <div className="px-5 py-4 border-t flex items-center gap-3"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)' }}>
        <button onClick={onRun} disabled={running}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-[13px] font-semibold transition-opacity"
          style={{ background: 'var(--color-brand-600)', color: 'white', opacity: running ? 0.6 : 1 }}>
          {running
            ? <><Loader size={13} className="animate-spin" /> Running…</>
            : <><Sparkles size={13} /> Run discovery</>}
        </button>
        <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
          Quill will search the web for matching faculty
        </span>
        <button onClick={() => onChange(DEFAULT)}
          className="ml-auto text-[11px] px-2.5 py-1 rounded border"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)',
            background: 'var(--color-paper-2)' }}>
          Reset
        </button>
      </div>
    </div>
  )
}

// ─── small shared components ────────────────────────────────────────

function hasResearchFocus(profile: UserProfileFull): boolean {
  return Boolean(
    profile.research_interests?.trim()
    || profile.headline?.trim()
    || profile.research_categories?.length
    || profile.methods?.length
    || profile.tools_frameworks?.length
    || profile.application_domains?.length
  )
}

function hasFilledResearchSettings(settings: Partial<DiscoverySettings>): boolean {
  return Boolean(
    settings.primary_keywords?.trim()
    || settings.adjacent_areas?.trim()
    || settings.methods_techniques?.trim()
    || settings.application_domain?.trim()
    || settings.target_departments?.trim()
  )
}

function researchSettingsFromProfile(profile: UserProfileFull): Partial<DiscoverySettings> {
  const headlineTerms = splitTerms(profile.headline)
  const interestTerms = splitTerms(profile.research_interests)
  const categories = splitTerms(profile.research_categories)
  const methods = splitTerms(profile.methods)
  const tools = splitTerms(profile.tools_frameworks)
  const domains = splitTerms(profile.application_domains)
  const departments = splitTerms([
    profile.affiliation,
    ...((profile.education || []).map((item) => item.department || item.field || item.institution)),
    ...((profile.experience || []).map((item) => item.lab_or_group || item.employer)),
  ])

  return {
    ...targetSettingsFromProfile(profile),
    primary_keywords: joinTerms(uniqueTerms([...categories, ...headlineTerms, ...interestTerms]).slice(0, 12)),
    adjacent_areas: joinTerms(uniqueTerms([...domains, ...splitTerms(profile.datasets_used)]).slice(0, 8)),
    methods_techniques: joinTerms(uniqueTerms([
      ...methods,
      ...tools,
      ...splitTerms((profile.programming_languages || []).map((item) => item.name)),
    ]).slice(0, 12)),
    application_domain: joinTerms(domains.slice(0, 8)),
    target_departments: joinTerms(departments.slice(0, 8)),
  }
}

function targetSettingsFromProfile(profile: UserProfileFull): Partial<DiscoverySettings> {
  const out: Partial<DiscoverySettings> = {}
  if (isPositionType(profile.target_position_type)) out.position_type = profile.target_position_type
  if (profile.target_start_date) out.start_date = profile.target_start_date
  const countries = joinTerms(splitTerms(profile.target_countries))
  if (countries) out.countries = countries
  return out
}

function isPositionType(value: unknown): value is PositionType {
  return value === 'postdoc' || value === 'phd' || value === 'master'
}

function splitTerms(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(splitTerms)
  if (typeof value === 'object' && 'name' in value && typeof (value as { name?: unknown }).name === 'string') {
    return splitTerms((value as { name: string }).name)
  }
  if (typeof value !== 'string') return []
  return value
    .replace(/[.;]/g, ',')
    .split(/,|\n|\/|\||·/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function uniqueTerms(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const normalized = item.replace(/\s+/g, ' ').trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function joinTerms(items: string[]): string {
  return uniqueTerms(items).join(', ')
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-36 flex-shrink-0 text-[11px] font-medium pt-1.5"
        style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <div className="flex items-center gap-2 flex-1 flex-wrap">{children}</div>
    </div>
  )
}

function Pill({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button onClick={onClick}
      className="px-3.5 py-1.5 rounded-md border text-[13px] font-medium transition-all"
      style={active ? {
        background: 'var(--color-brand-50)', borderColor: 'var(--color-brand-500)',
        color: 'var(--color-brand-700)',
      } : {
        background: 'var(--color-white)', borderColor: 'var(--color-line)',
        color: 'var(--color-muted)',
      }}>
      {children}
    </button>
  )
}

function Toggle({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div onClick={() => onChange(!checked)}
        className="w-8 h-4 rounded-full transition-colors flex-shrink-0 relative cursor-pointer"
        style={{ background: checked ? 'var(--color-brand-500)' : 'var(--color-line)' }}>
        <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? '17px' : '2px' }} />
      </div>
      <span className="text-[12px]" style={{ color: 'var(--color-ink-soft)' }}>{label}</span>
    </label>
  )
}

// ─── run status bar ─────────────────────────────────────────────────

function RunStatus({ quill, suggestionCount, mode, batchProgress, onStop }: {
  quill: ReturnType<typeof useQuillRun>
  suggestionCount: number
  mode: 'discover' | 'research' | null
  batchProgress?: DiscoveryBatchProgress | null
  onStop?: () => void
}) {
  const [showLog, setShowLog] = useState(true)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (quill.state !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [quill.state])

  if (quill.state === 'idle') return null
  const elapsedMs = (quill.endedAt ?? now) - (quill.startedAt ?? now)
  const elapsed = Math.max(0, Math.round(elapsedMs / 1000))
  const parsed = quill.events.some((evt) => evt.kind === 'parsed')
  const providerStarted = quill.events.some((evt) => evt.kind === 'started')
  const title = mode === 'research' ? 'Research monitor' : 'Discovery monitor'
  const activeText = mode === 'research'
    ? 'Researching the selected candidate'
    : batchProgress
      ? `Batch ${batchProgress.current}/${batchProgress.total}: finding ${batchProgress.batchSize} professors`
      : 'Searching, scoring, and preparing candidate suggestions'
  const steps = [
    { label: 'Create run', done: !!quill.runId, active: quill.state === 'running' && !quill.runId },
    { label: 'Start AI provider', done: providerStarted || quill.state === 'done', active: quill.state === 'running' && !!quill.runId && !providerStarted },
    { label: mode === 'research' ? 'Research candidate' : 'Search and score candidates', done: parsed || quill.state === 'done', active: quill.state === 'running' && providerStarted && !parsed },
    { label: 'Parse structured result', done: parsed || quill.state === 'done', active: quill.state === 'running' && providerStarted && !parsed },
    { label: mode === 'research' ? 'Update candidate profile' : 'Save ranked queue', done: quill.state === 'done', active: quill.state === 'running' && parsed },
  ]

  return (
    <div className="rounded-md border px-4 py-3 mb-5"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {quill.state === 'running' && <Loader size={14} className="animate-spin" style={{ color: 'var(--color-brand-600)' }} />}
            {quill.state === 'done' && <Check size={14} style={{ color: 'var(--color-green-700)' }} />}
            {quill.state === 'error' && <AlertCircle size={14} style={{ color: 'var(--color-rose-700)' }} />}
            {quill.state === 'cancelled' && <Square size={14} style={{ color: 'var(--color-amber-700)' }} />}
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-ink)' }}>{title}</h2>
            {quill.runId && (
              <span className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)', background: 'var(--color-paper)' }}>
                run #{quill.runId}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>
            {quill.state === 'running'
              ? `${activeText} · ${elapsed}s elapsed`
              : quill.state === 'done'
                ? `Done in ${elapsed}s · ${suggestionCount} suggestion${suggestionCount !== 1 ? 's' : ''} ready`
                : quill.state === 'cancelled'
                  ? `Stopped after ${elapsed}s`
                  : quill.error}
          </div>
          {mode === 'discover' && batchProgress && (
            <div className="mt-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
              Overall target {batchProgress.target}; completed batches are saved before the next Codex run starts.
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {quill.state === 'running' && (
            <button onClick={onStop ?? quill.cancel} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--color-amber-300)', background: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>
              <Square size={11} /> Stop
            </button>
          )}
          <button onClick={() => setShowLog(!showLog)} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)' }}>
            {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showLog ? 'Hide log' : 'Show log'}
          </button>
          <button onClick={quill.reset} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>
            <RefreshCw size={11} /> Clear
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-5">
        {steps.map((step) => (
          <div key={step.label} className="rounded border px-2 py-2"
            style={{
              borderColor: step.done ? 'var(--color-green-200)' : step.active ? 'var(--color-brand-400)' : 'var(--color-line)',
              background: step.done ? 'var(--color-green-50)' : step.active ? 'var(--color-brand-50)' : 'var(--color-paper)',
            }}>
            <div className="flex items-center gap-1.5">
              {step.done
                ? <Check size={12} style={{ color: 'var(--color-green-700)' }} />
                : step.active
                  ? <Loader size={12} className="animate-spin" style={{ color: 'var(--color-brand-600)' }} />
                  : <CircleDot size={12} style={{ color: 'var(--color-muted)' }} />}
              <span className="text-[11px] font-semibold" style={{ color: step.done ? 'var(--color-green-700)' : step.active ? 'var(--color-brand-700)' : 'var(--color-muted)' }}>
                {step.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {showLog && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded border p-3" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>
              Event timeline
            </div>
            <div className="max-h-56 overflow-auto pr-1">
              {quill.events.length === 0 && (
                <div className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Waiting for the first backend event…</div>
              )}
              {quill.events.map((evt) => (
                <div key={evt.id} className="border-l pl-2 pb-2 last:pb-0"
                  style={{ borderColor: 'var(--color-line)' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px]" style={{ color: 'var(--color-muted)' }}>
                      {new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--color-ink)' }}>{evt.label}</span>
                  </div>
                  {evt.detail && (
                    <div className="mt-0.5 line-clamp-2 text-[11px]" style={{ color: 'var(--color-muted)' }}>{evt.detail}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded border p-3" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>
              Live stream
            </div>
            <pre className="min-h-28 max-h-56 overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-[11px]"
              style={{ background: 'var(--color-ink)', color: '#d4e4ff' }}>
              {quill.logText || (quill.state === 'running' ? 'Waiting for provider output…' : 'No provider text captured.')}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── hiring badge ───────────────────────────────────────────────────

function HiringBadge({ signals }: { signals: any }) {
  if (!signals) return null
  const val = typeof signals === 'boolean' ? signals
    : signals?.postdoc ?? signals?.phd ?? signals?.master
  if (val === true) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full"
      style={{ background: '#f0fdf4', color: 'var(--color-green-700)' }}>
      <CircleDot size={8} /> Hiring
    </span>
  )
  if (val === false) return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
      style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}>
      Closed
    </span>
  )
  return null
}

// ─── suggestion row ─────────────────────────────────────────────────

function SuggestionRow({ p, active, onSelect, onAccept, onDismiss }: {
  p: Professor; active: boolean; onSelect: () => void; onAccept: () => void; onDismiss: () => void
}) {
  return (
    <button type="button" onClick={onSelect}
      className="w-full text-left border-b last:border-b-0 transition-colors"
      style={{
        borderColor: 'var(--color-line)',
        background: active ? 'color-mix(in srgb, var(--color-brand-50) 72%, var(--color-white))' : 'var(--color-white)',
      }}>
      <div className="px-3 py-2.5 flex items-start gap-2.5">
        <MatchBadge value={p.match_score ?? p.relevance_score ?? null} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="font-semibold text-[13px] truncate max-w-[210px]" style={{ color: 'var(--color-ink)' }}>{p.name}</span>
            {p.research_category && (
              <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                <span className="w-1.5 h-1.5 rounded-full"
                  style={{ background: `var(--color-cat-${p.research_category}, var(--color-muted))` }} />
                {formatCategory(p.research_category)}
              </span>
            )}
            <HiringBadge signals={(p as any).hiring_signals} />
          </div>
          <div className="text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>
            {[p.university, (p as any).dept_lab].filter(Boolean).join(' · ')}
          </div>
          <div className="text-[12px] leading-snug line-clamp-2 mt-1" style={{ color: 'var(--color-ink-soft)' }}>
            {(p as any).research_angle || p.research_interests}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={onAccept}
            className="p-1.5 rounded-md hover:bg-[color:var(--color-green-50)]"
            title="Accept — add to pipeline"
            style={{ color: 'var(--color-green-700)' }}>
            <Check size={15} />
          </button>
          <button onClick={onDismiss}
            className="p-1.5 rounded-md hover:bg-[color:var(--color-rose-50)]"
            title="Dismiss" style={{ color: 'var(--color-rose-700)' }}>
            <X size={15} />
          </button>
        </div>
      </div>
    </button>
  )
}

function MatchBadge({ value }: { value?: number | null }) {
  return (
    <div className="flex-shrink-0 w-11 rounded border px-1.5 py-1 text-center"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
      <div className="text-[15px] leading-none font-bold font-mono" style={{ color: 'var(--color-brand-600)' }}>
        {value ?? '—'}
      </div>
      <div className="text-[8px] uppercase tracking-[0.08em] mt-0.5" style={{ color: 'var(--color-muted)' }}>
        match
      </div>
    </div>
  )
}

function MetricCard({ label, value, tone = 'neutral' }: { label: string; value: React.ReactNode; tone?: 'neutral' | 'green' | 'amber' }) {
  const color = tone === 'green' ? 'var(--color-green-700)' : tone === 'amber' ? 'var(--color-amber-700)' : 'var(--color-ink)'
  return (
    <div className="rounded-md border px-3 py-2"
      style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line-strong)' }}>
      <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="text-[24px] leading-none font-bold mt-1" style={{ color }}>{value}</div>
    </div>
  )
}

function CandidatePreview({ p, onAccept, onDismiss, onResearch, researching }: {
  p: Professor | null
  onAccept: () => void
  onDismiss: () => void
  onResearch: () => void
  researching: boolean
}) {
  if (!p) {
    return (
      <div className="rounded-md border min-h-[320px] grid place-items-center px-6 text-center"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
        <div>
          <Compass size={26} style={{ color: 'var(--color-brand-600)' }} />
          <div className="text-[15px] font-semibold mt-3" style={{ color: 'var(--color-ink)' }}>No candidate selected</div>
          <div className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>
            Run discovery or select a result from the queue.
          </div>
        </div>
      </div>
    )
  }

  const extra = p as any
  const hiringNotes = extra.hiring_notes || extra.contact_instructions || extra.hiring_intel?.[extra.position_type || 'postdoc']
  const score = p.match_score ?? p.relevance_score ?? null

  return (
    <aside className="rounded-md border overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-line)', background: 'color-mix(in srgb, var(--color-paper) 70%, var(--color-white))' }}>
        <div className="flex items-start gap-3">
          <MatchBadge value={score} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] leading-tight font-bold" style={{ color: 'var(--color-ink)' }}>{p.name}</h2>
            <div className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>
              {[p.university, extra.dept_lab].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {p.research_category && <CategoryChip category={p.research_category} />}
          <HiringBadge signals={extra.hiring_signals} />
          {extra.position_type && (
            <span className="text-[11px] px-2.5 py-1 rounded border"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)', background: 'var(--color-paper-2)' }}>
              {POSITION_LABELS[extra.position_type as PositionType] ?? extra.position_type}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 flex flex-col gap-4">
        <EvidenceBlock title="Research angle" text={extra.research_angle || p.research_interests || 'No research angle captured yet.'} />
        {extra.last_research_summary && (
          <EvidenceBlock title="Profile summary" text={extra.last_research_summary} />
        )}
        <EvidenceBlock title="Hiring evidence" text={hiringNotes || 'No explicit hiring evidence captured yet.'} />
        {extra.relevance_breakdown && (
          <EvidenceBlock title="Why matched" text={summarizeBreakdown(extra.relevance_breakdown)} />
        )}

        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <Field label="Tier" value={p.tier || '—'} />
          <Field label="Status" value={p.status || '—'} />
          <Field label="Email" value={p.email || '—'} />
          <Field label="Source" value={p.source || '—'} />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={onAccept}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-semibold"
            style={{ background: 'var(--color-ink)', color: 'white' }}>
            <Check size={13} /> Add to pipeline
          </button>
          <button onClick={onResearch} disabled={researching}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-ink-soft)' }}>
            {researching ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Research
          </button>
          <button onClick={onDismiss}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-[12px] font-medium"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-rose-700)' }}>
            <X size={13} /> Dismiss
          </button>
          {p.profile_url && (
            <a href={p.profile_url} target="_blank" rel="noreferrer"
              onClick={(e) => {
                e.preventDefault()
                openExternalUrl(p.profile_url)
              }}
              className="ml-auto inline-flex items-center gap-1 text-[12px]"
              style={{ color: 'var(--color-brand-600)' }}>
              Faculty page <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    </aside>
  )
}

function CategoryChip({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[12px]"
      style={{
        background: `color-mix(in srgb, var(--color-cat-${category}) 10%, var(--color-white))`,
        borderColor: `color-mix(in srgb, var(--color-cat-${category}) 35%, var(--color-line))`,
        color: `color-mix(in srgb, var(--color-cat-${category}) 80%, var(--color-ink))`,
      }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: `var(--color-cat-${category})` }} />
      {formatCategory(category)}
    </span>
  )
}

function EvidenceBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] font-semibold" style={{ color: 'var(--color-muted)' }}>
        {title}
      </div>
      <div className="text-[13px] leading-relaxed mt-1" style={{ color: 'var(--color-ink-soft)' }}>
        {text}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border px-2 py-1.5 min-w-0"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <div className="text-[9px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="truncate mt-0.5" style={{ color: 'var(--color-ink)' }}>{value}</div>
    </div>
  )
}

function summarizeBreakdown(breakdown: any): string {
  if (!breakdown || typeof breakdown !== 'object') return ''
  if (breakdown.components && typeof breakdown.components === 'object') {
    return Object.entries(breakdown.components)
      .slice(0, 4)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join(' · ')
  }
  if (breakdown.total != null) return `Overall fit score ${breakdown.total}.`
  return JSON.stringify(breakdown).slice(0, 220)
}

// ─── main page ─────────────────────────────────────────────────────

export function Discover() {
  const [suggested, setSuggested] = useState<Professor[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [settings, setSettings] = useState<DiscoverySettings>(DEFAULT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [activeWorkflow, setActiveWorkflow] = useState<'discover' | 'research' | null>(null)
  const [discoveryBatch, setDiscoveryBatch] = useState<DiscoveryBatchProgress | null>(null)
  const discoveryStopRef = useRef(false)
  const quill = useQuillRun()

  const applyProfessorState = (all: Professor[]) => {
    const nextSuggested = all.filter((p) => p.is_suggested && !(p as any).dismissed_at)
    setSuggested(nextSuggested)
    setSelectedId((current) => {
      if (current && nextSuggested.some((p) => p.id === current)) return current
      return nextSuggested[0]?.id ?? null
    })
  }

  const reload = async () => {
    try {
      const all = await api.professors()
      applyProfessorState(all)
      return all
    } catch (e) {
      setErr(String(e))
      return []
    }
  }

  useEffect(() => {
    reload()
    window.addEventListener('quill:data-changed', reload)
    return () => window.removeEventListener('quill:data-changed', reload)
  }, [])

  useEffect(() => {
    api.user().then((profile) => {
      const targets = targetSettingsFromProfile(profile)
      if (!Object.keys(targets).length) return
      setSettings((current) => ({
        ...current,
        position_type: targets.position_type ?? current.position_type,
        start_date: current.start_date || targets.start_date || '',
        countries: current.countries.trim() ? current.countries : targets.countries || '',
      }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (suggested.length > 0 && quill.state === 'done') setSettingsOpen(false)
  }, [suggested.length, quill.state])

  const runDiscovery = async () => {
    if (quill.state === 'running' || discoveryBatch) return
    discoveryStopRef.current = false
    setActiveWorkflow('discover')
    setErr(null)

    const totalTarget = settings.count
    const totalBatches = Math.max(1, Math.ceil(totalTarget / DISCOVERY_BATCH_SIZE))

    try {
      for (let index = 0; index < totalBatches; index += 1) {
        if (discoveryStopRef.current) break

        const all = await reload()
        const excludeCandidates = all
          .filter((p) => p.name && p.university)
          .map((p) => `${p.name} — ${p.university}`)
        const batchSize = Math.min(DISCOVERY_BATCH_SIZE, totalTarget - index * DISCOVERY_BATCH_SIZE)
        const progress = { current: index + 1, total: totalBatches, batchSize, target: totalTarget }
        setDiscoveryBatch(progress)

        const existing = new Set(
          all.filter((p) => !p.is_suggested && p.university).map((p) => p.university!)
        )
        const dismissed = all.filter((p) => (p as any).dismissed_at).map((p) => p.id)
        const params = buildPromptParams(settings, existing, dismissed, { ...progress, excludeCandidates })
        const result = await quill.start({
          workflow: 'discover_professors',
          params,
          max_turns: 12,
          timeout_s: DISCOVERY_BATCH_TIMEOUT_S,
        })
        await reload()
        if (result !== 'done') break
      }
    } finally {
      setDiscoveryBatch(null)
      setActiveWorkflow(null)
    }
  }

  const stopDiscovery = () => {
    discoveryStopRef.current = true
    quill.cancel()
  }

  // front-end filters on results
  const filtered = useMemo(() => suggested
    .filter((p) => settings.min_match_score === 0 || (p.match_score ?? 0) >= settings.min_match_score)
    .sort((a, b) => {
      if (settings.sort_by === 'match_score') return (b.match_score ?? 0) - (a.match_score ?? 0)
      if (settings.sort_by === 'hiring') {
        const va = (a as any).hiring_signals?.phd ?? (a as any).hiring_signals ?? null
        const vb = (b as any).hiring_signals?.phd ?? (b as any).hiring_signals ?? null
        return (vb === true ? 1 : 0) - (va === true ? 1 : 0)
      }
      return (a.university ?? '').localeCompare(b.university ?? '')
    }), [settings.min_match_score, settings.sort_by, suggested])

  useEffect(() => {
    if (filtered.length && !filtered.some((p) => p.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
    if (!filtered.length) setSelectedId(null)
  }, [filtered, selectedId])

  const selected = filtered.find((p) => p.id === selectedId) ?? null
  const metrics = useMemo(() => {
    const hiring = suggested.filter((p) => {
      const s = (p as any).hiring_signals
      return s === true || s?.postdoc === true || s?.phd === true || s?.master === true
    }).length
    const avg = suggested.length
      ? Math.round(suggested.reduce((sum, p) => sum + (p.match_score ?? p.relevance_score ?? 0), 0) / suggested.length)
      : 0
    return { pending: suggested.length, visible: filtered.length, hiring, avg }
  }, [filtered.length, suggested])

  const accept = async (p: Professor) => {
    await api.patchProfessor(p.id, { status: 'drafting', is_suggested: false })
    reload()
  }

  const dismiss = async (p: Professor) => {
    await api.patchProfessor(p.id, { dismissed_at: new Date().toISOString() })
    reload()
  }

  const acceptAll = async () => {
    await Promise.all(filtered.map((p) =>
      api.patchProfessor(p.id, { status: 'drafting', is_suggested: false })
    ))
    reload()
  }

  const researchSelected = async () => {
    if (!selected) return
    setActiveWorkflow('research')
    await quill.start({ workflow: 'research_professor', professor_id: selected.id })
    setActiveWorkflow(null)
    reload()
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
              Candidate Discovery
            </div>
            <h1 className="text-[31px] leading-none font-bold tracking-tight mt-1" style={{ color: 'var(--color-ink)' }}>
              Discover candidates
            </h1>
            <p className="text-[13px] mt-1 max-w-full sm:max-w-[540px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
              Search, score, and triage new professors before moving them into the application pipeline.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={runDiscovery} disabled={quill.state === 'running' || !!discoveryBatch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-60"
              style={{ background: 'var(--color-ink)', color: 'white' }}>
              {(quill.state === 'running' || discoveryBatch) && activeWorkflow === 'discover'
                ? <Loader size={13} className="animate-spin" />
                : <Sparkles size={13} />}
              Run discovery
            </button>
            {filtered.length > 0 && (
              <button onClick={acceptAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border"
                style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)',
                  color: 'var(--color-ink-soft)' }}>
                <Check size={13} /> Accept visible
              </button>
            )}
            <button onClick={() => setSettingsOpen(!settingsOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border"
              style={{
                borderColor: settingsOpen ? 'var(--color-brand-400)' : 'var(--color-line)',
                background: settingsOpen ? 'var(--color-brand-50)' : 'var(--color-white)',
                color: settingsOpen ? 'var(--color-brand-700)' : 'var(--color-muted)',
              }}>
              <SlidersHorizontal size={13} />
              {settingsOpen ? 'Hide setup' : 'Setup'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <MetricCard label="Pending" value={metrics.pending} />
          <MetricCard label="Visible" value={metrics.visible} />
          <MetricCard label="Hiring" value={metrics.hiring} tone="green" />
          <MetricCard label="Avg Match" value={metrics.avg || '—'} tone="amber" />
        </div>

      {err && (
        <div className="mb-4 p-3 rounded text-[14px]"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>{err}</div>
      )}

      {settingsOpen && (
        <SettingsPanel settings={settings} onChange={setSettings}
          onRun={runDiscovery} running={quill.state === 'running' || !!discoveryBatch} />
      )}

      <RunStatus quill={quill} suggestionCount={suggested.length} mode={activeWorkflow}
        batchProgress={discoveryBatch} onStop={stopDiscovery} />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-3 items-start">
          <section className="rounded-md border overflow-hidden"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            <div className="px-3 py-2 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--color-line)', background: 'color-mix(in srgb, var(--color-paper) 70%, var(--color-white))' }}>
              <div>
                <h2 className="text-[13px] font-bold" style={{ color: 'var(--color-ink)' }}>Ranked queue</h2>
                <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  {filtered.length ? `${filtered.length} candidates ready for review` : 'No visible candidates'}
                </div>
              </div>
              <button onClick={runDiscovery} disabled={quill.state === 'running' || !!discoveryBatch}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold disabled:opacity-60"
                style={{ background: 'var(--color-ink)', color: 'white' }}>
                {(quill.state === 'running' || discoveryBatch) && activeWorkflow === 'discover'
                  ? <Loader size={12} className="animate-spin" />
                  : <Sparkles size={12} />}
                Run
              </button>
            </div>

            {filtered.length === 0 && (
              <div className="px-6 py-10">
                <Compass size={26} style={{ color: 'var(--color-brand-600)' }} />
                <h3 className="text-[16px] font-semibold mt-3" style={{ color: 'var(--color-ink)' }}>
                  No suggestions ready
                </h3>
                <p className="text-[13px] mt-1.5 max-w-full sm:max-w-md leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                  Open setup and run discovery to generate a ranked review queue.
                </p>
                <button onClick={() => setSettingsOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium border"
                  style={{ borderColor: 'var(--color-brand-400)', color: 'var(--color-brand-600)',
                    background: 'var(--color-brand-50)' }}>
                  <SlidersHorizontal size={13} /> Open setup
                </button>
              </div>
            )}

            {filtered.map((p) => (
              <SuggestionRow key={p.id} p={p} active={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
                onAccept={() => accept(p)}
                onDismiss={() => dismiss(p)} />
            ))}
          </section>

          <CandidatePreview p={selected}
            onAccept={() => selected && accept(selected)}
            onDismiss={() => selected && dismiss(selected)}
            onResearch={researchSelected}
            researching={quill.state === 'running' && activeWorkflow === 'research'} />
        </div>
      </div>
    </div>
  )
}
