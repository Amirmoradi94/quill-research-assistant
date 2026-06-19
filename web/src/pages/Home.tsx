import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ComponentType, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  SendHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react'
import {
  api,
  type Activity as ActivityRow,
  type CalendarEvent,
  type DocumentRow,
  type Draft,
  type Grant,
  type InterviewPrep,
  type Professor,
  type SentRow,
  type Stats,
  type UserProfile,
  type UserProfileFull,
} from '@/lib/api'
import { formatCategory } from '@/lib/categories'

type IconComponent = ComponentType<{ size?: number; className?: string; style?: CSSProperties }>

const HOME_ACTION_TRANSITION = 'transition-all duration-[400ms] ease-out'
const HOME_VISUAL_TRANSITION = 'transition-[width,background-color,border-color,box-shadow,transform,opacity] duration-[400ms] ease-out'

function isoDate(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function shortDate(value?: string | null) {
  if (!value) return 'No date'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function Home() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [user, setUser] = useState<UserProfileFull | null>(null)
  const [professors, setProfessors] = useState<Professor[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [sent, setSent] = useState<SentRow[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [interviews, setInterviews] = useState<InterviewPrep[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedData, setHasLoadedData] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      api.stats(),
      api.activity(8),
      api.profile(),
      api.user(),
      api.professors(),
      api.drafts(),
      api.sent(),
      api.documents(),
      api.calendarEvents(isoDate(), isoDate(30)),
      api.listInterviewPreps(),
      api.grants(),
    ])

    const [
      statsResult,
      activityResult,
      profileResult,
      userResult,
      professorsResult,
      draftsResult,
      sentResult,
      documentsResult,
      eventsResult,
      interviewsResult,
      grantsResult,
    ] = results

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason))
    const loadedAny = results.some((result) => result.status === 'fulfilled')

    if (statsResult.status === 'fulfilled') setStats(statsResult.value)
    if (activityResult.status === 'fulfilled') setActivity(activityResult.value)
    if (profileResult.status === 'fulfilled') setProfile(profileResult.value)
    if (userResult.status === 'fulfilled') setUser(userResult.value)
    if (professorsResult.status === 'fulfilled') setProfessors(professorsResult.value)
    if (draftsResult.status === 'fulfilled') setDrafts(draftsResult.value)
    if (sentResult.status === 'fulfilled') setSent(sentResult.value)
    if (documentsResult.status === 'fulfilled') setDocuments(documentsResult.value)
    if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value)
    if (interviewsResult.status === 'fulfilled') setInterviews(interviewsResult.value)
    if (grantsResult.status === 'fulfilled') setGrants(grantsResult.value)
    if (loadedAny) setHasLoadedData(true)
    setErrors(failures)
    setLoading(false)
    return failures.length > 0
  }, [])

  useEffect(() => {
    let retryTimer: number | null = null
    let disposed = false
    const refresh = async () => {
      const hadFailures = await load()
      if (!disposed && hadFailures) retryTimer = window.setTimeout(refresh, 1500)
    }
    const onFocus = () => { void load() }

    void refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('quill:data-changed', onFocus)
    return () => {
      disposed = true
      if (retryTimer) window.clearTimeout(retryTimer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('quill:data-changed', onFocus)
    }
  }, [load])

  const replyCount = stats?.reply_count ?? sent.reduce((sum, row) => sum + row.reply_count, 0)
  const sentCount = stats?.sent_count ?? sent.length
  const totalApplications = stats?.total ?? professors.length
  const responseRate = stats?.response_rate ?? (sentCount > 0 ? (replyCount / sentCount) * 100 : 0)
  const interviewCount = stats?.interview_count ?? interviews.filter((prep) => prep.status !== 'archived').length
  const unreadReplies = sent.reduce((sum, row) => sum + row.replies.filter((reply) => !reply.read_at && !reply.dismissed_at).length, 0)
  const followupsDue = stats?.pending_followups ?? sent.filter((row) => (row.days_since_sent ?? 0) >= 14 && row.reply_count === 0).length
  const initialSync = loading && !hasLoadedData
  const backendUnavailable = !loading && errors.length > 0 && !hasLoadedData
  const partialData = errors.length > 0 && hasLoadedData
  const dataUnavailable = initialSync || backendUnavailable
  const statusLabel = initialSync ? 'Starting backend' : backendUnavailable ? 'Backend offline' : partialData ? 'Partial data' : loading ? 'Syncing' : 'Live'
  const statusTone = backendUnavailable ? 'rose' : initialSync || partialData || loading ? 'amber' : 'green'
  const statusMessage = initialSync
    ? 'Quill is connecting to the local backend and loading your application data. Counts will appear once the database responds.'
    : backendUnavailable
      ? 'The local backend is still starting or not reachable. Quill is retrying automatically; use Setup if this does not clear.'
      : partialData
        ? 'Some data sources did not respond. Showing the data that loaded successfully while Quill keeps retrying.'
        : ''

  const statusRows = useMemo(() => {
    if (dataUnavailable) return []
    const counts = stats?.by_status ?? professors.reduce<Record<string, number>>((acc, prof) => {
      const key = prof.status || 'new'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const entries = Object.entries(counts).sort(([, a], [, b]) => b - a)
    return entries.length ? entries.slice(0, 5) : [['No targets loaded', 0] as [string, number]]
  }, [dataUnavailable, professors, stats])

  const upcomingTasks = useMemo(() => {
    const tasks: Array<{ id: string; title: string; detail: string; icon: IconComponent; to: string }> = []
    if (followupsDue > 0) tasks.push({ id: 'followups', title: `${followupsDue} follow-ups due`, detail: 'Sent more than 14 days ago', icon: Clock, to: '/sent' })
    if (drafts.length > 0) tasks.push({ id: 'drafts', title: `${drafts.length} drafts ready`, detail: 'Review and send outreach', icon: Mail, to: '/drafts' })
    if (unreadReplies > 0) tasks.push({ id: 'replies', title: `${unreadReplies} unread replies`, detail: 'Response queue needs review', icon: MessageCircle, to: '/sent' })
    events.slice(0, 2).forEach((event) => tasks.push({ id: `event-${event.id}`, title: event.title, detail: shortDate(event.date), icon: CalendarDays, to: '/calendar' }))
    grants.filter((grant) => grant.deadline).slice(0, 2).forEach((grant) => tasks.push({ id: `grant-${grant.id}`, title: grant.name, detail: `Deadline ${shortDate(grant.deadline)}`, icon: Target, to: '/grants' }))
    return tasks.slice(0, 6)
  }, [drafts.length, events, followupsDue, grants, unreadReplies])

  const recentDocuments = useMemo(
    () => [...documents].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3),
    [documents],
  )

  const upcomingEvents = useMemo(
    () => [...events].sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 3),
    [events],
  )

  const researchTags = [
    ...(user?.research_categories || profile?.research_categories || []),
    ...(user?.methods || []),
    ...(user?.tools_frameworks || []),
  ].filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 8)

  const attentionItems = [
    followupsDue > 0
      ? { id: 'followups', icon: Clock, title: `${followupsDue} follow-ups due`, detail: 'Messages older than 14 days with no reply', to: '/sent' }
      : null,
    unreadReplies > 0
      ? { id: 'replies', icon: MessageCircle, title: `${unreadReplies} unread replies`, detail: 'Inbox needs response review', to: '/sent' }
      : null,
    drafts.length > 0
      ? { id: 'drafts', icon: Mail, title: `${drafts.length} drafts ready`, detail: 'Queue is ready for review and send', to: '/drafts' }
      : null,
  ].filter(Boolean) as Array<{ id: string; icon: IconComponent; title: string; detail: string; to: string }>

  return (
    <div
      className="min-h-full overflow-x-hidden px-5 py-4"
      style={{
        backgroundColor: 'var(--color-paper)',
        backgroundImage:
          'linear-gradient(rgba(28,34,48,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.055) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div className="w-[320px] max-w-full min-w-0 overflow-hidden sm:w-full">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-muted)' }}>
              Dashboard
            </div>
            <h1 className="mt-1 text-[31px] font-bold leading-tight" style={{ color: 'var(--color-ink)' }}>
              Application pipeline
            </h1>
            <p className="mt-1 max-w-3xl text-[14px] leading-6" style={{ color: 'var(--color-muted)' }}>
              {dataUnavailable
                ? 'Connecting to the local backend and loading your application pipeline.'
                : `${sentCount} professors contacted, ${replyCount} replies, ${interviewCount} interview${interviewCount === 1 ? '' : 's'}, and ${drafts.length} drafts still in queue.`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusChip label={statusLabel} tone={statusTone} busy={loading || initialSync} />
            <LinkButton to="/drafts" icon={Mail}>Review drafts</LinkButton>
            <LinkButton to="/discover" icon={Sparkles}>Discover</LinkButton>
          </div>
        </div>

        {statusMessage && (
          <section
            className="mb-3 rounded-md border px-3 py-3"
            style={{
              background: backendUnavailable ? 'var(--color-rose-50)' : 'var(--color-amber-50)',
              borderColor: backendUnavailable ? 'var(--color-rose-200)' : 'var(--color-amber-200)',
              color: backendUnavailable ? 'var(--color-rose-700)' : 'var(--color-amber-700)',
            }}
          >
            <div className="flex items-start gap-2">
              {backendUnavailable ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />}
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{statusLabel}</div>
                <div className="mt-0.5 text-[12px] leading-5">{statusMessage}</div>
              </div>
            </div>
          </section>
        )}

        {attentionItems.length > 0 && (
          <section className="mb-3 rounded-md border px-3 py-3"
            style={{ background: 'color-mix(in srgb, var(--color-amber-50) 78%, var(--color-white))', borderColor: 'var(--color-amber-200)' }}>
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-amber-700)' }}>
              Needs Attention
            </div>
            <div className="grid gap-2 lg:grid-cols-3">
              {attentionItems.map((item) => {
                const Icon = item.icon
                return (
                  <Link key={item.id} to={item.to}
                    className={`rounded-md border px-3 py-2.5 hover:bg-[color:var(--color-white)] hover:shadow-[0_4px_14px_rgba(28,34,48,0.06)] ${HOME_ACTION_TRANSITION}`}
                    style={{ background: 'rgba(255,255,255,0.62)', borderColor: 'var(--color-amber-200)' }}>
                    <div className="flex items-start gap-2">
                      <Icon size={15} style={{ color: 'var(--color-amber-700)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>{item.title}</div>
                        <div className="mt-0.5 text-[12px] leading-5" style={{ color: 'var(--color-muted)' }}>{item.detail}</div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        <section
          className="grid gap-3 mb-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}
        >
          <KpiCard
            title="Total Targets"
            value={dataUnavailable ? null : totalApplications}
            detail={dataUnavailable ? 'Loading application data' : `${sentCount} sent · ${drafts.length} drafting`}
            trend="up"
            loading={dataUnavailable}
          />
          <KpiCard
            title="Sent Outreach"
            value={dataUnavailable ? null : sentCount}
            detail={dataUnavailable ? 'Waiting for backend response' : `${Math.round(responseRate)}% response rate`}
            trend="flat"
            loading={dataUnavailable}
          />
          <KpiCard
            title="Replies Received"
            value={dataUnavailable ? null : replyCount}
            detail={dataUnavailable ? 'Inbox summary not loaded yet' : `${unreadReplies} unread right now`}
            trend="flat"
            loading={dataUnavailable}
          />
          <KpiCard
            title="Follow-ups Due"
            value={dataUnavailable ? null : followupsDue}
            detail={dataUnavailable ? 'Calendar data not loaded yet' : events.length ? `Next interview ${shortDate(events[0]?.date)}` : 'No interview date scheduled'}
            trend="step"
            loading={dataUnavailable}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.04fr)_minmax(320px,0.96fr)] gap-3 mb-3 items-start">
          <Panel>
            <SectionTitle icon={SendHorizontal} title="Application Status Overview" action={<LinkText to="/professors">Open</LinkText>} />
            <div className="px-3 pb-3 overflow-x-auto">
              <div className="w-full min-w-0 grid grid-cols-[minmax(0,1fr)_44px_44px] sm:grid-cols-[minmax(0,1fr)_46px_46px_64px] gap-2 px-2 py-2 text-[10px] sm:text-[11px] uppercase tracking-[0.08em] border-b" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-line)' }}>
                <span>Status</span>
                <span>Count</span>
                <span>Share</span>
                <span className="hidden sm:block">Progress</span>
              </div>
              {dataUnavailable ? (
                <LoadingLine text={backendUnavailable ? 'Waiting for the local backend to come online.' : 'Connecting to the local backend.'} />
              ) : statusRows.map(([status, count]) => {
                const share = totalApplications > 0 ? Math.round((count / totalApplications) * 100) : 0
                return (
                  <div key={status} className="w-full min-w-0 grid grid-cols-[minmax(0,1fr)_44px_44px] sm:grid-cols-[minmax(0,1fr)_46px_46px_64px] gap-2 items-center px-2 py-3 text-[13px] border-b last:border-b-0" style={{ borderColor: 'var(--color-line)' }}>
                    <span className="font-medium truncate" style={{ color: 'var(--color-ink)' }}>{formatStatusLabel(status)}</span>
                    <span className="font-mono" style={{ color: 'var(--color-ink)' }}>{count}</span>
                    <span className="font-mono" style={{ color: 'var(--color-muted)' }}>{share}%</span>
                    <div className="hidden sm:block">
                      <Progress value={share} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          <div className="grid gap-3">
            <Panel>
              <SectionTitle icon={Target} title="Action Queue" action={<LinkText to="/sent">Review</LinkText>} />
              <div className="px-3 py-3 grid gap-2">
                {dataUnavailable ? (
                  <LoadingLine text="Action queue will appear after the backend responds." compact />
                ) : upcomingTasks.length > 0 ? upcomingTasks.slice(0, 4).map((task) => {
                  const Icon = task.icon
                  return (
                    <Link key={task.id} to={task.to}
                      className={`rounded-md border px-3 py-2.5 hover:bg-[color:var(--color-paper)] hover:shadow-[0_4px_14px_rgba(28,34,48,0.05)] ${HOME_ACTION_TRANSITION}`}
                      style={{ borderColor: 'var(--color-line)', background: 'color-mix(in srgb, var(--color-white) 96%, var(--color-paper))' }}>
                      <div className="flex items-start gap-2">
                        <Icon size={14} style={{ color: 'var(--color-brand-700)' }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>{task.title}</div>
                          <div className="mt-0.5 text-[12px] leading-5" style={{ color: 'var(--color-muted)' }}>{task.detail}</div>
                        </div>
                      </div>
                    </Link>
                  )
                }) : (
                  <EmptyLine text="No urgent tasks." compact />
                )}
              </div>
            </Panel>

            <Panel>
              <SectionTitle icon={Activity} title="Recent Activity" action={<span className="font-mono text-[11px]">live</span>} />
              <div className="px-3 pb-3">
                {activity.slice(0, 5).map((row) => (
                  <div key={row.id} className="grid grid-cols-[58px_1fr] gap-3 px-2 py-2.5 text-[12px] border-b" style={{ borderColor: 'var(--color-line)' }}>
                    <span className="font-mono" style={{ color: 'var(--color-muted)' }}>{shortDate(row.created_at)}</span>
                    <span className="line-clamp-2 leading-5" style={{ color: 'var(--color-ink)' }}>{row.action}{row.detail ? ` · ${row.detail}` : ''}</span>
                  </div>
                ))}
                {dataUnavailable ? <LoadingLine text="Recent activity is loading." /> : activity.length === 0 && <EmptyLine text="No recent activity yet." />}
              </div>
            </Panel>
          </div>
        </section>

        <section
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}
        >
          <SmallPanel icon={Users} title="Priority Matches" to="/professors">
            {dataUnavailable ? <LoadingLine text="Professor targets are loading." compact /> : professors.slice(0, 4).length > 0 ? professors.slice(0, 4).map((prof) => (
              <ListLine key={prof.id} title={prof.name} meta={[prof.university, formatStatusLabel(prof.status || 'new')].filter(Boolean).join(' · ')} />
            )) : <EmptyLine text="No targets loaded." compact />}
          </SmallPanel>

          <SmallPanel icon={CalendarDays} title="Upcoming Dates" to="/calendar">
            {dataUnavailable ? <LoadingLine text="Calendar is loading." compact /> : upcomingEvents.length > 0 ? upcomingEvents.map((event) => (
              <ListLine key={event.id} title={event.title} meta={shortDate(event.date)} />
            )) : <EmptyLine text="No upcoming dates." compact />}
          </SmallPanel>

          <SmallPanel icon={FileText} title="Documents" to="/documents">
            {dataUnavailable ? <LoadingLine text="Documents are loading." compact /> : recentDocuments.length > 0 ? recentDocuments.map((doc) => (
              <ListLine key={doc.id} title={doc.title || doc.filename} meta={`${formatStatusLabel(doc.kind)}${doc.is_default ? ' · Default' : ''}`} />
            )) : <EmptyLine text="No documents loaded." compact />}
          </SmallPanel>

          <SmallPanel icon={CheckCircle2} title="Profile Signals" to="/profile">
            {dataUnavailable ? (
              <LoadingLine text="Profile signals are loading." compact />
            ) : (
              <>
                <ListLine title={user?.name || profile?.name || 'Amir Moradi'} meta={user?.headline || profile?.current_role || 'Research candidate'} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {researchTags.length > 0 ? researchTags.slice(0, 5).map((tag) => (
                    <span key={tag} className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'var(--color-ink)', color: 'white' }}>
                      {formatCategory(tag)}
                    </span>
                  )) : (
                    <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Add profile tags.</span>
                  )}
                </div>
              </>
            )}
          </SmallPanel>
        </section>
      </div>
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section
      className={`rounded-md border shadow-[0_1px_2px_rgba(28,34,48,0.03)] ${HOME_VISUAL_TRANSITION}`}
      style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line-strong)' }}
    >
      {children}
    </section>
  )
}

function SectionTitle({ icon: Icon, title, action }: { icon: IconComponent; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'var(--color-line)' }}>
      <div className="inline-flex items-center gap-2 min-w-0">
        <Icon size={14} style={{ color: 'var(--color-ink)' }} />
        <h3 className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-ink)' }}>{title}</h3>
      </div>
      {action && <div className="text-[12px] shrink-0">{action}</div>}
    </div>
  )
}

function KpiCard({ title, value, detail, trend, loading = false }: {
  title: string
  value: ReactNode
  detail: string
  trend: 'up' | 'flat' | 'step'
  loading?: boolean
}) {
  return (
    <Panel>
      <div className="p-4 min-h-[112px]">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</div>
        <div className="flex items-end justify-between gap-3 mt-2">
          <div className="text-[36px] font-bold leading-none" style={{ color: 'var(--color-ink)' }}>
            {loading ? <LoadingDots /> : value}
          </div>
          {loading ? <div className="h-[34px] w-[70px] rounded-sm opacity-70" style={{ background: 'var(--color-paper-2)' }} /> : <SparkLine trend={trend} />}
        </div>
        <div className="mt-2 text-[12px]" style={{ color: 'var(--color-muted)' }}>{detail}</div>
      </div>
    </Panel>
  )
}

function SparkLine({ trend }: { trend: 'up' | 'flat' | 'step' }) {
  const points = trend === 'up' ? '0,28 18,21 33,18 49,11 68,6' : trend === 'flat' ? '0,18 18,18 33,18 49,17 68,17' : '0,29 18,29 18,18 42,18 42,7 68,7'
  return (
    <svg width="70" height="34" viewBox="0 0 70 34" aria-hidden="true" className={HOME_VISUAL_TRANSITION}>
      <polyline points={points} fill="none" stroke="var(--color-ink)" strokeWidth="2" className={HOME_VISUAL_TRANSITION} />
    </svg>
  )
}

function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 rounded-full overflow-hidden border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <div className={`h-full ${HOME_VISUAL_TRANSITION}`} style={{ width: `${Math.max(4, Math.min(100, value))}%`, background: 'var(--color-brand-700)' }} />
    </div>
  )
}

