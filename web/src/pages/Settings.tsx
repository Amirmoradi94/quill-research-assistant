import { useEffect, useRef, useState } from 'react'
import { Save, KeyRound, SlidersHorizontal, CheckCircle2, User, Terminal, Wifi, WifiOff, RefreshCw, Mail, AlertCircle, Inbox, HardDrive, Download, LogIn, ShieldCheck, Bell } from 'lucide-react'
import { api, type DesktopStatus, type ProviderSetupStatus, type UserProfile } from '@/lib/api'
import { sendTestNotification } from '@/lib/desktopNotifications'
import { useConfirm } from '@/components/ConfirmDialog'
import {
  checkForAppUpdate,
  formatUpdateProgress,
  formatUpdateVersion,
  installAppUpdate,
  isTauriRuntime,
  type AppUpdate,
  type UpdateProgress,
} from '@/lib/appUpdater'

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

type ProvidersState = {
  selected_default: string
  active: string
  claude_cli: { available: boolean; path: string | null }
  codex_cli: { available: boolean; path: string | null }
  anthropic_api: { configured: boolean }
  openai_api: { configured: boolean }
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [savedAt, setSavedAt] = useState<number>(0)
  const [providers, setProviders] = useState<ProvidersState | null>(null)
  const [setup, setSetup] = useState<ProviderSetupStatus | null>(null)
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [setupBusy, setSetupBusy] = useState<string | null>(null)
  const [setupMessage, setSetupMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [notificationMessage, setNotificationMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const confirmSetup = useConfirm()

  const loadProviders = () => {
    setProvidersLoading(true)
    Promise.allSettled([
      api.aiProviders(),
      api.providerSetupStatus(),
      api.desktopStatus(),
    ]).then(([providersResult, setupResult, desktopResult]) => {
      if (providersResult.status === 'fulfilled') setProviders(providersResult.value)
      if (setupResult.status === 'fulfilled') setSetup(setupResult.value)
      if (desktopResult.status === 'fulfilled') setDesktop(desktopResult.value)
      setProvidersLoading(false)
    }).catch(() => setProvidersLoading(false))
  }

  useEffect(() => {
    api.settings().then(setS).catch((e) => setErr(String(e)))
    api.profile().then(setProfile).catch(() => {})
    loadProviders()
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

  const runProviderSetup = async (provider: 'claude_cli' | 'codex_cli', action: 'install' | 'login') => {
    const item = setup?.providers[provider]
    const label = item?.label || (provider === 'claude_cli' ? 'Claude Code' : 'Codex')
    const ok = await confirmSetup({
      title: action === 'install' ? `Install ${label}?` : `Sign in to ${label}?`,
      message: action === 'install'
        ? `Quill will open Terminal and run the official ${label} installer.`
        : `Quill will open Terminal and start the official ${label} browser login flow.`,
      variant: 'primary',
      confirmLabel: action === 'install' ? 'Install' : 'Sign in',
    })
    if (!ok) return

    const key = `${provider}:${action}`
    setSetupBusy(key)
    setSetupMessage(null)
    try {
      const result = await api.providerSetupAction(provider, action)
      setSetupMessage({
        ok: true,
        text: `${result.message} A Terminal window should be open now. Complete the Terminal/browser steps, then click Recheck. If no Terminal window appears, macOS may be blocking Quill from controlling Terminal; allow it in System Settings > Privacy & Security > Automation.`,
      })
      window.setTimeout(loadProviders, 2500)
    } catch (e: any) {
      setSetupMessage({ ok: false, text: e?.message || String(e) })
    } finally {
      setSetupBusy(null)
    }
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
          desc="This is the local storage and provider environment the desktop build uses.">
          <div className="grid gap-2 text-[13px]">
            <RuntimeRow label="Mode" value={desktop.desktop_mode ? 'Desktop local app' : 'Browser development'} />
            <RuntimeRow label="Data folder" value={desktop.data_dir} mono />
            <RuntimeRow label="Database" value={desktop.db_path} mono />
            <RuntimeRow label="Documents" value={desktop.documents_dir} mono />
            <RuntimeRow label="Active provider" value={desktop.providers.active || 'No provider detected'} />
          </div>
        </Section>
      )}

      <Section icon={<Bell size={16} />} title="Desktop notifications"
        desc="Quill can show native macOS notifications for calendar reminders, meetings, and deadlines while the app is open.">
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

      <AppUpdatesSection />

      {/* User Profile */}
      {profile !== null && (
        <Section icon={<User size={16} />} title="Your Profile"
          desc="Your name and affiliation appear in the app greeting and are used by Quill when drafting outreach.">
          <Field label="Full name" value={profile.name || ''}
            placeholder="Lena Fischer"
            onSave={(v) => saveProfile({ name: v })} />
          <Field label="Email" value={profile.email || ''}
            placeholder="you@university.edu"
            onSave={(v) => saveProfile({ email: v })} />
          <Field label="Current role" value={profile.current_role || ''}
            placeholder="MSc Student / PhD Candidate"
            onSave={(v) => saveProfile({ current_role: v })} />
          <Field label="Affiliation" value={profile.affiliation || ''}
            placeholder="University name"
            onSave={(v) => saveProfile({ affiliation: v })} />
          <Field label="Country" value={profile.country || ''}
            placeholder="Germany"
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
              placeholder="e.g. structural health monitoring, fiber optic sensing, ML-based damage detection" />
          </div>
        </Section>
      )}

      {/* AI Provider */}
      <Section icon={<KeyRound size={16} />} title="AI Provider"
        desc="Quill uses the default provider for all workflows. Local CLIs use your existing subscription; API keys go directly to the provider.">

        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
            Active: <strong style={{ color: 'var(--color-ink)' }}>{s.ai_provider.replace(/_/g, ' ')}</strong>
          </span>
          <button onClick={loadProviders}
            className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded border"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)',
              background: 'var(--color-paper-2)' }}>
            <RefreshCw size={11} className={providersLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* Claude CLI */}
          <ProviderCard
            name="Claude CLI"
            icon={<Terminal size={14} />}
            kind="cli"
            available={providers?.claude_cli.available ?? null}
            isDefault={s.ai_provider === 'claude_cli'}
            onSetDefault={() => save({ ai_provider: 'claude_cli' })}
            onDisconnect={() => save({ ai_provider: 'anthropic_api' })}
          />
          {/* Codex CLI */}
          <ProviderCard
            name="Codex CLI"
            icon={<Terminal size={14} />}
            kind="cli"
            available={providers?.codex_cli.available ?? null}
            isDefault={s.ai_provider === 'codex_cli'}
            onSetDefault={() => save({ ai_provider: 'codex_cli' })}
            onDisconnect={() => save({ ai_provider: 'claude_cli' })}
          />
          {/* Anthropic API */}
          <ProviderCard
            name="Anthropic API"
            icon={<KeyRound size={14} />}
            kind="api"
            available={s.anthropic_api_key_set}
            isDefault={s.ai_provider === 'anthropic_api'}
            onSetDefault={() => save({ ai_provider: 'anthropic_api' })}
            onDisconnect={() => { save({ anthropic_api_key: '' } as any); save({ ai_provider: 'claude_cli' }) }}
            keyPlaceholder="sk-ant-..."
            onSaveKey={(v) => save({ anthropic_api_key: v } as any)}
          />
          {/* OpenAI API */}
          <ProviderCard
            name="OpenAI API"
            icon={<KeyRound size={14} />}
            kind="api"
            available={s.openai_api_key_set}
            isDefault={s.ai_provider === 'openai_api'}
            onSetDefault={() => save({ ai_provider: 'openai_api' })}
            onDisconnect={() => { save({ openai_api_key: '' } as any); save({ ai_provider: 'claude_cli' }) }}
            keyPlaceholder="sk-..."
            onSaveKey={(v) => save({ openai_api_key: v } as any)}
          />
        </div>

        <ProviderSetupWizard
          setup={setup}
          activeProvider={s.ai_provider}
          busy={setupBusy}
          message={setupMessage}
          loading={providersLoading}
          onAction={runProviderSetup}
          onRefresh={loadProviders}
          onSetDefault={(provider) => save({ ai_provider: provider })}
        />

        <Field label="Daily cost cap (USD)" value={String(s.daily_cost_cap_usd)} type="number"
          onSave={(v) => save({ daily_cost_cap_usd: parseFloat(v) || 0 } as any)} />
      </Section>

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
function AppUpdatesSection() {
  const confirm = useConfirm()
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const check = async () => {
    setChecking(true)
    setMessage(null)
    setUpdate(null)
    setProgress(null)
    try {
      if (!isTauriRuntime()) {
        setMessage({ ok: true, text: 'Desktop updater is available in the installed Quill AI app.' })
        return
      }
      const next = await checkForAppUpdate()
      if (next) {
        setUpdate(next)
        setMessage({ ok: true, text: `Quill AI ${formatUpdateVersion(next)} is ready to install.` })
      } else {
        setMessage({ ok: true, text: 'Quill AI is up to date.' })
      }
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || String(e) })
    } finally {
      setChecking(false)
    }
  }

  const install = async () => {
    if (!update) return
    const version = formatUpdateVersion(update)
    const ok = await confirm({
      title: `Install Quill AI ${version}?`,
      message: 'The signed update will be downloaded and installed. Quill will relaunch after installation.',
      variant: 'primary',
      confirmLabel: 'Install update',
    })
    if (!ok) return

    setInstalling(true)
    setMessage({ ok: true, text: 'Starting update download...' })
    try {
      await installAppUpdate(update, (next) => {
        setProgress(next)
        setMessage({ ok: true, text: formatUpdateProgress(next) })
      })
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || String(e) })
      setInstalling(false)
    }
  }

  return (
    <Section icon={<Download size={16} />} title="App updates"
      desc="Quill checks GitHub releases for signed desktop updates. Updates are verified before installation.">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={check}
          disabled={checking || installing}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium disabled:opacity-60"
          style={{
            background: 'var(--color-paper-2)',
            borderColor: 'var(--color-line)',
            color: 'var(--color-ink)',
          }}
        >
          <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
          Check for updates
        </button>
        {update && (
          <button
            onClick={install}
            disabled={installing}
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium disabled:opacity-60"
            style={{ background: 'var(--color-brand-600)', color: '#fff' }}
          >
            <Download size={14} />
            {installing ? 'Installing...' : `Install ${formatUpdateVersion(update)}`}
          </button>
        )}
        {message && (
          <span className="inline-flex items-center gap-1.5 text-[13px]"
            style={{ color: message.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)' }}>
            {message.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {message.text}
          </span>
        )}
      </div>
      {progress?.totalBytes ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-paper-2)' }}>
          <div
            className="h-full transition-all"
            style={{
              width: `${Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))}%`,
              background: 'var(--color-brand-600)',
            }}
          />
        </div>
      ) : null}
    </Section>
  )
}

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

