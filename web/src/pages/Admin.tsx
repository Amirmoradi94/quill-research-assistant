import { useEffect, useState } from 'react'
import { ShieldCheck, AlertCircle, Save } from 'lucide-react'
import { api, type AdminUser } from '@/lib/api'

export function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

  const load = () => {
    api.adminListUsers()
      .then((rows) => { setUsers(rows); setErr(null) })
      .catch((e: any) => setErr(e?.message || String(e)))
  }

  useEffect(load, [])

  const notFound = err?.startsWith('404')

  if (notFound) {
    return (
      <div className="px-8 py-6">
        <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>Home / Admin</div>
        <div className="mt-4 flex items-start gap-2 rounded-md px-3 py-2 text-[13px] max-w-lg"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>This page is only available to admin accounts.</span>
        </div>
      </div>
    )
  }

  const patch = async (id: number, body: Partial<{ credit_cap_usd: number | null; is_admin: boolean; is_active: boolean }>) => {
    setSavingId(id)
    try {
      const updated = await api.adminPatchUser(id, body)
      setUsers((prev) => prev?.map((u) => (u.id === id ? updated : u)) ?? prev)
      setErr(null)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="px-8 py-6 max-w-4xl">
      <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>Home / Admin</div>
      <h1 className="font-bold tracking-tight mb-5" style={{ fontSize: 36, color: 'var(--color-ink)' }}>
        Admin
      </h1>

      <section className="rounded-md border p-4 mb-4"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
        <h2 className="text-[15px] font-semibold flex items-center gap-2 mb-1" style={{ color: 'var(--color-ink)' }}>
          <ShieldCheck size={16} />
          Accounts
        </h2>
        <div className="text-[13px] mb-3" style={{ color: 'var(--color-muted)', lineHeight: 1.55 }}>
          Manage every signed-up account's AI credit cap, admin status, and active state.
        </div>

        {err && !notFound && (
          <div className="mb-3 flex items-start gap-2 rounded-md px-3 py-2 text-[12px]"
            style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {users === null ? (
          <div className="text-[13px]" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: 'var(--color-muted)' }}>
                <th className="text-left font-medium pb-2 pr-3">Email</th>
                <th className="text-left font-medium pb-2 pr-3">Admin</th>
                <th className="text-left font-medium pb-2 pr-3">Active</th>
                <th className="text-left font-medium pb-2 pr-3">Credit cap</th>
                <th className="text-left font-medium pb-2 pr-3">Used</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} saving={savingId === u.id} onPatch={(body) => patch(u.id, body)} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function UserRow({
  user, saving, onPatch,
}: {
  user: AdminUser
  saving: boolean
  onPatch: (body: Partial<{ credit_cap_usd: number | null; is_admin: boolean; is_active: boolean }>) => void
}) {
  const [cap, setCap] = useState(user.credit_cap_usd === null ? '' : String(user.credit_cap_usd))
  useEffect(() => {
    setCap(user.credit_cap_usd === null ? '' : String(user.credit_cap_usd))
  }, [user.credit_cap_usd])

  return (
    <tr className="border-t" style={{ borderColor: 'var(--color-line)' }}>
      <td className="py-2 pr-3" style={{ color: 'var(--color-ink)' }}>{user.account_email || '—'}</td>
      <td className="py-2 pr-3">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={user.is_admin}
            disabled={saving}
            onChange={(e) => onPatch({ is_admin: e.target.checked })}
          />
        </label>
      </td>
      <td className="py-2 pr-3">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={user.is_active}
            disabled={saving}
            onChange={(e) => onPatch({ is_active: e.target.checked })}
          />
        </label>
      </td>
      <td className="py-2 pr-3">
        {user.is_admin ? (
          <span style={{ color: 'var(--color-muted)' }}>unlimited</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="0.01"
              min="0"
              value={cap}
              disabled={saving}
              onChange={(e) => setCap(e.target.value)}
              className="w-20 px-2 py-1 rounded-md border text-[12px] outline-none"
              style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line)' }}
            />
            <button
              disabled={saving}
              onClick={() => onPatch({ credit_cap_usd: cap === '' ? null : Number(cap) })}
              className="px-2 py-1 rounded-md border text-[12px] inline-flex items-center gap-1"
              style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              <Save size={12} />
            </button>
          </div>
        )}
      </td>
      <td className="py-2 pr-3" style={{ color: 'var(--color-muted)' }}>
        {user.is_admin ? '—' : `$${(user.credit_used_usd ?? 0).toFixed(2)}`}
      </td>
    </tr>
  )
}
