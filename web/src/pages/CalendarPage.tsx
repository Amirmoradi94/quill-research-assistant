import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, CalendarDays, List,
  ExternalLink, Banknote, Plus, X, Trash2, Pencil,
} from 'lucide-react'
import { api, type Grant, type CalendarEvent } from '@/lib/api'
import { useConfirm } from '@/components/ConfirmDialog'

// ─── helpers ───────────────────────────────────────────────────────

function parseDate(s?: string | null): Date | null {
  if (!s) return null
  const m = s.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? new Date(m[1] + 'T12:00:00') : null
}

function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

function urgencyColor(days: number): string {
  if (days < 0)   return 'var(--color-muted-2)'
  if (days <= 14) return 'var(--color-rose-700)'
  if (days <= 60) return 'var(--color-amber-600)'
  return 'var(--color-green-700)'
}

function urgencyBg(days: number): string {
  if (days < 0)   return 'var(--color-paper-2)'
  if (days <= 14) return 'var(--color-rose-50)'
  if (days <= 60) return '#fff8ed'
  return '#f0fdf4'
}

function formatDeadline(s: string): string {
  const d = parseDate(s)
  if (!d) return s
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const KIND_COLORS: Record<string, string> = {
  event:    'var(--color-brand-600)',
  meeting:  '#7c3aed',
  reminder: 'var(--color-amber-600)',
  deadline: 'var(--color-rose-700)',
}
const KIND_BG: Record<string, string> = {
  event:    'var(--color-brand-50)',
  meeting:  '#f5f3ff',
  reminder: '#fff8ed',
  deadline: 'var(--color-rose-50)',
}

function kindColor(kind: string, customColor?: string | null) {
  return customColor || KIND_COLORS[kind] || KIND_COLORS.event
}
function kindBg(kind: string) { return KIND_BG[kind] || KIND_BG.event }

const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function buildGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const startOffset = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── modal ─────────────────────────────────────────────────────────

type ModalState =
  | { mode: 'create'; date: string }
  | { mode: 'edit'; event: CalendarEvent }
  | null

const KINDS = ['event', 'meeting', 'reminder', 'deadline'] as const
const KIND_LABELS: Record<string, string> = {
  event: 'Event', meeting: 'Meeting', reminder: 'Reminder', deadline: 'Deadline',
}

function EventModal({ state, onClose, onSaved }: {
  state: ModalState
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = state?.mode === 'edit'
  const initial = isEdit ? state.event : null

  const [title, setTitle] = useState(initial?.title ?? '')
  const [date, setDate] = useState(initial?.date ?? (state?.mode === 'create' ? state.date : ''))
  const [time, setTime] = useState(initial?.time ?? '')
  const [endTime, setEndTime] = useState(initial?.end_time ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [kind, setKind] = useState<string>(initial?.kind ?? 'event')
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  // close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const submit = async () => {
    if (!title.trim() || !date || saving) return
    setSaving(true)
    try {
      const payload = {
        title: title.trim(), date, kind,
        time: time || null, end_time: endTime || null,
        description: desc || null, all_day: !time,
      }
      if (isEdit) {
        await api.updateCalendarEvent(state.event.id, payload)
      } else {
        await api.createCalendarEvent(payload as any)
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!state) return null

  const accentColor = kindColor(kind)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="w-full max-w-md mx-4 rounded-xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-white)' }}>

        {/* color accent bar */}
        <div className="h-1" style={{ background: accentColor }} />

        {/* header */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between">
          <span className="text-[16px] font-semibold" style={{ color: 'var(--color-ink)' }}>
            {isEdit ? 'Edit event' : 'New event'}
          </span>
          <button onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[color:var(--color-paper-2)] transition-colors">
            <X size={15} style={{ color: 'var(--color-muted)' }} />
          </button>
        </div>

        <div className="px-6 pb-6 flex flex-col gap-4">
          {/* kind selector */}
          <div className="flex gap-2">
            {KINDS.map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className="flex-1 py-1.5 rounded-md text-[12px] font-medium border transition-all"
                style={kind === k ? {
                  background: kindBg(k), borderColor: kindColor(k),
                  color: kindColor(k),
                } : {
                  background: 'var(--color-paper-2)', borderColor: 'var(--color-line)',
                  color: 'var(--color-muted)',
                }}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>

          {/* title */}
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="Event title"
            className="w-full px-3 py-2.5 rounded-lg border text-[15px] outline-none transition-colors"
            style={{
              background: 'var(--color-paper)', borderColor: 'var(--color-line)',
              color: 'var(--color-ink)',
            }}
          />

          {/* date + time row */}
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[11px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--color-muted)' }}>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2 rounded-lg border text-[13px] outline-none"
                style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
            </div>
            <div className="flex flex-col gap-1 w-24">
              <label className="text-[11px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--color-muted)' }}>Start</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="px-3 py-2 rounded-lg border text-[13px] outline-none"
                style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
            </div>
            <div className="flex flex-col gap-1 w-24">
              <label className="text-[11px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--color-muted)' }}>End</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="px-3 py-2 rounded-lg border text-[13px] outline-none"
                style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }} />
            </div>
          </div>

          {/* description */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: 'var(--color-muted)' }}>Notes</label>
            <textarea
              value={desc} onChange={(e) => setDesc(e.target.value)}
              rows={3} placeholder="Optional notes or details…"
              className="w-full px-3 py-2 rounded-lg border text-[13px] outline-none font-sans resize-none"
              style={{
                background: 'var(--color-paper)', borderColor: 'var(--color-line)',
                color: 'var(--color-ink)', lineHeight: 1.5,
              }}
            />
          </div>

          {/* actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={!title.trim() || !date || saving}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-opacity"
              style={{
                background: accentColor, color: 'white',
                opacity: (!title.trim() || !date || saving) ? 0.45 : 1,
              }}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add event'}
            </button>
            <button onClick={onClose}
              className="px-5 py-2.5 rounded-lg text-[13px] border transition-colors"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)',
                background: 'var(--color-paper-2)' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── right panel states ────────────────────────────────────────────

type PanelState =
  | { kind: 'idle' }
  | { kind: 'grant'; grant: Grant; date: Date }
  | { kind: 'event'; event: CalendarEvent }

type Tab = 'calendar' | 'table'

// ─── main page ─────────────────────────────────────────────────────

export function CalendarPage() {
  const confirm = useConfirm()
  const [grants, setGrants] = useState<Grant[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('calendar')
  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [modal, setModal] = useState<ModalState>(null)

  const load = () => {
    api.grants().then(setGrants).catch((e) => setErr(String(e)))
    api.calendarEvents().then(setEvents).catch(() => {})
  }

  useEffect(() => {
    load()
    window.addEventListener('quill:data-changed', load)
    return () => window.removeEventListener('quill:data-changed', load)
  }, [])

  const withDate = useMemo(() =>
    grants.map((g) => ({ grant: g, date: parseDate(g.deadline) }))
      .filter((x) => x.date !== null) as { grant: Grant; date: Date }[], [grants])

  const rolling = useMemo(() => grants.filter((g) => !parseDate(g.deadline)), [grants])
  const upcoming = useMemo(() =>
    withDate.filter((x) => daysUntil(x.date) >= 0).sort((a, b) => a.date.getTime() - b.date.getTime()), [withDate])
  const past = useMemo(() =>
    withDate.filter((x) => daysUntil(x.date) < 0).sort((a, b) => b.date.getTime() - a.date.getTime()), [withDate])

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const grid = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const grantsOnDay = (d: Date) => withDate.filter((x) => isSameDay(x.date, d))
  const eventsOnDay = (d: Date) => events.filter((e) => { const ed = parseDate(e.date); return ed && isSameDay(ed, d) })

  const upcomingEventCount = events.filter(e => { const d = parseDate(e.date); return d && daysUntil(d) >= 0 }).length

  return (
    <>
      <div className="px-8 py-6">
        <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>Home / Calendar</div>

        <div className="flex items-center justify-between mb-5">
          <h1 className="font-bold tracking-tight" style={{ fontSize: 36, color: 'var(--color-ink)' }}>
            Calendar
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-mono" style={{ color: 'var(--color-muted)' }}>
              {upcoming.length} grants · {upcomingEventCount} events
            </span>
            <button
              onClick={() => setModal({ mode: 'create', date: toISODate(today) })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium"
              style={{ background: 'var(--color-brand-600)', color: 'white' }}>
              <Plus size={13} /> New event
            </button>
            <div className="flex rounded-md border overflow-hidden text-[13px]"
              style={{ borderColor: 'var(--color-line)' }}>
              <button onClick={() => setTab('calendar')}
                className="px-3 py-1.5 flex items-center gap-1.5"
                style={{ background: tab === 'calendar' ? 'var(--color-ink)' : 'var(--color-white)',
                  color: tab === 'calendar' ? 'white' : 'var(--color-muted)' }}>
                <CalendarDays size={13} /> Calendar
              </button>
              <button onClick={() => setTab('table')}
                className="px-3 py-1.5 flex items-center gap-1.5 border-l"
                style={{ borderColor: 'var(--color-line)',
                  background: tab === 'table' ? 'var(--color-ink)' : 'var(--color-white)',
                  color: tab === 'table' ? 'white' : 'var(--color-muted)' }}>
                <List size={13} /> Table
              </button>
            </div>
          </div>
        </div>

        {err && (
          <div className="mb-4 p-3 rounded text-[14px]"
            style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>{err}</div>
        )}

        {tab === 'calendar' ? (
          <CalendarView
            grid={grid} viewYear={viewYear} viewMonth={viewMonth} today={today}
            grantsOnDay={grantsOnDay} eventsOnDay={eventsOnDay}
            rolling={rolling} upcoming={upcoming}
            onPrev={prevMonth} onNext={nextMonth}
            onAddEvent={(date) => setModal({ mode: 'create', date })}
            onEditEvent={(event) => setModal({ mode: 'edit', event })}
            onDeleteEvent={async (id) => {
              const ev = events.find((e) => e.id === id)
              const ok = await confirm({
                title: 'Delete this event?',
                detail: ev?.title,
                message: 'It will be removed from the calendar permanently.',
              })
              if (ok) { await api.deleteCalendarEvent(id); load() }
            }}
          />
        ) : (
          <TableView
            upcoming={upcoming} past={past} rolling={rolling} events={events}
            onAddEvent={() => setModal({ mode: 'create', date: toISODate(today) })}
            onEditEvent={(event) => setModal({ mode: 'edit', event })}
            onDeleteEvent={async (id) => {
              const ev = events.find((e) => e.id === id)
              const ok = await confirm({
                title: 'Delete this event?',
                detail: ev?.title,
                message: 'It will be removed from the calendar permanently.',
              })
              if (ok) { await api.deleteCalendarEvent(id); load() }
            }}
          />
        )}
      </div>

      {modal && (
        <EventModal
          state={modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </>
  )
}

// ─── Calendar grid ──────────────────────────────────────────────────

type CalendarViewProps = {
  grid: (Date | null)[]
  viewYear: number; viewMonth: number; today: Date
  grantsOnDay: (d: Date) => { grant: Grant; date: Date }[]
  eventsOnDay: (d: Date) => CalendarEvent[]
  rolling: Grant[]; upcoming: { grant: Grant; date: Date }[]
  onPrev: () => void; onNext: () => void
  onAddEvent: (date: string) => void
  onEditEvent: (event: CalendarEvent) => void
  onDeleteEvent: (id: number) => void
}

function CalendarView(props: CalendarViewProps) {
  const { grid, viewYear, viewMonth, today, grantsOnDay, eventsOnDay,
    rolling, upcoming, onPrev, onNext, onAddEvent, onEditEvent, onDeleteEvent } = props
  const [panel, setPanel] = useState<PanelState>({ kind: 'idle' })

  return (
    <div className="flex gap-5">
      {/* Grid */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onPrev} className="p-1.5 rounded hover:bg-[color:var(--color-paper-2)]">
            <ChevronLeft size={16} style={{ color: 'var(--color-ink)' }} />
          </button>
          <span className="font-semibold text-[16px]" style={{ color: 'var(--color-ink)' }}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button onClick={onNext} className="p-1.5 rounded hover:bg-[color:var(--color-paper-2)]">
            <ChevronRight size={16} style={{ color: 'var(--color-ink)' }} />
          </button>
        </div>

        <div className="rounded-lg border overflow-hidden"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
          <div className="grid grid-cols-7 border-b" style={{ borderColor: 'var(--color-line)' }}>
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-muted)' }}>{d}</div>
            ))}
          </div>
          {Array.from({ length: grid.length / 7 }, (_, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b last:border-b-0"
              style={{ borderColor: 'var(--color-line)' }}>
              {grid.slice(wi * 7, wi * 7 + 7).map((day, di) => {
                const isToday = day ? isSameDay(day, today) : false
                const dayGrants = day ? grantsOnDay(day) : []
                const dayEvents = day ? eventsOnDay(day) : []
                return (
                  <DayCell key={di} day={day} isToday={isToday} viewMonth={viewMonth}
                    grants={dayGrants} events={dayEvents}
                    onAdd={() => day && onAddEvent(toISODate(day))}
                    onSelectGrant={(g, d) => setPanel({ kind: 'grant', grant: g, date: d })}
                    onSelectEvent={(ev) => setPanel({ kind: 'event', event: ev })}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="w-60 flex-shrink-0 flex flex-col gap-3">
        {panel.kind === 'grant' && (
          <GrantCard item={{ grant: panel.grant, date: panel.date }}
            onClose={() => setPanel({ kind: 'idle' })} />
        )}
        {panel.kind === 'event' && (
          <EventCard event={panel.event}
            onEdit={() => { onEditEvent(panel.event); setPanel({ kind: 'idle' }) }}
            onDelete={async () => { await onDeleteEvent(panel.event.id); setPanel({ kind: 'idle' }) }}
            onClose={() => setPanel({ kind: 'idle' })}
          />
        )}
        {panel.kind === 'idle' && (
          <SidebarUpcoming upcoming={upcoming} rolling={rolling}
            onSelect={(g, d) => setPanel({ kind: 'grant', grant: g, date: d })} />
        )}
      </div>
    </div>
  )
}

// ─── Day cell ───────────────────────────────────────────────────────

function DayCell({ day, isToday, viewMonth, grants, events, onAdd, onSelectGrant, onSelectEvent }: {
  day: Date | null; isToday: boolean; viewMonth: number
  grants: { grant: Grant; date: Date }[]
  events: CalendarEvent[]
  onAdd: () => void
  onSelectGrant: (g: Grant, d: Date) => void
  onSelectEvent: (e: CalendarEvent) => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="min-h-[88px] p-1.5 border-r last:border-r-0 relative group"
      style={{
        borderColor: 'var(--color-line)',
        background: isToday ? 'var(--color-brand-50)' : day ? 'transparent' : 'var(--color-paper)',
      }}>
      {day && (
        <>
          <div className="flex items-center justify-between mb-1">
            <div className={`text-[12px] font-mono w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'font-bold' : ''}`}
              style={{
                color: isToday ? 'white'
                  : day.getMonth() !== viewMonth ? 'var(--color-muted-2)'
                  : 'var(--color-ink-soft)',
                background: isToday ? 'var(--color-brand-500)' : 'transparent',
              }}>
              {day.getDate()}
            </div>
            {hovered && (
              <button onClick={onAdd}
                className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                style={{ background: 'var(--color-brand-100)', color: 'var(--color-brand-600)' }}>
                <Plus size={11} />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {grants.map(({ grant, date: gd }) => {
              const days = daysUntil(gd)
              return (
                <button key={`g-${grant.id}`}
                  onClick={() => onSelectGrant(grant, gd)}
                  className="w-full text-left rounded px-1 py-0.5 text-[10px] leading-tight truncate font-medium"
                  style={{ background: urgencyBg(days), color: urgencyColor(days) }}>
                  {grant.name}
                </button>
              )
            })}
            {events.map((ev) => (
              <button key={`e-${ev.id}`}
                onClick={() => onSelectEvent(ev)}
                className="w-full text-left rounded px-1 py-0.5 text-[10px] leading-tight truncate font-medium"
                style={{ background: kindBg(ev.kind), color: kindColor(ev.kind, ev.color) }}>
                {ev.time ? `${ev.time.slice(0,5)} ` : ''}{ev.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Sidebar panels ────────────────────────────────────────────────

function SidebarUpcoming({ upcoming, rolling, onSelect }: {
  upcoming: { grant: Grant; date: Date }[]
  rolling: Grant[]
  onSelect: (g: Grant, d: Date) => void
}) {
  return (
    <>
      <div className="text-[12px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--color-muted)' }}>Next deadlines</div>
      <div className="flex flex-col gap-2">
        {upcoming.slice(0, 6).map(({ grant, date }) => {
          const days = daysUntil(date)
          return (
            <div key={grant.id} onClick={() => onSelect(grant, date)}
              className="rounded-md border px-3 py-2.5 cursor-pointer"
              style={{ background: urgencyBg(days), borderColor: 'var(--color-line)' }}>
              <div className="font-medium text-[13px] leading-tight" style={{ color: 'var(--color-ink)' }}>
                {grant.name}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] font-mono" style={{ color: urgencyColor(days) }}>
                  {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days}d`}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>
          )
        })}
        {upcoming.length === 0 && (
          <div className="text-[13px]" style={{ color: 'var(--color-muted)' }}>No upcoming deadlines.</div>
        )}
      </div>
      {rolling.length > 0 && (
        <>
          <div className="text-[12px] font-semibold uppercase tracking-wider mt-1"
            style={{ color: 'var(--color-muted)' }}>Rolling</div>
          <div className="flex flex-col gap-1.5">
            {rolling.map((g) => (
              <div key={g.id} className="rounded-md border px-3 py-2"
                style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
                <div className="text-[13px] font-medium" style={{ color: 'var(--color-ink-soft)' }}>{g.name}</div>
                {g.amount && <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{g.amount}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function EventCard({ event, onEdit, onDelete, onClose }: {
  event: CalendarEvent; onEdit: () => void; onDelete: () => void; onClose: () => void
}) {
  const color = kindColor(event.kind, event.color)
  return (
    <div className="rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--color-line)' }}>
      <div className="h-1" style={{ background: color }} />
      <div className="p-4" style={{ background: kindBg(event.kind) }}>
        <div className="flex items-start justify-between mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{ background: color, color: '#fff' }}>{event.kind}</span>
          <button onClick={onClose} className="p-0.5">
            <X size={13} style={{ color: 'var(--color-muted)' }} />
          </button>
        </div>
        <div className="font-semibold text-[15px] leading-snug mb-1" style={{ color: 'var(--color-ink)' }}>
          {event.title}
        </div>
        <div className="text-[12px] font-mono mb-3" style={{ color }}>
          {event.date}
          {event.time ? ` · ${event.time}${event.end_time ? `–${event.end_time}` : ''}` : ''}
        </div>
        {event.description && (
          <div className="text-[12px] mb-3" style={{ color: 'var(--color-ink-soft)', lineHeight: 1.5 }}>
            {event.description}
          </div>
        )}
        <div className="flex gap-2 pt-3 border-t" style={{ borderColor: 'var(--color-line)' }}>
          <button onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 text-[12px] py-1.5 rounded-md border transition-colors"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)', color: 'var(--color-ink-soft)' }}>
            <Pencil size={11} /> Edit
          </button>
          <button onClick={onDelete}
            className="flex items-center justify-center gap-1 text-[12px] px-3 py-1.5 rounded-md border"
            style={{ borderColor: 'var(--color-rose-200)', background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function GrantCard({ item, onClose }: { item: { grant: Grant; date: Date }; onClose: () => void }) {
  const { grant, date } = item
  const days = daysUntil(date)
  return (
    <div className="rounded-lg border p-4" style={{ background: urgencyBg(days), borderColor: 'var(--color-line)' }}>
      <div className="flex items-start justify-between mb-2">
        <Banknote size={16} style={{ color: urgencyColor(days) }} />
        <button onClick={onClose}><X size={13} style={{ color: 'var(--color-muted)' }} /></button>
      </div>
      <div className="font-semibold text-[14px] leading-snug mb-1" style={{ color: 'var(--color-ink)' }}>
        {grant.name}
      </div>
      <div className="text-[12px] font-mono mb-3" style={{ color: urgencyColor(days) }}>
        {formatDeadline(grant.deadline!)} · {days === 0 ? 'today' : days < 0 ? `${Math.abs(days)}d ago` : `${days}d away`}
      </div>
      {grant.amount && <div className="text-[12px] mb-1" style={{ color: 'var(--color-ink-soft)' }}>{grant.amount}</div>}
      {grant.eligibility && <div className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>{grant.eligibility}</div>}
      {grant.notes && (
        <div className="text-[11px] mt-2 pt-2 border-t" style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
          {grant.notes}
        </div>
      )}
      {grant.url && (
        <a href={grant.url} target="_blank" rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[12px]"
          style={{ color: 'var(--color-brand-600)' }}>
          Open <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}

// ─── Table view ─────────────────────────────────────────────────────

function TableView({ upcoming, past, rolling, events, onEditEvent, onDeleteEvent }: {
  upcoming: { grant: Grant; date: Date }[]
  past: { grant: Grant; date: Date }[]
  rolling: Grant[]
  events: CalendarEvent[]
  onAddEvent: () => void
  onEditEvent: (e: CalendarEvent) => void
  onDeleteEvent: (id: number) => void
}) {
  const upcomingEvents = events.filter(e => { const d = parseDate(e.date); return d && daysUntil(d) >= 0 })
    .sort((a, b) => a.date.localeCompare(b.date))
  const pastEvents = events.filter(e => { const d = parseDate(e.date); return d && daysUntil(d) < 0 })
    .sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="flex flex-col gap-6">
      {(upcomingEvents.length > 0 || upcoming.length > 0) && (
        <TSection title="Upcoming" color="var(--color-ink)">
          {upcomingEvents.map((ev) => (
            <EventTableRow key={`e-${ev.id}`} event={ev}
              onEdit={() => onEditEvent(ev)}
              onDelete={() => onDeleteEvent(ev.id)} />
          ))}
          {upcoming.map(({ grant, date }) => {
            const days = daysUntil(date)
            return (
              <GrantTableRow key={`g-${grant.id}`} grant={grant}>
                <span className="font-mono text-[13px]" style={{ color: urgencyColor(days) }}>
                  {formatDeadline(grant.deadline!)}
                </span>
                <span className="text-[12px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: urgencyBg(days), color: urgencyColor(days) }}>
                  {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days}d`}
                </span>
              </GrantTableRow>
            )
          })}
        </TSection>
      )}

      {rolling.length > 0 && (
        <TSection title="Rolling / TBD" color="var(--color-muted)">
          {rolling.map((grant) => (
            <GrantTableRow key={grant.id} grant={grant}>
              <span className="text-[13px] font-mono" style={{ color: 'var(--color-muted)' }}>Rolling</span>
            </GrantTableRow>
          ))}
        </TSection>
      )}

      {(pastEvents.length > 0 || past.length > 0) && (
        <TSection title="Past" color="var(--color-muted-2)">
          {pastEvents.map((ev) => (
            <EventTableRow key={`e-${ev.id}`} event={ev} dim
              onEdit={() => onEditEvent(ev)} onDelete={() => onDeleteEvent(ev.id)} />
          ))}
          {past.map(({ grant }) => (
            <GrantTableRow key={grant.id} grant={grant} dim>
              <span className="text-[13px] font-mono line-through" style={{ color: 'var(--color-muted-2)' }}>
                {formatDeadline(grant.deadline!)}
              </span>
            </GrantTableRow>
          ))}
        </TSection>
      )}

      {upcoming.length === 0 && rolling.length === 0 && past.length === 0 && events.length === 0 && (
        <div className="rounded-md border px-4 py-10 text-center text-[14px]"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
          No events yet. Click "New event" above to get started.
        </div>
      )}
    </div>
  )
}

function TSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color }}>
        {title}
      </div>
      <div className="rounded-md border overflow-hidden"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
        {children}
      </div>
    </div>
  )
}

function EventTableRow({ event, dim, onEdit, onDelete }: {
  event: CalendarEvent; dim?: boolean; onEdit: () => void; onDelete: () => void
}) {
  const color = kindColor(event.kind, event.color)
  return (
    <div className="px-4 py-3 border-b last:border-b-0 flex items-center gap-3"
      style={{ borderColor: 'var(--color-line)', opacity: dim ? 0.55 : 1 }}>
      <div className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[14px] truncate" style={{ color: 'var(--color-ink)' }}>{event.title}</div>
        {event.description && (
          <div className="text-[12px] truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>{event.description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[12px] font-mono" style={{ color }}>
          {event.date}{event.time ? ` ${event.time.slice(0,5)}` : ''}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: kindBg(event.kind), color }}>{event.kind}</span>
        <button onClick={onEdit} className="p-1 rounded hover:bg-[color:var(--color-paper-2)]">
          <Pencil size={11} style={{ color: 'var(--color-muted)' }} />
        </button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-[color:var(--color-rose-50)]">
          <Trash2 size={11} style={{ color: 'var(--color-rose-700)' }} />
        </button>
      </div>
    </div>
  )
}

function GrantTableRow({ grant, children, dim }: { grant: Grant; children: React.ReactNode; dim?: boolean }) {
  return (
    <div className="px-4 py-3 border-b last:border-b-0 flex items-center gap-3"
      style={{ borderColor: 'var(--color-line)', opacity: dim ? 0.55 : 1 }}>
      <Banknote size={14} style={{ color: 'var(--color-amber-700)', flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[14px] truncate" style={{ color: 'var(--color-ink)' }}>{grant.name}</div>
        {(grant.amount || grant.eligibility) && (
          <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>
            {grant.amount}{grant.eligibility ? ` · ${grant.eligibility}` : ''}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {children}
        {grant.url && (
          <a href={grant.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-brand-600)' }}>
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  )
}
