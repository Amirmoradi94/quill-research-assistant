// Speech helpers for the mock interview: text-to-speech via the backend
// `/api/tts` endpoint (macOS `say`), and speech-to-text via the browser's
// Web Speech API.

// ── Text to speech ──────────────────────────────────────────────────

export function ttsUrl(text: string, voice?: string): string {
  const params = new URLSearchParams({ text })
  if (voice) params.set('voice', voice)
  return `/api/tts?${params.toString()}`
}

// ── Speech to text (Web Speech API) ─────────────────────────────────
// The types below are not in the standard DOM lib, so we declare the
// minimal surface we use.

type SpeechRecognitionResultEvent = {
  resultIndex: number
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
}

export interface Recognizer {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognizerCtor = new () => Recognizer

function getCtor(): RecognizerCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognizerCtor
    webkitSpeechRecognition?: RecognizerCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isSTTSupported(): boolean {
  return getCtor() !== null
}

export function createRecognizer(): Recognizer | null {
  const Ctor = getCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.continuous = true
  rec.interimResults = true
  return rec
}
