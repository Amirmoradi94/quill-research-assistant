import {
  Sparkles, History, X, Paperclip, ArrowUp, Square,
  CheckCircle2, Loader, AlertCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { runQuill, type QuillEvent } from '@/lib/quill'

type Role = 'user' | 'assistant'

type Message = {
  id: string
  role: Role
  // Free-text body (assistant messages stream in token chunks; user messages
  // are static).
  text: string
  // Embedded "tool call" cards rendered inside an assistant message.
  tools?: ToolCall[]
  meta?: { runId?: number; provider?: string; ts: number; cost?: number; durationMs?: number }
  done?: boolean
  error?: string
}

type ToolCall = {
  id: string
  name: string
  input: any
  status: 'running' | 'done' | 'error'
  result?: any
}

const SUGGESTIONS = [
  'Find new profs',
  "This week's stats",
  'What should I do today?',
] as const

export function QuillRail() {
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'boot',
      role: 'assistant',
      text:
        'Hi. The Quill backend is live — Claude or Codex runs on your machine, ' +
        'the dashboard streams the output here. Try saying hi or asking a quick question.',
      done: true,
      meta: { ts: Date.now() },
    },
  ])
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when content grows.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Auto-grow textarea.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }, [text])

  async function send() {
    const msg = text.trim()
    if (!msg || running) return
    setText('')

    // Add user message immediately.
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text: msg, done: true }
    const aiId = crypto.randomUUID()
    const aiMsg: Message = {
      id: aiId,
      role: 'assistant',
      text: '',
      tools: [],
      meta: { ts: Date.now() },
    }
    setMessages((prev) => [...prev, userMsg, aiMsg])

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)

    try {
      for await (const evt of runQuill(
        { workflow: 'chat', params: { message: msg }, max_turns: 1, timeout_s: 60 },
        { signal: controller.signal }
      )) {
        applyEvent(aiId, evt, setMessages)
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        applyError(aiId, 'Cancelled.', setMessages)
      } else {
        applyError(aiId, err?.message || String(err), setMessages)
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline; Cmd/Ctrl+Enter still sends
    // (so muscle memory keeps working for anyone used to chat apps).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

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
          <StatusPill running={running} />
        </div>
        <div className="flex gap-1">
          <button className="p-1.5 rounded transition-colors hover:bg-[color:var(--color-paper-2)]" title="History">
            <History size={14} style={{ color: 'var(--color-muted)' }} />
          </button>
          <button className="p-1.5 rounded transition-colors hover:bg-[color:var(--color-paper-2)]" title="Close">
            <X size={14} style={{ color: 'var(--color-muted)' }} />
          </button>
        </div>
      </header>

      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3 text-[14px] flex flex-col gap-3">
        {messages.map((m) => (
          <MessageView key={m.id} msg={m} />
        ))}
      </div>

      <div className="px-4 py-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((p) => (
          <button
            key={p}
            className="px-2.5 py-1 text-[11px] rounded-full border transition-colors hover:bg-[color:var(--color-white)]"
            style={{
              background: 'var(--color-paper-2)',
              borderColor: 'var(--color-line)',
              color: 'var(--color-ink-soft)',
            }}
            onClick={() => {
              setText(p)
              taRef.current?.focus()
            }}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="px-4 pb-4 pt-3 border-t" style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)' }}>
        <div
          className="quill-composer relative rounded-xl border px-4 pt-3.5 pb-12 transition-all"
          style={{
            background: 'var(--color-paper)',
            borderColor: 'var(--color-line-strong)',
            boxShadow: '0 1px 2px rgba(17,24,39,0.04)',
          }}
        >
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask Quill anything…"
            rows={1}
            disabled={running}
            className="w-full bg-transparent border-0 outline-none resize-none text-[14px] leading-[1.6] placeholder:text-[color:var(--color-muted-2)]"
            style={{ color: 'var(--color-ink)', minHeight: 56, maxHeight: 220 }}
          />

          {/* Bottom toolbar inside the shell */}
          <div className="absolute left-3 right-3 bottom-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded-md transition-colors hover:bg-[color:var(--color-paper-2)]"
                title="Attach"
              >
                <Paperclip size={15} style={{ color: 'var(--color-muted)' }} />
              </button>
              <span className="text-[10.5px] ml-1" style={{ color: 'var(--color-muted-2)' }}>
                <kbd style={kbdStyle}>Enter</kbd>&nbsp;send
                <span className="mx-1.5" style={{ opacity: 0.5 }}>·</span>
                <kbd style={kbdStyle}>Shift</kbd>&nbsp;<kbd style={kbdStyle}>Enter</kbd>&nbsp;newline
              </span>
            </div>
            {running ? (
              <button
                className="quill-send px-3 py-1.5 rounded-md text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-all hover:opacity-90 active:scale-95"
                style={{ background: 'var(--color-ink)' }}
                onClick={stop}
                title="Stop"
              >
                <Square size={11} fill="currentColor" />
                Stop
              </button>
            ) : (
              <button
                className="quill-send px-3 py-1.5 rounded-md text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--color-brand-500)' }}
                disabled={!text.trim()}
                onClick={send}
                title="Send (Enter)"
              >
                <ArrowUp size={13} />
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

// ─────────── Helpers ───────────
const kbdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  background: 'var(--color-paper-2)',
  border: '1px solid var(--color-line)',
  padding: '1px 5px',
  borderRadius: 3,
  color: 'var(--color-ink-soft)',
}

function StatusPill({ running }: { running: boolean }) {
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-mono inline-flex items-center gap-1"
      style={{
        background: running ? 'var(--color-amber-50)' : 'var(--color-paper-2)',
        color: running ? 'var(--color-amber-700)' : 'var(--color-muted)',
      }}
    >
      {running && <Loader size={9} className="animate-spin" />}
      {running ? 'streaming' : 'idle'}
    </span>
  )
}

function MessageView({ msg }: { msg: Message }) {
  if (msg.role === 'user') {
    return (
      <div
        className="self-end max-w-[90%] rounded-md px-3 py-2 text-[14px] leading-relaxed animate-[qMsgIn_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
        style={{ background: 'var(--color-brand-50)', color: 'var(--color-brand-700)' }}
      >
        {msg.text}
      </div>
    )
  }

  return (
    <div className="animate-[qMsgIn_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
      <div
        className="text-[11px] font-mono mb-1.5"
        style={{ color: 'var(--color-muted)' }}
      >
        Quill {msg.meta?.provider && `· via ${msg.meta.provider}`}
        {msg.meta?.cost !== undefined && ` · $${msg.meta.cost.toFixed(4)}`}
        {msg.meta?.durationMs !== undefined && ` · ${(msg.meta.durationMs / 1000).toFixed(1)}s`}
      </div>

      {msg.tools && msg.tools.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {msg.tools.map((t) => <ToolView key={t.id} tool={t} />)}
        </div>
      )}

      <div
        className={`text-[14px] leading-[1.6] ${msg.done ? '' : 'q-cursor'}`}
        style={{ color: 'var(--color-ink-soft)', whiteSpace: 'pre-wrap' }}
      >
        {msg.text}
      </div>

      {msg.error && (
        <div
          className="mt-2 px-3 py-2 rounded text-[12px] flex items-start gap-2"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}
        >
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{msg.error}</span>
        </div>
      )}
    </div>
  )
}

