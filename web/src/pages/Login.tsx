import { useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound, LogIn, AlertCircle } from 'lucide-react'
import quillLogoFull from '@/assets/brand/quill-logo-full-transparent.png'

export function Login({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('amir')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await onLogin(username.trim(), password)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

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
            Sign in
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Access your research dashboard and Quill assistant.
          </p>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--color-muted)' }}>
            Username
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full rounded-md border px-3 py-2 text-[14px] outline-none"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--color-muted)' }}>
            <KeyRound size={12} />
            Password
          </span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            className="w-full rounded-md border px-3 py-2 text-[14px] outline-none"
            style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink)' }}
          />
        </label>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-[12px]"
            style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-[14px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--color-ink)' }}
        >
          <LogIn size={15} />
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
