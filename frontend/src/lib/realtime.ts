import { useEffect, useRef, useState } from 'react'

import { supabase } from './supabase'

export type LivePing = { what?: 'location' | 'status' | 'responders' | 'alerts' }

/**
 * Listens to a Realtime topic that the database pings when something changes (see the
 * realtime_broadcast migration). Pings carry no data: the screen refetches through the normal,
 * RLS-checked reads. Returns whether the socket is connected, so screens can poll slowly as a
 * fallback while it is and quickly while it isn't.
 */
export function useLiveChannel(
  topic: string | null,
  onPing: (ping: LivePing) => void,
  { isPrivate = true }: { isPrivate?: boolean } = {},
) {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onPing)
  useEffect(() => {
    handler.current = onPing
  })

  useEffect(() => {
    const client = supabase
    if (!topic || !client) return
    let cancelled = false
    const channel = client.channel(topic, { config: { private: isPrivate } })
    channel.on('broadcast', { event: 'changed' }, (message) => {
      handler.current((message.payload ?? {}) as LivePing)
    })

    async function join() {
      // Private topics are authorized with the signed-in user's token.
      if (isPrivate) await client!.realtime.setAuth()
      if (cancelled) return
      channel.subscribe((status) => {
        if (!cancelled) setConnected(status === 'SUBSCRIBED')
      })
    }
    void join()

    return () => {
      cancelled = true
      setConnected(false)
      void client.removeChannel(channel)
    }
  }, [topic, isPrivate])

  return connected
}

/** Poll every 30 s while live updates arrive, every 5 s while they don't. */
export function fallbackInterval(connected: boolean) {
  return connected ? 30_000 : 5_000
}
