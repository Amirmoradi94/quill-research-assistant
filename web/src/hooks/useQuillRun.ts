import { useState, useCallback } from 'react'
import { apiUrl } from '@/lib/runtime'

export type RunState = 'idle' | 'running' | 'done' | 'error'

export type QuillRunEvent = {
  id: string
  kind: string
  label: string
  detail?: string
  at: number
}

export type QuillRunOptions = {
  workflow: string
  params?: Record<string, unknown>
  professor_id?: number
  document_id?: number
  grant_id?: number
}

export function useQuillRun() {
  const [state, setState] = useState<RunState>('idle')
  const [lines, setLines] = useState<string[]>([])
  const [events, setEvents] = useState<QuillRunEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)

  const pushEvent = useCallback((kind: string, label: string, detail?: string) => {
    setEvents((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        kind,
        label,
        detail,
        at: Date.now(),
      },
    ].slice(-80))
  }, [])

  const start = useCallback(async (opts: QuillRunOptions) => {
    setState('running')
    setLines([])
    setEvents([])
    setError(null)
    setRunId(null)
    setStartedAt(Date.now())
    setEndedAt(null)
    pushEvent('queued', 'Preparing workflow request', opts.workflow)

    try {
      const res = await fetch(apiUrl('/api/ai/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow: opts.workflow,
          params: opts.params ?? {},
          professor_id: opts.professor_id ?? null,
          document_id: opts.document_id ?? null,
          grant_id: opts.grant_id ?? null,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'AI run failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let currentKind = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        const parts = buf.split('\n')
        buf = parts.pop() ?? ''

        for (const line of parts) {
          if (line.startsWith('event: ')) {
            currentKind = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (currentKind === 'run_id') {
                setRunId(data.id)
                pushEvent('run_id', `Run #${data.id} created`, data.provider ? `Provider: ${data.provider}` : undefined)
              } else if (currentKind === 'started') {
                pushEvent('started', 'AI provider started', data.provider)
              } else if (currentKind === 'text' && data.text) {
                setLines((prev) => {
                  const chunk: string = data.text
                  const last = prev[prev.length - 1] ?? ''
                  if (last.endsWith('\n') || prev.length === 0) {
                    return [...prev, chunk]
                  }
                  return [...prev.slice(0, -1), last + chunk]
                })
              } else if (currentKind === 'tool_call') {
                pushEvent('tool_call', `Tool call: ${data.name || data.tool || 'tool'}`, summarizeEventData(data))
              } else if (currentKind === 'tool_result') {
                pushEvent('tool_result', `Tool result: ${data.name || data.tool || 'tool'}`, summarizeEventData(data))
              } else if (currentKind === 'parsed') {
                pushEvent('parsed', 'Structured results parsed')
              } else if (currentKind === 'done') {
                pushEvent('done', 'Workflow completed')
                setEndedAt(Date.now())
              } else if (currentKind === 'error') {
                throw new Error(data.error || data.message || 'AI error')
              }
            } catch (parseErr: unknown) {
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected token') {
                throw parseErr
              }
            }
          }
        }
      }

      setEndedAt((current) => current ?? Date.now())
      setState('done')
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      setEndedAt(Date.now())
      pushEvent('error', 'Workflow failed', message)
      setState('error')
    }
  }, [pushEvent])

  const reset = useCallback(() => {
    setState('idle')
    setLines([])
    setEvents([])
    setError(null)
    setRunId(null)
    setStartedAt(null)
    setEndedAt(null)
  }, [])

  const logText = lines.join('')

  return { state, lines, logText, events, error, runId, startedAt, endedAt, start, reset }
}

function summarizeEventData(data: Record<string, unknown>): string | undefined {
  const text = data.text || data.message || data.error || data.stderr || data.result
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 180)
  const keys = Object.keys(data).filter((key) => !['name', 'tool', 'id'].includes(key)).slice(0, 4)
  if (!keys.length) return undefined
  return keys.map((key) => `${key}: ${JSON.stringify(data[key])}`).join(' · ').slice(0, 180)
}
