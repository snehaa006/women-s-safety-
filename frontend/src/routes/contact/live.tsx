import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BatteryMedium,
  CircleCheck,
  LoaderCircle,
  MapPin,
  Navigation,
  PhoneCall,
  TriangleAlert,
  UserCheck,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LazyMap } from '@/features/map/lazy-map'
import { mapsLink } from '@/features/map/links'
import { respondToLiveLink, sosKeys, viewLiveLink, type LiveView } from '@/features/sos/api'
import { SafePointsCard } from '@/features/sos/safe-points'
import { useSafePoints } from '@/features/sos/use-safe-points'
import { fallbackInterval, useLiveChannel } from '@/lib/realtime'
import { formatDateTime, formatTime, timeAgo } from '@/lib/time'
import { useNow } from '@/lib/use-now'

const RESPONDED_KEY = 'responded-as'

/** The page a trusted contact opens from the SOS message. No account needed. */
export function Component() {
  const { token = '' } = useParams()
  const queryClient = useQueryClient()
  const [topic, setTopic] = useState<string | null>(null)
  // A public topic whose name only link holders learn; its pings carry no data.
  const connected = useLiveChannel(
    topic,
    () => void queryClient.invalidateQueries({ queryKey: sosKeys.live(token) }),
    { isPrivate: false },
  )
  const live = useQuery({
    queryKey: sosKeys.live(token),
    queryFn: async () => {
      const view = await viewLiveLink(token)
      setTopic(view?.status === 'active' ? view.channel : null)
      return view
    },
    refetchInterval: (query) =>
      query.state.data?.status === 'active' ? fallbackInterval(connected) : false,
  })

  if (live.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Opening the live location…
      </p>
    )
  }
  if (live.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't load this link</AlertTitle>
        <AlertDescription>
          {live.error.message}. Check your connection; this page retries on its own.
        </AlertDescription>
      </Alert>
    )
  }
  if (!live.data) {
    return (
      <div className="grid gap-2 py-8 text-center">
        <h1 className="text-xl font-bold">This link has expired</h1>
        <p className="text-muted-foreground">
          Live links stop working 24 hours after the SOS ends, or the link is not complete. Ask the
          person who sent it for a new one.
        </p>
      </div>
    )
  }
  return <LivePage token={token} view={live.data} />
}

function LivePage({ token, view }: { token: string; view: LiveView }) {
  const now = useNow(10_000)
  const name = view.citizen_name ?? 'Your contact'
  const active = view.status === 'active'
  const location = view.last_location
  const safePoints = useSafePoints(active ? location : null)

  return (
    <div className="grid gap-5">
      {active ? (
        <section className="bg-sos text-sos-foreground grid gap-1 rounded-xl p-5 shadow-md">
          <h1 className="text-2xl font-extrabold">{name} needs help</h1>
          <p className="text-sos-foreground/90">
            SOS sent {timeAgo(view.started_at, now)} ({formatTime(view.started_at)})
            {view.source !== 'app' ? ' from a wearable' : ''}. This page updates by itself.
          </p>
        </section>
      ) : (
        <section className="grid justify-items-center gap-2 rounded-xl border p-5 text-center">
          <CircleCheck className="size-10 text-emerald-600" aria-hidden />
          <h1 className="text-2xl font-bold">{name} is safe</h1>
          <p className="text-muted-foreground">
            {view.resolution === 'false_alarm' ? 'It was a false alarm. ' : ''}
            The SOS ended {view.resolved_at ? formatDateTime(view.resolved_at) : ''}.
          </p>
        </section>
      )}

      {active && view.closed_under_duress ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{name} may not be safe</AlertTitle>
          <AlertDescription>
            The SOS was cancelled with a duress PIN, which means {name} may have been forced to
            cancel it. Treat this as an emergency. Don't mention this message to {name} by phone.
          </AlertDescription>
        </Alert>
      ) : null}

      {active ? (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="sos" size="touch">
            <a href="tel:112">
              <PhoneCall aria-hidden />
              Call 112
            </a>
          </Button>
          {view.citizen_phone ? (
            <Button asChild variant="outline" size="touch">
              <a href={`tel:${view.citizen_phone.replace(/[^\d+]/g, '')}`}>
                <PhoneCall aria-hidden />
                Call {name}
              </a>
            </Button>
          ) : location ? (
            <Button asChild variant="outline" size="touch">
              <a href={mapsLink(location.lat, location.lng)} target="_blank" rel="noreferrer">
                <Navigation aria-hidden />
                Directions
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      {active ? <Respond token={token} name={name} contactName={view.contact_name} /> : null}

      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="text-sos size-5" aria-hidden />
            {active ? 'Live location' : 'Last known location'}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <LazyMap
            className="h-72"
            path={view.path}
            current={location}
            points={active ? safePoints.data : undefined}
            follow={active}
            label={`${name}'s location and route since the SOS started`}
          />
          {location ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                Updated {timeAgo(location.at, now)}
                {location.accuracy_m ? `, within ${Math.round(location.accuracy_m)} m` : ''}
              </span>
              {view.battery_pct !== null ? (
                <span className="flex items-center gap-1">
                  <BatteryMedium className="size-4" aria-hidden />
                  {view.battery_pct}%
                </span>
              ) : null}
              <a
                className="text-foreground underline"
                href={mapsLink(location.lat, location.lng)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Maps
              </a>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Waiting for the first location fix. Keep this page open.
            </p>
          )}
        </CardContent>
      </Card>

      {active && location ? (
        <SafePointsCard points={safePoints.data} pending={safePoints.isPending} />
      ) : null}

      {view.responders.length > 0 ? (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="text-primary size-5" aria-hidden />
              Responding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1">
              {view.responders.map((r) => (
                <li key={`${r.name}-${r.at}`} className="flex justify-between gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground text-sm">{formatTime(r.at)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function readResponded(token: string) {
  try {
    return localStorage.getItem(`${RESPONDED_KEY}:${token}`)
  } catch {
    return null
  }
}

function Respond({
  token,
  name,
  contactName,
}: {
  token: string
  name: string
  contactName: string | null
}) {
  const queryClient = useQueryClient()
  const [respondedAs, setRespondedAs] = useState(() => readResponded(token))
  // A link sent to one contact already knows their name.
  const [responder, setResponder] = useState(contactName ?? '')
  const respond = useMutation({
    mutationFn: (who: string) => respondToLiveLink(token, who),
    onSuccess: async (_, who) => {
      try {
        localStorage.setItem(`${RESPONDED_KEY}:${token}`, who)
      } catch {
        // Private mode: the confirmation just won't survive a reload.
      }
      setRespondedAs(who)
      await queryClient.invalidateQueries({ queryKey: sosKeys.live(token) })
    },
  })

  if (respondedAs) {
    return (
      <Alert>
        <UserCheck aria-hidden />
        <AlertTitle>{name} can see you're responding</AlertTitle>
        <AlertDescription>
          Thank you, {respondedAs}. Keep this page open for live updates.
        </AlertDescription>
      </Alert>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (responder.trim()) respond.mutate(responder.trim())
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Are you going to help?</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="responder-name">Your name</Label>
            <Input
              id="responder-name"
              autoComplete="name"
              maxLength={60}
              value={responder}
              onChange={(event) => setResponder(event.target.value)}
              placeholder="So they know who is coming"
            />
          </div>
          {respond.isError ? (
            <p className="text-destructive text-sm">{respond.error.message}</p>
          ) : null}
          <Button type="submit" size="touch" disabled={!responder.trim() || respond.isPending}>
            <UserCheck aria-hidden />
            I'm responding
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
