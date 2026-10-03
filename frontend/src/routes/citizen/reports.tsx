import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, EyeOff, LoaderCircle, Plus } from 'lucide-react'
import { Link, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/features/auth/auth-context'
import {
  complaintKeys,
  fetchComplaintTimeline,
  fetchMyComplaint,
  listMyComplaints,
  shareIdentity,
  type Severity,
} from '@/features/complaints/api'
import { SeverityBadge } from '@/features/complaints/severity-badge'
import { CATEGORY, describeComplaintEntry, STATUS } from '@/features/complaints/labels'
import { paths } from '@/lib/paths'
import { fallbackInterval, useLiveChannel } from '@/lib/realtime'
import { formatDateTime, formatTime } from '@/lib/time'

/** Live updates for the citizen's own complaints (pinged on `user:<id>`). */
function useMyComplaintsLive() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const userId = auth.status === 'signed-in' ? auth.profile.id : null
  return useLiveChannel(userId ? `user:${userId}` : null, () => {
    void queryClient.invalidateQueries({ queryKey: ['complaints', 'mine'] })
  })
}

export function Component() {
  const { complaintId } = useParams()
  const live = useMyComplaintsLive()
  return complaintId ? <Detail id={complaintId} live={live} /> : <List live={live} />
}

function List({ live }: { live: boolean }) {
  const reports = useQuery({
    queryKey: complaintKeys.mine,
    queryFn: listMyComplaints,
    refetchInterval: fallbackInterval(live),
  })
  return (
    <div className="grid gap-6">
      <PageHeader
        title="My reports"
        description="Where each report stands, and what the police did."
      />
      <Button asChild className="w-fit">
        <Link to={paths.app.report}>
          <Plus aria-hidden /> New report
        </Link>
      </Button>
      {reports.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : reports.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{reports.error.message}</AlertDescription>
        </Alert>
      ) : reports.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">You haven't filed any reports.</p>
      ) : (
        <ul className="grid gap-2">
          {reports.data.map((r) => (
            <li key={r.id}>
              <Link
                to={paths.app.complaint(r.id)}
                className="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-lg border p-3"
              >
                <SeverityBadge severity={r.severity as Severity} />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{CATEGORY[r.category] ?? r.category}</span>
                  <span className="text-muted-foreground text-sm">
                    {r.reference} · {formatDateTime(r.created_at)} ·{' '}
                    {STATUS[r.status as keyof typeof STATUS] ?? r.status}
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Detail({ id, live }: { id: string; live: boolean }) {
  const queryClient = useQueryClient()
  const report = useQuery({
    queryKey: complaintKeys.mineOne(id),
    queryFn: () => fetchMyComplaint(id),
    refetchInterval: fallbackInterval(live),
  })
  const timeline = useQuery({
    queryKey: complaintKeys.timeline(id),
    queryFn: () => fetchComplaintTimeline(id),
    refetchInterval: fallbackInterval(live),
  })
  const share = useMutation({
    mutationFn: () => shareIdentity(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['complaints', 'mine'] }),
  })

  if (report.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading your report…
      </p>
    )
  }
  const r = report.data
  if (report.isError || !r) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this report</AlertTitle>
        <AlertDescription>
          {report.error?.message ?? 'It may belong to another account.'}{' '}
          <Link to={paths.app.reports} className="underline">
            All reports
          </Link>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-5">
      <Link to={paths.app.reports} className="text-muted-foreground w-fit text-sm">
        ← My reports
      </Link>
      <header className="grid gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <SeverityBadge severity={r.severity as Severity} />
          {CATEGORY[r.category] ?? r.category}
        </h1>
        <p className="text-muted-foreground text-sm">
          {r.reference} · filed {formatDateTime(r.created_at)}
        </p>
        <Badge variant="secondary" className="mt-1">
          {STATUS[r.status as keyof typeof STATUS] ?? r.status}
        </Badge>
      </header>

      {r.outcome_note ? (
        <Alert>
          <AlertTitle>From the police</AlertTitle>
          <AlertDescription>{r.outcome_note}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>What you reported</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p className="whitespace-pre-wrap">{r.description}</p>
          {r.occurred_at ? (
            <p className="text-muted-foreground">Happened {formatDateTime(r.occurred_at)}</p>
          ) : null}
        </CardContent>
      </Card>

      {r.confidential ? (
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <EyeOff className="text-primary size-5" aria-hidden />
              Confidential
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {r.identity_shared_at ? (
              <p>
                You shared your name and phone number on {formatDateTime(r.identity_shared_at)}.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Officers can't see your name or phone number. Share them only if you want the
                  police to contact you. This can't be undone.
                </p>
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => share.mutate()}
                  disabled={share.isPending}
                >
                  Share my name with the police
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm">
            {(timeline.data ?? []).map((entry) => (
              <li key={entry.seq} className="grid grid-cols-[4.5rem_1fr] gap-2">
                <span className="text-muted-foreground tabular-nums">
                  {formatTime(entry.occurred_at)}
                </span>
                <span>{describeComplaintEntry(entry)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
