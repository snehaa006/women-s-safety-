import { useEffect, useRef, useState } from 'react'

import { recordLocation } from './api'
import { batteryPct, toFix, type Fix } from './geo'

export type StreamStatus = 'waiting' | 'sharing' | 'denied' | 'unavailable' | 'ended'

type StreamState = {
  status: StreamStatus
  lastFix: Fix | null
  lastSentAt: number | null
  error: string | null
}

const INITIAL: StreamState = { status: 'waiting', lastFix: null, lastSentAt: null, error: null }

/**
 * Streams this phone's location to an active SOS: the newest fix every `intervalMs`, and at least
 * every 30 s even when standing still, so contacts can see the phone is still connected.
 * A failed send is retried on the next tick with the newest fix.
 */
export function useLocationStream(incidentId: string | null, intervalMs = 5000) {
  const [state, setState] = useState<StreamState>(INITIAL)
  const latest = useRef<Fix | null>(null)

  useEffect(() => {
    if (!incidentId) return
    if (!('geolocation' in navigator)) {
      queueMicrotask(() => setState((s) => ({ ...s, status: 'unavailable' })))
      return
    }

    let stopped = false
    let sentFixAt = 0
    let sentAt = 0
    let sending = false

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        latest.current = toFix(position)
        setState((s) => ({
          ...s,
          lastFix: latest.current,
          status: s.status === 'ended' ? 'ended' : 'sharing',
        }))
      },
      (error) => {
        setState((s) => ({
          ...s,
          status: error.code === error.PERMISSION_DENIED ? 'denied' : s.status,
          error: error.message || 'Location is unavailable',
        }))
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    )

    async function tick() {
      const fix = latest.current
      if (stopped || sending || !fix || !incidentId) return
      const fresh = fix.at !== sentFixAt
      if (!fresh && Date.now() - sentAt < 30_000) return
      sending = true
      try {
        await recordLocation(incidentId, fix, await batteryPct())
        sentFixAt = fix.at
        sentAt = Date.now()
        setState((s) => ({ ...s, lastSentAt: sentAt, error: null }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/has ended|No such SOS/.test(message)) {
          stopped = true
          setState((s) => ({ ...s, status: 'ended' }))
        } else {
          setState((s) => ({ ...s, error: message }))
        }
      } finally {
        sending = false
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), intervalMs)
    return () => {
      stopped = true
      clearInterval(timer)
      navigator.geolocation.clearWatch(watchId)
    }
  }, [incidentId, intervalMs])

  return state
}
