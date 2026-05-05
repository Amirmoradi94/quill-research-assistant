import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { QuillRail } from './QuillRail'

export function Layout() {
  return (
    <div
      className="grid h-screen"
      style={{ gridTemplateColumns: '230px 1fr 360px' }}
    >
      <Sidebar user={{ name: 'Amir', email: 'amir@example.com' }} />
      <main className="overflow-y-auto" style={{ background: 'var(--color-paper)' }}>
        <Outlet />
      </main>
      <QuillRail />
    </div>
  )
}
