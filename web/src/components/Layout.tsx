import { Outlet } from 'react-router-dom'
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Sidebar } from './Sidebar'
import { QuillRail } from './QuillRail'
import { ConfirmProvider } from './ConfirmDialog'
import { api, type UserProfile } from '@/lib/api'
import { startReminderNotifications } from '@/lib/desktopNotifications'

const QUILL_RAIL_DEFAULT_WIDTH = 368
const QUILL_RAIL_MIN_WIDTH = 320
const QUILL_RAIL_MAX_WIDTH = 640

function clampRailWidth(value: number) {
  return Math.max(QUILL_RAIL_MIN_WIDTH, Math.min(QUILL_RAIL_MAX_WIDTH, Math.round(value)))
}

function loadRailWidth() {
  try {
    const saved = Number(localStorage.getItem('quill-rail-width'))
    if (Number.isFinite(saved)) return clampRailWidth(saved)
  } catch {}
  return QUILL_RAIL_DEFAULT_WIDTH
}

export function Layout() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [quillWidth, setQuillWidth] = useState(loadRailWidth)

  useEffect(() => {
    api.profile().then(setProfile).catch(() => {})
  }, [])

  useEffect(() => startReminderNotifications(), [])

  const user = {
    name: profile?.name || 'User',
    email: profile?.email || null,
  }

  function startRailResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const move = (evt: PointerEvent) => {
      const next = clampRailWidth(window.innerWidth - evt.clientX)
      setQuillWidth(next)
      try { localStorage.setItem('quill-rail-width', String(next)) } catch {}
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const shellStyle = {
    '--quill-rail-width': `${quillWidth}px`,
  } as CSSProperties

  return (
    <ConfirmProvider>
      <div
        className="grid h-screen overflow-hidden grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_var(--quill-rail-width)]"
        style={shellStyle}
      >
        <div className="hidden lg:block min-h-0 overflow-hidden">
          <Sidebar user={user} />
        </div>
        <main className="quill-type-scale overflow-y-auto min-h-0 min-w-0" style={{ background: 'var(--color-paper)' }}>
          <Outlet />
        </main>
        <div className="quill-type-scale relative hidden h-screen min-h-0 overflow-hidden xl:block">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Quill panel"
            aria-valuemin={QUILL_RAIL_MIN_WIDTH}
            aria-valuemax={QUILL_RAIL_MAX_WIDTH}
            aria-valuenow={quillWidth}
            onPointerDown={startRailResize}
            className="group absolute left-0 top-0 z-20 h-full w-2 cursor-col-resize"
          >
            <div className="mx-auto h-full w-px transition-colors group-hover:bg-[color:var(--color-brand-500)]"
              style={{ background: 'var(--color-line)' }} />
          </div>
          <QuillRail />
        </div>
      </div>
    </ConfirmProvider>
  )
}
