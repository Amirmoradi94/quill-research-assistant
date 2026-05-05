import { Sparkles, History, X, Paperclip, ArrowUp } from 'lucide-react'
import { useState } from 'react'

/**
 * Quill chat rail — placeholder for now (Phase 1 wires up the real SSE stream).
 * Layout matches design board section 12.
 */
export function QuillRail() {
  const [text, setText] = useState('')

  return (
    <aside
      className="flex flex-col border-l"
      style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}
    >
      <header
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: 'var(--color-amber-600)' }} />
          <span className="font-semibold text-[14px]">Quill</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'var(--color-paper-2)', color: 'var(--color-muted)' }}
          >
            idle
          </span>
        </div>
        <div className="flex gap-1">
          <button
            className="p-1.5 rounded transition-colors hover:bg-[color:var(--color-paper-2)]"
            title="History"
          >
            <History size={14} style={{ color: 'var(--color-muted)' }} />
          </button>
          <button
            className="p-1.5 rounded transition-colors hover:bg-[color:var(--color-paper-2)]"
            title="Close"
          >
            <X size={14} style={{ color: 'var(--color-muted)' }} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-[14px]">
        <div className="mb-3">
          <div className="text-[11px] font-mono mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Quill · 14:18
          </div>
          <div style={{ color: 'var(--color-ink-soft)', lineHeight: 1.55 }}>
            Hi. The runner is wired up — the dashboard backend just needs the SSE
            route mounted and we can stream real workflow output here. Phase 1.
          </div>
        </div>
      </div>

      <div className="px-4 py-2 flex flex-wrap gap-1.5">
        {['Find new profs', 'This week\'s stats', 'What should I do today?'].map((p) => (
          <button
            key={p}
            className="px-2.5 py-1 text-[11px] rounded-full border transition-colors"
            style={{
              background: 'var(--color-paper-2)',
              borderColor: 'var(--color-line)',
              color: 'var(--color-ink-soft)',
            }}
            onClick={() => setText(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="px-4 pb-4 pt-2 border-t" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
        <div
          className="relative rounded-md border px-3 py-2 pr-20 transition-colors"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-line-strong)' }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask Quill…"
            rows={1}
            className="w-full bg-transparent border-0 outline-none resize-none text-[14px] leading-[1.55]"
            style={{ color: 'var(--color-ink)', minHeight: 22, maxHeight: 180 }}
          />
          <div className="absolute right-2 bottom-2 flex gap-1">
            <button className="p-1.5 rounded transition-colors hover:bg-[color:var(--color-paper-2)]" title="Attach">
              <Paperclip size={14} style={{ color: 'var(--color-muted)' }} />
            </button>
            <button
              className="p-1.5 rounded transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-brand-500)', color: 'white' }}
              disabled={!text.trim()}
              title="Send (Cmd+Enter)"
            >
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
