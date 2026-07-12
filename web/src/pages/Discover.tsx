import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Compass, Sparkles, Check, X, Loader, ChevronDown, ChevronUp,
  AlertCircle, RefreshCw, SlidersHorizontal, ExternalLink, CircleDot,
  MapPin, BookOpen, Users, Square,
} from 'lucide-react'
import {
  api,
  type DiscoveryCandidate,
  type DiscoveryCoverage,
  type DiscoveryDepartment,
  type DiscoveryPage,
  type DiscoveryRun,
  type DiscoveryUniversity,
  type Professor,
  type UserProfileFull,
} from '@/lib/api'
import { formatCategory } from '@/lib/categories'
import { useQuillRun } from '@/hooks/useQuillRun'
import { openExternalUrl } from '@/lib/openExternal'

// ─── settings type ─────────────────────────────────────────────────

type PositionType = 'postdoc' | 'phd' | 'master'
type ProfRank = 'assistant' | 'associate' | 'full'

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

  // pipeline exclusions
  skip_existing_universities: boolean
  skip_dismissed: boolean
  exclude_disciplines: string

  // department scoping
  target_departments: string
}

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

const START_DATE_OPTIONS = ['', 'Fall 2026', 'Spring 2027', 'Fall 2027', 'Spring 2028', 'Rolling']
const DURATION_OPTIONS = ['any', '1 year', '2 years', '3+ years']
const PUB_RECENCY_OPTIONS = [
  { label: 'No filter', value: 0 },
  { label: 'Last year', value: 1 },
  { label: 'Last 2 yrs', value: 2 },
  { label: 'Last 3 yrs', value: 3 },
  { label: 'Last 5 yrs', value: 5 },
]
const REGION_CODES = [
  'AF', 'AL', 'DZ', 'AD', 'AO', 'AR', 'AM', 'AU', 'AT', 'AZ', 'BH', 'BD', 'BY', 'BE', 'BZ', 'BJ', 'BT', 'BO', 'BA', 'BW',
  'BR', 'BN', 'BG', 'BF', 'BI', 'KH', 'CM', 'CA', 'CL', 'CN', 'CO', 'CR', 'HR', 'CU', 'CY', 'CZ', 'DK', 'DO', 'EC', 'EG',
  'SV', 'EE', 'ET', 'FI', 'FR', 'GE', 'DE', 'GH', 'GR', 'GT', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IL',
  'IT', 'JP', 'JO', 'KZ', 'KE', 'KW', 'LV', 'LB', 'LT', 'LU', 'MY', 'MT', 'MX', 'MA', 'NL', 'NZ', 'NG', 'NO', 'PK', 'PE',
  'PH', 'PL', 'PT', 'QA', 'RO', 'SA', 'RS', 'SG', 'SK', 'SI', 'ZA', 'KR', 'ES', 'LK', 'SE', 'CH', 'TW', 'TH', 'TN', 'TR',
  'UA', 'AE', 'GB', 'US', 'UY', 'VN',
]

type CountryOption = { label: string; aliases?: string[] }

const COUNTRY_ALIASES: Record<string, string[]> = {
  Canada: ['CA'],
  China: ['PRC'],
  Germany: ['Deutschland'],
  Netherlands: ['Holland'],
  Switzerland: ['Swiss'],
  'United Arab Emirates': ['UAE'],
  'United Kingdom': ['UK', 'Britain', 'England'],
  'United States': ['US', 'USA', 'America'],
}

const REGION_OPTIONS: CountryOption[] = [
  { label: 'European Union', aliases: ['EU', 'Europe'] },
  { label: 'North America', aliases: ['US Canada', 'USA Canada'] },
  { label: 'Scandinavia', aliases: ['Nordics', 'Nordic countries'] },
]

const COUNTRY_DISPLAY_NAMES = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null

