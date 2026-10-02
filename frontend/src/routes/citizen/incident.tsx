import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LazyMap } from '@/features/map/lazy-map'
import {
  closedForCitizen,
  fetchIncident,
  fetchPath,
  fetchTimeline,
  sosKeys,
} from '@/features/sos/api'
import { describeEntry } from '@/features/sos/timeline'
import { paths } from '@/lib/paths'
import { formatDateTime, formatTime } from '@/lib/time'

export function Component() {
  const { incidentId = '' } = useParams()
  const incident = useQuery({
    queryKey: sosKeys.incident(incidentId),
    queryFn: () => fetchIncident(incidentId),
  })
  const timeline = useQuery({
    queryKey: sosKeys.timeline(incidentId),
    queryFn: () => fetchTimeline(incidentId),
  })
  const path = useQuery({
    queryKey: sosKeys.path(incidentId),
    queryFn: () => fetchPath(incidentId),
  })

  if (incident.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
      </p>
    )
  }
  const row = incident.data?.incident
  if (!row) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {incident.error?.message ?? "We couldn't find this SOS."}{' '}
          <Link to={paths.app.home} className="underline">
            Go home
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  const ended = closedForCitizen(row)

  return (
    <div className="grid gap-6">
      <PageHeader
        title="What happened"
        description={`SOS on ${formatDateTime(row.started_at)}`}
        actions={
          ended ? (
            <Badge variant="secondary">Ended</Badge>
          ) : (
            <Button asChild variant="sos" size="sm">
              <Link to={paths.app.sos(row.id)}>Open live SOS</Link>
            </Button>
          )
        }
      />

      <LazyMap
        className="h-56"
        path={path.data ?? []}
        follow={false}
        label="The route recorded during this SOS"
      />

      <section aria-labelledby="timeline-title" className="grid gap-3">
        <h2 id="timeline-title" className="text-lg font-bold">
          Timeline
        </h2>
        {timeline.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{timeline.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <ol className="grid gap-0">
          {(timeline.data ?? []).map((entry) => (
            <li key={entry.seq} className="relative border-l-2 py-2 pl-5">
              <span
                aria-hidden
                className="bg-primary absolute top-3.5 -left-[7px] size-3 rounded-full"
              />
              <p className="font-medium">{describeEntry(entry)}</p>
              <p className="text-muted-foreground text-sm">
                {formatTime(entry.occurred_at, true)} · ledger entry #{entry.seq}
              </p>
            </li>
          ))}
        </ol>
        <Card className="bg-muted/50 shadow-none">
          <CardContent className="text-muted-foreground flex gap-3 text-sm">
            <ShieldCheck className="text-primary size-5 shrink-0" aria-hidden />
            Each step is written to a tamper-evident ledger the moment it happens. Changing any
            entry later breaks the chain, so this record can be trusted as evidence.
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
