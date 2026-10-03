import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bot,
  EyeOff,
  LoaderCircle,
  Lock,
  MapPin,
  Mic,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
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
import { Label } from '@/components/ui/label'
import {
  acknowledgeComplaint,
  consoleComplaintKeys,
  fetchConsoleComplaint,
  fetchQueue,
  loadDemoComplaints,
  setComplaintSeverity,
  setComplaintStatus,
  type ConsoleComplaint,
  type QueueComplaint,
  type Severity,
} from '@/features/complaints/api'
import {
  describeComplaintEntry,
  SEVERITY_HELP,
  signalLabel,
  STATUS,
  timeLeft,
} from '@/features/complaints/labels'
import { SeverityBadge } from '@/features/complaints/severity-badge'
import { useListenOrg, useOrgChannel, useStaff } from '@/features/console/use-console'
import { mapsLink } from '@/features/map/links'
import { paths } from '@/lib/paths'
import { fallbackInterval } from '@/lib/realtime'
import { formatDateTime, formatTime } from '@/lib/time'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

export function Component() {
  const { complaintId } = useParams()
  const live = useOrgChannel(useListenOrg())
  return complaintId ? <Workbench id={complaintId} live={live} /> : <Queue live={live} />
}

function Countdown({ complaint, now }: { complaint: QueueComplaint; now: number }) {
  if (complaint.acknowledged_at) {
    return <span className="text-muted-foreground text-sm">Acknowledged</span>
  }
  const left = timeLeft(complaint.sla_due_at, now)
  return (
    <span
      className={cn(
        'font-mono text-sm font-semibold tabular-nums',
        left.overdue ? 'text-sos' : left.seconds < 120 ? 'text-orange-600' : '',
      )}
      aria-label={`Time to acknowledge: ${left.text}`}
    >
      {left.text}
    </span>
  )
}

