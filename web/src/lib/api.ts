// Tiny typed fetch wrapper. The Vite dev server proxies /api/* to :8000.
import { apiUrl } from './runtime'

export type Professor = {
  id: number
  number?: number | null
  name: string
  university?: string
  dept_lab?: string
  tier?: string
  status?: string
  date_sent?: string | null
  email?: string
  research_angle?: string
  notes?: string
  priority?: number
  profile_url?: string
  research_interests?: string
  research_category?: string
  scholar_url?: string | null
  twitter?: string | null
  lab_url?: string | null
  last_research_summary?: string | null
  source?: string
  is_suggested?: boolean
  dismissed_at?: string | null
  match_score?: number | null
  relevance_score?: number | null
  relevance_breakdown?: {
    components: Record<string, number>
    weights: Record<string, number>
    contributions: Record<string, number>
    total: number
    user_position_type?: string
    paper_count?: number
  } | null
  relevance_scored_at?: string | null
  position_type?: string | null
  hiring_signals?: Record<string, boolean | null> | null
  hiring_notes?: string | null
  hiring_intel?: {
    postdoc?: string
    phd?: string
    master?: string
    general?: string
  } | null
  contact_instructions?: string | null
  prospective_url?: string | null
  profile_scraped_at?: string | null
  created_at: string
  updated_at: string
}

export type Stats = {
  total: number
  by_status: Record<string, number>
  by_tier: Record<string, number>
  by_university: Record<string, number>
  sent_count: number
  reply_count: number
  response_rate: number
  interview_count: number
  offer_count: number
  pending_followups: number
}

export type Activity = {
  id: number
  date: string
  action: string
  detail: string
  professor_id: number | null
  created_at: string
}

export type AIRun = {
  id: number
  workflow: string
  provider: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'deferred' | 'retried'
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  duration_ms: number | null
  output: string | null
  error_type: string | null
  error_message: string | null
  retry_of_run_id: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  professor_id: number | null
  document_id: number | null
  grant_id: number | null
}

export type DesktopStatus = {
  ok: boolean
  desktop_mode: boolean
  data_dir: string
  db_path: string
  documents_dir: string
}

export type AuthStatus = {
  authenticated: boolean
  user_id?: number
  account_email?: string | null
}

export type Draft = {
  id: number
  professor_id: number
  subject: string
  body: string
  created_at: string
  updated_at: string
  skipped_at?: string | null
  attachment_doc_ids?: number[] | null
  professor_name?: string
  professor_university?: string
  professor_status?: string
  professor_email?: string
  professor_research_category?: string
  sent_at?: string | null
}

export type SentReply = {
  id: number
  received_at: string | null
  from_email: string | null
  from_name: string | null
  subject: string | null
  snippet: string | null
  body: string | null
  read_at: string | null
  dismissed_at: string | null
  response_draft: string | null
  response_subject: string | null
  response_sent_at: string | null
  meeting_request: boolean | null
}

export type LikelyQuestion = {
  question: string
  draft_answer: string
  category: string
}

export type LogisticsItem = {
  item: string
  done: boolean
}

export type KeyFact = { label: string; value: string }

export type TalkingPoint = { point: string; detail: string }

export type Briefing = {
  key_facts: KeyFact[]
  summary: string
  what_to_expect: string
}

export type FitAnalysis = {
  strengths: string[]
  gaps: string[]
  verdict: string
}

export type InterviewPrep = {
  id: number
  professor_id: number
  professor_name: string | null
  university: string | null
  reply_id: number | null
  position_type: string | null
  meeting_format: string
  meeting_at: string | null
  meeting_notes: string | null
  briefing: Briefing
  fit_analysis: FitAnalysis
  talking_points: TalkingPoint[]
  likely_questions: LikelyQuestion[]
  questions_to_ask: string[]
  logistics: LogisticsItem[]
  status: string
  generated_at: string | null
  updated_at: string | null
}

export type MockTurn = {
  role: 'professor' | 'applicant' | 'feedback'
  text: string
  at: string
}

