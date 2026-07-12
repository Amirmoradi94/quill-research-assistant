import { NavLink } from 'react-router-dom'
import {
  House,
  Compass,
  Users,
  Mail,
  SendHorizontal,
  CheckCheck,
  GraduationCap,
  Folder,
  CalendarDays,
  TrendingUp,
  Settings,
  User as UserIcon,
  Zap,
  ShieldCheck,
} from 'lucide-react'
import quillLogoMark from '@/assets/brand/quill-logo-mark.png'

const NAV = [
  { to: '/',           label: 'Home',       icon: House,           end: true },
  { to: '/profile',    label: 'Profile',    icon: UserIcon },
  { to: '/discover',   label: 'Discover',   icon: Compass },
  { to: '/professors', label: 'Professors', icon: Users },
  { to: '/drafts',     label: 'Drafts',     icon: Mail },
  { to: '/batches',    label: 'Batches',    icon: SendHorizontal },
  { to: '/sent',       label: 'Sent',       icon: CheckCheck },
  { to: '/interview-prep', label: 'Interview Prep', icon: GraduationCap },
  { to: '/documents',  label: 'Documents',  icon: Folder },
  { to: '/calendar',   label: 'Calendar',   icon: CalendarDays },
] as const

// Activity remains hidden from sidebar but routes remain accessible by URL.
const NAV_INSIGHTS: ReadonlyArray<{ to: string; label: string; icon: typeof TrendingUp | typeof Zap }> = [
  { to: '/ai-runs', label: 'Recovery', icon: Zap },
]
// const NAV_INSIGHTS = [
//   { to: '/activity', label: 'Activity', icon: TrendingUp },
//   { to: '/ai-runs',  label: 'AI Runs',  icon: Zap },
// ] as const

export function Sidebar({
  user,
}: {
  user: {
    name: string
    email: string | null
    isAdmin: boolean
    creditCapUsd: number | null
    creditUsedUsd: number | null
    creditRemainingUsd: number | null
  }
}) {
  return (
    <aside
      className="flex h-full min-h-0 flex-col py-4 px-3 text-[15px] border-r"
      style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <div className="grid h-8 w-8 place-items-center overflow-visible rounded-[9px]">
          <img src={quillLogoMark} alt="" className="h-8 w-8 object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] truncate">Quill AI</div>
          {user.email && (
            <div className="text-[12px] truncate" style={{ color: 'var(--color-muted)' }}>
              {user.email}
            </div>
          )}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5">
        {NAV.map((it) => (
          <NavItem key={it.to} {...it} />
        ))}

        {NAV_INSIGHTS.length > 0 && (
          <>
            <div className="text-[12px] uppercase tracking-wider px-2.5 pt-3.5 pb-1" style={{ color: 'var(--color-muted-2)' }}>
              Insights
            </div>
            {NAV_INSIGHTS.map((it) => (
              <NavItem key={it.to} {...it} />
            ))}
          </>
        )}

        <div className="my-2 flex-1" />

        {!user.isAdmin && user.creditCapUsd !== null && (
          <CreditWidget
            cap={user.creditCapUsd}
            used={user.creditUsedUsd ?? 0}
            remaining={user.creditRemainingUsd ?? user.creditCapUsd}
          />
        )}

        {user.isAdmin && <NavItem to="/admin" label="Admin" icon={ShieldCheck} />}
        <NavItem to="/settings" label="Settings" icon={Settings} />
      </nav>
    </aside>
  )
}

function CreditWidget({ cap, used, remaining }: { cap: number; used: number; remaining: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  return (
    <div
      className="mb-2 rounded-md border px-2.5 py-2 text-[12px]"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-white)' }}
    >
      <div className="flex items-center justify-between">
        <span style={{ color: 'var(--color-ink-soft)' }}>Quill credit</span>
        <span className="font-mono font-semibold" style={{ color: 'var(--color-ink)' }}>
          ${remaining.toFixed(2)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-paper)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: pct >= 100 ? 'var(--color-rose-500, #e11d48)' : 'var(--color-ink)',
          }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between" style={{ color: 'var(--color-muted)' }}>
        <span>${used.toFixed(2)} used</span>
        <span>${cap.toFixed(2)} total</span>
      </div>
    </div>
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
        `flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${
          isActive ? 'is-active' : ''
        }`
      }
      style={({ isActive }) => ({
        color: isActive ? 'var(--color-white)' : 'var(--color-ink-soft)',
        background: isActive ? 'var(--color-ink)' : 'transparent',
        fontWeight: isActive ? 600 : 400,
        boxShadow: isActive ? '0 1px 2px rgba(17,24,39,0.08)' : 'none',
      })}
    >
      <Icon size={16} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="font-mono text-[12px]" style={{ color: 'var(--color-muted)' }}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}
