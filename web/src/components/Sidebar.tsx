import { NavLink } from 'react-router-dom'
import {
  House,
  Compass,
  Users,
  Mail,
  SendHorizontal,
  Banknote,
  Folder,
  CalendarDays,
  Activity,
  Zap,
  Settings,
} from 'lucide-react'

const NAV = [
  { to: '/',           label: 'Home',       icon: House,           end: true },
  { to: '/discover',   label: 'Discover',   icon: Compass,         badge: 12 },
  { to: '/professors', label: 'Professors', icon: Users },
  { to: '/drafts',     label: 'Drafts',     icon: Mail },
  { to: '/batches',    label: 'Batches',    icon: SendHorizontal },
  { to: '/grants',     label: 'Grants',     icon: Banknote },
  { to: '/documents',  label: 'Documents',  icon: Folder },
  { to: '/calendar',   label: 'Calendar',   icon: CalendarDays },
] as const

const NAV_INSIGHTS = [
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/ai-runs',  label: 'AI Runs',  icon: Zap, badge: 2 },
] as const

export function Sidebar({ user }: { user: { name: string; email: string | null } }) {
  return (
    <aside
      className="flex flex-col py-4 px-3 text-[14px] border-r"
      style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <div
          className="w-8 h-8 rounded-[9px] grid place-items-center text-white font-bold text-[12px]"
          style={{ background: 'linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))' }}
        >
          {(user.name || 'AM').slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] truncate">Postdoc Dashboard</div>
          <div className="text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>
            {user.email || 'self-hosted'}
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV.map((it) => (
          <NavItem key={it.to} {...it} />
        ))}

        <div className="text-[11px] uppercase tracking-wider px-2.5 pt-3.5 pb-1" style={{ color: 'var(--color-muted-2)' }}>
          Insights
        </div>
        {NAV_INSIGHTS.map((it) => (
          <NavItem key={it.to} {...it} />
        ))}

        <div className="my-2" />
        <NavItem to="/settings" label="Settings" icon={Settings} />
      </nav>
    </aside>
  )
}

function NavItem({
  to, label, icon: Icon, badge, end,
}: { to: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors ${
          isActive ? 'is-active' : ''
        }`
      }
      style={({ isActive }) => ({
        color: isActive ? 'var(--color-ink)' : 'var(--color-ink-soft)',
        background: isActive ? 'var(--color-white)' : 'transparent',
        fontWeight: isActive ? 500 : 400,
        boxShadow: isActive ? '0 1px 2px rgba(17,24,39,0.04)' : 'none',
      })}
    >
      <Icon size={16} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="font-mono text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}
