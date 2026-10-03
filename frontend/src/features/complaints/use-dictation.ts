import { useEffect, useRef, useState } from 'react'

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult:
    | ((event: {
        resultIndex: number
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
      }) => void)
    | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionConstructor = new () => Recognition

function recognitionClass(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Live dictation with the browser's speech recognition (Chrome, Edge, Safari). Final phrases are
 * passed to onText; nothing is recorded or uploaded by this app.
 */
export function useDictation(onText: (text: string) => void) {
  const supported = recognitionClass() !== null
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const handler = useRef(onText)
  useEffect(() => {
    handler.current = onText
  })

  useEffect(() => () => recognition.current?.stop(), [])

  function start(lang: string) {
    const Klass = recognitionClass()
    if (!Klass) return
    const r = new Klass()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.onresult = (event) => {
      let pending = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) handler.current(text.trim())
        else pending += text
      }
      setInterim(pending)
    }
    r.onerror = (event) => {
      setError(
        event.error === 'not-allowed'
          ? 'Microphone access is blocked. Allow it in the browser, or type instead.'
          : 'Dictation stopped. You can type instead.',
      )
    }
    r.onend = () => {
      setListening(false)
      setInterim('')
    }
    recognition.current = r
    setError(null)
    setListening(true)
    r.start()
  }

  function stop() {
    recognition.current?.stop()
  }

  return { supported, listening, interim, error, start, stop }
}