const COUNTRY_OPTIONS: CountryOption[] = [
  ...REGION_OPTIONS,
  ...REGION_CODES
    .map((code) => COUNTRY_DISPLAY_NAMES?.of(code) ?? code)
    .map((label) => ({ label, aliases: COUNTRY_ALIASES[label] ?? [] })),
].sort((a, b) => a.label.localeCompare(b.label))

// ─── settings panel ─────────────────────────────────────────────────

type SectionId = 'position' | 'geography' | 'research' | 'professor' | 'exclusions'

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: 'position',   label: 'Position & Timeline', icon: <Sparkles size={13} /> },
  { id: 'geography',  label: 'Geography',           icon: <MapPin size={13} /> },
  { id: 'research',   label: 'Research focus',      icon: <BookOpen size={13} /> },
  { id: 'professor',  label: 'Professor profile',   icon: <Users size={13} /> },
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
                      <CountryAutocomplete
                        value={s.countries}
                        onChange={(value) => set('countries', value)}
                        placeholder="US, Canada, EU, Switzerland, UK..."
                      />
                    </Row>
                    <Row label="Exclude countries">
                      <CountryAutocomplete
                        value={s.exclude_countries}
                        onChange={(value) => set('exclude_countries', value)}
                        placeholder="e.g. China, Germany..."
                      />
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
                        placeholder="Primary keywords"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Adjacent areas">
                      <input value={s.adjacent_areas}
                        onChange={(e) => set('adjacent_areas', e.target.value)}
                        placeholder="Adjacent areas"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Methods / tools">
                      <input value={s.methods_techniques}
                        onChange={(e) => set('methods_techniques', e.target.value)}
                        placeholder="Methods, tools, or techniques"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Application domain">
                      <input value={s.application_domain}
                        onChange={(e) => set('application_domain', e.target.value)}
                        placeholder="Application domain"
                        className="flex-1 px-2.5 py-1.5 rounded-md border text-[12px] outline-none" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
                    </Row>
                    <Row label="Departments">
                      <input value={s.target_departments}
                        onChange={(e) => set('target_departments', e.target.value)}
                        placeholder="Target departments or institutes"
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
          Quill will build university, department, and directory coverage
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function firstTerms(value: string, limit = 2): string {
  const terms = splitTerms(value).slice(0, limit)
  return terms.length ? terms.join(', ') : ''
}

function hasCustomDiscoverySetup(s: DiscoverySettings): boolean {
  return Boolean(
    hasFilledResearchSettings(s)
    || s.start_date
    || s.countries.trim()
    || s.exclude_countries.trim()
    || s.language_english_only
    || s.prof_ranks.length !== DEFAULT.prof_ranks.length
    || s.require_email
    || s.prefer_international_lab
    || s.exclude_disciplines.trim()
  )
}

function discoverySetupItems(s: DiscoverySettings): { label: string; value: string; active: boolean }[] {
  const focus = firstTerms(
    [
      s.primary_keywords,
      s.adjacent_areas,
      s.methods_techniques,
      s.application_domain,
      s.target_departments,
    ].filter(Boolean).join(', '),
  )
  return [
    {
      label: 'Focus',
      value: focus || 'Set research focus',
      active: Boolean(focus),
    },
    {
      label: 'Location',
      value: firstTerms(s.countries, 3) || 'Any region',
      active: Boolean(s.countries.trim()),
    },
    {
      label: 'Timeline',
      value: s.start_date || 'Any start',
      active: Boolean(s.start_date),
    },
    {
      label: 'Coverage',
      value: 'All matches',
      active: true,
    },
  ]
}

