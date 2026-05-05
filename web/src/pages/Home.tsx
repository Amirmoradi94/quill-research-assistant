import { useEffect, useState } from 'react'
import { Clock, TrendingUp, MessageCircle } from 'lucide-react'
import { api, type Stats, type Activity } from '@/lib/api'

export function Home() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<Activity[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.stats(), api.activity(8)])
      .then(([s, a]) => {
        setStats(s)
        setActivity(a)
      })
      .catch((e) => setErr(String(e)))
  }, [])

  return (
    <div className="px-8 py-6 max-w-5xl">
      <div className="text-[12px] mb-1" style={{ color: 'var(--color-muted)' }}>
        Home
      </div>
      <h1 className="font-bold tracking-tight mb-5" style={{ fontSize: 32, color: 'var(--color-ink)' }}>
        Good evening, Amir
      </h1>

      {err && (
        <div
          className="mb-4 p-3 rounded text-[13px]"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}
        >
          Backend error: {err}. Make sure the FastAPI server is running on{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>:8000</code>.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Kpi label="Total" value={stats?.total ?? '—'} delta="professors" />
        <Kpi
          label="Sent"
          value={stats?.sent_count ?? '—'}
          delta={
            <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-green-700)' }}>
              <TrendingUp size={12} /> live from /api/stats
            </span>
          }
        />
        <Kpi
          label="Response"
          value={stats ? `${Math.round(stats.response_rate)}%` : '—'}
          delta={`${stats?.pending_followups ?? 0} follow-ups due`}
        />
      </div>

      {/* Follow-ups card */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
            <Clock size={14} style={{ color: 'var(--color-amber-700)' }} />
            {stats?.pending_followups ?? 0} follow-ups due
          </h3>
          <span className="text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
            sent &gt; 14 days ago
          </span>
        </div>
        <div className="text-[13px]" style={{ color: 'var(--color-muted)' }}>
          Detailed list lands when the Professors page is wired up.
        </div>
      </Card>

      {/* Recent activity */}
      <Card className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
            <MessageCircle size={14} style={{ color: 'var(--color-brand-600)' }} />
            Recent activity
          </h3>
          <span className="text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
            last 8 events
          </span>
        </div>
        {activity.length === 0 ? (
          <div className="text-[13px]" style={{ color: 'var(--color-muted)' }}>
            No activity yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {activity.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline gap-2 text-[13px] py-1.5 border-b last:border-b-0"
                style={{ borderColor: 'var(--color-line)' }}
              >
                <span className="font-mono text-[11px] w-20 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                  {new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                <span style={{ color: 'var(--color-ink)' }}>{a.action}</span>
                {a.detail && (
                  <span className="truncate" style={{ color: 'var(--color-muted)' }}>
                    — {a.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ───────── helpers ─────────
function Kpi({ label, value, delta }: { label: string; value: React.ReactNode; delta: React.ReactNode }) {
  return (
    <div
      className="rounded-md border px-4 py-3"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}
    >
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <div className="text-[28px] font-bold leading-tight mt-1" style={{ color: 'var(--color-ink)' }}>
        {value}
      </div>
      <div className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>
        {delta}
      </div>
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-md border px-5 py-4 ${className || ''}`}
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}
    >
      {children}
    </section>
  )
}
