// Tiny typed fetch wrapper. The Vite dev server proxies /api/* to :8000.

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
  match_score?: number | null
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText} — ${path}`)
  }
  return r.json() as Promise<T>
}

export const api = {
  health: () => request<{ ok: boolean; time: string }>('/api/health'),
  stats: () => request<Stats>('/api/stats'),
  professors: (params?: { limit?: number; q?: string; status?: string; tier?: string }) => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.q) qs.set('q', params.q)
    if (params?.status) qs.set('status', params.status)
    if (params?.tier) qs.set('tier', params.tier)
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<Professor[]>(`/api/professors${suffix}`)
  },
  activity: (limit = 100) => request<Activity[]>(`/api/activity?limit=${limit}`),
}
