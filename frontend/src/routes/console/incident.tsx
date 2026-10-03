import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BatteryMedium,
  CircleCheck,
  History,
  LoaderCircle,
  MapPin,
  PhoneCall,
  ShieldAlert,
  Truck,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  acknowledgeIncident,
  closeIncident,
  consoleKeys,
  dispatchUnit,
  fetchConsoleIncident,
  markOnScene,
  type CloseCode,
  type ConsoleIncident,
} from '@/features/console/api'
import {
  CLOSE_OPTIONS,
  describeConsoleEntry,
  escalationLabel,
  formatDuration,
  isUrgent,
  STATE_LABEL,
  waitingFor,
} from '@/features/console/board'
import { useListenOrg, useOrgChannel } from '@/features/console/use-console'
import { LazyMap } from '@/features/map/lazy-map'
import { mapsLink } from '@/features/map/links'
import { CLOSE_CODE } from '@/features/sos/timeline'
import { paths } from '@/lib/paths'
import { fallbackInterval, useLiveChannel } from '@/lib/realtime'
import { formatTime, timeAgo } from '@/lib/time'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

/** The incident command view: live map, actions, response metrics and the sealed timeline. */
export function Component() {
  const { incidentId = '' } = useParams()
  const queryClient = useQueryClient()
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: consoleKeys.incident(incidentId) })
  // Location pings arrive on the incident topic; actions by colleagues on the station topic.
  const live = useLiveChannel(incidentId ? `incident:${incidentId}` : null, refresh)
  useOrgChannel(useListenOrg())
  const query = useQuery({
    queryKey: consoleKeys.incident(incidentId),
    queryFn: () => fetchConsoleIncident(incidentId),
    refetchInterval: (q) => (q.state.data?.status === 'active' ? fallbackInterval(live) : false),
  })

  if (query.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading incident…
      </p>
    )
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this incident</AlertTitle>
        <AlertDescription>
          {query.error.message}.{' '}
          <Link to={paths.console.live} className="underline">
            Back to the board
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  return <IncidentView incident={query.data} />
}