function SmallPanel({ icon, title, to, children }: { icon: IconComponent; title: string; to: string; children: ReactNode }) {
  return (
    <Panel>
      <SectionTitle icon={icon} title={title} action={<LinkText to={to}>Open</LinkText>} />
      <div className="px-3 py-2.5">{children}</div>
    </Panel>
  )
}

function ListLine({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-line)' }}>
      <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-ink)' }}>{title}</div>
      <div className="text-[12px] truncate" style={{ color: 'var(--color-muted)' }}>{meta || 'No metadata'}</div>
    </div>
  )
}

function EmptyLine({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`${compact ? 'py-1' : 'px-2 py-3'} text-[12px]`} style={{ color: 'var(--color-muted)' }}>{text}</div>
}

function LoadingLine({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`${compact ? 'py-1' : 'px-2 py-3'} flex items-center gap-2 text-[12px]`} style={{ color: 'var(--color-muted)' }}>
      <Loader2 size={13} className="animate-spin" />
      <span>{text}</span>
    </div>
  )
}

function LoadingDots() {
  return (
    <span className="inline-flex h-9 items-end gap-1 pb-1" aria-label="Loading">
      {[0, 1, 2].map((item) => (
        <span
          key={item}
          className="h-2 w-2 animate-pulse rounded-full"
          style={{ background: 'var(--color-muted)', animationDelay: `${item * 120}ms` }}
        />
      ))}
    </span>
  )
}

