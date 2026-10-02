import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleCheck,
  Copy,
  History,
  LoaderCircle,
  MapPin,
  MessageCircle,
  MessageSquare,
  PhoneCall,
  Share2,
  UserCheck,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { circleKeys, listContacts } from '@/features/circle/api'
import { LazyMap } from '@/features/map/lazy-map'
import { mapsLink } from '@/features/map/links'
import {
  closedForCitizen,
  fetchIncident,
  fetchPath,
  fetchResponders,
  sosKeys,
  type Incident,
  type ResolveResult,
} from '@/features/sos/api'
import { ResolveDialog } from '@/features/sos/resolve-dialog'
import { liveLinkUrl, smsLink, sosMessage, whatsappLink } from '@/features/sos/share'
import { useLocationStream, type StreamStatus } from '@/features/sos/use-location-stream'
import { paths } from '@/lib/paths'
import { formatTime, timeAgo } from '@/lib/time'
import { useNow } from '@/lib/use-now'

const SOURCE_LABEL: Record<string, string> = {
  app: 'from this app',
  device: 'from your wearable',
  simulator: 'from the virtual wearable',
}

export function Component() {
  const { incidentId = '' } = useParams()
  const queryClient = useQueryClient()
  const [closedHere, setClosedHere] = useState(false)
  // After the duress PIN the screen shows "safe" while this phone keeps sending location quietly.
  const [quietSharing, setQuietSharing] = useState(false)

  const query = useQuery({
    queryKey: sosKeys.incident(incidentId),
    queryFn: () => fetchIncident(incidentId),
    refetchInterval: 15_000,
  })
  const incident = query.data?.incident
  const closed = closedHere || (incident ? closedForCitizen(incident) : false)
  const streaming = incident?.status === 'active' && (!closed || quietSharing)
  const stream = useLocationStream(streaming ? incidentId : null)

  if (query.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading your SOS…
      </p>
    )
  }
  if (query.isError || !incident) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this SOS</AlertTitle>
        <AlertDescription>
          {query.error?.message ?? 'It may belong to another account.'}{' '}
          <Link to={paths.app.home} className="underline">
            Go home
          </Link>
        </AlertDescription>
      </Alert>
    )
  }

  function onResolved(result: ResolveResult) {
    setClosedHere(true)
    setQuietSharing(result.keep_sharing)
    void queryClient.invalidateQueries({ queryKey: ['incidents'] })
  }

  if (closed) return <SafeScreen incidentId={incidentId} />

  return (
    <ActiveSos
      incident={incident}
      shareToken={query.data?.shareToken ?? null}
      stream={stream}
      onResolved={onResolved}
    />
  )
}

