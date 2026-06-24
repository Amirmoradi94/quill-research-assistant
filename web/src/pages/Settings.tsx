import { useEffect, useRef, useState } from 'react'
import { Save, KeyRound, SlidersHorizontal, CheckCircle2, User, Wifi, WifiOff, RefreshCw, Mail, AlertCircle, Inbox, HardDrive, Bell } from 'lucide-react'
import { api, type DesktopStatus, type UserProfile } from '@/lib/api'
import { sendTestNotification } from '@/lib/desktopNotifications'

type SettingsT = {
  ai_provider: string
  claude_cli_path: string | null
  codex_cli_path: string | null
  anthropic_api_key_set: boolean
  openai_api_key_set: boolean
  email_tone_rules: string
  daily_cost_cap_usd: number
  ui_density: string
  batch_defaults: {
    batch_size: number
    max_per_university: number
    weekdays: number[]
    tiers: string[]
    categories: string[]
    universities: string[]
  }
  // Gmail
  gmail_address: string
  gmail_send_name: string
  gmail_connected: boolean
  gmail_last_verified_at: string | null
  // Auto reply-poller
  reply_check_enabled: boolean
  reply_check_interval_hours: number
  reply_check_last_run_at: string | null
  reply_check_last_status: { checked: number; new_replies: number; errors_count: number } | null
  reply_check_last_error: string | null
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [savedAt, setSavedAt] = useState<number>(0)
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null)
  const [notificationMessage, setNotificationMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const loadRuntime = () => {
    api.desktopStatus().then(setDesktop).catch(() => {})
  }

  useEffect(() => {
    api.settings().then(setS).catch((e) => setErr(String(e)))
    api.profile().then(setProfile).catch(() => {})
    loadRuntime()
  }, [])

  if (!s) return (
    <div className="px-8 py-6">
      {err && <div className="p-3 rounded text-[14px]"
        style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>{err}</div>}
    </div>
  )

  const save = async (patch: Partial<SettingsT>) => {
    const next = await api.patchSettings(patch)
    setS(next)
    setSavedAt(Date.now())
  }

  const saveProfile = async (patch: Partial<UserProfile>) => {
    const next = await api.patchProfile(patch)
    setProfile(next)
    setSavedAt(Date.now())
  }

  return (
    <div className="px-8 py-6 max-w-4xl">
      <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>
        Home / Settings
      </div>
      <div className="flex items-baseline justify-between mb-5">
        <h1 className="font-bold tracking-tight" style={{ fontSize: 36, color: 'var(--color-ink)' }}>
          Settings
        </h1>
        {savedAt > 0 && Date.now() - savedAt < 3000 && (
          <span className="inline-flex items-center gap-1 text-[12px]"
            style={{ color: 'var(--color-green-700)' }}>
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
      </div>

      {desktop && (
        <Section icon={<HardDrive size={16} />} title="Local runtime"
          desc="This is the local storage environment the desktop build uses.">
          <div className="grid gap-2 text-[13px]">
            <RuntimeRow label="Mode" value={desktop.desktop_mode ? 'Desktop local app' : 'Browser development'} />
            <RuntimeRow label="Data folder" value={desktop.data_dir} mono />
            <RuntimeRow label="Database" value={desktop.db_path} mono />
            <RuntimeRow label="Documents" value={desktop.documents_dir} mono />
          </div>
        </Section>
      )}

      <Section icon={<Bell size={16} />} title="Desktop notifications"
        desc="Quill can send native macOS notifications for calendar reminders, meetings, and deadlines. macOS may suppress banners while Quill is frontmost or Focus is enabled.">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={async () => {
              setNotificationMessage(null)
              const result = await sendTestNotification()
              setNotificationMessage({ ok: result.ok, text: result.message })
            }}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium"
            style={{
              background: 'var(--color-paper-2)',
              borderColor: 'var(--color-line)',
              color: 'var(--color-ink)',
            }}
          >
            <Bell size={14} />
            Send test notification
          </button>
          {notificationMessage && (
            <span className="text-[13px]"
              style={{ color: notificationMessage.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)' }}>
              {notificationMessage.text}
            </span>
          )}
        </div>
      </Section>

      {/* User Profile */}
      {profile !== null && (
        <Section icon={<User size={16} />} title="Your Profile"
          desc="Your name and affiliation appear in the app greeting and are used by Quill when drafting outreach.">
          <Field label="Full name" value={profile.name || ''}
            placeholder="Your full name"
            onSave={(v) => saveProfile({ name: v })} />
          <Field label="Email" value={profile.email || ''}
            placeholder="name@example.com"
            onSave={(v) => saveProfile({ email: v })} />
          <Field label="Current role" value={profile.current_role || ''}
            placeholder="Current role"
            onSave={(v) => saveProfile({ current_role: v })} />
          <Field label="Affiliation" value={profile.affiliation || ''}
            placeholder="Affiliation"
            onSave={(v) => saveProfile({ affiliation: v })} />
          <Field label="Country" value={profile.country || ''}
            placeholder="Country"
            onSave={(v) => saveProfile({ country: v })} />
          <div className="flex items-start gap-2 mb-2">
            <div className="text-[12px] w-44 flex-shrink-0 pt-2" style={{ color: 'var(--color-muted)' }}>
              Research interests
            </div>
            <AutoTextarea
              defaultValue={profile.research_interests || ''}
              minRows={3}
              onBlur={(e) => saveProfile({ research_interests: e.target.value })}
              className="flex-1 px-2.5 py-1.5 rounded-md border text-[13px] outline-none font-sans"
              style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)', lineHeight: 1.5 }}
              placeholder="Research interests" />
          </div>
        </Section>
      )}

      {/* Batch defaults */}
      <Section icon={<SlidersHorizontal size={16} />} title="Batch defaults"
        desc="Initial values for the Batches page controls. You can still override per-session.">
        <div className="grid grid-cols-2 gap-4">
          <NumField label="Default batch size" value={s.batch_defaults.batch_size}
            min={1} max={30}
            onSave={(v) => save({ batch_defaults: { ...s.batch_defaults, batch_size: v } } as any)} />
          <NumField label="Max per university" value={s.batch_defaults.max_per_university}
            min={1} max={10}
            onSave={(v) => save({ batch_defaults: { ...s.batch_defaults, max_per_university: v } } as any)} />
        </div>
        <div className="mt-4">
          <Lbl>Default send weekdays</Lbl>
          <div className="flex items-center gap-1 mt-1">
            {WEEKDAY_LABELS.map((d, i) => {
              const on = s.batch_defaults.weekdays.includes(i)
              return (
                <button key={i}
                  onClick={() => {
                    const next = on ? s.batch_defaults.weekdays.filter((x) => x !== i)
                      : [...s.batch_defaults.weekdays, i].sort()
                    save({ batch_defaults: { ...s.batch_defaults, weekdays: next } } as any)
                  }}
                  className="px-2 py-1 rounded text-[12px] border"
                  style={{
                    background: on ? 'var(--color-brand-50)' : 'var(--color-paper-2)',
                    borderColor: on ? 'var(--color-brand-500)' : 'var(--color-line)',
                    color: on ? 'var(--color-brand-700)' : 'var(--color-muted)',
                    fontWeight: on ? 500 : 400,
                  }}>{d}</button>
              )
            })}
          </div>
        </div>
      </Section>

      {/* Gmail SMTP */}
      <GmailSection s={s} save={save} reload={() => api.settings().then(setS)} />

      {/* Auto reply-poller */}
      <InboxSyncSection s={s} save={save} reload={() => api.settings().then(setS)} />

      {/* Email tone */}
      <Section icon={<KeyRound size={16} />} title="Email tone rules"
        desc="Guidance Quill follows when drafting outreach. Spans every workflow that touches emails.">
        <AutoTextarea value={s.email_tone_rules}
          onChange={(e) => setS({ ...s, email_tone_rules: e.target.value })}
          onBlur={() => save({ email_tone_rules: s.email_tone_rules })}
          minRows={4}
          className="w-full px-3 py-2 rounded-md border text-[13px] outline-none font-sans"
          style={{
            background: 'var(--color-white)', borderColor: 'var(--color-line)',
            color: 'var(--color-ink)', lineHeight: 1.55,
          }}
          placeholder="e.g. 150 to 250 words, no em-dashes, IEEE journal names spelled out, lead with the recipient's specific work" />
      </Section>
    </div>
  )
}

// ─────────── helpers ───────────
function Section({ icon, title, desc, children }: {
  icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-md border p-4 mb-4"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
      <h2 className="text-[15px] font-semibold flex items-center gap-2 mb-1"
        style={{ color: 'var(--color-ink)' }}>
        {icon}
        {title}
      </h2>
      {desc && (
        <div className="text-[13px] mb-3" style={{ color: 'var(--color-muted)', lineHeight: 1.55 }}>
          {desc}
        </div>
      )}
      {children}
    </section>
  )
}

function RuntimeRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-28 flex-shrink-0 text-[12px] pt-0.5" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <div className={`${mono ? 'font-mono text-[12px]' : 'text-[13px]'} min-w-0 break-all`}
        style={{ color: 'var(--color-ink-soft)' }}>
        {value}
      </div>
    </div>
  )
}