function Field({ label, value, placeholder, type, onSave }: {
  label: string; value: string; placeholder?: string; type?: string; onSave: (v: string) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="text-[12px] w-44 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <input type={type || 'text'} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        className="flex-1 px-2.5 py-1.5 rounded-md border text-[13px] outline-none"
        style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }} />
      <button onClick={() => onSave(v)}
        className="px-2.5 py-1.5 rounded-md border text-[12px] inline-flex items-center gap-1"
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

function ProviderSetupWizard({
  setup,
  activeProvider,
  busy,
  message,
  loading,
  onAction,
  onRefresh,
  onSetDefault,
}: {
  setup: ProviderSetupStatus | null
  activeProvider: string
  busy: string | null
  message: { ok: boolean; text: string } | null
  loading: boolean
  onAction: (provider: 'claude_cli' | 'codex_cli', action: 'install' | 'login') => void
  onRefresh: () => void
  onSetDefault: (provider: 'claude_cli' | 'codex_cli') => void
}) {
  const rows = setup ? [setup.providers.claude_cli, setup.providers.codex_cli] : []

  return (
    <div className="rounded-md border p-3 mb-4"
      style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[13px] font-semibold inline-flex items-center gap-1.5"
            style={{ color: 'var(--color-ink)' }}>
            <ShieldCheck size={14} />
            Guided subscription connection
          </div>
          <div className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Use your Claude or ChatGPT subscription through the official local CLI. Quill opens Terminal for install or login and never asks for your password.
          </div>
        </div>
        <button onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] shrink-0"
          style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}>
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Recheck
        </button>
      </div>

      <div className="grid gap-2">
        {rows.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Checking local provider setup…</div>
        ) : rows.map((item) => {
          const provider = item.provider
          const installBusy = busy === `${provider}:install`
          const loginBusy = busy === `${provider}:login`
          const ready = item.installed && item.authenticated === true
          const authKnown = item.authenticated !== null
          return (
            <div key={provider} className="rounded-md border px-3 py-2"
              style={{ background: 'var(--color-white)', borderColor: ready ? 'var(--color-green-200)' : 'var(--color-line)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>{item.label}</span>
                    <StatusPill ok={item.installed} label={item.installed ? 'Installed' : 'Missing'} />
                    <StatusPill ok={ready} label={ready ? 'Signed in' : authKnown ? 'Not signed in' : 'Sign-in unknown'} />
                    {activeProvider === provider && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                        style={{ background: 'var(--color-brand-600)', color: 'white' }}>
                        Default
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    {item.message}
                    {item.account && <> Account: {item.account}.</>}
                    {item.auth_method && <> Access: {item.auth_method}.</>}
                  </div>
                  {item.path && (
                    <div className="mt-1 font-mono text-[10px] break-all" style={{ color: 'var(--color-muted-2)' }}>
                      {item.path}{item.version ? ` · ${item.version}` : ''}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  {!item.installed && (
                    <button onClick={() => onAction(provider, 'install')} disabled={!item.can_install || installBusy}
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                      style={{ background: 'var(--color-brand-50)', borderColor: 'var(--color-brand-300)', color: 'var(--color-brand-700)' }}>
                      <Download size={11} />
                      {installBusy ? 'Opening…' : 'Install'}
                    </button>
                  )}
                  {item.installed && !ready && (
                    <button onClick={() => onAction(provider, 'login')} disabled={!item.can_login || loginBusy}
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                      style={{ background: 'var(--color-brand-50)', borderColor: 'var(--color-brand-300)', color: 'var(--color-brand-700)' }}>
                      <LogIn size={11} />
                      {loginBusy ? 'Opening…' : 'Sign in'}
                    </button>
                  )}
                  {ready && activeProvider !== provider && (
                    <button onClick={() => onSetDefault(provider)}
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium"
                      style={{ background: 'var(--color-green-50)', borderColor: 'var(--color-green-200)', color: 'var(--color-green-700)' }}>
                      Use
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {message && (
        <div className="mt-3 rounded px-3 py-2 text-[12px] flex items-start gap-2"
          style={{
            background: message.ok ? 'var(--color-green-50)' : 'var(--color-rose-50)',
            color: message.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)',
          }}>
          {message.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {setup?.platform !== 'Darwin' && (
        <div className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Guided install and login buttons are currently available on macOS. On this platform, install the provider manually and click Recheck.
        </div>
      )}
    </div>
  )
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
      style={{
        background: ok ? 'var(--color-green-50)' : 'var(--color-paper-2)',
        borderColor: ok ? 'var(--color-green-200)' : 'var(--color-line)',
        color: ok ? 'var(--color-green-700)' : 'var(--color-muted)',
      }}>
      {ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
      {label}
    </span>
  )
}

function ProviderCard({ name, icon, kind, available, isDefault, onSetDefault, onDisconnect, keyPlaceholder, onSaveKey }: {
  name: string
  icon: React.ReactNode
  kind: 'cli' | 'api'
  available: boolean | null
  isDefault: boolean
  onSetDefault: () => void
  onDisconnect: () => void
  keyPlaceholder?: string
  onSaveKey?: (v: string) => void
}) {
  const [keyVal, setKeyVal] = useState('')
  const [showKey, setShowKey] = useState(false)

  const connected = available === true
  const loading = available === null

  return (
    <div className="rounded-md border p-3 flex flex-col gap-2"
      style={{
        borderColor: isDefault ? 'var(--color-brand-500)' : 'var(--color-line)',
        background: isDefault ? 'var(--color-brand-50)' : 'var(--color-paper)',
      }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-medium"
          style={{ color: 'var(--color-ink)' }}>
          {icon}
          {name}
        </div>
        {isDefault && (
          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: 'var(--color-brand-600)', color: '#fff' }}>
            Default
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {loading ? (
          <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>checking…</span>
        ) : connected ? (
          <>
            <Wifi size={12} style={{ color: 'var(--color-green-700)' }} />
            <span className="text-[12px] font-medium" style={{ color: 'var(--color-green-700)' }}>
              {kind === 'cli' ? 'Found in PATH' : 'Key configured'}
            </span>
          </>
        ) : (
          <>
            <WifiOff size={12} style={{ color: 'var(--color-muted)' }} />
            <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
              {kind === 'cli' ? 'Not found in PATH' : 'No key set'}
            </span>
          </>
        )}
      </div>

      {kind === 'api' && onSaveKey && (
        <div className={`flex items-center gap-1 ${showKey ? '' : ''}`}>
          {showKey ? (
            <>
              <input
                type="password"
                value={keyVal}
                onChange={(e) => setKeyVal(e.target.value)}
                placeholder={keyPlaceholder}
                className="flex-1 px-2 py-1 rounded border text-[12px] outline-none"
                style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}
              />
              <button
                onClick={() => { onSaveKey(keyVal); setKeyVal(''); setShowKey(false) }}
                className="px-2 py-1 rounded border text-[11px] inline-flex items-center gap-1"
                style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)',
                  color: 'var(--color-ink-soft)' }}>
                <Save size={10} /> Save
              </button>
              <button onClick={() => setShowKey(false)}
                className="text-[11px] px-1.5" style={{ color: 'var(--color-muted)' }}>✕</button>
            </>
          ) : (
            <button onClick={() => setShowKey(true)}
              className="text-[11px] px-2 py-1 rounded border"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)',
                background: 'var(--color-paper-2)' }}>
              {connected ? 'Update key' : 'Set key'}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-auto pt-1" style={{ borderTop: '1px solid var(--color-line)' }}>
        {!isDefault && connected && (
          <button onClick={onSetDefault}
            className="flex-1 text-[11px] px-2 py-1 rounded border font-medium"
            style={{ background: 'var(--color-brand-50)', borderColor: 'var(--color-brand-400)',
              color: 'var(--color-brand-700)' }}>
            Set as default
          </button>
        )}
        {isDefault && (
          <button onClick={onDisconnect}
            className="flex-1 text-[11px] px-2 py-1 rounded border"
            style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)',
              color: 'var(--color-muted)' }}>
            Disconnect
          </button>
        )}
        {!isDefault && !connected && kind === 'cli' && (
          <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            Install to use
          </span>
        )}
      </div>
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
          placeholder="Amir Moradi"
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
