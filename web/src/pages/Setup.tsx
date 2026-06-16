import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileUp,
  HardDrive,
  Loader2,
  LogIn,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  User,
} from 'lucide-react'
import { api, type AiProvidersStatus, type DesktopStatus, type DocumentRow, type ProviderSetupStatus, type UserProfile } from '@/lib/api'

type LoadState = {
  desktop: DesktopStatus | null
  providers: AiProvidersStatus | null
  setup: ProviderSetupStatus | null
  documents: DocumentRow[]
  profile: UserProfile | null
}

const initialState: LoadState = {
  desktop: null,
  providers: null,
  setup: null,
  documents: [],
  profile: null,
}

export function Setup() {
  const [state, setState] = useState<LoadState>(initialState)
  const [loading, setLoading] = useState(true)
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [setupBusy, setSetupBusy] = useState<string | null>(null)
  const [setupMessage, setSetupMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [profileDraft, setProfileDraft] = useState({ name: '', email: '', role: '' })
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    setError(null)
    const [desktopResult, providersResult, setupResult, docsResult, profileResult] = await Promise.allSettled([
      api.desktopStatus(),
      api.aiProviders(),
      api.providerSetupStatus(),
      api.documents('cv'),
      api.profile(),
    ])

    const next = {
      desktop: desktopResult.status === 'fulfilled' ? desktopResult.value : null,
      providers: providersResult.status === 'fulfilled' ? providersResult.value : null,
      setup: setupResult.status === 'fulfilled' ? setupResult.value : null,
      documents: docsResult.status === 'fulfilled' ? docsResult.value : [],
      profile: profileResult.status === 'fulfilled' ? profileResult.value : null,
    }

    setState(next)
    setProfileDraft({
      name: next.profile?.name || '',
      email: next.profile?.email || '',
      role: next.profile?.current_role || '',
    })
    setLoading(false)

    if (desktopResult.status === 'rejected') {
      setError('Local backend is still starting or not reachable. Wait a few seconds, then click Recheck.')
      return
    }
    const failed: string[] = []
    if (providersResult.status === 'rejected') failed.push('provider status')
    if (setupResult.status === 'rejected') failed.push('Claude/Codex setup status')
    if (docsResult.status === 'rejected') failed.push('CV documents')
    if (profileResult.status === 'rejected') failed.push('profile')
    if (failed.length) setError(`Could not load ${failed.join(', ')}. Click Recheck after the app finishes starting.`)
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (state.desktop || loading || !error?.startsWith('Local backend')) return
    const retry = window.setTimeout(() => { void load() }, 2000)
    return () => window.clearTimeout(retry)
  }, [error, loading, state.desktop])

  const activeProvider = state.providers?.active || state.desktop?.providers.active || ''
  const hasProvider = !!activeProvider
  const backendStarting = !!error?.startsWith('Local backend')
  const defaultCv = useMemo(
    () => state.documents.find((doc) => doc.is_default) || state.documents[0] || null,
    [state.documents],
  )
  const hasProfileName = !!state.profile?.name?.trim()
  const essentialsComplete = hasProvider && !!defaultCv && hasProfileName

  const chooseProvider = async (provider: 'claude_cli' | 'codex_cli') => {
    setSavingProvider(provider)
    setError(null)
    try {
      await api.patchSettings({ ai_provider: provider })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingProvider(null)
    }
  }

  const runProviderSetup = async (provider: 'claude_cli' | 'codex_cli', action: 'install' | 'login') => {
    const item = state.setup?.providers[provider]
    const label = item?.label || (provider === 'claude_cli' ? 'Claude Code' : 'Codex')
    const detail = action === 'install'
      ? `Quill will open Terminal and run the official ${label} installer.`
      : `Quill will open Terminal and start the official ${label} browser login.`
    if (!confirm(`${action === 'install' ? 'Install' : 'Sign in to'} ${label}?\n\n${detail}`)) return

    const key = `${provider}:${action}`
    setSetupBusy(key)
    setSetupMessage(null)
    setError(null)
    try {
      const result = await api.providerSetupAction(provider, action)
      setSetupMessage({
        ok: true,
        text: `${result.message} A Terminal window should be open now. Finish the Terminal/browser steps, then click Recheck. If no Terminal window appears, macOS may be blocking Quill from controlling Terminal; allow it in System Settings > Privacy & Security > Automation.`,
      })
      window.setTimeout(load, 2500)
    } catch (e: any) {
      setSetupMessage({ ok: false, text: e?.message || String(e) })
    } finally {
      setSetupBusy(null)
    }
  }

  const uploadCv = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await api.uploadDocument('cv', file, true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const saveProfile = async () => {
    setSavingProfile(true)
    setError(null)
    try {
      await api.patchProfile({
        name: profileDraft.name,
        email: profileDraft.email,
        current_role: profileDraft.role,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingProfile(false)
    }
  }

  const finish = () => {
    localStorage.setItem('postdoc.setup.completed', 'true')
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-full overflow-x-hidden py-5 md:py-7" style={{ color: 'var(--color-ink)' }}>
      <div
        className="mx-auto flex w-full min-w-0 flex-col gap-5"
        style={{ width: 'calc(100% - 40px)', maxWidth: '64rem' }}
      >
        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>Welcome / Setup</div>
            <h1 className="max-w-full text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">Set up Quill AI</h1>
            <p className="mt-2 max-w-full text-[15px] leading-6" style={{ color: 'var(--color-ink-soft)' }}>
              Complete these checks once. The app helps graduate applicants find research positions and uses your installed Claude or Codex account for Quill.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-[13px] font-medium"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Recheck
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]"
            style={{
              borderColor: backendStarting ? 'var(--color-amber-200)' : 'var(--color-rose-200)',
              background: backendStarting ? 'var(--color-amber-50)' : 'var(--color-rose-50)',
              color: backendStarting ? 'var(--color-amber-700)' : 'var(--color-rose-700)',
            }}>
            {backendStarting ? <RefreshCw size={15} className="mt-0.5 shrink-0 animate-spin" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
            <span>{error}</span>
          </div>
        )}

        <div className="grid min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid min-w-0 max-w-full gap-4">
            <SetupCard
              icon={<HardDrive size={18} />}
              title="Local app storage"
              status={state.desktop ? 'ready' : loading || backendStarting ? 'checking' : 'needs_attention'}
              detail={state.desktop ? 'Backend and local storage are available.' : loading || backendStarting ? 'Starting local backend...' : 'The local backend is not responding yet.'}
            >
              <div className="grid gap-2 text-[13px]">
                <InfoRow label="Mode" value={state.desktop?.desktop_mode ? 'Desktop app' : state.desktop ? 'Browser development' : 'Checking'} />
                <InfoRow label="Data folder" value={state.desktop?.data_dir || 'Waiting for backend'} mono />
              </div>
            </SetupCard>

            <SetupCard
              icon={<Terminal size={18} />}
              title="Choose Quill provider"
              status={hasProvider ? 'ready' : loading ? 'checking' : 'needs_attention'}
              detail={hasProvider ? `Quill will use ${labelProvider(activeProvider)}.` : 'Install or sign in to Claude Code or Codex, then choose one.'}
            >
              {setupMessage && (
                <div className="mb-3 rounded-md border px-3 py-2 text-[12px]"
                  style={{
                    borderColor: setupMessage.ok ? 'var(--color-green-200)' : 'var(--color-rose-200)',
                    background: setupMessage.ok ? 'var(--color-green-50)' : 'var(--color-rose-50)',
                    color: setupMessage.ok ? 'var(--color-green-700)' : 'var(--color-rose-700)',
                  }}>
                  {setupMessage.text}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <ProviderChoice
                  name="Claude"
                  description="Use Claude Code/CLI on this computer."
                  available={!!state.providers?.claude_cli.available || !!state.setup?.providers.claude_cli.installed}
                  selected={activeProvider === 'claude_cli'}
                  busy={savingProvider === 'claude_cli'}
                  onClick={() => chooseProvider('claude_cli')}
                  setup={state.setup?.providers.claude_cli || null}
                  setupBusy={setupBusy}
                  onSetupAction={(action) => runProviderSetup('claude_cli', action)}
                />
                <ProviderChoice
                  name="Codex"
                  description="Use Codex CLI on this computer."
                  available={!!state.providers?.codex_cli.available || !!state.setup?.providers.codex_cli.installed}
                  selected={activeProvider === 'codex_cli'}
                  busy={savingProvider === 'codex_cli'}
                  onClick={() => chooseProvider('codex_cli')}
                  setup={state.setup?.providers.codex_cli || null}
                  setupBusy={setupBusy}
                  onSetupAction={(action) => runProviderSetup('codex_cli', action)}
                />
              </div>
              <div className="mt-3 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                Need API keys or advanced options? Open <Link to="/settings" className="font-medium underline">Settings</Link>.
              </div>
            </SetupCard>

            <SetupCard
              icon={<FileUp size={18} />}
              title="Add your CV"
              status={defaultCv ? 'ready' : loading ? 'checking' : 'needs_attention'}
              detail={defaultCv ? `${defaultCv.filename} is ready for profile extraction and outreach drafts.` : 'Upload a PDF or DOCX CV to seed your profile and drafts.'}
            >
              <input ref={inputRef} type="file" accept=".pdf,.doc,.docx,.txt,.md" className="hidden" onChange={(e) => uploadCv(e.target.files)} />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-[14px] font-semibold text-white"
                  style={{ background: 'var(--color-brand-600)' }}
                >
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
                  {uploading ? 'Uploading...' : defaultCv ? 'Replace CV' : 'Upload CV'}
                </button>
                {defaultCv && (
                  <div className="min-w-0 text-[13px]" style={{ color: 'var(--color-muted)' }}>
                    <div className="truncate font-medium" style={{ color: 'var(--color-ink)' }}>{defaultCv.filename}</div>
                    <div>{defaultCv.text_chars.toLocaleString()} text chars extracted</div>
                  </div>
                )}
              </div>
            </SetupCard>

            <SetupCard
              icon={<User size={18} />}
              title="Profile basics"
              status={hasProfileName ? 'ready' : 'needs_attention'}
              detail={hasProfileName ? 'Your basic identity is saved.' : 'Add your name so greetings, drafts, and profile extraction have a verified identity.'}
            >
              <div className="grid gap-3">
                <TextField label="Name" value={profileDraft.name} onChange={(v) => setProfileDraft((p) => ({ ...p, name: v }))} placeholder="Your full name" />
                <TextField label="Email" value={profileDraft.email} onChange={(v) => setProfileDraft((p) => ({ ...p, email: v }))} placeholder="you@university.edu" />
                <TextField label="Role" value={profileDraft.role} onChange={(v) => setProfileDraft((p) => ({ ...p, role: v }))} placeholder="PhD candidate" />
              </div>
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-[13px] font-medium"
                style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}
              >
                {savingProfile ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                Save profile
              </button>
            </SetupCard>
          </div>

          <aside className="h-fit min-w-0 max-w-full rounded-lg border p-4" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}>
            <div className="flex items-center gap-2">
              <Sparkles size={17} style={{ color: 'var(--color-brand-600)' }} />
              <h2 className="text-[17px] font-semibold">Setup status</h2>
            </div>
            <div className="mt-4 grid gap-2">
              <StatusLine label="Local backend" status={state.desktop ? 'ready' : loading || backendStarting ? 'checking' : 'needs_attention'} />
              <StatusLine label="AI provider" status={hasProvider ? 'ready' : loading ? 'checking' : 'needs_attention'} />
              <StatusLine label="CV uploaded" status={defaultCv ? 'ready' : loading ? 'checking' : 'needs_attention'} />
              <StatusLine label="Profile name" status={hasProfileName ? 'ready' : loading ? 'checking' : 'needs_attention'} />
            </div>
            <button
              onClick={finish}
              disabled={!essentialsComplete}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-[14px] font-semibold"
              style={{
                background: essentialsComplete ? 'var(--color-ink)' : 'var(--color-line)',
                color: essentialsComplete ? 'var(--color-white)' : 'var(--color-muted)',
              }}
            >
              Open dashboard
            </button>
            <Link
              to="/settings"
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border px-3 text-[13px] font-medium"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              <Settings size={15} />
              Advanced settings
            </Link>
          </aside>
        </div>
      </div>
    </div>
  )
}

function SetupCard({ icon, title, status, detail, children }: {
  icon: ReactNode
  title: string
  status: 'ready' | 'checking' | 'needs_attention'
  detail: string
  children: ReactNode
}) {
  const ready = status === 'ready'
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-lg border p-4" style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
            style={{ background: ready ? 'var(--color-green-50)' : 'var(--color-amber-50)', color: ready ? 'var(--color-green-700)' : 'var(--color-amber-700)' }}>
            {icon}
          </div>
          <div>
            <h2 className="text-[18px] font-semibold">{title}</h2>
            <p className="mt-1 text-[13px] leading-5" style={{ color: 'var(--color-muted)' }}>{detail}</p>
          </div>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function StatusPill({ status }: { status: 'ready' | 'checking' | 'needs_attention' }) {
  if (status === 'checking') {
    return <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}><Loader2 size={12} className="animate-spin" /> Checking</span>
  }
  const ready = status === 'ready'
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]"
      style={{
        borderColor: ready ? 'var(--color-green-200)' : 'var(--color-amber-200)',
        background: ready ? 'var(--color-green-50)' : 'var(--color-amber-50)',
        color: ready ? 'var(--color-green-700)' : 'var(--color-amber-700)',
      }}>
      {ready ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      {ready ? 'Ready' : 'Needs setup'}
    </span>
  )
}

