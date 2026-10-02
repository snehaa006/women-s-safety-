import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PhoneCall, Siren } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { paths } from '@/lib/paths'
import { cn } from '@/lib/utils'

import { createSos, fetchActiveIncident, sosKeys } from './api'
import { batteryPct, currentFix, type Fix } from './geo'
import { useHold } from './use-hold'

export const HOLD_MS = 1500
export const COUNTDOWN_S = 3

type Phase =
  | { kind: 'idle' }
  | { kind: 'countdown'; secondsLeft: number }
  | { kind: 'sending' }
  | { kind: 'error'; message: string }

const delay = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Not supported (iOS): the screen change is the feedback.
  }
}

/**
 * Hold to start a countdown, then the SOS is sent unless cancelled. GPS starts warming up as soon
 * as the countdown begins, but the SOS never waits more than a moment for it: the live location
 * stream fills the position in.
 */
export function SosHoldButton({ className }: { className?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // Kept across retries, so a retried request can never create a second incident.
  const pending = useRef<{ clientId: string; fix: Promise<Fix | null> } | null>(null)

  const send = useCallback(async () => {
    pending.current ??= { clientId: crypto.randomUUID(), fix: currentFix(3000) }
    const { clientId, fix } = pending.current
    setPhase({ kind: 'sending' })
    try {
      const position = await Promise.race([fix, delay(1500)])
      const result = await createSos(clientId, position, await batteryPct())
      pending.current = null
      vibrate([200, 100, 200])
      await queryClient.invalidateQueries({ queryKey: ['incidents'] })
      navigate(paths.app.sos(result.incident_id))
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [navigate, queryClient])

  const hold = useHold(HOLD_MS, () => {
    pending.current = { clientId: crypto.randomUUID(), fix: currentFix(COUNTDOWN_S * 1000 + 1000) }
    vibrate(100)
    setPhase({ kind: 'countdown', secondsLeft: COUNTDOWN_S })
  })

  useEffect(() => {
    if (phase.kind !== 'countdown') return
    const timer = setTimeout(() => {
      if (phase.secondsLeft <= 1) void send()
      else setPhase({ kind: 'countdown', secondsLeft: phase.secondsLeft - 1 })
    }, 1000)
    return () => clearTimeout(timer)
  }, [phase, send])

  function cancel() {
    pending.current = null
    setPhase({ kind: 'idle' })
  }

  if (phase.kind === 'countdown' || phase.kind === 'sending') {
    return (
      <div
        className={cn('grid justify-items-center gap-5 text-center', className)}
        role="alertdialog"
        aria-labelledby="sos-countdown-title"
      >
        <div
          aria-hidden
          className="bg-sos text-sos-foreground font-display grid size-44 animate-pulse place-content-center rounded-full text-6xl font-extrabold shadow-lg"
        >
          {phase.kind === 'countdown' ? phase.secondsLeft : <Siren className="size-14" />}
        </div>
        <p id="sos-countdown-title" className="text-lg font-semibold" aria-live="assertive">
          {phase.kind === 'countdown'
            ? `Sending SOS in ${phase.secondsLeft}…`
            : 'Sending SOS and your location…'}
        </p>
        {phase.kind === 'countdown' ? (
          <div className="flex w-full max-w-xs gap-3">
            <Button variant="outline" size="touch" className="flex-1" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="sos" size="touch" className="flex-1" onClick={() => void send()}>
              Send now
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  const progress = Math.round(hold.progress * 100)
  return (
    <div className={cn('grid justify-items-center gap-3 text-center', className)}>
      <button
        type="button"
        aria-describedby="sos-status"
        aria-label="SOS. Press and hold to send."
        {...hold.handlers}
        style={{
          backgroundImage: hold.holding
            ? `conic-gradient(color-mix(in oklch, var(--sos-foreground) 45%, transparent) ${progress}%, transparent ${progress}%)`
            : undefined,
        }}
        className="bg-sos text-sos-foreground font-display focus-visible:ring-ring/60 grid size-44 touch-none place-content-center rounded-full text-4xl font-extrabold tracking-wide shadow-lg ring-8 ring-[color-mix(in_oklch,var(--sos)_18%,transparent)] transition-transform outline-none select-none focus-visible:ring-[6px] active:scale-95"
      >
        SOS
        <span className="font-sans text-sm font-normal tracking-normal">
          {hold.holding ? 'Keep holding…' : 'Press and hold'}
        </span>
      </button>
      {phase.kind === 'error' ? (
        <Alert variant="destructive" className="max-w-sm text-left">
          <AlertTitle>The SOS didn't go through</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>{phase.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="sos" onClick={() => void send()}>
                Try again
              </Button>
              <Button asChild variant="outline">
                <a href="tel:112">
                  <PhoneCall aria-hidden />
                  Call 112
                </a>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <p id="sos-status" className="text-muted-foreground max-w-xs text-sm">
          Hold for {HOLD_MS / 1000} seconds. You get {COUNTDOWN_S} seconds to cancel, then your live
          location goes to your trusted circle.
        </p>
      )}
    </div>
  )
}

/** Header shortcut: opens the active SOS if there is one, otherwise the SOS button. */
export function SosQuickButton() {
  const active = useQuery({
    queryKey: sosKeys.active,
    queryFn: fetchActiveIncident,
    refetchInterval: 30_000,
  })
  const incident = active.data

  // Same width either way, so the header fits a phone screen; a pulsing dot marks an active SOS.
  return (
    <Button asChild variant="sos" size="sm" title={incident ? 'Your SOS is active' : 'SOS'}>
      <Link
        to={incident ? paths.app.sos(incident.id) : paths.app.home}
        aria-label={incident ? 'Your SOS is active. Open it.' : 'SOS'}
      >
        {incident ? (
          <span className="relative flex size-4 items-center justify-center" aria-hidden>
            <span className="bg-sos-foreground absolute size-2.5 animate-ping rounded-full" />
            <span className="bg-sos-foreground size-2 rounded-full" />
          </span>
        ) : (
          <Siren aria-hidden />
        )}
        SOS
      </Link>
    </Button>
  )
}