function DiscoverySetupCta({ settings, settingsOpen, onOpen }: {
  settings: DiscoverySettings
  settingsOpen: boolean
  onOpen: () => void
}) {
  const customized = hasCustomDiscoverySetup(settings)
  const items = discoverySetupItems(settings)

  return (
    <section
      className="mb-3 overflow-hidden rounded-md border shadow-[0_14px_34px_rgba(28,34,48,0.12)]"
      style={{
        background: 'color-mix(in srgb, var(--color-brand-50) 58%, var(--color-white))',
        borderColor: 'var(--color-brand-400)',
      }}
    >
      <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"
            style={{
              background: 'var(--color-white)',
              borderColor: 'var(--color-brand-300)',
              color: 'var(--color-brand-700)',
            }}
          >
            <SlidersHorizontal size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold leading-tight" style={{ color: 'var(--color-ink)' }}>
                Set discovery filters first
              </h2>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: customized ? 'var(--color-green-50)' : 'var(--color-amber-50)',
                  borderColor: customized ? 'var(--color-green-200)' : 'var(--color-amber-200)',
                  color: customized ? 'var(--color-green-700)' : 'var(--color-amber-700)',
                }}
              >
                {customized ? 'Ready to review' : 'Recommended'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {items.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium"
                  style={{
                    background: item.active ? 'var(--color-white)' : 'color-mix(in srgb, var(--color-white) 68%, var(--color-amber-50))',
                    borderColor: item.active ? 'var(--color-brand-300)' : 'var(--color-line)',
                    color: item.active ? 'var(--color-ink)' : 'var(--color-muted)',
                  }}
                >
                  <span style={{ color: item.active ? 'var(--color-brand-700)' : 'var(--color-muted)' }}>
                    {item.label}
                  </span>
                  <span>{item.value}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={onOpen}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-bold shadow-[0_10px_24px_rgba(28,34,48,0.18)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
          style={{ background: 'var(--color-ink)', color: 'white' }}
        >
          <SlidersHorizontal size={15} />
          {settingsOpen ? 'Continue filters' : 'Set discovery filters'}
        </button>
      </div>
    </section>
  )
}

function CountryAutocomplete({ value, onChange, placeholder }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const selectedValues = splitTerms(value)
  const selected = new Set(selectedValues.map((item) => item.toLowerCase()))
  const suggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!focused || normalizedQuery.length < 1) return []

    return COUNTRY_OPTIONS
      .filter((option) => !selected.has(option.label.toLowerCase()))
      .map((option) => {
        const searchable = [option.label, ...(option.aliases ?? [])].map((item) => item.toLowerCase())
        const starts = searchable.some((item) => item.startsWith(normalizedQuery))
        const includes = searchable.some((item) => item.includes(normalizedQuery))
        return { option, starts, includes }
      })
      .filter((item) => item.includes)
      .sort((a, b) => Number(b.starts) - Number(a.starts) || a.option.label.localeCompare(b.option.label))
      .slice(0, 7)
      .map((item) => item.option)
  }, [focused, query, selected])

  const selectCountry = (country: string) => {
    onChange(joinTerms([...selectedValues, country]))
    setQuery('')
    setFocused(true)
  }

  const removeCountry = (country: string) => {
    onChange(selectedValues.filter((item) => item.toLowerCase() !== country.toLowerCase()).join(', '))
  }

  return (
    <div className="relative min-w-[220px] flex-1">
      <div
        className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1"
        style={{ background: 'var(--color-white)', borderColor: focused ? 'var(--color-brand-400)' : 'var(--color-line)', color: 'var(--color-ink)' }}
      >
        {selectedValues.map((country) => (
          <span
            key={country}
            className="inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-medium"
            style={{
              background: 'var(--color-brand-50)',
              borderColor: 'var(--color-brand-300)',
              color: 'var(--color-brand-700)',
            }}
          >
            {country}
            <button
              type="button"
              onClick={() => removeCountry(country)}
              className="inline-flex h-4 w-4 items-center justify-center rounded hover:bg-[color:var(--color-white)]"
              aria-label={`Remove ${country}`}
              style={{ color: 'var(--color-brand-700)' }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && suggestions[0]) {
              e.preventDefault()
              selectCountry(suggestions[0].label)
            }
            if (e.key === 'Backspace' && !query && selectedValues.length > 0) {
              removeCountry(selectedValues[selectedValues.length - 1])
            }
            if (e.key === 'Escape') setFocused(false)
          }}
          placeholder={selectedValues.length ? 'Add another country...' : placeholder}
          className="min-w-[150px] flex-1 bg-transparent px-1 py-1 text-[12px] outline-none"
          style={{ color: 'var(--color-ink)' }}
        />
      </div>
      {suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-md border p-1 shadow-[0_16px_34px_rgba(28,34,48,0.16)]"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}
          role="listbox"
        >
          {suggestions.map((option) => (
            <button
              key={option.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectCountry(option.label)}
              className="flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-[12px] font-medium hover:bg-[color:var(--color-brand-50)]"
              style={{ color: 'var(--color-ink)' }}
              role="option"
            >
              <span>{option.label}</span>
              <Check size={12} style={{ color: 'var(--color-brand-600)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
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

function DiscoveryRunStatus({ run, coverage, universities, departments, pages, candidates, running, onStop, onRefresh }: {
  run: DiscoveryRun | null
  coverage: DiscoveryCoverage | null
  universities: DiscoveryUniversity[]
  departments: DiscoveryDepartment[]
  pages: DiscoveryPage[]
  candidates: DiscoveryCandidate[]
  running: boolean
  onStop: () => void
  onRefresh: () => void
}) {
  if (!run) return null
  const latestLog = coverage?.recent_logs.find((log) => log.run_id === run.id)
  const isActive = running || run.status === 'queued' || run.status === 'running'
  const statusColor = run.status === 'done'
    ? 'var(--color-green-700)'
    : run.status === 'failed'
      ? 'var(--color-rose-700)'
      : 'var(--color-brand-700)'
  const countries = run.target_countries?.join(', ') || '—'
  const visibleUniversities = Math.max(universities.length, run.universities_total)
  const visibleDepartments = Math.max(departments.length, run.departments_found)
  const visiblePages = Math.max(pages.length, run.directory_pages_found)
  const visibleCandidates = Math.max(candidates.length, run.candidates_extracted)

  return (
    <div className="rounded-md border px-4 py-3 mb-5"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isActive && <Loader size={14} className="animate-spin" style={{ color: 'var(--color-brand-600)' }} />}
            {run.status === 'done' && <Check size={14} style={{ color: 'var(--color-green-700)' }} />}
            {run.status === 'failed' && <AlertCircle size={14} style={{ color: 'var(--color-rose-700)' }} />}
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-ink)' }}>Discovery coverage</h2>
            <span className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)', background: 'var(--color-paper)' }}>
              run #{run.id}
            </span>
            <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              style={{ borderColor: 'var(--color-line)', color: statusColor, background: 'var(--color-paper)' }}>
              {run.status}
            </span>
          </div>
          <div className="mt-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>
            {run.summary || `Covering ${countries}`}
          </div>
          {latestLog && (
            <div className="mt-1 text-[11px]" style={{ color: latestLog.level === 'warning' ? 'var(--color-amber-700)' : 'var(--color-muted)' }}>
              {latestLog.message}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isActive && (
            <button onClick={onStop} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--color-amber-300)', background: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>
              <Square size={11} /> Stop monitoring
            </button>
          )}
          <button onClick={onRefresh} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)', color: 'var(--color-ink-soft)' }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        <Field label="Countries" value={countries} />
        <Field label="Source checks" value={run.universities_checked} />
        <Field label="Universities found" value={visibleUniversities} />
        <Field label="Departments seeded" value={visibleDepartments} />
        <Field label="Pages queued" value={visiblePages} />
        <Field label="Candidates found" value={visibleCandidates} />
        <Field label="Failures" value={run.failures} />
      </div>
    </div>
  )
}

function DiscoveryCandidateReview({ run, candidates, busy, onPromote, onPromoteAll, onReject }: {
  run: DiscoveryRun | null
  candidates: DiscoveryCandidate[]
  busy: string | null
  onPromote: (candidate: DiscoveryCandidate) => void
  onPromoteAll: () => void
  onReject: (candidate: DiscoveryCandidate) => void
}) {
  if (!run || candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => {
    const statusRank = (status: string) => status === 'verified' ? 0 : status === 'pending' ? 1 : status === 'duplicate' ? 2 : 3
    return statusRank(a.verification_status) - statusRank(b.verification_status)
      || (b.match_score ?? -1) - (a.match_score ?? -1)
      || a.name.localeCompare(b.name)
  })
  const visible = sorted.slice(0, 12)
  const verifiedReady = candidates.filter((candidate) => candidate.verification_status === 'verified' && !candidate.professor_id).length
  const busyPromoteAll = busy === 'promote-all'

  return (
    <section className="rounded-md border mb-5 overflow-hidden"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
      <div className="px-4 py-3 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        style={{ borderColor: 'var(--color-line)', background: 'color-mix(in srgb, var(--color-paper) 70%, var(--color-white))' }}>
        <div>
          <h2 className="text-[13px] font-bold" style={{ color: 'var(--color-ink)' }}>Matched professors</h2>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {candidates.length} matched · {run.candidates_verified} with verified contact · ranked by fit to your profile
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onPromoteAll} disabled={busyPromoteAll || verifiedReady === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-ink)', color: 'white' }}>
            {busyPromoteAll ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Add verified
          </button>
        </div>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--color-line)' }}>
        {visible.map((candidate) => {
          const actionBusy = busy === `promote-${candidate.id}` || busy === `reject-${candidate.id}`
          const status = candidate.professor_id ? 'saved' : candidate.verification_status
          const statusColor = status === 'verified' || status === 'saved'
            ? 'var(--color-green-700)'
            : status === 'rejected' || status === 'duplicate'
              ? 'var(--color-rose-700)'
              : 'var(--color-amber-700)'
          return (
            <div key={candidate.id} className="px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-start">
              <MatchBadge value={candidate.match_score} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>{candidate.name}</h3>
                  <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ borderColor: 'var(--color-line)', color: statusColor, background: 'var(--color-paper)' }}>
                    {status}
                  </span>
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {[candidate.university_name, candidate.dept_lab, candidate.country].filter(Boolean).join(' · ')}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  {candidate.career_stage && (
                    <span style={{ color: candidate.career_stage === 'early' ? 'var(--color-green-700)' : 'var(--color-muted)' }}>
                      {candidate.career_stage}-career{candidate.career_stage === 'early' ? ' · hires more' : ''}
                    </span>
                  )}
                  {typeof candidate.h_index === 'number' && <span>h-index {candidate.h_index}</span>}
                  {typeof candidate.topic_match_count === 'number' && candidate.topic_match_count > 0 && (
                    <span>{candidate.topic_match_count} papers in your topics</span>
                  )}
                  {candidate.email && (
                    <a href={`mailto:${candidate.email}`} style={{ color: 'var(--color-brand-600)' }}>{candidate.email}</a>
                  )}
                </div>
                <p className="text-[12px] mt-1.5 leading-relaxed line-clamp-2" style={{ color: 'var(--color-ink-soft)' }}>
                  {candidate.research_text || candidate.evidence_summary || candidate.rejection_reason || 'No evidence summary captured.'}
                </p>
                {!!candidate.matched_reasons?.length && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {candidate.matched_reasons.slice(0, 3).map((reason) => (
                      <span key={reason} className="rounded border px-1.5 py-0.5 text-[10px]"
                        style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)', background: 'var(--color-paper-2)' }}>
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 lg:pt-1">
                {candidate.profile_url && (
                  <a href={candidate.profile_url} target="_blank" rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      if (candidate.profile_url) openExternalUrl(candidate.profile_url)
                    }}
                    className="inline-flex items-center gap-1 text-[12px]"
                    style={{ color: 'var(--color-brand-600)' }}>
                    Source <ExternalLink size={11} />
                  </a>
                )}
                <button onClick={() => onPromote(candidate)}
                  disabled={actionBusy || candidate.verification_status === 'rejected' || !!candidate.professor_id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-green-700)' }}>
                  {busy === `promote-${candidate.id}` ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                  Add
                </button>
                <button onClick={() => onReject(candidate)}
                  disabled={actionBusy || candidate.verification_status === 'rejected' || !!candidate.professor_id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-rose-700)' }}>
                  {busy === `reject-${candidate.id}` ? <Loader size={12} className="animate-spin" /> : <X size={12} />}
                  Reject
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── run status bar ─────────────────────────────────────────────────

function RunStatus({ quill }: {
  quill: ReturnType<typeof useQuillRun>
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
  const quillStarted = quill.events.some((evt) => evt.kind === 'started')
  const title = 'Research monitor'
  const activeText = 'Researching the selected candidate'
  const steps = [
    { label: 'Create run', done: !!quill.runId, active: quill.state === 'running' && !quill.runId },
    { label: 'Start Quill', done: quillStarted || quill.state === 'done', active: quill.state === 'running' && !!quill.runId && !quillStarted },
    { label: 'Research candidate', done: parsed || quill.state === 'done', active: quill.state === 'running' && quillStarted && !parsed },
    { label: 'Parse structured result', done: parsed || quill.state === 'done', active: quill.state === 'running' && quillStarted && !parsed },
    { label: 'Update candidate profile', done: quill.state === 'done', active: quill.state === 'running' && parsed },
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
                ? `Done in ${elapsed}s`
                : quill.state === 'cancelled'
                  ? `Stopped after ${elapsed}s`
                  : quill.error}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {quill.state === 'running' && (
            <button onClick={quill.cancel} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold"
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
              {quill.logText || (quill.state === 'running' ? 'Waiting for Quill output…' : 'No Quill text captured.')}
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
  const hiringNotes = extra.hiring_notes || extra.contact_instructions || (extra.position_type ? extra.hiring_intel?.[extra.position_type] : undefined)
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

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={onAccept}
            className="inline-flex min-w-[116px] items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-semibold"
            style={{ background: 'var(--color-ink)', color: 'white' }}>
            <Check size={13} /> Add to pipeline
          </button>
          <button onClick={onResearch} disabled={researching}
            className="inline-flex min-w-[96px] items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-[12px] font-medium disabled:opacity-60"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-ink-soft)' }}>
            {researching ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Research
          </button>
          <button onClick={onDismiss}
            className="inline-flex min-w-[96px] items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-[12px] font-medium"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-rose-700)' }}>
            <X size={13} /> Dismiss
          </button>
          {p.profile_url && (
            <a href={p.profile_url} target="_blank" rel="noreferrer"
              onClick={(e) => {
                e.preventDefault()
                openExternalUrl(p.profile_url)
              }}
              className="inline-flex min-w-0 items-center gap-1 text-[12px]"
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
  const [activeWorkflow, setActiveWorkflow] = useState<'research' | null>(null)
  const [discoveryRun, setDiscoveryRun] = useState<DiscoveryRun | null>(null)
  const [discoveryCoverage, setDiscoveryCoverage] = useState<DiscoveryCoverage | null>(null)
  const [discoveryUniversities, setDiscoveryUniversities] = useState<DiscoveryUniversity[]>([])
  const [discoveryDepartments, setDiscoveryDepartments] = useState<DiscoveryDepartment[]>([])
  const [discoveryPages, setDiscoveryPages] = useState<DiscoveryPage[]>([])
  const [discoveryCandidates, setDiscoveryCandidates] = useState<DiscoveryCandidate[]>([])
  const [discoveryRunning, setDiscoveryRunning] = useState(false)
  const [candidateAction, setCandidateAction] = useState<string | null>(null)
  const [acceptingAll, setAcceptingAll] = useState(false)
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

  const refreshDiscovery = async () => {
    const coverage = await api.discoveryCoverage()
    setDiscoveryCoverage(coverage)
    const latest = coverage.active_run || coverage.latest_run
    setDiscoveryRun(latest)
    if (latest) {
      const [universities, departments, pages, candidates] = await Promise.all([
        api.discoveryUniversities(latest.id),
        api.discoveryDepartments(latest.id),
        api.discoveryPages(latest.id),
        api.discoveryCandidates(latest.id),
      ])
      setDiscoveryUniversities(universities)
      setDiscoveryDepartments(departments)
      setDiscoveryPages(pages)
      setDiscoveryCandidates(candidates)
    } else {
      setDiscoveryUniversities([])
      setDiscoveryDepartments([])
      setDiscoveryPages([])
      setDiscoveryCandidates([])
    }
    return coverage
  }

  useEffect(() => {
    reload()
    refreshDiscovery().catch(() => {})
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
    if (quill.state === 'running' || discoveryRunning) return
    if (!settings.countries.trim()) {
      setErr('Select at least one country or supported region before running discovery.')
      setSettingsOpen(true)
      return
    }
    discoveryStopRef.current = false
    setErr(null)
    setDiscoveryRunning(true)

    try {
      let run = await api.startDiscoveryRun({
        position_type: settings.position_type,
        target_countries: settings.countries,
        target_departments: settings.target_departments,
        filters: settings,
      })
      setDiscoveryRun(run)
      await refreshDiscovery()
      while (!discoveryStopRef.current && (run.status === 'queued' || run.status === 'running')) {
        await wait(1800)
        run = await api.discoveryRun(run.id)
        setDiscoveryRun(run)
        await refreshDiscovery()
      }
      if (run.status === 'done') {
        const [universities, departments, pages, candidates] = await Promise.all([
          api.discoveryUniversities(run.id),
          api.discoveryDepartments(run.id),
          api.discoveryPages(run.id),
          api.discoveryCandidates(run.id),
        ])
        setDiscoveryUniversities(universities)
        setDiscoveryDepartments(departments)
        setDiscoveryPages(pages)
        setDiscoveryCandidates(candidates)
      }
      if (run.status === 'failed') {
        setErr(run.error_message || run.summary || 'University coverage failed.')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDiscoveryRunning(false)
    }
  }

  const stopDiscovery = () => {
    discoveryStopRef.current = true
    setDiscoveryRunning(false)
  }

  const promoteDiscoveryCandidate = async (candidate: DiscoveryCandidate) => {
    if (candidateAction) return
    setCandidateAction(`promote-${candidate.id}`)
    setErr(null)
    try {
      await api.promoteDiscoveryCandidate(candidate.id)
      await Promise.all([refreshDiscovery(), reload()])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCandidateAction(null)
    }
  }

  const promoteAllVerifiedDiscoveryCandidates = async () => {
    if (!discoveryRun || candidateAction) return
    setCandidateAction('promote-all')
    setErr(null)
    try {
      await api.promoteVerifiedDiscoveryCandidates(discoveryRun.id)
      await Promise.all([refreshDiscovery(), reload()])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCandidateAction(null)
    }
  }

  const rejectDiscoveryCandidate = async (candidate: DiscoveryCandidate) => {
    if (candidateAction) return
    setCandidateAction(`reject-${candidate.id}`)
    setErr(null)
    try {
      await api.rejectDiscoveryCandidate(candidate.id)
      await refreshDiscovery()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCandidateAction(null)
    }
  }

  // Always show every suggestion and sort strongest matches first.
  const filtered = useMemo(() => [...suggested]
    .sort((a, b) => {
      return (b.match_score ?? b.relevance_score ?? 0) - (a.match_score ?? a.relevance_score ?? 0)
    }), [suggested])

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
    if (suggested.length === 0 || acceptingAll) return
    setAcceptingAll(true)
    try {
      await Promise.all(suggested.map((p) =>
        api.patchProfessor(p.id, { status: 'drafting', is_suggested: false })
      ))
      reload()
    } finally {
      setAcceptingAll(false)
    }
  }

  const researchSelected = async () => {
    if (!selected) return
    setActiveWorkflow('research')
    await quill.start({ workflow: 'research_professor', professor_id: selected.id })
    setActiveWorkflow(null)
    reload()
  }

  const openDiscoverySettings = () => {
    setSettingsOpen(true)
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
              Discover Candidates
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={openDiscoverySettings}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold"
              style={{ background: 'var(--color-ink)', color: 'white' }}>
              <SlidersHorizontal size={13} />
              Set filters
            </button>
            {suggested.length > 0 && (
              <button onClick={acceptAll} disabled={acceptingAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border disabled:opacity-60"
                style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)',
                  color: 'var(--color-ink-soft)' }}>
                {acceptingAll ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                Add all to pipeline
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
              {settingsOpen ? 'Hide filters' : 'Filters'}
            </button>
          </div>
        </div>

        <DiscoverySetupCta settings={settings} settingsOpen={settingsOpen} onOpen={openDiscoverySettings} />

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
          onRun={runDiscovery} running={quill.state === 'running' || discoveryRunning} />
      )}

      <DiscoveryRunStatus
        run={discoveryRun}
        coverage={discoveryCoverage}
        universities={discoveryUniversities}
        departments={discoveryDepartments}
        pages={discoveryPages}
        candidates={discoveryCandidates}
        running={discoveryRunning}
        onStop={stopDiscovery}
        onRefresh={() => refreshDiscovery().catch((e) => setErr(e instanceof Error ? e.message : String(e)))}
      />

      <DiscoveryCandidateReview
        run={discoveryRun}
        candidates={discoveryCandidates}
        busy={candidateAction}
        onPromote={promoteDiscoveryCandidate}
        onPromoteAll={promoteAllVerifiedDiscoveryCandidates}
        onReject={rejectDiscoveryCandidate}
      />

      <RunStatus quill={quill} />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-3 items-start">
          <section className="rounded-md border overflow-hidden"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)' }}>
            <div className="px-3 py-2 border-b flex items-center justify-between gap-2"
              style={{ borderColor: 'var(--color-line)', background: 'color-mix(in srgb, var(--color-paper) 70%, var(--color-white))' }}>
              <div>
                <h2 className="text-[13px] font-bold" style={{ color: 'var(--color-ink)' }}>Ranked queue</h2>
                <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  {filtered.length ? `${filtered.length} candidates ready for review` : 'No visible candidates'}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {suggested.length > 0 && (
                  <button onClick={acceptAll} disabled={acceptingAll}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium disabled:opacity-60"
                    style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-ink-soft)' }}>
                    {acceptingAll ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                    Add all
                  </button>
                )}
              </div>
            </div>

            {filtered.length === 0 && (
              <div className="px-6 py-10">
                <Compass size={26} style={{ color: 'var(--color-brand-600)' }} />
                <h3 className="text-[16px] font-semibold mt-3" style={{ color: 'var(--color-ink)' }}>
                  No suggestions ready
                </h3>
                <p className="text-[13px] mt-1.5 max-w-full sm:max-w-md leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                  Open filters and run discovery coverage. Quill will extract candidate profiles first; verification and scoring come next.
                </p>
                <button onClick={() => setSettingsOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium border"
                  style={{ borderColor: 'var(--color-brand-400)', color: 'var(--color-brand-600)',
                    background: 'var(--color-brand-50)' }}>
                  <SlidersHorizontal size={13} /> Open filters
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
