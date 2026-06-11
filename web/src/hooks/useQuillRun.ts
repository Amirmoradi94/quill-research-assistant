import { useState, useCallback } from 'react'
import { apiUrl } from '@/lib/runtime'

export type RunState = 'idle' | 'running' | 'done' | 'error'

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
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<number | null>(null)

  const start = useCallback(async (opts: QuillRunOptions) => {
    setState('running')
    setLines([])
    setError(null)
    setRunId(null)

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
              } else if (currentKind === 'text' && data.text) {
                setLines((prev) => {
                  const chunk: string = data.text
                  const last = prev[prev.length - 1] ?? ''
                  if (last.endsWith('\n') || prev.length === 0) {
                    return [...prev, chunk]
                  }
                  return [...prev.slice(0, -1), last + chunk]
                })
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

      setState('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }, [])

  const reset = useCallback(() => {
    setState('idle')
    setLines([])
    setError(null)
    setRunId(null)
  }, [])

  const logText = lines.join('')

  return { state, lines, logText, error, runId, start, reset }
}
