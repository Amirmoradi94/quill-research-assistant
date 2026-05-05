function App() {
  return (
    <div className="min-h-screen p-10" style={{ background: 'var(--color-paper)', color: 'var(--color-ink)' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-9 h-9 rounded-[9px] grid place-items-center text-white font-bold text-xs"
            style={{
              background:
                'linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))',
            }}
          >
            AM
          </div>
          <div>
            <div className="font-semibold text-[15px]">Postdoc Dashboard</div>
            <div className="text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
              phase 0 · web scaffold
            </div>
          </div>
        </div>

        <h1 className="text-[32px] font-bold tracking-tight mt-8 mb-1">Phase 0 is live.</h1>
        <p className="text-[15px] mb-8 max-w-2xl" style={{ color: 'var(--color-ink-soft)' }}>
          Vite + React + TypeScript + Tailwind v4 are wired up with the locked
          Higher-contrast warm palette. The existing dashboard is still running on{' '}
          <Code>:8000</Code>; this React app runs on <Code>:5173</Code> and proxies{' '}
          <Code>/api/*</Code> to it.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-10">
          <Kpi label="Surface" value="paper" hex="#fbfaf7" />
          <Kpi label="Sidebar" value="paper-2" hex="#ebe7dc" />
          <Kpi label="Brand" value="brand-500" hex="#3b6fe0" />
        </div>

        <h2
          className="text-[11px] font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--color-muted)' }}
        >
          Token sanity check
        </h2>

        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--color-white)', border: '1px solid var(--color-line)' }}
        >
          <div className="flex flex-wrap gap-2 mb-4">
            <Pill bg="var(--color-brand-50)" fg="var(--color-brand-700)">RL</Pill>
            <Pill bg="var(--color-green-50)" fg="var(--color-green-700)">Awarded</Pill>
            <Pill bg="var(--color-amber-50)" fg="var(--color-amber-700)">Follow-up due</Pill>
            <Pill bg="var(--color-rose-50)" fg="var(--color-rose-700)">Declined</Pill>
            <Pill bg="var(--color-paper-2)" fg="var(--color-muted)">Drafting</Pill>
          </div>
          <div className="flex gap-2">
            <Btn primary>Primary</Btn>
            <Btn>Secondary</Btn>
            <Btn ghost>Ghost</Btn>
          </div>
        </div>

        <p
          className="text-[11px] mt-10 font-mono"
          style={{ color: 'var(--color-muted-2)' }}
        >
          dashboard/web · light mode only · Inter 15px
        </p>
      </div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="mx-1 px-1.5 py-0.5 rounded font-mono text-[13px]"
      style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink)' }}
    >
      {children}
    </code>
  )
}

function Kpi({ label, value, hex }: { label: string; value: string; hex: string }) {
  return (
    <div
      className="rounded-md p-4"
      style={{ background: 'var(--color-white)', border: '1px solid var(--color-line)' }}
    >
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      <div className="flex items-center gap-2 mt-2">
        <div
          className="w-4 h-4 rounded"
          style={{ background: hex, border: '1px solid var(--color-line)' }}
        />
        <span className="font-mono text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {hex}
        </span>
      </div>
    </div>
  )
}

function Pill({
  bg,
  fg,
  children,
}: {
  bg: string
  fg: string
  children: React.ReactNode
}) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  )
}

function Btn({
  primary,
  ghost,
  children,
}: {
  primary?: boolean
  ghost?: boolean
  children: React.ReactNode
}) {
  const style: React.CSSProperties = primary
    ? { background: 'var(--color-brand-500)', color: 'white' }
    : ghost
    ? { background: 'transparent', color: 'var(--color-ink-soft)' }
    : {
        background: 'var(--color-white)',
        color: 'var(--color-ink)',
        border: '1px solid var(--color-line-strong)',
      }
  return (
    <button
      type="button"
      className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
      style={style}
    >
      {children}
    </button>
  )
}

export default App