function ProviderChoice({ name, description, available, selected, busy, onClick, setup, setupBusy, onSetupAction }: {
  name: string
  description: string
  available: boolean
  selected: boolean
  busy: boolean
  onClick: () => void
  setup: ProviderSetupStatus['providers']['claude_cli'] | ProviderSetupStatus['providers']['codex_cli'] | null
  setupBusy: string | null
  onSetupAction: (action: 'install' | 'login') => void
}) {
  const installBusy = setupBusy === `${setup?.provider}:install`
  const loginBusy = setupBusy === `${setup?.provider}:login`
  const installed = setup?.installed ?? available
  const signedIn = setup?.authenticated === true

  return (
    <div
      className="min-h-[132px] rounded-lg border p-3 text-left transition-colors"
      style={{
        borderColor: selected ? 'var(--color-brand-600)' : 'var(--color-line)',
        background: selected ? 'var(--color-brand-50)' : 'var(--color-paper-2)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">{name}</div>
        {busy ? <Loader2 size={15} className="animate-spin" /> : selected ? <CheckCircle2 size={15} style={{ color: 'var(--color-brand-700)' }} /> : null}
      </div>
      <p className="mt-2 text-[13px] leading-5" style={{ color: 'var(--color-muted)' }}>{description}</p>
      <div className="mt-3 text-[12px] font-medium" style={{ color: installed ? 'var(--color-green-700)' : 'var(--color-amber-700)' }}>
        {installed ? (signedIn ? 'Installed and signed in' : 'Installed; sign in needed') : 'Not detected yet'}
      </div>
      {setup?.account && (
        <div className="mt-1 truncate text-[12px]" style={{ color: 'var(--color-muted)' }}>{setup.account}</div>
      )}
      {setup?.message && installed && !signedIn && (
        <div className="mt-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>{setup.message}</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!installed && setup?.can_install && (
          <button
            type="button"
            onClick={() => onSetupAction('install')}
            disabled={installBusy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}
          >
            {installBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Install
          </button>
        )}
        {installed && !signedIn && setup?.can_login && (
          <button
            type="button"
            onClick={() => onSetupAction('login')}
            disabled={loginBusy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper)' }}
          >
            {loginBusy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
            Sign in
          </button>
        )}
        {installed && signedIn && (
          <button
            type="button"
            onClick={onClick}
            disabled={!available || busy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-white"
            style={{ background: selected ? 'var(--color-green-700)' : 'var(--color-brand-600)' }}
          >
            {selected ? <CheckCircle2 size={13} /> : null}
            {selected ? 'Selected' : 'Use'}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusLine({ label, status }: { label: string; status: 'ready' | 'checking' | 'needs_attention' }) {
  const done = status === 'ready'
  const checking = status === 'checking'
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px]" style={{ background: 'var(--color-paper)' }}>
      <span>{label}</span>
      {done ? (
        <CheckCircle2 size={15} style={{ color: 'var(--color-green-700)' }} />
      ) : checking ? (
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--color-muted)' }} />
      ) : (
        <AlertCircle size={15} style={{ color: 'var(--color-amber-700)' }} />
      )}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 max-w-full gap-1 overflow-hidden sm:grid-cols-[120px_minmax(0,1fr)]">
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className={`block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</span>
    </div>
  )
}

function TextField({ label, value, onChange, placeholder }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="grid gap-1.5 text-[13px]">
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-md border px-3 text-[14px] outline-none"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-paper-2)' }}
      />
    </label>
  )
}

function labelProvider(provider: string) {
  if (provider === 'claude_cli') return 'Claude'
  if (provider === 'codex_cli') return 'Codex'
  if (provider === 'anthropic_api') return 'Anthropic API'
  if (provider === 'openai_api') return 'OpenAI API'
  return provider.replace(/_/g, ' ')
}
