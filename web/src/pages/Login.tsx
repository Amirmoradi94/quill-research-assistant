import { useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound, LogIn, UserPlus, AlertCircle, Mail } from 'lucide-react'
import quillLogoFull from '@/assets/brand/quill-logo-full-transparent.png'

type Mode = 'signin' | 'signup'

export function Login({
  onLogin,
  onSignup,
}: {
  onLogin: (email: string, password: string) => Promise<void>
  onSignup: (email: string, password: string, name?: string) => Promise<void>
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (mode === 'signup') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    setLoading(true)
    try {
      if (mode === 'signin') {
        await onLogin(email.trim(), password)
      } else {
        await onSignup(email.trim(), password, name.trim())
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const canSubmit =
    mode === 'signin'
      ? !!email.trim() && !!password
      : !!email.trim() && password.length >= 8 && !!confirmPassword

  return (
    <main className="quill-type-scale grid min-h-screen place-items-center px-4 py-8"
      style={{
        background: 'var(--color-paper)',
        backgroundImage:
          'linear-gradient(rgba(28,34,48,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.045) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}>
      <form onSubmit={submit} className="w-full max-w-[390px] rounded-md border p-5"
        style={{
          background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))',
          borderColor: 'var(--color-line)',
          boxShadow: '0 12px 35px rgba(28,34,48,0.10)',
        }}>
        <div className="mb-5 flex items-center gap-3">
          <img src={quillLogoFull} alt="Quill AI" className="h-11 w-auto object-contain" />
        </div>

        <div className="mb-5">
          <h1 className="text-[24px] font-bold leading-tight" style={{ color: 'var(--color-ink)' }}>
            {mode === 'signin' ? 'Sign in' : 'Create your account'}
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Access your research dashboard and Quill assistant.
          </p>
        </div>

        <div className="mb-4 flex rounded-md border p-1" style={{ borderColor: 'var(--color-line)' }}>
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="flex-1 rounded px-3 py-1.5 text-[13px] font-medium transition-colors"
            style={{
              background: mode === 'signin' ? 'var(--color-ink)' : 'transparent',
              color: mode === 'signin' ? 'var(--color-white)' : 'var(--color-muted)',
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className="flex-1 rounded px-3 py-1.5 text-[13px] font-medium transition-colors"
            style={{
              background: mode === 'signup' ? 'var(--color-ink)' : 'transparent',
              color: mode === 'signup' ? 'var(--color-white)' : 'var(--color-muted)',
            }}
          >
            New account
          </button>
        </div>

        {mode === 'signup' && (
          <label className="mb-3 block">
            <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--color-muted)' }}>
              Name (optional)
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="w-full rounded-md border px-3 py-2 text-[14px] outline-none"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
            />
          </label>
        )}

        <label className="mb-3 block">
          <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--color-muted)' }}>
            <Mail size={12} />
            Email
          </span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            className="w-full rounded-md border px-3 py-2 text-[14px] outline-none"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--color-muted)' }}>
            <KeyRound size={12} />
            Password
          </span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="w-full rounded-md border px-3 py-2 text-[14px] outline-none"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          />
        </label>

        {mode === 'signup' && (
          <label className="mb-4 block">
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--color-muted)' }}>
              <KeyRound size={12} />
              Confirm password
            </span>
            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border px-3 py-2 text-[14px] outline-none"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
            />
          </label>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-[12px]"
            style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-[14px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--color-ink)' }}
        >
          {mode === 'signin' ? <LogIn size={15} /> : <UserPlus size={15} />}
          {loading
            ? (mode === 'signin' ? 'Signing in...' : 'Creating account...')
            : (mode === 'signin' ? 'Sign in' : 'Create account')}
        </button>
      </form>
    </main>
  )
}
