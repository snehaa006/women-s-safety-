import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

const TICK_MS = 16

/**
 * Press-and-hold for `durationMs` to fire `onComplete`. Releasing early cancels. Works with touch,
 * mouse and the keyboard (hold Space or Enter). `progress` runs from 0 to 1 while held.
 */
export function useHold(durationMs: number, onComplete: () => void) {
  const [progress, setProgress] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef(0)
  const complete = useRef(onComplete)

  useEffect(() => {
    complete.current = onComplete
  }, [onComplete])

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setProgress(0)
  }, [])

  const start = useCallback(() => {
    if (timer.current) return
    startedAt.current = Date.now()
    timer.current = setInterval(() => {
      const value = Math.min((Date.now() - startedAt.current) / durationMs, 1)
      setProgress(value)
      if (value >= 1) {
        stop()
        complete.current()
      }
    }, TICK_MS)
  }, [durationMs, stop])

  useEffect(() => stop, [stop])

  const isHoldKey = (key: string) => key === ' ' || key === 'Enter'

  return {
    progress,
    holding: progress > 0,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        start()
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (!isHoldKey(event.key)) return
        event.preventDefault()
        if (!event.repeat) start()
      },
      onKeyUp(event: KeyboardEvent<HTMLElement>) {
        if (isHoldKey(event.key)) stop()
      },
      onContextMenu(event: { preventDefault(): void }) {
        event.preventDefault()
      },
    },
  }
}