function Field({ label, value, placeholder, type, onSave, compact = false }: {
  label: string; value: string; placeholder?: string; type?: string; onSave: (v: string) => void; compact?: boolean
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div className={`flex ${compact ? 'items-start flex-col gap-1 mb-0' : 'items-center gap-2 mb-2'}`}>
      <div className={`text-[12px] ${compact ? '' : 'w-44 flex-shrink-0'}`} style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <input type={type || 'text'} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        className={`${compact ? 'w-full' : 'flex-1'} px-2.5 py-1.5 rounded-md border text-[13px] outline-none`}
        style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }} />
      <button onClick={() => onSave(v)}
        className={`${compact ? 'w-full justify-center' : ''} px-2.5 py-1.5 rounded-md border text-[12px] inline-flex items-center gap-1`}
        style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)',
          color: 'var(--color-ink-soft)' }}>
        <Save size={12} />
        Save
      </button>
    </div>
  )
}

function NumField({ label, value, min, max, onSave }: {
  label: string; value: number; min: number; max: number; onSave: (v: number) => void
}) {
  return (
    <div>
      <Lbl>{label}</Lbl>
      <div className="flex items-center gap-2 mt-1">
        <input type="range" min={min} max={max} value={value}
          onChange={(e) => onSave(parseInt(e.target.value))}
          className="flex-1" />
        <span className="font-mono text-[13px] w-8" style={{ color: 'var(--color-ink)' }}>{value}</span>
      </div>
    </div>
  )
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
      {children}
    </div>
  )
}