function ActiveSos({
  incident,
  shareToken,
  stream,
  onResolved,
}: {
  incident: Incident
  shareToken: string | null
  stream: ReturnType<typeof useLocationStream>
  onResolved: (result: ResolveResult) => void
}) {
  const now = useNow(10_000)
  const path = useQuery({
    queryKey: sosKeys.path(incident.id),
    queryFn: () => fetchPath(incident.id),
    refetchInterval: 5000,
  })
  const current =
    stream.lastFix ??
    (incident.last_lat !== null && incident.last_lng !== null
      ? { lat: incident.last_lat, lng: incident.last_lng }
      : null)

  return (
    <div className="grid gap-5">
      <section
        aria-labelledby="sos-title"
        className="bg-sos text-sos-foreground grid gap-1 rounded-xl p-5 shadow-md"
      >
        <h1 id="sos-title" className="text-2xl font-extrabold">
          SOS active
        </h1>
        <p className="text-sos-foreground/90">
          Sent {timeAgo(incident.started_at, now)} {SOURCE_LABEL[incident.source] ?? ''}. Keep this
          screen open to keep sharing your location.
        </p>
      </section>

      <Button asChild variant="sos" size="touch" className="w-full">
        <a href="tel:112">
          <PhoneCall aria-hidden />
          Call 112 now
        </a>
      </Button>

      <Responders incidentId={incident.id} />

      <ShareCard shareToken={shareToken} />

      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="text-sos size-5" aria-hidden />
            Your location
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <StreamLine status={stream.status} source={incident.source} />
          <LazyMap
            className="h-64"
            path={path.data ?? []}
            current={current}
            label="Your live location and the route since the SOS started"
          />
          {current ? (
            <p className="text-muted-foreground text-sm">
              {current.lat.toFixed(5)}, {current.lng.toFixed(5)}
              {stream.lastFix?.accuracy ? ` · within ${stream.lastFix.accuracy} m` : ''}
              {stream.lastSentAt ? ` · sent ${formatTime(stream.lastSentAt, true)}` : ''} ·{' '}
              <a
                className="underline"
                href={mapsLink(current.lat, current.lng)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Maps
              </a>
            </p>
          ) : null}
          {stream.error && stream.status !== 'denied' ? (
            <p className="text-muted-foreground text-sm">Last problem: {stream.error}. Retrying.</p>
          ) : null}
        </CardContent>
      </Card>

      <ResolveDialog incidentId={incident.id} onResolved={onResolved} />
    </div>
  )
}

function StreamLine({ status, source }: { status: StreamStatus; source: string }) {
  if (status === 'sharing') {
    return (
      <p className="flex items-center gap-2 font-medium">
        <span className="bg-sos size-2.5 animate-pulse rounded-full" aria-hidden />
        Sharing this phone's location every 5 seconds
      </p>
    )
  }
  if (status === 'denied') {
    return (
      <Alert>
        <AlertTitle>Location is blocked</AlertTitle>
        <AlertDescription>
          Allow location for this site in your browser settings, then reload. Your SOS is still
          active{source !== 'app' ? ', and your wearable keeps sending its position' : ''}.
        </AlertDescription>
      </Alert>
    )
  }
  if (status === 'unavailable') {
    return <p>This browser can't share location. Your SOS is still active.</p>
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      Finding your position…
    </p>
  )
}

function Responders({ incidentId }: { incidentId: string }) {
  const responders = useQuery({
    queryKey: sosKeys.responders(incidentId),
    queryFn: () => fetchResponders(incidentId),
    refetchInterval: 5000,
  })
  const list = responders.data ?? []

  return (
    <Card className="gap-3" aria-live="polite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="text-primary size-5" aria-hidden />
          Who's responding
        </CardTitle>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No one yet. When a contact opens your live link and taps "I'm responding", they show up
            here.
          </p>
        ) : (
          <ul className="grid gap-2">
            {list.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="font-semibold">{r.name} is on the way</span>
                <span className="text-muted-foreground text-sm">{formatTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ShareCard({ shareToken }: { shareToken: string | null }) {
  const contacts = useQuery({ queryKey: circleKeys.all, queryFn: listContacts })
  const [copied, setCopied] = useState(false)
  if (!shareToken) return null

  const url = liveLinkUrl(shareToken)
  const text = sosMessage(url)
  const phones = (contacts.data ?? []).flatMap((c) => (c.phone ? [c.phone] : []))
  const canShare = typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy your live link', url)
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="text-primary size-5" aria-hidden />
          Send your live link
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          Anyone with this link can see where you are until 24 hours after you end the SOS.
          Automatic alerts to your circle come in the next update; for now, send it here.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button asChild size="touch">
            <a href={whatsappLink(text)} target="_blank" rel="noreferrer">
              <MessageCircle aria-hidden />
              WhatsApp
            </a>
          </Button>
          {phones.length > 0 ? (
            <Button asChild size="touch" variant="secondary">
              <a href={smsLink(phones, text)}>
                <MessageSquare aria-hidden />
                SMS circle ({phones.length})
              </a>
            </Button>
          ) : (
            <Button asChild size="touch" variant="secondary">
              <Link to={paths.app.circle}>
                <Users aria-hidden />
                Add contacts
              </Link>
            </Button>
          )}
          <Button size="touch" variant="outline" onClick={copy}>
            {copied ? <CircleCheck aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          {canShare ? (
            <Button
              size="touch"
              variant="outline"
              onClick={() => navigator.share({ title: 'SOS', text, url }).catch(() => {})}
            >
              <Share2 aria-hidden />
              Share…
            </Button>
          ) : (
            <Button asChild size="touch" variant="outline">
              <a href={url} target="_blank" rel="noreferrer">
                Preview link
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SafeScreen({ incidentId }: { incidentId: string }) {
  return (
    <div className="grid justify-items-center gap-4 py-8 text-center">
      <CircleCheck className="size-16 text-emerald-600" aria-hidden />
      <h1 className="text-2xl font-bold">You're marked safe</h1>
      <p className="text-muted-foreground max-w-sm">
        Your circle can see that the SOS has ended. The live link stops working in 24 hours.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link to={paths.app.incident(incidentId)}>
            <History aria-hidden />
            See what happened
          </Link>
        </Button>
        <Button asChild>
          <Link to={paths.app.home}>Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