function Queue({ live }: { live: boolean }) {
  const now = useNow(1_000)
  const queue = useQuery({
    queryKey: consoleComplaintKeys.queue,
    queryFn: fetchQueue,
    refetchInterval: fallbackInterval(live),
  })
  const items = queue.data ?? []
  const waiting = items.filter((c) => !c.acknowledged_at).length

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Complaints"
        description="Unacknowledged first, sorted by time left to acknowledge."
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {items.length} open · {waiting} waiting for acknowledgement
        </span>
        <DemoButton />
      </div>

      {queue.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{queue.error.message}</AlertDescription>
        </Alert>
      ) : queue.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground text-sm">No open complaints.</CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {items.map((c) => {
            const overdue = !c.acknowledged_at && timeLeft(c.sla_due_at, now).overdue
            return (
              <li key={c.id}>
                <Link
                  to={paths.console.complaint(c.id)}
                  className={cn(
                    'bg-card hover:bg-accent/40 grid gap-1 rounded-lg border p-3',
                    overdue && 'border-sos ring-sos/30 ring-2',
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={c.severity} />
                    <span className="font-medium">{c.category_label}</span>
                    {c.reporter.confidential && !c.reporter.name ? (
                      <Badge variant="outline">
                        <EyeOff aria-hidden /> Confidential
                      </Badge>
                    ) : null}
                    {c.pending_review ? (
                      <Badge variant="secondary">Downgrade in review</Badge>
                    ) : null}
                    {c.escalation_level > 0 ? (
                      <Badge variant="destructive">
                        <ShieldAlert aria-hidden />
                        {c.escalation_level >= 2 ? 'Raised to control room' : 'SLA missed'}
                      </Badge>
                    ) : null}
                    {c.is_demo ? <Badge variant="outline">Demo</Badge> : null}
                    <span className="ml-auto">
                      <Countdown complaint={c} now={now} />
                    </span>
                  </span>
                  <span className="text-muted-foreground line-clamp-2 text-sm">{c.excerpt}</span>
                  <span className="text-muted-foreground text-xs">
                    {c.reference} · {c.org_name} · filed {formatTime(c.created_at)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DemoButton() {
  const { profile } = useStaff()
  const queryClient = useQueryClient()
  const load = useMutation({
    mutationFn: loadDemoComplaints,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })
  if (profile?.role !== 'admin' && profile?.role !== 'supervisor') return null
  return (
    <span className="ml-auto flex items-center gap-2">
      {load.isError ? <span className="text-destructive">{load.error.message}</span> : null}
      <Button size="sm" variant="outline" onClick={() => load.mutate()} disabled={load.isPending}>
        <RefreshCw className={cn(load.isPending && 'animate-spin')} aria-hidden />
        Load demo complaints
      </Button>
    </span>
  )
}

function Workbench({ id, live }: { id: string; live: boolean }) {
  const now = useNow(1_000)
  const query = useQuery({
    queryKey: consoleComplaintKeys.one(id),
    queryFn: () => fetchConsoleComplaint(id),
    refetchInterval: fallbackInterval(live),
  })

  if (query.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading complaint…
      </p>
    )
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this complaint</AlertTitle>
        <AlertDescription>
          {query.error.message}.{' '}
          <Link to={paths.console.complaints} className="underline">
            Back to the queue
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  const c = query.data
  const open = c.status !== 'resolved' && c.status !== 'closed'

  return (
    <div className="grid gap-5">
      <Link
        to={paths.console.complaints}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden /> Complaints
      </Link>

      <header className="grid gap-2 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={c.severity} className="text-sm" />
          <h1 className="text-xl font-bold">{c.category_label}</h1>
          {open ? (
            <span className="ml-auto">
              <Countdown complaint={c} now={now} />
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">
          {c.reference} · {c.org_name} · filed {formatDateTime(c.created_at)} · {STATUS[c.status]}
        </p>
        <Reporter complaint={c} />
      </header>

      {open ? <Actions complaint={c} /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Report
              {c.input_mode === 'voice' ? (
                <Badge variant="outline">
                  <Mic aria-hidden /> Dictated
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="whitespace-pre-wrap">{c.description}</p>
            {c.occurred_at ? (
              <p className="text-muted-foreground">Happened {formatDateTime(c.occurred_at)}</p>
            ) : null}
            {c.location ? (
              <a
                className="flex w-fit items-center gap-1 underline"
                href={mapsLink(c.location.lat, c.location.lng)}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin className="text-sos size-4" aria-hidden />
                {c.location.lat.toFixed(5)}, {c.location.lng.toFixed(5)}
              </a>
            ) : (
              <p className="text-muted-foreground">No location given.</p>
            )}
            {c.outcome_note ? <p>Outcome: {c.outcome_note}</p> : null}
          </CardContent>
        </Card>

        <Triage complaint={c} />
      </div>

      {c.overrides.length > 0 ? (
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-4" aria-hidden /> Severity overrides
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {c.overrides.map((o) => (
                <li key={o.id}>
                  L{o.from} → L{o.to} (baseline L{o.baseline}) by {o.officer ?? 'an officer'},{' '}
                  {formatDateTime(o.at)}: "{o.justification}" ·{' '}
                  <span className="font-medium">
                    {o.review_status === 'pending'
                      ? 'awaiting supervisor review'
                      : `${o.review_status} by ${o.reviewed_by ?? 'a supervisor'}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm">
            {c.timeline.map((entry) => (
              <li key={entry.seq} className="grid grid-cols-[5.5rem_1fr] gap-2">
                <span className="text-muted-foreground tabular-nums">
                  {formatTime(entry.occurred_at, true)}
                </span>
                <span>{describeComplaintEntry(entry, true)}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-3 text-xs">
            Every step is sealed in the tamper-evident ledger.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Reporter({ complaint }: { complaint: ConsoleComplaint }) {
  const r = complaint.reporter
  if (r.confidential && !r.name) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <EyeOff className="text-primary size-4" aria-hidden />
        <span className="font-medium">{r.alias}</span>
        <span className="text-muted-foreground">
          Confidential: name and phone stay hidden unless the reporter shares them.
        </span>
      </p>
    )
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{r.name}</span>
      {r.confidential ? <Badge variant="outline">Shared by the reporter</Badge> : null}
      {r.phone ? (
        <a
          className="flex items-center gap-1 underline"
          href={`tel:${r.phone.replace(/\s+/g, '')}`}
        >
          <PhoneCall className="size-4" aria-hidden />
          {r.phone}
        </a>
      ) : null}
    </p>
  )
}

function Triage({ complaint }: { complaint: ConsoleComplaint }) {
  const { rules, ai } = complaint
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5" aria-hidden /> Triage
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="grid gap-1">
          <p className="font-medium">
            Rules: <SeverityBadge severity={rules.severity} /> {rules.category_label}
          </p>
          <p className="text-muted-foreground">
            {rules.signals.length ? rules.signals.map(signalLabel).join(', ') : 'No signals'}
          </p>
        </div>
        <div className="grid gap-1">
          {ai ? (
            <>
              <p className="font-medium">
                AI: <SeverityBadge severity={ai.severity} /> (final L{ai.final}
                {ai.confidence !== null ? `, ${Math.round(ai.confidence * 100)}% sure` : ''})
              </p>
              <p>{ai.rationale}</p>
              {ai.legal_tags.length ? (
                <p className="text-muted-foreground">
                  Possible sections (suggestions only): {ai.legal_tags.join(', ')}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">
              {complaint.triage_state === 'pending'
                ? 'AI review in progress…'
                : complaint.triage_state === 'skipped'
                  ? 'AI review is not set up; the rules decided.'
                  : 'AI review failed; the rules decided.'}
            </p>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Baseline L{complaint.baseline_severity}: going lower needs a written justification that a
          supervisor reviews.
        </p>
      </CardContent>
    </Card>
  )
}

function Actions({ complaint }: { complaint: ConsoleComplaint }) {
  const queryClient = useQueryClient()
  const ack = useMutation({
    mutationFn: () => acknowledgeComplaint(complaint.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })
  const progress = useMutation({
    mutationFn: () => setComplaintStatus(complaint.id, 'in_progress', ''),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })
  return (
    <section aria-label="Actions" className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {complaint.acknowledged_at ? null : (
          <Button size="touch" onClick={() => ack.mutate()} disabled={ack.isPending}>
            Acknowledge
          </Button>
        )}
        {complaint.status !== 'in_progress' ? (
          <Button
            variant="secondary"
            onClick={() => progress.mutate()}
            disabled={progress.isPending}
          >
            Mark in progress
          </Button>
        ) : null}
        <SeverityDialog complaint={complaint} />
        <ResolveDialog complaintId={complaint.id} />
      </div>
      {complaint.acknowledged_by ? (
        <p className="text-muted-foreground text-sm">
          Acknowledged by {complaint.acknowledged_by}
          {complaint.acknowledged_at ? ` at ${formatTime(complaint.acknowledged_at)}` : ''}
        </p>
      ) : null}
      {ack.isError ? <p className="text-destructive text-sm">{ack.error.message}</p> : null}
    </section>
  )
}

/** The accountability lock: going below the baseline needs a justification. */
function SeverityDialog({ complaint }: { complaint: ConsoleComplaint }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [severity, setSeverity] = useState<Severity>(complaint.severity)
  const [justification, setJustification] = useState('')
  const below = severity < complaint.baseline_severity
  const save = useMutation({
    mutationFn: () => setComplaintSeverity(complaint.id, severity, justification),
    onSuccess: () => setOpen(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })
  const ready = severity !== complaint.severity && (!below || justification.trim().length >= 20)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ready) save.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setSeverity(complaint.severity)
          setJustification('')
          save.reset()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Change severity</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change severity</DialogTitle>
            <DialogDescription>
              The AI baseline is L{complaint.baseline_severity}. Raising is always allowed; going
              lower needs a justification, and a supervisor reviews it.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Severity</legend>
            {([5, 4, 3, 2, 1] as Severity[]).map((s) => (
              <label key={s} className="flex items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="severity"
                  checked={severity === s}
                  onChange={() => setSeverity(s)}
                />
                <SeverityBadge severity={s} />
                {SEVERITY_HELP[s]}
                {s === complaint.baseline_severity ? (
                  <span className="text-muted-foreground">(baseline)</span>
                ) : null}
              </label>
            ))}
          </fieldset>
          {below ? (
            <div className="grid gap-2">
              <Label htmlFor="justification">
                <Lock className="size-4" aria-hidden /> Justification (at least 20 characters)
              </Label>
              <textarea
                id="justification"
                rows={3}
                maxLength={1000}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
              />
              <p className="text-muted-foreground text-xs">
                {justification.trim().length}/20 · logged in the ledger and sent for supervisor
                review.
              </p>
            </div>
          ) : null}
          {save.isError ? <p className="text-destructive text-sm">{save.error.message}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={!ready || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResolveDialog({ complaintId }: { complaintId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'resolved' | 'closed'>('resolved')
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: () => setComplaintStatus(complaintId, status, note),
    onSuccess: () => setOpen(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (note.trim()) save.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Resolve or close</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Resolve or close</DialogTitle>
            <DialogDescription>The reporter sees your note.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={status === 'resolved'}
                onChange={() => setStatus('resolved')}
              />
              Resolved
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={status === 'closed'}
                onChange={() => setStatus('closed')}
              />
              Closed without action
            </label>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="outcome-note">Note for the reporter</Label>
            <textarea
              id="outcome-note"
              rows={3}
              required
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            />
          </div>
          {save.isError ? <p className="text-destructive text-sm">{save.error.message}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={!note.trim() || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