function LinkText({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-1 font-semibold hover:underline ${HOME_ACTION_TRANSITION}`} style={{ color: 'var(--color-brand-700)' }}>
      {children}
      <ArrowRight size={12} />
    </Link>
  )
}

function LinkButton({ to, icon: Icon, children }: { to: string; icon: IconComponent; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[13px] font-medium hover:bg-[color:var(--color-paper)] hover:shadow-[0_4px_14px_rgba(28,34,48,0.05)] ${HOME_ACTION_TRANSITION}`}
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line-strong)', color: 'var(--color-ink)' }}
    >
      <Icon size={13} />
      {children}
    </Link>
  )
}

function StatusChip({ label, tone, busy = false }: { label: string; tone: 'green' | 'amber' | 'rose'; busy?: boolean }) {
  const color = tone === 'green' ? 'var(--color-green-700)' : tone === 'rose' ? 'var(--color-rose-700)' : 'var(--color-amber-700)'
  const background = tone === 'green' ? 'var(--color-green-50)' : tone === 'rose' ? 'var(--color-rose-50)' : 'var(--color-amber-50)'
  const Icon = tone === 'rose' ? AlertCircle : busy ? Loader2 : TrendingUp
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[13px] font-medium" style={{ background, borderColor: 'var(--color-line)', color }}>
      <Icon size={12} className={busy ? 'animate-spin' : ''} />
      {label}
    </span>
  )
}
