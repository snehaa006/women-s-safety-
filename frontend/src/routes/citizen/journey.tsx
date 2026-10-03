import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, LoaderCircle, Pause, Play, ShieldAlert, Siren } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-context'
import { interpolateRoute } from '@/features/devices/demo-route'
import { LazyMap } from '@/features/map/lazy-map'
import {
  endJourney,
  fetchJourney,
  journeyCheckIn,
  journeyPing,
  safeMapKeys,
  type Journey,
} from '@/features/safe-map/api'
import { describeJourneyEntry } from '@/features/safe-map/labels'
import { currentFix } from '@/features/sos/geo'
import { paths } from '@/lib/paths'
import { fallbackInterval, useLiveChannel } from '@/lib/realtime'
import { formatTime } from '@/lib/time'
import { useNow } from '@/lib/use-now'

/**
 * Sends a ping every `interval` ms while the journey is active: the phone's location, or the next
 * point of the demo walk along the route (which can be paused to simulate a stop).
 */
function usePings(journey: Journey | undefined, demo: { on: boolean; paused: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const step = useRef(0)
  const walk = useRef<[number, number][]>([])
  const active = journey?.status === 'active'
  const id = journey?.id
  const interval = journey?.interval_ms ?? 15000

  useEffect(() => {
    walk.current = journey?.route ? interpolateRoute(journey.route, 60) : []
  }, [journey?.route])

  useEffect(() => {
    if (!active || !id) return
    let stopped = false
    async function ping() {
      let fix: { lat: number; lng: number; accuracy: number | null } | null = null
      if (demo.on && walk.current.length) {
        if (!demo.paused) step.current = Math.min(step.current + 1, walk.current.length - 1)
        const [lng, lat] = walk.current[step.current]
        fix = { lat, lng, accuracy: 10 }
      } else {
        fix = await currentFix(4000)
      }
      if (stopped || !fix) return
      try {
        await journeyPing(id!, fix)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      }
      void queryClient.invalidateQueries({ queryKey: safeMapKeys.journey(id!) })
    }
    void ping()
    const timer = setInterval(ping, demo.on ? Math.min(interval, 5000) : interval)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [active, id, interval, demo.on, demo.paused, queryClient])

  return error
}

export function Component() {
  const { journeyId = '' } = useParams()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const userId = auth.status === 'signed-in' ? auth.profile.id : null
  const live = useLiveChannel(userId ? `user:${userId}` : null, () => {
    void queryClient.invalidateQueries({ queryKey: safeMapKeys.journey(journeyId) })
  })
  const journey = useQuery({
    queryKey: safeMapKeys.journey(journeyId),
    queryFn: () => fetchJourney(journeyId),
    refetchInterval: fallbackInterval(live),
  })
  const [demo, setDemo] = useState({ on: false, paused: false })
  const pingError = usePings(journey.data ?? undefined, demo)
  const end = useMutation({
    mutationFn: (arrived: boolean) => endJourney(journeyId, arrived),
    onSettled: () => queryClient.invalidateQueries({ queryKey: safeMapKeys.journey(journeyId) }),
  })

  if (journey.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading your journey…
      </p>
    )
  }
  const j = journey.data
  if (journey.isError || !j) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this journey</AlertTitle>
        <AlertDescription>
          {journey.error?.message ?? 'It may belong to another account.'}{' '}
          <Link to={paths.app.map} className="underline">
            Safety map
          </Link>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold">To {j.dest_name ?? 'your destination'}</h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          Started {formatTime(j.started_at)}
          {j.expected_arrival_at ? ` · expected by ${formatTime(j.expected_arrival_at)}` : ''}
          {j.route_label ? <Badge variant="secondary">{j.route_label} route</Badge> : null}
          {j.monitoring === 'active' ? (
            <Badge variant="destructive">Active monitoring</Badge>
          ) : null}
        </p>
      </header>

      {j.status === 'active' && j.check_in_due_at ? <CheckIn journey={j} /> : null}

      {j.status === 'escalated' ? (
        <Alert variant="destructive">
          <Siren aria-hidden />
          <AlertTitle>SOS raised</AlertTitle>
          <AlertDescription>
            {j.escalation_reason === 'lost_heartbeat'
              ? 'Your phone stopped sending its location, so your circle was alerted.'
              : 'Nobody answered the check-in, so your circle was alerted.'}{' '}
            {j.incident_id ? (
              <Link to={paths.app.sos(j.incident_id)} className="font-medium underline">
                Open the SOS
              </Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {j.status === 'arrived' ? (
        <Alert>
          <CircleCheck aria-hidden />
          <AlertTitle>You arrived</AlertTitle>
          <AlertDescription>The journey is no longer watched.</AlertDescription>
        </Alert>
      ) : null}

      {j.monitoring === 'active' && j.status === 'active' ? (
        <p role="status" className="bg-muted rounded-md px-3 py-2 text-sm">
          You're in an area flagged at night, so your location is checked more often.
        </p>
      ) : null}

      <LazyMap
        path={j.path}
        routes={j.route ? [{ coordinates: j.route, color: '#0f8a5f', selected: true }] : []}
        destination={{ lat: j.dest_lat, lng: j.dest_lng }}
        className="h-[45dvh]"
        label="Your journey: the planned route in green, where you walked in red"
      />
      {pingError ? (
        <p className="text-destructive text-sm">Location not sent: {pingError}</p>
      ) : null}
      {j.off_route_m && j.off_route_m > 150 && j.status === 'active' ? (
        <p className="text-sm">You're about {Math.round(j.off_route_m)} m from the route.</p>
      ) : null}

      {j.status === 'active' ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => end.mutate(true)} disabled={end.isPending || !!j.check_in_due_at}>
            I've arrived
          </Button>
          <Button
            variant="outline"
            onClick={() => end.mutate(false)}
            disabled={end.isPending || !!j.check_in_due_at}
          >
            Stop watching
          </Button>
        </div>
      ) : null}

      {j.status === 'active' && j.route ? (
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="text-base">Demo walk</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDemo((d) => ({ on: !d.on, paused: false }))}
            >
              {demo.on ? 'Use my real location' : 'Walk the route (demo)'}
            </Button>
            {demo.on ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDemo((d) => ({ ...d, paused: !d.paused }))}
              >
                {demo.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
                {demo.paused ? 'Keep walking' : 'Stop here (a check-in comes after 3 min)'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm">
            {j.timeline.map((e) => (
              <li key={e.seq} className="grid grid-cols-[4.5rem_1fr] gap-2">
                <span className="text-muted-foreground tabular-nums">
                  {formatTime(e.occurred_at)}
                </span>
                <span>{describeJourneyEntry(e)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

function CheckIn({ journey }: { journey: Journey }) {
  const queryClient = useQueryClient()
  const now = useNow(1000)
  const [pin, setPin] = useState('')
  const answer = useMutation({
    mutationFn: () => journeyCheckIn(journey.id, pin),
    onSuccess: () => setPin(''),
    onSettled: () => queryClient.invalidateQueries({ queryKey: safeMapKeys.journey(journey.id) }),
  })
  const left = Math.max(0, Math.ceil((new Date(journey.check_in_due_at!).getTime() - now) / 1000))
  return (
    <Alert role="alertdialog" aria-label="Are you OK?">
      <ShieldAlert aria-hidden />
      <AlertTitle>Are you OK?</AlertTitle>
      <AlertDescription className="grid gap-2">
        <p>
          {journey.check_in_reason === 'off_route'
            ? 'You left your route.'
            : "You've stopped for a few minutes."}{' '}
          Enter your PIN within {left} s, or your circle will be alerted.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            answer.mutate()
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="checkin-pin">PIN</Label>
            <Input
              id="checkin-pin"
              inputMode="numeric"
              autoComplete="off"
              type="password"
              className="w-32"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={answer.isPending}>
            I'm OK
          </Button>
        </form>
        {answer.data && !answer.data.ok ? (
          <p className="text-destructive">
            {answer.data.error === 'locked'
              ? 'Too many wrong PINs. Try again later.'
              : 'Wrong PIN.'}
          </p>
        ) : null}
        {answer.isError ? <p className="text-destructive">{answer.error.message}</p> : null}
      </AlertDescription>
    </Alert>
  )
}