function IncidentView({ incident }: { incident: ConsoleIncident }) {
  const now = useNow(5_000)
  const active = incident.status === 'active'
  const escalation = escalationLabel(incident.escalation_level)
  const location = incident.last_location

  return (
    <div className="grid gap-5">
      <Link
        to={paths.console.live}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden /> Live board
      </Link>

      <header
        className={cn(
          'grid gap-2 rounded-xl border p-4',
          active && isUrgent(incident) && 'border-sos ring-sos/40 ring-2',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid">
            <h1 className="text-2xl font-bold">{incident.citizen_name}</h1>
            <p className="text-muted-foreground text-sm">
              SOS at {formatTime(incident.started_at, true)} · {incident.org_name ?? 'Unrouted'}
              {active ? ` · waiting ${formatDuration(waitingFor(incident, now))}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {incident.is_demo ? <Badge variant="outline">Demo</Badge> : null}
            {escalation && active ? (
              <Badge variant={isUrgent(incident) ? 'destructive' : 'secondary'}>
                <ShieldAlert aria-hidden />
                {escalation}
              </Badge>
            ) : null}
            <Badge variant="secondary">
              {active
                ? STATE_LABEL[incident.response_state]
                : `Closed: ${CLOSE_CODE[incident.close_code ?? ''] ?? 'by the citizen'}`}
            </Badge>
          </div>
        </div>
        {incident.closed_under_duress ? (
          <Alert variant="destructive">
            <AlertTitle>Ended with the duress PIN</AlertTitle>
            <AlertDescription>
              The citizen's screen shows the SOS as ended, but they may be under pressure. Treat it
              as active.
            </AlertDescription>
          </Alert>
        ) : null}
        {incident.citizen_phone ? (
          <Button asChild variant="outline" className="w-full sm:w-fit">
            <a href={`tel:${incident.citizen_phone.replace(/\s+/g, '')}`}>
              <PhoneCall aria-hidden />
              Call {incident.citizen_phone}
            </a>
          </Button>
        ) : null}
      </header>

      {active ? <Actions incident={incident} /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="text-sos size-5" aria-hidden />
              Location
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <LazyMap
              className="h-72"
              path={incident.path}
              current={location}
              follow={active}
              label={`${incident.citizen_name}'s location and route since the SOS started`}
            />
            {location ? (
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span>
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)} · {timeAgo(location.at, now)}
                  {location.accuracy_m ? `, within ${Math.round(location.accuracy_m)} m` : ''}
                </span>
                {incident.battery_pct !== null ? (
                  <span className="flex items-center gap-1">
                    <BatteryMedium className="size-4" aria-hidden />
                    {incident.battery_pct}%
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
              <p className="text-muted-foreground text-sm">No location fix yet.</p>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Response times</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Metric label="Acknowledged" seconds={incident.metrics.ack_s} />
                <Metric label="Dispatched" seconds={incident.metrics.dispatch_s} />
                <Metric label="On scene" seconds={incident.metrics.arrival_s} />
              </dl>
              {incident.unit ? (
                <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-sm">
                  <Truck className="size-4" aria-hidden />
                  {incident.unit.call_sign}
                  {incident.arrived_at
                    ? ` arrived ${formatTime(incident.arrived_at)}`
                    : incident.eta_at
                      ? `, ETA ${formatTime(incident.eta_at)}`
                      : ''}
                </p>
              ) : null}
              {incident.responders.length > 0 ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  Contacts responding: {incident.responders.map((r) => r.name).join(', ')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-5" aria-hidden />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-2 text-sm">
                {incident.timeline.map((entry) => (
                  <li key={entry.seq} className="grid grid-cols-[5.5rem_1fr] gap-2">
                    <span className="text-muted-foreground tabular-nums">
                      {formatTime(entry.occurred_at, true)}
                    </span>
                    <span>{describeConsoleEntry(entry)}</span>
                  </li>
                ))}
              </ol>
              <p className="text-muted-foreground mt-3 text-xs">
                Every step is sealed in the tamper-evident ledger.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, seconds }: { label: string; seconds: number | null }) {
  return (
    <div className="bg-muted/50 grid rounded-md p-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-semibold tabular-nums">{formatDuration(seconds)}</dd>
    </div>
  )
}

/** Acknowledge → dispatch → on scene → close. Each step is one tap. */
function Actions({ incident }: { incident: ConsoleIncident }) {
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })

  return (
    <section aria-label="Actions" className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {incident.acknowledged_at ? (
          <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <CircleCheck className="size-4 text-emerald-600" aria-hidden />
            Acknowledged {formatTime(incident.acknowledged_at)}
            {incident.acknowledged_by ? ` by ${incident.acknowledged_by}` : ''}
          </span>
        ) : (
          <Button
            size="touch"
            onClick={() => run.mutate(() => acknowledgeIncident(incident.id))}
            disabled={run.isPending}
          >
            Acknowledge
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <DispatchDialog incident={incident} />
        {incident.unit && !incident.arrived_at ? (
          <Button
            variant="secondary"
            onClick={() => run.mutate(() => markOnScene(incident.id))}
            disabled={run.isPending}
          >
            Mark on scene
          </Button>
        ) : null}
        <CloseDialog incidentId={incident.id} />
      </div>
      {run.isError ? <p className="text-destructive text-sm">{run.error.message}</p> : null}
    </section>
  )
}

function DispatchDialog({ incident }: { incident: ConsoleIncident }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const available = incident.units.filter(
    (u) => u.status === 'available' || u.id === incident.unit?.id,
  )
  const [unitId, setUnitId] = useState('')
  const [eta, setEta] = useState('6')
  const dispatch = useMutation({
    mutationFn: () => dispatchUnit(incident.id, unitId, Number(eta)),
    onSuccess: () => setOpen(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (unitId) dispatch.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setUnitId(incident.unit?.id ?? available[0]?.id ?? '')
          dispatch.reset()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={incident.unit ? 'outline' : 'default'}>
          <Truck aria-hidden />
          {incident.unit ? 'Change unit' : 'Dispatch unit'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Dispatch a unit</DialogTitle>
            <DialogDescription>
              The citizen and their contacts see the call sign and arrival time.
            </DialogDescription>
          </DialogHeader>
          {available.length === 0 ? (
            <p className="text-muted-foreground text-sm">No units are available right now.</p>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Unit</legend>
              {available.map((u) => (
                <label
                  key={u.id}
                  className="has-checked:border-primary flex items-center gap-3 rounded-md border p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="unit"
                    value={u.id}
                    checked={unitId === u.id}
                    onChange={() => setUnitId(u.id)}
                  />
                  <span className="grid">
                    <span className="font-medium">{u.call_sign}</span>
                    <span className="text-muted-foreground">
                      {u.org_name}
                      {u.distance_m !== null
                        ? ` · ${(u.distance_m / 1000).toFixed(1)} km away`
                        : ''}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="grid gap-2">
            <Label htmlFor="eta">Arrival in (minutes)</Label>
            <Input
              id="eta"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              required
              value={eta}
              onChange={(e) => setEta(e.target.value)}
            />
          </div>
          {dispatch.isError ? (
            <p className="text-destructive text-sm">{dispatch.error.message}</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={!unitId || dispatch.isPending}>
              {dispatch.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Dispatch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CloseDialog({ incidentId }: { incidentId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<CloseCode | ''>('')
  const [note, setNote] = useState('')
  const close = useMutation({
    mutationFn: () => closeIncident(incidentId, code as CloseCode, note),
    onSuccess: () => setOpen(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (code) close.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Close incident</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Close this incident</DialogTitle>
            <DialogDescription>
              Pick what happened. The code and note are sealed in the ledger.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Outcome</legend>
            {CLOSE_OPTIONS.map((option) => (
              <label key={option.code} className="flex items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="close-code"
                  value={option.code}
                  checked={code === option.code}
                  onChange={() => setCode(option.code)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="close-note">Note (optional)</Label>
            <Input
              id="close-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {close.isError ? <p className="text-destructive text-sm">{close.error.message}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={!code || close.isPending}>
              Close incident
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