// ─────────── Gmail SMTP section ───────────
function GmailSection({ s, save, reload }: {
  s: SettingsT
  save: (patch: any) => Promise<void>
  reload: () => void
}) {
  const [pw, setPw] = useState('')
  const [name, setName] = useState(s.gmail_send_name || '')
  const [addr, setAddr] = useState(s.gmail_address || '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => { setAddr(s.gmail_address || ''); setName(s.gmail_send_name || '') }, [s])

  const saveCreds = async () => {
    const payload: any = { gmail_address: addr.trim(), gmail_send_name: name.trim() }
    if (pw.trim()) payload.gmail_app_password = pw.trim()
    await save(payload)
    setPw('')
    setTestResult(null)
  }

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await api.testGmail()
      setTestResult(r)
      if (r.ok) reload()
    } catch (e: any) {
      setTestResult({ ok: false, message: String(e?.message || e) })
    } finally { setTesting(false) }
  }

  const disconnect = async () => {
    if (!confirm('Disconnect Gmail? Your app password will be erased from the database.')) return
    await save({ gmail_address: '', gmail_send_name: '', gmail_app_password: '' })
    setAddr(''); setName(''); setPw(''); setTestResult(null)
  }

  return (
    <Section icon={<Mail size={16} />} title="Gmail (send drafts)"
      desc="Connect your Gmail account so Quill (and the Send buttons) can email professors directly. Uses a 16-character App Password, encrypted at rest. Requires 2-Step Verification on your Google account.">
      <div className="flex items-center gap-2 mb-3 text-[12px]">
        {s.gmail_connected ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full"
            style={{ background: 'var(--color-green-50)', color: 'var(--color-green-700)' }}>
            <CheckCircle2 size={12} /> Connected as {s.gmail_address}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full"
            style={{ background: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>
            <AlertCircle size={12} /> Not connected
          </span>
        )}
        {s.gmail_last_verified_at && (
          <span style={{ color: 'var(--color-muted)' }}>
            Last verified {new Date(s.gmail_last_verified_at).toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="text-[12px] w-44 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
          Gmail address
        </div>
        <input value={addr} onChange={(e) => setAddr(e.target.value)}
          placeholder="you@gmail.com"
          className="flex-1 px-2.5 py-1.5 rounded-md border text-[13px] outline-none"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }} />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[12px] w-44 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
          Send-as name
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="flex-1 px-2.5 py-1.5 rounded-md border text-[13px] outline-none"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }} />
      </div>

      <div className="flex items-start gap-2 mb-2">
        <div className="text-[12px] w-44 flex-shrink-0 pt-2" style={{ color: 'var(--color-muted)' }}>
          App Password
        </div>
        <div className="flex-1 min-w-0">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
            placeholder={s.gmail_connected ? '••••••••••••••••  (leave blank to keep current)' : 'abcd efgh ijkl mnop'}
            className="w-full px-3 py-2 rounded-md border text-[13px] outline-none font-mono tracking-wider"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }} />
          <div className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Generate at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener"
              style={{ color: 'var(--color-brand-700)' }} className="hover:underline">
              myaccount.google.com/apppasswords</a> · 16 chars · spaces optional ·
            stored encrypted (Fernet) on this machine only.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button onClick={saveCreds}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[13px] font-medium"
          style={{ background: 'var(--color-brand-500)', color: 'white' }}>
          <Save size={13} /> Save credentials
        </button>
        <button onClick={test} disabled={!s.gmail_connected || testing}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[13px] border disabled:opacity-50"
          style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
          {testing ? <RefreshCw size={13} className="animate-spin" /> : <Wifi size={13} />}
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {s.gmail_connected && (
          <button onClick={disconnect}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[13px] border"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-rose-700)' }}>
            <WifiOff size={13} /> Disconnect
          </button>
        )}
      </div>

      {testResult && (
        <div className="mt-3 px-3 py-2 rounded text-[12px] flex items-start gap-2"
          style={{
            background: testResult.ok ? 'var(--color-green-50)' : 'var(--color-rose-50)',
            color: testResult.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)',
          }}>
          {testResult.ok ? <CheckCircle2 size={13} className="mt-0.5" /> : <AlertCircle size={13} className="mt-0.5" />}
          <span>{testResult.message}</span>
        </div>
      )}
    </Section>
  )
}


