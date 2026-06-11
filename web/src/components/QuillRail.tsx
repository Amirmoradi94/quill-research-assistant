import {
  History, Paperclip, ArrowUp, Square,
  CheckCircle2, Loader, AlertCircle, ChevronDown, ChevronRight,
  Bot, CircleDot, Database, FileText, Mail, WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { fetchProviders, runQuill, type ProvidersStatus, type QuillEvent } from '@/lib/quill'

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

type QuillProvider = 'claude_cli' | 'codex_cli'

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

function loadProvider(): QuillProvider {
  try {
    const saved = localStorage.getItem('quill-provider')
    if (saved === 'codex_cli' || saved === 'claude_cli') return saved
  } catch {}
  return 'claude_cli'
}

export function QuillRail() {
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<Message[]>(loadMessages)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [providers, setProviders] = useState<ProvidersStatus | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<QuillProvider>(loadProvider)
  const abortRef = useRef<AbortController | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Persist history to localStorage whenever messages change.
  useEffect(() => { saveMessages(messages) }, [messages])

  useEffect(() => {
    fetchProviders()
      .then((status) => {
        setProviders(status)
        setProviderError(null)
        const claudeReady = status.claude_cli.available
        const codexReady = status.codex_cli.available
        setSelectedProvider((current) => {
          if (current === 'claude_cli' && claudeReady) return current
          if (current === 'codex_cli' && codexReady) return current
          if (claudeReady) return 'claude_cli'
          if (codexReady) return 'codex_cli'
          return current
        })
      })
      .catch((e) => setProviderError(e?.message || String(e)))
  }, [])

  useEffect(() => {
    try { localStorage.setItem('quill-provider', selectedProvider) } catch {}
  }, [selectedProvider])

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
          preferred_provider: selectedProvider,
          max_turns: 30,
          timeout_s: 120,
        },
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
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
      // Signal all pages to refresh their data in case Quill modified the DB.
      window.dispatchEvent(new CustomEvent('quill:data-changed'))
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
      className="flex h-full min-h-0 flex-col overflow-hidden border-l"
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
              <span className="grid size-7 place-items-center rounded-md border"
                style={{ background: 'var(--color-ink)', color: 'white', borderColor: 'var(--color-ink)' }}>
                <Bot size={15} />
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
          <ProviderSelect
            providers={providers}
            error={providerError}
            selected={selectedProvider}
            onSelect={setSelectedProvider}
            disabled={running}
          />
        </div>
      </header>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 text-[15px]">
        {messages.map((m) => (
          <MessageView key={m.id} msg={m} />
        ))}
      </div>

      <div className="shrink-0 px-3 pb-3 pt-3 border-t" style={{ background: 'color-mix(in srgb, var(--color-white) 92%, var(--color-paper))', borderColor: 'var(--color-line)' }}>
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

function ProviderSelect({
  providers,
  error,
  selected,
  onSelect,
  disabled,
}: {
  providers: ProvidersStatus | null
  error: string | null
  selected: QuillProvider
  onSelect: (provider: QuillProvider) => void
  disabled: boolean
}) {
  if (error) {
    return (
      <span className="rounded-full border px-2 py-0.5 text-[11px] inline-flex items-center gap-1"
        style={{ background: 'var(--color-rose-50)', color: 'var(--color-rose-700)', borderColor: 'var(--color-line)' }}>
        <AlertCircle size={10} />
        provider error
      </span>
    )
  }
  if (!providers) {
    return (
      <span className="rounded-full border px-2 py-0.5 text-[11px] inline-flex items-center gap-1"
        style={{ background: 'var(--color-paper)', color: 'var(--color-muted)', borderColor: 'var(--color-line)' }}>
        <Loader size={10} className="animate-spin" />
        provider
      </span>
    )
  }
  const options: { value: QuillProvider; label: string; available: boolean }[] = [
    { value: 'claude_cli', label: 'Claude', available: providers.claude_cli.available },
    { value: 'codex_cli', label: 'Codex', available: providers.codex_cli.available },
  ]
  return (
    <div
      className="inline-flex overflow-hidden rounded-full border p-0.5"
      style={{ background: 'var(--color-paper-2)', borderColor: 'var(--color-line)' }}
      aria-label="Quill provider"
    >
      {options.map((option) => {
        const active = selected === option.value
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled || !option.available}
            onClick={() => onSelect(option.value)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: active ? 'var(--color-white)' : 'transparent',
              color: active ? 'var(--color-green-700)' : 'var(--color-muted)',
              boxShadow: active ? '0 1px 2px rgba(17,24,39,0.08)' : 'none',
            }}
            title={option.available ? `Use ${option.label} for Quill` : `${option.label} CLI not detected`}
          >
            <CircleDot size={10} />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function MessageView({ msg }: { msg: Message }) {
  if (msg.role === 'user') {
    return (
      <div
        className="self-end max-w-[88%] rounded-md border px-3 py-2 text-[14px] leading-relaxed animate-[qMsgIn_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
        style={{ background: 'var(--color-ink)', color: 'white', borderColor: 'var(--color-ink)' }}
      >
        {msg.text}
      </div>
    )
  }

  return (
    <div className="animate-[qMsgIn_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-md border px-3 py-2.5"
      style={{ background: 'color-mix(in srgb, var(--color-white) 94%, var(--color-paper))', borderColor: 'var(--color-line)' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-mono mb-1.5" style={{ color: 'var(--color-muted)' }}>
        <WandSparkles size={11} style={{ color: 'var(--color-amber-600)' }} />
        <span>Quill</span>
        {msg.meta?.provider && <span>via {msg.meta.provider}</span>}
        {msg.meta?.cost !== undefined && <span>${msg.meta.cost.toFixed(4)}</span>}
        {msg.meta?.durationMs !== undefined && <span>{(msg.meta.durationMs / 1000).toFixed(1)}s</span>}
      </div>

      {msg.tools && msg.tools.length > 0 && (
        <ToolActivity tools={msg.tools} done={!!msg.done} />
      )}

      <div
        className={`quill-md text-[14px] leading-[1.58] ${msg.done ? '' : 'q-cursor'}`}
        style={{ color: 'var(--color-ink-soft)' }}
      >
        <ReactMarkdown>{ensureParagraphs(msg.text)}</ReactMarkdown>
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

// Insert double newlines between sentences that were concatenated without spacing.
// Handles "Sentence one.Sentence two." → two paragraphs. Leaves existing markdown alone.
function ensureParagraphs(text: string): string {
  if (!text) return text
  // Already has paragraph breaks — don't touch it.
  if (text.includes('\n\n')) return text
  // Single newlines: convert to paragraphs.
  if (text.includes('\n')) return text.replace(/\n(?!\n)/g, '\n\n')
  // No newlines at all: split on ". " followed by a capital letter.
  return text.replace(/\.\s+(?=[A-Z])/g, '.\n\n')
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
        case 'error': {
          const stderr = (evt.data.stderr || '').trim()
          const tail = stderr ? stderr.split('\n').slice(-3).join('\n') : ''
          return { ...m, done: true, error: tail ? `${evt.data.message}\n${tail}` : evt.data.message }
        }
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
