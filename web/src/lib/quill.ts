// Client for the Quill SSE endpoint.
import { apiUrl } from './runtime'
//
// We can't use the browser's EventSource API because it's GET-only — our
// endpoint is POST (so we can include workflow params in the body). Instead
// we use fetch() + ReadableStream and parse SSE frames manually.

export type QuillEvent =
  | { kind: 'run_id';      data: { id: number; provider: string; workflow: string } }
  | { kind: 'started';     data: { provider: string } }
  | { kind: 'text';        data: { text: string } }
  | { kind: 'tool_call';   data: { id: string; name: string; input: any } }
  | { kind: 'tool_result'; data: { id: string; is_error: boolean; content: any } }
  | { kind: 'parsed';      data: { payload: any } }
  | { kind: 'done';        data: { ok: boolean; result?: string; cost_usd?: number; usage?: any; duration_ms?: number } }
  | { kind: 'error';       data: { message: string; stderr?: string } }

export type RunInput = {
  workflow: string
  params?: Record<string, any>
  preferred_provider?: 'claude_cli' | 'codex_cli'
  professor_id?: number
  document_id?: number
  grant_id?: number
  cwd?: string
  allowed_tools?: string[]
  max_turns?: number
  timeout_s?: number
}

/**
 * Start a workflow and yield SSE events as they arrive.
 *
 * Caller can pass an AbortSignal to cancel — closing the stream terminates
 * the subprocess on the server side via the runner's `finally` block.
 */
export async function* runQuill(
  input: RunInput,
  { signal }: { signal?: AbortSignal } = {}
): AsyncGenerator<QuillEvent> {
  const r = await fetch(apiUrl('/api/ai/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify(input),
    signal,
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`AI run failed: ${r.status} ${r.statusText}: ${text.slice(0, 200)}`)
  }
  if (!r.body) throw new Error('AI run: no response body')

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      // SSE frames are separated by a blank line. Parse one frame at a time.
      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const evt = parseFrame(frame)
        if (evt) yield evt
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
}

function parseFrame(frame: string): QuillEvent | null {
  let event = ''
  let dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!event) return null
  try {
    return { kind: event as any, data: JSON.parse(dataLines.join('\n') || '{}') }
  } catch {
    return null
  }
}

// ── Provider info ───────────────────────────────────────────────────
export type ProvidersStatus = {
  selected_default: string
  active: string | null
  claude_cli: { available: boolean; path: string | null }
  codex_cli:  { available: boolean; path: string | null }
  anthropic_api: { configured: boolean }
  openai_api:    { configured: boolean }
  daily_cost_cap_usd: number
}

export async function fetchProviders(): Promise<ProvidersStatus> {
  const r = await fetch(apiUrl('/api/ai/providers'))
  if (!r.ok) throw new Error(`providers ${r.status}`)
  return r.json()
}