// ─────────── Auto-growing textarea ───────────
// Resizes to fit its content. Useful for multi-paragraph settings fields
// where the user shouldn't have to drag the corner handle.
function AutoTextarea({
  value, defaultValue, onChange, onBlur, placeholder, className, style, minRows = 2,
}: {
  value?: string
  defaultValue?: string
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [internal, setInternal] = useState(defaultValue ?? '')
  const controlled = value !== undefined

  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => { fit() }, [value, internal])
  useEffect(() => { fit() }, [])

  return (
    <textarea
      ref={ref}
      value={controlled ? value : internal}
      onChange={(e) => {
        if (!controlled) setInternal(e.target.value)
        onChange?.(e)
        fit()
      }}
      onBlur={onBlur}
      rows={minRows}
      placeholder={placeholder}
      className={className}
      style={{ ...style, resize: 'none', overflow: 'hidden' }}
    />
  )
}


// ─────────── Inbox sync (auto reply-poller) section ───────────
function InboxSyncSection({ s, save, reload }: {
  s: SettingsT
  save: (patch: Record<string, any>) => Promise<void> | void
  reload: () => Promise<any> | any
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const enabled = !!s.reply_check_enabled
  const interval = s.reply_check_interval_hours || 4
  const last = s.reply_check_last_run_at ? new Date(s.reply_check_last_run_at) : null
  const lastStatus = s.reply_check_last_status

  const checkNow = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await api.checkReplies()
      setMsg({
        ok: true,
        text: r.new_replies > 0
          ? `${r.new_replies} new ${r.new_replies === 1 ? 'reply' : 'replies'} across ${r.checked} sent emails.`
          : `Checked ${r.checked} sent emails. No new replies.`,
      })
      await reload()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) })
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(null), 8000)
    }
  }

  return (
    <Section icon={<Inbox size={16} />} title="Inbox sync (auto reply-check)"
      desc="Poll your Gmail inbox on a schedule and surface replies on the Sent page automatically. Requires Gmail connected above.">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={enabled}
            disabled={!s.gmail_connected}
            onChange={(e) => save({ reply_check_enabled: e.target.checked })}
            className="cursor-pointer" />
          <span className="text-[13px] font-medium" style={{ color: 'var(--color-ink)' }}>
            Auto-check for replies
          </span>
        </label>
        {!s.gmail_connected && (
          <span className="text-[11px]" style={{ color: 'var(--color-amber-700)' }}>
            Connect Gmail above first.
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <label className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
          Every
        </label>
        <select value={interval}
          disabled={!enabled}
          onChange={(e) => save({ reply_check_interval_hours: parseInt(e.target.value) })}
          className="px-2 py-1 rounded border text-[12px] outline-none disabled:opacity-50"
          style={{
            background: 'var(--color-white)',
            borderColor: 'var(--color-line)',
            color: 'var(--color-ink-soft)',
          }}>
          <option value={1}>1 hour</option>
          <option value={2}>2 hours</option>
          <option value={4}>4 hours</option>
          <option value={6}>6 hours</option>
          <option value={12}>12 hours</option>
          <option value={24}>1 day</option>
          <option value={48}>2 days</option>
        </select>
        <button onClick={checkNow} disabled={busy || !s.gmail_connected}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] disabled:opacity-50"
          style={{
            background: 'var(--color-white)',
            borderColor: 'var(--color-line)',
            color: 'var(--color-ink-soft)',
          }}>
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>

      <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
        {last ? (
          <>
            Last checked {last.toLocaleString()}.
            {lastStatus && (
              <> {' '}
                {lastStatus.new_replies} new {lastStatus.new_replies === 1 ? 'reply' : 'replies'},{' '}
                {lastStatus.checked} sent emails scanned
                {lastStatus.errors_count > 0 && (
                  <span style={{ color: 'var(--color-amber-700)' }}>
                    {' '}({lastStatus.errors_count} error{lastStatus.errors_count === 1 ? '' : 's'})
                  </span>
                )}
                .
              </>
            )}
          </>
        ) : (
          <>Never checked.</>
        )}
        {s.reply_check_last_error && (
          <div className="mt-1 inline-flex items-center gap-1" style={{ color: 'var(--color-rose-700)' }}>
            <AlertCircle size={11} /> Last error: {s.reply_check_last_error}
          </div>
        )}
      </div>

      {msg && (
        <div className="mt-3 text-[12px] inline-flex items-center gap-1.5"
          style={{ color: msg.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)' }}>
          {msg.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {msg.text}
        </div>
      )}
    </Section>
  )
}