function ToolView({ tool }: { tool: ToolCall }) {
  const Icon = tool.status === 'done' ? CheckCircle2 : tool.status === 'error' ? AlertCircle : Loader
  return (
    <div
      className="rounded-sm border px-2 py-1 text-[11px] font-mono flex items-center gap-1.5"
      style={{
        background: 'var(--color-white)',
        borderColor: 'var(--color-line)',
        color:
          tool.status === 'done'  ? 'var(--color-green-700)' :
          tool.status === 'error' ? 'var(--color-rose-700)'  :
                                    'var(--color-amber-700)',
      }}
    >
      <Icon size={11} className={tool.status === 'running' ? 'animate-spin' : ''} />
      <span className="font-medium" style={{ color: 'var(--color-ink)' }}>{tool.name}</span>
      <span className="truncate" style={{ color: 'var(--color-brand-700)', maxWidth: 220 }}>
        {tool.input ? renderToolArg(tool.input) : ''}
      </span>
    </div>
  )
}

function renderToolArg(input: any): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  if (input.file_path) return input.file_path
  if (input.url) return input.url
  if (input.command) return input.command
  return JSON.stringify(input).slice(0, 60)
}

// ─────────── Event reducer ───────────
type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>

function applyEvent(aiId: string, evt: QuillEvent, setMessages: SetMessages) {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== aiId) return m
      switch (evt.kind) {
        case 'run_id': {
          return { ...m, meta: { ...(m.meta || { ts: Date.now() }), runId: evt.data.id, provider: evt.data.provider } }
        }
        case 'started':
          return m
        case 'text':
          return { ...m, text: m.text + (evt.data.text || '') }
        case 'tool_call': {
          const tools = [...(m.tools || []), { id: evt.data.id, name: evt.data.name, input: evt.data.input, status: 'running' as const }]
          return { ...m, tools }
        }
        case 'tool_result': {
          const tools = (m.tools || []).map((t) =>
            t.id === evt.data.id
              ? { ...t, status: (evt.data.is_error ? 'error' : 'done') as ToolCall['status'], result: evt.data.content }
              : t
          )
          return { ...m, tools }
        }
        case 'parsed':
          return m
        case 'done':
          return {
            ...m,
            done: true,
            meta: {
              ...(m.meta || { ts: Date.now() }),
              cost: evt.data.cost_usd,
              durationMs: evt.data.duration_ms,
            },
          }
        case 'error':
          return { ...m, done: true, error: evt.data.message }
      }
      return m
    })
  )
}

function applyError(aiId: string, message: string, setMessages: SetMessages) {
  setMessages((prev) =>
    prev.map((m) => (m.id === aiId ? { ...m, done: true, error: message } : m))
  )
}