export type MockInterview = {
  id: number
  prep_id: number
  transcript: MockTurn[]
  status: string
  summary: string | null
}

export type SentRow = {
  draft_id: number
  professor_id: number
  professor_name: string
  professor_email: string | null
  university: string | null
  tier: string | null
  research_category: string | null
  subject: string
  body: string
  sent_at: string | null
  sent_via: string | null
  days_since_sent: number | null
  batch_index: number | null
  status: string
  reply_count: number
  last_reply_at: string | null
  last_reply_snippet: string | null
  replies: SentReply[]
}

export type DocumentRow = {
  id: number
  kind: string
  title: string
  filename: string
  extension: string
  size_bytes: number
  is_default: boolean
  version: number
  has_text: boolean
  text_chars: number
  created_at: string
  updated_at: string
}

export type DiscoveryRun = {
  id: number
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  phase: string
  position_type: string | null
  target_countries: string[] | null
  target_departments: string[] | null
  filters: Record<string, any> | null
  universities_total: number
  universities_checked: number
  departments_found: number
  directory_pages_found: number
  pages_crawled: number
  candidates_extracted: number
  candidates_verified: number
  candidates_rejected: number
  professors_saved: number
  failures: number
  summary: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

export type DiscoveryLog = {
  id: number
  run_id: number
  level: string
  stage: string | null
  message: string
  payload: Record<string, any> | null
  created_at: string | null
}

export type DiscoveryCoverage = {
  active_run: DiscoveryRun | null
  latest_run: DiscoveryRun | null
  totals: Record<string, number>
  recent_logs: DiscoveryLog[]
}

export type DiscoveryUniversity = {
  id: number
  run_id: number
  name: string
  normalized_name: string
  country: string
  country_code: string | null
  region: string | null
  official_domain: string | null
  official_url: string | null
  source: string | null
  source_url: string | null
  source_confidence: number | null
  status: string
  error_message: string | null
  discovered_at: string | null
  checked_at: string | null
  created_at: string
  updated_at: string
}

export type DiscoveryDepartment = {
  id: number
  run_id: number
  university_id: number
  name: string
  normalized_name: string
  school: string | null
  url: string | null
  domain: string | null
  source: string | null
  relevance_keywords: string[] | null
  status: string
  error_message: string | null
  discovered_at: string | null
  crawled_at: string | null
  created_at: string
  updated_at: string
}

export type DiscoveryPage = {
  id: number
  run_id: number
  university_id: number | null
  department_id: number | null
  url: string
  normalized_url: string
  final_url: string | null
  page_type: string
  status: string
  depth: number
  fetcher: string | null
  http_status: number | null
  content_hash: string | null
  title: string | null
  discovered_from_url: string | null
  extracted_count: number
  error_message: string | null
  first_seen_at: string | null
  last_crawled_at: string | null
  created_at: string
  updated_at: string
}

export type DiscoveryCandidate = {
  id: number
  run_id: number
  university_id: number | null
  department_id: number | null
  source_page_id: number | null
  professor_id: number | null
  name: string
  normalized_name: string
  title: string | null
  rank: string | null
  university_name: string | null
  country: string | null
  dept_lab: string | null
  email: string | null
  profile_url: string | null
  lab_url: string | null
  scholar_url: string | null
  research_text: string | null
  evidence_summary: string | null
  raw_payload: Record<string, any> | null
  extraction_confidence: number | null
  verification_status: string
  rejection_reason: string | null
  match_score: number | null
  matched_reasons: string[] | null
  scored_at: string | null
  openalex_author_id: string | null
  orcid: string | null
  works_count: number | null
  cited_by_count: number | null
  h_index: number | null
  first_pub_year: number | null
  career_stage: string | null
  topic_match_count: number | null
  semantic_score: number | null
  created_at: string
  updated_at: string
}

export type AdminUser = {
  id: number
  account_email: string | null
  name: string
  is_admin: boolean
  is_active: boolean
  credit_cap_usd: number | null
  credit_used_usd: number | null
  created_at: string | null
}

export type UserProfile = {
  id: number
  name: string
  email: string | null
  current_role: string | null
  affiliation: string | null
  country: string | null
  research_interests: string | null
  research_categories: string[] | null
  orcid: string | null
  scholar_url: string | null
  github: string | null
  website: string | null
  twitter: string | null
  phd_year: number | null
  phd_institution: string | null
  is_admin: boolean
  credit_cap_usd: number | null
  credit_used_usd: number | null
  credit_remaining_usd: number | null
}

// Rich profile — returned by GET /api/user. Superset of UserProfile + nested
// repeatable rows. Every scalar is optional because most rows start empty.
export type UserEducation = {
  id: number
  degree_level: string
  field?: string | null
  institution?: string | null
  department?: string | null
  start_date?: string | null
  end_date?: string | null
  is_current?: boolean
  gpa?: number | null
  gpa_scale?: number | null
  honors?: string | null
  advisor_name?: string | null
  advisor_title?: string | null
  co_advisor_name?: string | null
  thesis_title?: string | null
  thesis_abstract?: string | null
  key_courses?: Array<{ name: string; grade?: string; year?: number }> | null
  transcript_doc_id?: number | null
  order_idx?: number
}

export type UserPublication = {
  id: number
  title: string
  authors?: string | null
  venue_full_name?: string | null
  venue_short?: string | null
  year?: number | null
  type?: string | null
  status?: string | null
  doi?: string | null
  url?: string | null
  pdf_url?: string | null
  citation_count?: number | null
  your_role?: string | null
  abstract?: string | null
  one_line_takeaway?: string | null
  is_signature?: boolean
  order_idx?: number
}

export type UserExperience = {
  id: number
  title: string
  employer?: string | null
  lab_or_group?: string | null
  supervisor?: string | null
  location?: string | null
  start_date?: string | null
  end_date?: string | null
  is_current?: boolean
  bullets?: string[] | null
  tech_used?: string[] | null
  order_idx?: number
}

export type UserAward = {
  id: number
  name: string
  granting_body?: string | null
  amount?: number | null
  currency?: string | null
  year?: number | null
  type?: string | null
  notes?: string | null
  order_idx?: number
}

export type UserReference = {
  id: number
  name: string
  title?: string | null
  institution?: string | null
  email?: string | null
  relationship_type?: string | null
  years_known?: number | null
  notes?: string | null
  order_idx?: number
}

export type FieldProvenance = Record<string, {
  source?: string
  confidence?: number
  extracted_at?: string
  verified_by_user?: boolean
  verified_at?: string
}>

export type UserProfileFull = {
  id: number
  // Identity
  name: string
  preferred_name?: string | null
  pronouns?: string | null
  headshot_url?: string | null
  // Contact
  email?: string | null
  email_secondary?: string | null
  phone?: string | null
  city?: string | null
  country?: string | null
  nationality?: string | null
  languages?: Array<{ lang: string; level: string }> | null
  // Online
  orcid?: string | null
  scholar_url?: string | null
  github?: string | null
  linkedin?: string | null
  website?: string | null
  twitter?: string | null
  // Current role
  current_role?: string | null
  affiliation?: string | null
  // Target
  target_position_type?: string | null
  target_start_date?: string | null
  earliest_available_date?: string | null
  target_countries?: string[] | null
  target_universities_preferred?: string[] | null
  excluded_institutions?: string[] | null
  funding_status?: string | null
  work_authorization?: Record<string, string> | null
  commitment_length?: string | null
  // Research profile
  headline?: string | null
  research_interests?: string | null
  research_categories?: string[] | null
  methods?: string[] | null
  application_domains?: string[] | null
  tools_frameworks?: string[] | null
  datasets_used?: string[] | null
  datasets_created?: Array<{ name: string; status?: string }> | null
  // Skills
  programming_languages?: Array<{ name: string; proficiency?: string }> | null
  certifications?: string[] | null
  reviewing_venues?: string[] | null
  teaching_summary?: string | null
  // Legacy
  phd_year?: number | null
  phd_institution?: string | null
  // Linked docs
  cv_doc_id?: number | null
  research_statement_doc_id?: number | null
  transcript_doc_ids?: number[] | null
  sample_paper_doc_ids?: number[] | null
  // Metadata
  cv_last_extracted_at?: string | null
  field_provenance?: FieldProvenance | null
  created_at?: string
  updated_at?: string
  // Nested
  education: UserEducation[]
  publications: UserPublication[]
  experience: UserExperience[]
  awards: UserAward[]
  references: UserReference[]
}

export type Grant = {
  id: number
  name: string
  deadline?: string
  amount?: string
  eligibility?: string
  status?: string
  notes?: string
  url?: string
  source?: string
  match_score?: number | null
  region?: string | null
  discipline_tags?: string[] | null
}

export type CalendarEvent = {
  id: number
  title: string
  date: string           // YYYY-MM-DD
  time?: string | null
  end_time?: string | null
  description?: string | null
  color?: string | null
  kind: string           // event | reminder | meeting | deadline
  all_day: boolean
  created_at: string
  updated_at: string
}

export type ProfessorPaper = {
  id: number
  title: string
  venue: string | null
  year: number | null
  abstract: string | null
  url: string | null
  pdf_url: string | null
  relevance_score: number | null
  relevance_summary: string | null
  fetched_at: string | null
}

export type BatchParams = {
  batch_size?: number
  max_per_university?: number
  start_date?: string
  weekdays?: number[]
  tiers?: string[]
  categories?: string[]
  universities?: string[]
}

const STARTUP_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000, 5000, 8000, 10000]

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isIdempotentRequest(init?: RequestInit): boolean {
  const method = init?.method?.toUpperCase() ?? 'GET'
  return method === 'GET' || method === 'HEAD'
}

