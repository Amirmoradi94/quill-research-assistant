import {
  History, Paperclip, ArrowUp, Square,
  CheckCircle2, Loader, AlertCircle, ChevronDown, ChevronRight,
  Database, FileText, Mail, WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { runQuill, type QuillEvent } from '@/lib/quill'
import quillLogoMark from '@/assets/brand/quill-logo-mark.png'

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

const REVEAL_INTERVAL_MS = 35

const BOOT_MSG: Message = {
  id: 'boot',
  role: 'assistant',
  text: 'Hi. I can inspect this dashboard, run research workflows, update local data, and help draft outreach. Ask a focused question or pick a prompt below.',
  done: true,
  meta: { ts: Date.now() },
}

const QUICK_PROMPTS = [
  { label: 'Review drafts', icon: Mail, text: 'Review the current draft queue and tell me which outreach emails need attention first.' },
  { label: 'Find gaps', icon: Database, text: 'Scan the dashboard data and summarize the biggest gaps in my application pipeline.' },
  { label: 'Improve profile', icon: FileText, text: 'Review my profile signals and suggest concrete improvements for professor matching.' },
]

const markdownComponents: Components = {
  a({ href, children }) {
    const safeHref = href && /^(https?:|mailto:|\/|#)/i.test(href) ? href : undefined
    return (
      <a href={safeHref} target={safeHref?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
        {children}
      </a>
    )
  },
  code({ className, children, ...props }) {
    const text = String(children ?? '')
    const isBlock = text.includes('\n') || Boolean(className)
    return isBlock ? (
      <code className={className} {...props}>{children}</code>
    ) : (
      <code {...props}>{children}</code>
    )
  },
  table({ children }) {
    return (
      <div className="quill-md-table-wrap">
        <table>{children}</table>
      </div>
    )
  },
  img({ src, alt }) {
    if (!src) return null
    return <img src={src} alt={alt || ''} loading="lazy" />
  },
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem('quill-history')
    if (raw) {
      const parsed = JSON.parse(raw) as Message[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return [BOOT_MSG]
}

function saveMessages(msgs: Message[]) {
  try {
    // Keep last 100 messages; skip incomplete assistant messages from prev sessions
    const clean = msgs.map((m) =>
      m.role === 'assistant' && !m.done ? { ...m, done: true } : m
    ).slice(-100)
    localStorage.setItem('quill-history', JSON.stringify(clean))
  } catch {}
}

export function QuillRail() {
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<Message[]>(loadMessages)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const revealRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const revealQueuesRef = useRef<Map<string, string[]>>(new Map())
  const pendingDoneRef = useRef<Map<string, QuillEvent>>(new Map())
  const bodyRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const pinnedToBottomRef = useRef(true)

  // Persist history to localStorage whenever messages change.
  useEffect(() => { saveMessages(messages) }, [messages])

  useEffect(() => {
    return () => {
      if (revealRef.current) clearInterval(revealRef.current)
    }
  }, [])

  // Auto-scroll only while the user is already near the bottom.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || (!pinnedToBottomRef.current && !running)) return
    window.requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: running ? 'auto' : 'smooth' })
    })
  }, [messages, running])

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
    setElapsed(0)
    elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)

    // Build conversation history for the LLM: prior user + assistant messages
    // in order, excluding the boot greeting and the freshly-added empty AI
    // message. Cap at the most recent 12 turns to keep prompt cost bounded.
    const priorHistory = messages
      .filter((m) => m.id !== 'boot' && m.done && m.text.trim().length > 0)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.text }))

    try {
      for await (const evt of runQuill(
        {
          workflow: 'chat',
          params: { message: msg, history: priorHistory },
          max_turns: 30,
          timeout_s: 120,
        },
        { signal: controller.signal }
      )) {
        handleQuillEvent(aiId, evt)
      }
    } catch (err: any) {
      clearRevealQueue(aiId)
      if (controller.signal.aborted) {
        applyError(aiId, 'Cancelled.', setMessages)
      } else {
        applyError(aiId, err?.message || String(err), setMessages)
      }
    } finally {
      setRunning(false)
      abortRef.current = null
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
      // Signal all pages to refresh their data in case Quill modified the DB.
      window.dispatchEvent(new CustomEvent('quill:data-changed'))
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function handleQuillEvent(aiId: string, evt: QuillEvent) {
    if (evt.kind === 'text') {
      enqueueReveal(aiId, evt.data.text || '')
      return
    }
    if (evt.kind === 'done' && hasQueuedReveal(aiId)) {
      pendingDoneRef.current.set(aiId, evt)
      return
    }
    applyEvent(aiId, evt, setMessages)
  }

  function enqueueReveal(aiId: string, textChunk: string) {
    if (!textChunk) return
    const queue = revealQueuesRef.current.get(aiId) ?? []
    queue.push(...splitRevealTokens(textChunk))
    revealQueuesRef.current.set(aiId, queue)
    startRevealPump()
  }

  function hasQueuedReveal(aiId: string) {
    return (revealQueuesRef.current.get(aiId)?.length ?? 0) > 0
  }

  function startRevealPump() {
    if (revealRef.current) return
    revealRef.current = setInterval(() => {
      let hasMore = false
      for (const [aiId, queue] of revealQueuesRef.current.entries()) {
        const token = queue.shift()
        if (!token) {
          revealQueuesRef.current.delete(aiId)
          const done = pendingDoneRef.current.get(aiId)
          if (done) {
            pendingDoneRef.current.delete(aiId)
            applyEvent(aiId, done, setMessages)
          }
          continue
        }
        appendMessageText(aiId, token, setMessages)
        if (queue.length > 0) hasMore = true
      }
      if (!hasMore && revealQueuesRef.current.size === 0 && revealRef.current) {
        clearInterval(revealRef.current)
        revealRef.current = null
      }
    }, REVEAL_INTERVAL_MS)
  }

  function clearRevealQueue(aiId: string) {
    revealQueuesRef.current.delete(aiId)
    pendingDoneRef.current.delete(aiId)
    if (revealQueuesRef.current.size === 0 && revealRef.current) {
      clearInterval(revealRef.current)
      revealRef.current = null
    }
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
      className="flex h-screen min-h-0 flex-col overflow-hidden border-l"
      style={{
        background: 'var(--color-paper)',
        borderColor: 'var(--color-line)',
        backgroundImage:
          'linear-gradient(rgba(28,34,48,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(28,34,48,0.045) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <header
        className="shrink-0 px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-line)', background: 'color-mix(in srgb, var(--color-white) 92%, var(--color-paper))' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center overflow-visible rounded-md">
                <img src={quillLogoMark} alt="" className="h-7 w-7 object-contain" />
              </span>
              <div className="min-w-0">
                <div className="font-bold text-[14px] leading-tight" style={{ color: 'var(--color-ink)' }}>
                  Quill
                </div>
                <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  Research assistant
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {running && (
              <button
                onClick={stop}
                className="px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1"
                style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)', border: '1px solid var(--color-line-strong)' }}
                title="Stop generation"
              >
                <Square size={9} fill="currentColor" /> Stop
              </button>
            )}
            <button
              className="p-1.5 rounded-md border transition-colors hover:bg-[color:var(--color-paper-2)]"
              title="Clear history"
              onClick={() => { setMessages([BOOT_MSG]); localStorage.removeItem('quill-history') }}
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}
            >
              <History size={14} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <StatusPill running={running} elapsed={elapsed} />
        </div>
      </header>

      <div
        ref={bodyRef}
        tabIndex={0}
        aria-label="Quill conversation"
        onScroll={(event) => {
          const el = event.currentTarget
          pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72
        }}
        onWheelCapture={(event) => event.stopPropagation()}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-3 text-[15px] focus:outline-none"
        style={{ scrollbarGutter: 'stable' }}
      >
        {messages.map((m) => (
          <MessageView key={m.id} msg={m} />
        ))}
      </div>

      <div className="mt-auto shrink-0 px-3 pb-3 pt-3 border-t" style={{ background: 'color-mix(in srgb, var(--color-white) 92%, var(--color-paper))', borderColor: 'var(--color-line)' }}>
        <div className="mb-2 flex items-center gap-1.5 flex-wrap">
          {QUICK_PROMPTS.map(({ label, icon: Icon, text: prompt }) => (
            <button
              key={label}
              onClick={() => {
                if (!running) {
                  setText(prompt)
                  taRef.current?.focus()
                }
              }}
              disabled={running}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
              style={{ background: 'var(--color-white)', borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>
        <div
          className="quill-composer relative rounded-md border px-3 pt-3 pb-11 transition-all"
          style={{
            background: 'var(--color-white)',
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
            className="w-full bg-transparent border-0 outline-none resize-none text-[14px] leading-[1.55] placeholder:text-[color:var(--color-muted-2)]"
            style={{ color: 'var(--color-ink)', minHeight: 58, maxHeight: 220 }}
          />

          {/* Bottom toolbar inside the shell */}
          <div className="absolute left-3 right-3 bottom-2.5 flex items-center justify-between gap-2">
            <button
              className="p-1.5 rounded-md transition-colors hover:bg-[color:var(--color-paper-2)] flex-shrink-0"
              title="Attach"
            >
              <Paperclip size={15} style={{ color: 'var(--color-muted)' }} />
            </button>
            <span className="text-[10px] mr-auto" style={{ color: 'var(--color-muted)' }}>
              Enter to send
            </span>
            {running ? (
              <button
                className="quill-send flex-shrink-0 px-3 py-1.5 rounded-md text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-all hover:opacity-90 active:scale-95"
                style={{ background: 'var(--color-ink)' }}
                onClick={stop}
                title="Stop"
              >
                <Square size={11} fill="currentColor" />
                Stop
              </button>
            ) : (
              <button
                className="quill-send flex-shrink-0 px-3 py-1.5 rounded-md text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--color-ink)' }}
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
function StatusPill({ running, elapsed }: { running: boolean; elapsed: number }) {
  const slow = running && elapsed > 30
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11px] font-mono inline-flex items-center gap-1"
      style={{
        background: slow ? 'var(--color-rose-50)' : running ? 'var(--color-amber-50)' : 'var(--color-paper-2)',
        color: slow ? 'var(--color-rose-700)' : running ? 'var(--color-amber-700)' : 'var(--color-muted)',
        borderColor: 'var(--color-line)',
      }}
    >
      {running && <Loader size={9} className="animate-spin" />}
      {running ? `${elapsed}s` : 'idle'}
    </span>
  )
}

function MessageView({ msg }: { msg: Message }) {
  if (msg.role === 'user') {
    return (
      <div
        className="shrink-0 self-end max-w-[88%] min-w-0 break-words rounded-md border px-3 py-2 text-[14px] leading-relaxed animate-[qMsgIn_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
        style={{ background: 'var(--color-ink)', color: 'white', borderColor: 'var(--color-ink)' }}
      >
        {msg.text}
      </div>
    )
  }

  return (
    <div className="shrink-0 min-w-0 max-w-full overflow-hidden animate-[qMsgIn_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-md border px-3 py-2.5"
      style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line)' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-mono mb-1.5" style={{ color: 'var(--color-muted)' }}>
        <WandSparkles size={11} style={{ color: 'var(--color-amber-600)' }} />
        <span>Quill</span>
        {msg.meta?.cost !== undefined && <span>${msg.meta.cost.toFixed(4)}</span>}
        {msg.meta?.durationMs !== undefined && <span>{(msg.meta.durationMs / 1000).toFixed(1)}s</span>}
      </div>

      {msg.tools && msg.tools.length > 0 && (
        <ToolActivity tools={msg.tools} done={!!msg.done} />
      )}

      <div
        className={`quill-md min-w-0 max-w-full text-[14px] leading-[1.58] ${msg.done ? '' : 'q-cursor'}`}
        style={{ color: 'var(--color-ink-soft)' }}
      >
        <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
          {prepareMarkdown(msg.text)}
        </ReactMarkdown>
      </div>

      {msg.error && (
        <div
          className="mt-2 px-3 py-2 rounded text-[13px] flex items-start gap-2"
          style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)' }}
        >
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{msg.error}</span>
        </div>
      )}
    </div>
  )
}

function ToolActivity({ tools, done }: { tools: ToolCall[]; done: boolean }) {
  const [expanded, setExpanded] = useState(false)

  const running = tools.find((t) => t.status === 'running')
  const latest = running ?? tools[tools.length - 1]
  const errCount = tools.filter((t) => t.status === 'error').length
  const total = tools.length

  if (!done) {
    // In-progress: single animated line showing the current tool
    return (
      <div className="mb-2 flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-mono"
        style={{ color: 'var(--color-amber-700)', background: 'var(--color-amber-50)', borderColor: 'var(--color-line)' }}>
        <Loader size={11} className="animate-spin shrink-0" />
        <span className="truncate" style={{ maxWidth: 280 }}>
          {latest ? `${latest.name} ${toolArg(latest.input)}` : 'working…'}
        </span>
      </div>
    )
  }

  // Completed: collapsed summary with optional expand
  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-mono"
        style={{
          color: errCount ? 'var(--color-rose-700)' : 'var(--color-muted)',
          borderColor: 'var(--color-line)',
          background: errCount ? 'var(--color-rose-50)' : 'var(--color-paper)',
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {errCount
          ? `${total} steps · ${errCount} error${errCount > 1 ? 's' : ''}`
          : `${total} step${total > 1 ? 's' : ''}`}
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-0.5 pl-3 border-l"
          style={{ borderColor: 'var(--color-line)' }}>
          {tools.map((t) => (
            <div key={t.id} className="flex items-center gap-1.5 text-[11px] font-mono truncate"
              style={{
                color: t.status === 'error' ? 'var(--color-rose-700)'
                  : t.status === 'done' ? 'var(--color-muted)'
                  : 'var(--color-amber-700)',
              }}>
              {t.status === 'done' ? <CheckCircle2 size={10} />
                : t.status === 'error' ? <AlertCircle size={10} />
                : <Loader size={10} className="animate-spin" />}
              <span className="font-medium" style={{ color: 'var(--color-ink-soft)' }}>{t.name}</span>
              <span className="truncate opacity-60">{toolArg(t.input)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Keep model output renderable as Markdown while fixing common model/streaming
// artifacts: chunks can arrive as "sentence.Next sentence", and models often
// compress sections into "*Section:* 7. Item 8. Item" instead of real lists.
function prepareMarkdown(text: string): string {
  if (!text) return text
  return text
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])(```)/g, '$1\n$2')
    .replace(/(```[^\n]*\n[\s\S]*?\n```)(?=\S)/g, '$1\n\n')
    .replace(/(^|\n)\*([^*\n:]{2,80}):\*\s+(?=\d{1,3}\.\s)/g, '$1**$2:**\n\n')
    .replace(/(^|\n)_([^_\n:]{2,80}):_\s+(?=\d{1,3}\.\s)/g, '$1**$2:**\n\n')
    .replace(/([^\n])[ \t]+(\d{1,3})\.\s+(?=(?:"|“|[A-Z][^.\n]{2,}))/g, '$1\n$2. ')
    .replace(/([^\n])[ \t]+([-*+])\s+(?=\S)/g, '$1\n$2 ')
    .replace(/([.!?])(?=[A-Z0-9])/g, '$1\n\n')
    .replace(/(:)(?=-\s|\*\s|\d+\.\s)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
}

function toolArg(input: any): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  if (input.command) return input.command
  if (input.file_path) return input.file_path
  if (input.url) return input.url
  if (input.pattern) return input.pattern
  return JSON.stringify(input).slice(0, 80)
}

// ─────────── Event reducer ───────────
type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>

function splitRevealTokens(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

function appendMessageText(aiId: string, token: string, setMessages: SetMessages) {
  setMessages((prev) =>
    prev.map((m) => (m.id === aiId ? { ...m, text: mergeTextChunk(m.text, token) } : m))
  )
}

function mergeTextChunk(current: string, next: string): string {
  if (!current || !next) return current + next
  const last = current[current.length - 1]
  const first = next[0]
  if (/\s/.test(last) || /\s/.test(first)) return current + next
  if (/^[,.;:!?)}\]]/.test(first)) return current + next
  if (/[.!?)]/.test(last) && /^[A-Z0-9#*\-|]/.test(first)) return `${current}\n\n${next}`
  if (last === ':' && /^(?:[-*]|\d)/.test(first)) return `${current}\n${next}`
  return current + next
}

function applyEvent(aiId: string, evt: QuillEvent, setMessages: SetMessages) {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== aiId) return m
      switch (evt.kind) {
        case 'run_id': {
          return { ...m, meta: { ...(m.meta || { ts: Date.now() }), runId: evt.data.id } }
        }
        case 'started':
          return m
        case 'text':
          return { ...m, text: mergeTextChunk(m.text, evt.data.text || '') }
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
          return { ...m, done: true, error: evt.data.message || 'AI run failed' }
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
