import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Activity } from '@/lib/api'

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function actionColor(action: string): string {
  const a = action.toLowerCase()
  if (a.includes('sent') || a.includes('mark')) return 'var(--color-green-700)'
  if (a.includes('draft')) return 'var(--color-brand-600)'
  if (a.includes('reply') || a.includes('interview')) return 'var(--color-amber-600)'
  if (a.includes('reject') || a.includes('error')) return 'var(--color-rose-700)'
  return 'var(--color-muted)'
}

function groupByDate(items: Activity[]): Record<string, Activity[]> {
  const groups: Record<string, Activity[]> = {}
  for (const item of items) {
    const key = item.date || item.created_at.slice(0, 10)
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return groups
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

export function ActivityPage() {
  const [activity, setActivity] = useState<Activity[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = () => api.activity(200).then(setActivity).catch((e) => setErr(String(e)))

  useEffect(() => {
    load()
    window.addEventListener('quill:data-changed', load)
    return () => window.removeEventListener('quill:data-changed', load)
  }, [])

  const grouped = groupByDate(activity)
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="px-8 py-6 max-w-3xl">
      <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>Home / Activity</div>
      <div className="flex items-baseline justify-between mb-5">
        <h1 className="font-bold tracking-tight" style={{ fontSize: 36, color: 'var(--color-ink)' }}>
          Activity
        </h1>
        <span className="text-[13px] font-mono" style={{ color: 'var(--color-muted)' }}>
          {activity.length} events
        </span>
      </div>

      {err && (
        <div className="mb-4 p-3 rounded text-[14px]"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>{err}</div>
      )}

      {activity.length === 0 && !err && (
        <div className="rounded-md border px-4 py-10 text-center text-[14px]"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
          No activity yet. Start by accepting professors and drafting emails.
        </div>
      )}

      <div className="flex flex-col gap-6">
        {dates.map((date) => (
          <div key={date}>
            <div className="text-[12px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--color-muted)' }}>
              {formatDate(date)}
            </div>
            <div className="rounded-md border overflow-hidden"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
              {grouped[date].map((item) => (
                <div key={item.id} className="px-4 py-2.5 border-b last:border-b-0 flex items-baseline gap-3"
                  style={{ borderColor: 'var(--color-line)' }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                    style={{ background: actionColor(item.action) }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[14px]" style={{ color: 'var(--color-ink)' }}>
                      {item.action}
                    </span>
                    {item.detail && (
                      <span className="ml-1.5 text-[13px]" style={{ color: 'var(--color-muted)' }}>
                        {item.detail}
                      </span>
                    )}
                    {item.professor_id && (
                      <Link to={`/professors/${item.professor_id}`}
                        className="ml-1.5 text-[12px]"
                        style={{ color: 'var(--color-brand-600)' }}>
                        view →
                      </Link>
                    )}
                  </div>
                  <span className="text-[12px] font-mono flex-shrink-0" style={{ color: 'var(--color-muted-2)' }}>
                    {relativeTime(item.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
