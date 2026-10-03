import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BatteryMedium,
  Inbox,
  LoaderCircle,
  Radio,
  RefreshCw,
  ShieldAlert,
  Truck,
} from 'lucide-react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { PhaseBadge } from '@/components/phase-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { acknowledgeIncident, loadDemoIncidents, type BoardIncident } from '@/features/console/api'
import { BoardMap } from '@/features/console/board-map'
import {
  escalationLabel,
  formatDuration,
  isUrgent,
  STATE_LABEL,
  summarize,
  waitingFor,
} from '@/features/console/board'
import { useBoard, useStaff } from '@/features/console/use-console'
import { paths } from '@/lib/paths'
import { formatTime } from '@/lib/time'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

export function Component() {
  const { board, live } = useBoard()
  const now = useNow(5_000)
  const incidents = board.data ?? []
  const counts = summarize(incidents)

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Live board"
        description="Active SOS alerts for your station, most urgent first."
      />

      <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <span className="font-medium">
          {counts.total} active · {counts.unacknowledged} not acknowledged
        </span>
        {counts.urgent > 0 ? <Badge variant="destructive">{counts.urgent} escalated</Badge> : null}
        <span className="text-muted-foreground flex items-center gap-1.5">
          <span
            className={cn('size-2 rounded-full', live ? 'bg-emerald-600' : 'bg-muted-foreground')}
            aria-hidden
          />
          {live ? 'Live' : 'Refreshing every 5 s'}
        </span>
        <DemoButton />
      </div>

      {board.isError ? (
        <Alert variant="destructive">
          <AlertTitle>The board didn't load</AlertTitle>
          <AlertDescription>{board.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section aria-labelledby="active-sos" className="grid content-start gap-3">
          <h2 id="active-sos" className="flex items-center gap-2 font-semibold">
            <Radio className="text-sos size-4" aria-hidden />
            Active SOS
          </h2>
          {board.isPending ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          ) : incidents.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground text-sm">
                No active incidents. New SOS alerts appear here instantly.
              </CardContent>
            </Card>
          ) : (
            <ul className="grid gap-3">
              {incidents.map((incident) => (
                <IncidentRow key={incident.id} incident={incident} now={now} />
              ))}
            </ul>
          )}
        </section>

        <div className="grid content-start gap-4">
          <BoardMap incidents={incidents} className="h-72" />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox className="text-primary size-4" aria-hidden />
                Complaint queue
              </CardTitle>
              <CardDescription>Sorted by time left to acknowledge.</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
              Triage and countdowns arrive with smart complaints.
              <PhaseBadge phase="P3" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function IncidentRow({ incident, now }: { incident: BoardIncident; now: number }) {
  const queryClient = useQueryClient()
  const ack = useMutation({
    mutationFn: () => acknowledgeIncident(incident.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })
  const urgent = isUrgent(incident)
  const escalation = escalationLabel(incident.escalation_level)

  return (
    <li
      className={cn(
        'bg-card grid gap-3 rounded-lg border p-4',
        urgent && 'border-sos ring-sos/40 animate-pulse ring-2 motion-reduce:animate-none',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid">
          <Link
            to={paths.console.incident(incident.id)}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {incident.citizen_name}
          </Link>
          <span className="text-muted-foreground text-sm">
            {incident.org_name ?? 'Unrouted'} · started {formatTime(incident.started_at)} · waiting{' '}
            {formatDuration(waitingFor(incident, now))}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {incident.is_demo ? <Badge variant="outline">Demo</Badge> : null}
          {escalation ? (
            <Badge variant={urgent ? 'destructive' : 'secondary'}>
              <ShieldAlert aria-hidden />
              {escalation}
            </Badge>
          ) : null}
          <Badge variant={incident.acknowledged_at ? 'secondary' : 'outline'}>
            {STATE_LABEL[incident.response_state]}
          </Badge>
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {incident.unit ? (
          <span className="flex items-center gap-1">
            <Truck className="size-4" aria-hidden />
            {incident.unit.call_sign}
            {incident.eta_at && !incident.arrived_at ? `, ETA ${formatTime(incident.eta_at)}` : ''}
          </span>
        ) : null}
        {incident.battery_pct !== null ? (
          <span className="flex items-center gap-1">
            <BatteryMedium className="size-4" aria-hidden />
            {incident.battery_pct}%
          </span>
        ) : null}
        {incident.last_location ? null : <span>No location yet</span>}
        {incident.responders > 0 ? (
          <span>
            {incident.responders} contact{incident.responders === 1 ? '' : 's'} responding
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {incident.acknowledged_at ? null : (
          <Button size="sm" onClick={() => ack.mutate()} disabled={ack.isPending}>
            {ack.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Acknowledge
          </Button>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link to={paths.console.incident(incident.id)}>Open</Link>
        </Button>
      </div>
      {ack.isError ? <p className="text-destructive text-sm">{ack.error.message}</p> : null}
    </li>
  )
}

/** Admins and supervisors can (re)load three demo incidents to try the console. */
function DemoButton() {
  const { profile } = useStaff()
  const queryClient = useQueryClient()
  const load = useMutation({
    mutationFn: loadDemoIncidents,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })
  if (profile?.role !== 'admin' && profile?.role !== 'supervisor') return null
  return (
    <span className="ml-auto flex items-center gap-2">
      {load.isError ? <span className="text-destructive">{load.error.message}</span> : null}
      <Button size="sm" variant="outline" onClick={() => load.mutate()} disabled={load.isPending}>
        <RefreshCw className={cn(load.isPending && 'animate-spin')} aria-hidden />
        Load demo incidents
      </Button>
    </span>
  )
}
