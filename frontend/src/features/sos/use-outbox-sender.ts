import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { flushOutbox, loadOutbox, useOutbox } from './outbox'

/**
 * Keeps trying to send queued SOS alerts while the app is open: right away, then after 2, 4, 8 …
 * up to 60 seconds, and immediately when the browser says it is back online.
 */
export function useOutboxSender() {
  const queryClient = useQueryClient()
  const { pending } = useOutbox()
  const waiting = pending.length > 0

  useEffect(() => {
    void loadOutbox()
  }, [])

  useEffect(() => {
    if (!waiting) return
    let stopped = false
    let delay = 2000
    let timer: ReturnType<typeof setTimeout> | undefined

    async function attempt() {
      clearTimeout(timer)
      const left = await flushOutbox()
      if (stopped) return
      await queryClient.invalidateQueries({ queryKey: ['incidents'] })
      if (left > 0) {
        timer = setTimeout(() => void attempt(), delay)
        delay = Math.min(delay * 2, 60_000)
      }
    }
    function online() {
      delay = 2000
      void attempt()
    }

    timer = setTimeout(() => void attempt(), delay)
    window.addEventListener('online', online)
    return () => {
      stopped = true
      clearTimeout(timer)
      window.removeEventListener('online', online)
    }
  }, [waiting, queryClient])
}
