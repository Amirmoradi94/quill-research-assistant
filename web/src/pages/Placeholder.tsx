import { Construction } from 'lucide-react'

export function Placeholder({ title, section }: { title: string; section: string }) {
  return (
    <div className="px-8 py-6">
      <div className="text-[13px] mb-1" style={{ color: 'var(--color-muted)' }}>
        Home / {title}
      </div>
      <h1 className="font-bold tracking-tight mb-5" style={{ fontSize: 36, color: 'var(--color-ink)' }}>
        {title}
      </h1>
      <div
        className="rounded-md border px-5 py-8 flex items-start gap-3 max-w-2xl"
        style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}
      >
        <Construction size={20} style={{ color: 'var(--color-amber-600)', flexShrink: 0, marginTop: 2 }} />
        <div className="text-[15px]" style={{ color: 'var(--color-ink-soft)', lineHeight: 1.6 }}>
          The <strong>{title}</strong> page is designed in{' '}
          <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-paper-2)', padding: '1px 5px', borderRadius: 3 }}>
            design-research/design-system.html
          </code>{' '}
          (Section {section}). React port lands in a follow-up Phase-0 commit.
        </div>
      </div>
    </div>
  )
}
