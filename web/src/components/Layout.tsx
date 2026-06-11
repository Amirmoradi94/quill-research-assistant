import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { QuillRail } from './QuillRail'
import { ConfirmProvider } from './ConfirmDialog'
import { api, type UserProfile } from '@/lib/api'

export function Layout() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    api.profile().then(setProfile).catch(() => {})
  }, [])

  useEffect(() => {
    if (location.pathname === '/setup') return
    if (localStorage.getItem('postdoc.setup.completed') === 'true') return

    let cancelled = false
    Promise.allSettled([
      api.desktopStatus(),
      api.documents('cv'),
      api.profile(),
    ]).then(([desktopResult, docsResult, profileResult]) => {
      if (cancelled) return
      const desktop = desktopResult.status === 'fulfilled' ? desktopResult.value : null
      const docs = docsResult.status === 'fulfilled' ? docsResult.value : []
      const p = profileResult.status === 'fulfilled' ? profileResult.value : null
      const hasProvider = !!desktop?.providers.active
      const hasCv = docs.some((doc) => doc.kind === 'cv')
      const hasProfileName = !!p?.name?.trim()
      if (!hasProvider || !hasCv || !hasProfileName) {
        navigate('/setup', { replace: true })
      }
    })

    return () => { cancelled = true }
  }, [location.pathname, navigate])

  const user = {
    name: profile?.name || 'User',
    email: profile?.email || null,
  }

  return (
    <ConfirmProvider>
      <div className="grid h-screen overflow-hidden grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_368px]">
        <div className="hidden lg:block min-h-0 overflow-hidden">
          <Sidebar user={user} />
        </div>
        <main className="overflow-y-auto min-h-0 min-w-0" style={{ background: 'var(--color-paper)' }}>
          <Outlet />
        </main>
        <div className="hidden xl:block min-h-0 overflow-hidden">
          <QuillRail />
        </div>
      </div>
    </ConfirmProvider>
  )
}
