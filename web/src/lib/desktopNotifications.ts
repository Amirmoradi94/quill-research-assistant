import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { api, type CalendarEvent } from './api'

const SENT_KEY = 'quill-reminder-notifications-sent-v1'
const POLL_MS = 60_000
const MAX_PER_POLL = 3

type SentMap = Record<string, number>

type NotificationResult = {
  ok: boolean
  message: string
}

function localISODate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function readSent(): SentMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(SENT_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSent(sent: SentMap) {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 45
  const compacted = Object.fromEntries(Object.entries(sent).filter(([, ts]) => ts >= cutoff))
  try { localStorage.setItem(SENT_KEY, JSON.stringify(compacted)) } catch {}
}

function eventKey(event: CalendarEvent) {
  return [
    event.id,
    event.updated_at,
    event.date,
    event.time || 'all-day',
    event.kind || 'event',
  ].join(':')
}

function eventDateTime(event: CalendarEvent) {
  if (event.time && /^\d{2}:\d{2}/.test(event.time)) {
    return new Date(`${event.date}T${event.time.slice(0, 5)}:00`)
  }
  const day = new Date(`${event.date}T09:00:00`)
  return Number.isNaN(day.getTime()) ? null : day
}

function shouldNotify(event: CalendarEvent, now: Date) {
  if (!['reminder', 'meeting', 'deadline'].includes(event.kind)) return false
  const due = eventDateTime(event)
  if (!due) return false

  const ageMs = now.getTime() - due.getTime()
  if (event.all_day || !event.time) {
    return localISODate(now) === event.date && ageMs >= 0 && ageMs < 1000 * 60 * 60 * 15
  }
  return ageMs >= 0 && ageMs < 1000 * 60 * 10
}

function titleFor(event: CalendarEvent) {
  if (event.kind === 'deadline') return `Deadline: ${event.title}`
  if (event.kind === 'meeting') return `Meeting: ${event.title}`
  return `Reminder: ${event.title}`
}

function bodyFor(event: CalendarEvent) {
  const parts: string[] = []
  if (event.time) parts.push(`Time: ${event.time.slice(0, 5)}`)
  else parts.push('Due today')
  if (event.description?.trim()) parts.push(event.description.trim())
  return parts.join(' · ')
}

export async function ensureNotificationPermission(): Promise<NotificationResult> {
  try {
    if (await isPermissionGranted()) {
      return { ok: true, message: 'Notifications are allowed.' }
    }
    const permission = await requestPermission()
    if (permission === 'granted') {
      return { ok: true, message: 'Notifications are allowed.' }
    }
    return { ok: false, message: 'Notifications are not allowed yet. Enable them in macOS Settings > Notifications > Quill AI.' }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) }
  }
}

export async function sendQuillNotification(title: string, body?: string): Promise<NotificationResult> {
  const permission = await ensureNotificationPermission()
  if (!permission.ok) return permission
  try {
    sendNotification({ title, body, group: 'quill-reminders' })
    return { ok: true, message: 'Notification sent.' }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) }
  }
}

export function sendTestNotification() {
  return sendQuillNotification(
    'Quill reminder test',
    'Desktop notifications are working.',
  )
}

async function checkDueReminders() {
  const now = new Date()
  const from = localISODate(addDays(now, -1))
  const to = localISODate(addDays(now, 1))
  const sent = readSent()
  let sentCount = 0

  const events = await api.calendarEvents(from, to)
  for (const event of events) {
    if (sentCount >= MAX_PER_POLL) break
    const key = eventKey(event)
    if (sent[key] || !shouldNotify(event, now)) continue

    const result = await sendQuillNotification(titleFor(event), bodyFor(event))
    if (result.ok) {
      sent[key] = Date.now()
      sentCount += 1
    }
  }

  if (sentCount > 0) writeSent(sent)
}

export function startReminderNotifications() {
  let stopped = false
  let timer: ReturnType<typeof window.setInterval> | null = null

  const run = () => {
    if (stopped) return
    checkDueReminders().catch(() => {})
  }

  const initial = window.setTimeout(run, 5000)
  timer = window.setInterval(run, POLL_MS)
  window.addEventListener('quill:data-changed', run)

  return () => {
    stopped = true
    window.clearTimeout(initial)
    if (timer) window.clearInterval(timer)
    window.removeEventListener('quill:data-changed', run)
  }
}