class ApiHttpError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  const retryDelays = isIdempotentRequest(init) ? STARTUP_RETRY_DELAYS_MS : []
  let lastError = ''
  const method = init?.method?.toUpperCase() ?? 'GET'

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      r = await fetch(apiUrl(path), {
        ...init,
        credentials: 'include',
        headers: {
          ...(method === 'GET' || method === 'HEAD' ? {} : { 'Content-Type': 'application/json' }),
          ...(init?.headers || {}),
        },
      })
      if (!r.ok) {
        throw new ApiHttpError(`${r.status} ${r.statusText} · ${path}`)
      }
      return r.json() as Promise<T>
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (e instanceof ApiHttpError) {
        throw e
      }
      if (attempt >= retryDelays.length) break
      await sleep(retryDelays[attempt])
    }
  }

  throw new Error(
    `Local backend is not reachable while loading ${path}. Quill waited for the packaged backend to start; click Recheck, or close and reopen the app if this keeps happening.${lastError ? ` (${lastError})` : ''}`,
  )
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  login: (email: string, password: string) =>
    request<{ ok: boolean; user_id: number; account_email: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account_email: email, password }),
    }),
  signup: (email: string, password: string, name?: string) =>
    request<{ ok: boolean; user_id: number; account_email: string }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ account_email: email, password, name: name || '' }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  adminListUsers: () => request<AdminUser[]>('/api/admin/users'),
  adminPatchUser: (
    id: number,
    patch: Partial<{ credit_cap_usd: number | null; is_admin: boolean; is_active: boolean }>,
  ) =>
    request<AdminUser>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  health: () => request<{ ok: boolean; time: string }>('/api/health'),
  stats: () => request<Stats>('/api/stats'),
  professors: (params?: { q?: string; status?: string; tier?: string; category?: string }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.status) qs.set('status', params.status)
    if (params?.tier) qs.set('tier', params.tier)
    if (params?.category) qs.set('category', params.category)
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<Professor[]>(`/api/professors${suffix}`)
  },
  professor: (id: number) => request<Professor>(`/api/professors/${id}`),
  professorPapers: (id: number) => request<ProfessorPaper[]>(`/api/professors/${id}/papers`),
  drafts: () => request<Draft[]>('/api/drafts'),
  generateDrafts: (payload: { professor_ids?: number[]; limit?: number; user_instructions?: string }) =>
    request<{ ok: boolean; started: number; remaining: number; runs: Array<{
      run_id: number; professor_id: number; professor_name: string; provider: string
    }> }>('/api/draft-generation', { method: 'POST', body: JSON.stringify(payload) }),
  draft: (id: number) => request<Draft>(`/api/drafts/${id}`),
  patchDraft: (id: number, patch: { subject?: string; body?: string; attachment_doc_ids?: number[] | null }) =>
    request<Draft>(`/api/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDraft: (id: number) =>
    fetch(apiUrl(`/api/drafts/${id}`), { method: 'DELETE', credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} · /api/drafts/${id}`)
    }),
  grants: () => request<Grant[]>('/api/grants'),
  batches: (params?: BatchParams) => {
    const qs = new URLSearchParams()
    if (params?.batch_size != null) qs.set('batch_size', String(params.batch_size))
    if (params?.max_per_university != null) qs.set('max_per_university', String(params.max_per_university))
    if (params?.start_date) qs.set('start_date', params.start_date)
    if (params?.weekdays?.length) qs.set('weekdays', params.weekdays.join(','))
    if (params?.tiers?.length) qs.set('tiers', params.tiers.join(','))
    if (params?.categories?.length) qs.set('categories', params.categories.join(','))
    if (params?.universities?.length) qs.set('universities', params.universities.join(','))
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<any>(`/api/batches${suffix}`)
  },
  skipDraft: (id: number) => request<any>(`/api/drafts/${id}/skip`, { method: 'POST' }),
  unskipDraft: (id: number) => request<any>(`/api/drafts/${id}/unskip`, { method: 'POST' }),
  markBatchSent: (draft_ids: number[], send_date?: string) =>
    request<any>('/api/batches/mark-sent', {
      method: 'POST',
      body: JSON.stringify({ draft_ids, send_date, sent_via: 'manual' }),
    }),
  settings: () => request<any>('/api/settings'),
  patchSettings: (payload: Record<string, any>) =>
    request<any>('/api/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
  testGmail: () =>
    request<{ ok: boolean; message: string }>('/api/gmail/test', { method: 'POST' }),
  sendDraft: (id: number) =>
    request<{ draft_id: number; professor_name: string; to: string; subject: string; sent_at: string }>(
      `/api/drafts/${id}/send`, { method: 'POST' }
    ),
  sent: () => request<SentRow[]>('/api/sent'),
  checkReplies: () => request<{ checked: number; new_replies: number; errors: string[] }>(
    '/api/sent/check-replies', { method: 'POST' }
  ),
  draftReplyResponse: (replyId: number, instruction: string) =>
    request<{ id: number; response_draft: string; response_subject: string | null; read_at: string | null }>(
      `/api/replies/${replyId}/draft-response`,
      { method: 'POST', body: JSON.stringify({ instruction }) },
    ),
  patchReply: (replyId: number, patch: {
    read?: boolean; dismissed?: boolean; response_draft?: string; response_subject?: string
  }) =>
    request<SentReply>(`/api/replies/${replyId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  sendReplyResponse: (replyId: number) =>
    request<{ reply_id: number; to: string; subject: string; sent_at: string }>(
      `/api/replies/${replyId}/send-response`, { method: 'POST' },
    ),
  patchProfessor: (id: number, patch: Record<string, any>) =>
    request<Professor>(`/api/professors/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProfessor: (id: number) =>
    fetch(apiUrl(`/api/professors/${id}`), { method: 'DELETE', credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} · /api/professors/${id}`)
    }),
  uploadDraftAttachment: async (draftId: number, file: File): Promise<{
    draft_id: number; uploaded_document: DocumentRow; attachment_doc_ids: number[]
  }> => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(apiUrl(`/api/drafts/${draftId}/upload-attachment`), { method: 'POST', body: fd, credentials: 'include' })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} on attachment upload`)
    return r.json()
  },
  bulkAttachToDrafts: (docIds: number[], target: 'drafting' | 'all' = 'drafting') =>
    request<{ ok: boolean; modified: number; target: string; added_doc_ids: number[] }>(
      '/api/drafts/bulk-attach',
      { method: 'POST', body: JSON.stringify({ doc_ids: docIds, target }) }
    ),
  documents: (kind?: string) => {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    return request<DocumentRow[]>(`/api/documents${qs}`)
  },
  uploadDocument: async (kind: string, file: File, isDefault = false): Promise<DocumentRow> => {
    const fd = new FormData()
    fd.append('kind', kind)
    fd.append('title', file.name)
    fd.append('is_default', isDefault ? 'true' : 'false')
    fd.append('file', file)
    const r = await fetch(apiUrl('/api/documents'), { method: 'POST', body: fd, credentials: 'include' })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} on upload`)
    return r.json() as Promise<DocumentRow>
  },
  setDefaultDocument: (id: number) =>
    request<DocumentRow>(`/api/documents/${id}`, {
      method: 'PATCH', body: JSON.stringify({ is_default: true }),
    }),
  deleteDocument: async (id: number) => {
    const r = await fetch(apiUrl(`/api/documents/${id}`), { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} on delete`)
  },
  calendarEvents: (from?: string, to?: string) => {
    const qs = new URLSearchParams()
    if (from) qs.set('from_date', from)
    if (to) qs.set('to_date', to)
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<CalendarEvent[]>(`/api/calendar/events${suffix}`)
  },
  createCalendarEvent: (payload: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>) =>
    request<CalendarEvent>('/api/calendar/events', { method: 'POST', body: JSON.stringify(payload) }),
  updateCalendarEvent: (id: number, patch: Partial<Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>>) =>
    request<CalendarEvent>(`/api/calendar/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCalendarEvent: async (id: number) => {
    const r = await fetch(apiUrl(`/api/calendar/events/${id}`), { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  },
  activity: (limit = 100) => request<Activity[]>(`/api/activity?limit=${limit}`),
  discoveryCoverage: () => request<DiscoveryCoverage>('/api/discovery/coverage'),
  startDiscoveryRun: (payload: {
    position_type?: string
    target_countries: string | string[]
    target_departments?: string | string[]
    filters?: Record<string, any>
  }) =>
    request<DiscoveryRun>('/api/discovery/runs', { method: 'POST', body: JSON.stringify(payload) }),
  discoveryRun: (id: number) => request<DiscoveryRun>(`/api/discovery/runs/${id}`),
  discoveryUniversities: (id: number) =>
    request<DiscoveryUniversity[]>(`/api/discovery/runs/${id}/universities`),
  discoveryDepartments: (id: number) =>
    request<DiscoveryDepartment[]>(`/api/discovery/runs/${id}/departments`),
  discoveryPages: (id: number) => request<DiscoveryPage[]>(`/api/discovery/runs/${id}/pages`),
  discoveryCandidates: (id: number) =>
    request<DiscoveryCandidate[]>(`/api/discovery/runs/${id}/candidates`),
  promoteDiscoveryCandidate: (id: number) =>
    request<Professor>(`/api/discovery/candidates/${id}/promote`, { method: 'POST' }),
  promoteVerifiedDiscoveryCandidates: (id: number) =>
    request<Professor[]>(`/api/discovery/runs/${id}/promote-verified`, { method: 'POST' }),
  rejectDiscoveryCandidate: (id: number) =>
    request<DiscoveryCandidate>(`/api/discovery/candidates/${id}/reject`, { method: 'POST' }),
  aiRuns: (limit = 100) => request<AIRun[]>(`/api/ai/runs?limit=${limit}`),
  retryAiRun: (id: number, useFallbackProvider = false) =>
    request<AIRun>(`/api/ai/runs/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ use_fallback_provider: useFallbackProvider }),
    }),
  recoverStaleAiRuns: () =>
    request<{ updated: number }>('/api/ai/recover-stale-runs', { method: 'POST' }),
  desktopStatus: () => request<DesktopStatus>('/api/desktop/status'),
  profile: () => request<UserProfile>('/api/profile'),
  patchProfile: (payload: Partial<UserProfile>) =>
    request<UserProfile>('/api/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  // Rich user profile (new endpoints, /api/user)
  user: () => request<UserProfileFull>('/api/user'),
  patchUser: (payload: Partial<UserProfileFull>) =>
    request<UserProfileFull>('/api/user', { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteUserProfileData: () =>
    request<UserProfileFull>('/api/user', { method: 'DELETE' }),
  verifyUserField: (field: string) =>
    request<any>(`/api/user/field/${encodeURIComponent(field)}/verify`, { method: 'POST' }),
  // Repeatable CRUD — generic helpers for each child kind.
  addUserItem: <T,>(kind: 'education' | 'publications' | 'experience' | 'awards' | 'references', payload: any) =>
    request<T>(`/api/user/${kind}`, { method: 'POST', body: JSON.stringify(payload) }),
  patchUserItem: <T,>(kind: 'education' | 'publications' | 'experience' | 'awards' | 'references', id: number, payload: any) =>
    request<T>(`/api/user/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteUserItem: async (kind: 'education' | 'publications' | 'experience' | 'awards' | 'references', id: number) => {
    const r = await fetch(apiUrl(`/api/user/${kind}/${id}`), { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  },
  reorderUserItems: (kind: 'education' | 'publications' | 'experience' | 'awards' | 'references', order: number[]) =>
    request<{ ok: boolean; count: number }>(`/api/user/${kind}/reorder`, { method: 'POST', body: JSON.stringify(order) }),
  extractUserProfile: async (onEvent: (evt: string, data: any) => void) => {
    const r = await fetch(apiUrl('/api/user/extract'), {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream' },
      credentials: 'include',
    })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
    if (!r.body) throw new Error('Profile extraction failed: no response stream')
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += value
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          let evt = ''
          const dataLines: string[] = []
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) evt = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
          }
          if (!evt) continue
          try { onEvent(evt, JSON.parse(dataLines.join('\n') || '{}')) } catch { /* ignore malformed SSE frames */ }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Profile extraction stream disconnected: ${message}`)
    } finally {
      try { reader.releaseLock() } catch {}
    }
  },
  scoreProfessor: (id: number) =>
    request<{ id: number; relevance_score: number; relevance_breakdown: any }>(
      `/api/professors/${id}/score`, { method: 'POST' }
    ),
  scoreAllProfessors: () =>
    request<{ updated: number }>('/api/professors/score-all', { method: 'POST' }),

  listInterviewPreps: () => request<InterviewPrep[]>('/api/interview-prep'),
  getInterviewPrep: (professorId: number) =>
    request<InterviewPrep>(`/api/professors/${professorId}/interview-prep`),
  generateInterviewPrep: (professorId: number, body: {
    meeting_format?: string; meeting_at?: string | null; reply_id?: number | null
  } = {}) =>
    request<InterviewPrep>(`/api/professors/${professorId}/interview-prep`,
      { method: 'POST', body: JSON.stringify(body) }),
  patchInterviewPrep: (prepId: number, patch: Partial<{
    meeting_format: string; meeting_at: string | null; meeting_notes: string
    briefing: Briefing; fit_analysis: FitAnalysis; talking_points: TalkingPoint[]
    likely_questions: LikelyQuestion[]; questions_to_ask: string[]
    logistics: LogisticsItem[]; status: string
  }>) =>
    request<InterviewPrep>(`/api/interview-prep/${prepId}`,
      { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteInterviewPrep: (prepId: number) =>
    request<void>(`/api/interview-prep/${prepId}`, { method: 'DELETE' }),
  startMockInterview: (prepId: number) =>
    request<MockInterview>(`/api/interview-prep/${prepId}/mock/start`, { method: 'POST' }),
  mockInterviewTurn: (mockId: number, answer: string) =>
    request<MockInterview>(`/api/mock/${mockId}/turn`,
      { method: 'POST', body: JSON.stringify({ answer }) }),
  finishMockInterview: (mockId: number) =>
    request<MockInterview>(`/api/mock/${mockId}/finish`, { method: 'POST' }),
}
