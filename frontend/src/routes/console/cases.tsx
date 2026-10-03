import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, FileUp, LoaderCircle, MapPin } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useOrgChannel, useListenOrg } from '@/features/console/use-console'
import {
  addCaseNote,
  addEvidence,
  advanceCase,
  caseCheckin,
  caseKeys,
  fetchCase,
  fetchCases,
  type ConsoleCase,
  type MissingRequirement,
} from '@/features/evidence/api'
import { formatBytes } from '@/features/evidence/hash'
import { ChecklistChips, EntryList, StatusBadge } from '@/features/evidence/parts'
import { currentFix } from '@/features/sos/geo'
import { paths } from '@/lib/paths'
import { fallbackInterval } from '@/lib/realtime'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'

export function Component() {
  const { caseId } = useParams()
  const live = useOrgChannel(useListenOrg())
  return caseId ? <CaseView id={caseId} live={live} /> : <CaseList live={live} />
}

function CaseList({ live }: { live: boolean }) {
  const cases = useQuery({
    queryKey: caseKeys.list,
    queryFn: fetchCases,
    refetchInterval: fallbackInterval(live),
  })
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Cases"
        description="Each case follows its procedure step by step. Open a case from a complaint."
      />
      {cases.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : cases.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{cases.error.message}</AlertDescription>
        </Alert>
      ) : cases.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No cases yet. Open one from a complaint's workbench.{' '}
          <Link to={paths.console.complaints} className="underline">
            Complaints
          </Link>
        </p>
      ) : (
        <ul className="grid gap-2">
          {cases.data.map((k) => (
            <li key={k.id}>
              <Link
                to={paths.console.case(k.id)}
                className="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-lg border p-3"
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">
                    {k.reference} · {k.title}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {k.state_label} (step {k.state_index + 1} of {k.state_count}) · {k.org_name} ·
                    led by {k.lead_officer} · {k.evidence_count} evidence, {k.locked_count} locked
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

function CaseView({ id, live }: { id: string; live: boolean }) {
  const queryClient = useQueryClient()
  const kase = useQuery({
    queryKey: caseKeys.one(id),
    queryFn: () => fetchCase(id),
    refetchInterval: fallbackInterval(live),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['console', 'cases'] })

  if (kase.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading the case…
      </p>
    )
  }
  if (kase.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this case</AlertTitle>
        <AlertDescription>
          {kase.error.message}{' '}
          <Link to={paths.console.cases} className="underline">
            All cases
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  const k = kase.data

  return (
    <div className="grid gap-5">
      <Link to={paths.console.cases} className="text-muted-foreground w-fit text-sm">
        ← Cases
      </Link>
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold">
          {k.reference} · {k.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {k.org_name} · investigating officer {k.lead_officer} · opened{' '}
          {formatDateTime(k.created_at)}
          {k.complaint_id ? (
            <>
              {' '}
              · complaint{' '}
              <Link to={paths.console.complaint(k.complaint_id)} className="underline">
                {k.complaint_reference}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-5">
          <Procedure k={k} onDone={refresh} />
          <EvidenceList k={k} onDone={refresh} />
        </div>
        <div className="grid content-start gap-5">
          <SiteVisit k={k} onDone={refresh} />
          <Notes k={k} onDone={refresh} />
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <EntryList entries={k.timeline} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Procedure({ k, onDone }: { k: ConsoleCase; onDone: () => void }) {
  const current = k.state_index
  const [target, setTarget] = useState(k.states[current + 1]?.key ?? '')
  const [missing, setMissing] = useState<MissingRequirement[] | null>(null)
  const advance = useMutation({
    mutationFn: () => advanceCase(k.id, target),
    onSuccess: (result) => {
      setMissing(result.ok ? null : result.missing)
      if (result.ok) setTarget(k.states[k.states.findIndex((s) => s.key === target) + 1]?.key ?? '')
    },
    onSettled: onDone,
  })
  const later = k.states.filter((s) => s.index > current)

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>
          Procedure: {k.workflow.name} (v{k.workflow.version})
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="grid gap-2" aria-label="Workflow steps">
          {k.states.map((s) => (
            <li
              key={s.key}
              className={cn(
                'grid gap-1 rounded-md border p-2 text-sm',
                s.index === current && 'border-primary bg-accent/40',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                {s.index <= current ? (
                  <Check className="size-4 text-emerald-600" aria-label="done" />
                ) : (
                  <span className="text-muted-foreground w-4 text-center">{s.index + 1}</span>
                )}
                {s.label}
                {s.index === current ? <Badge variant="secondary">Current</Badge> : null}
              </span>
              {s.requires.length > 0 && s.index > current ? (
                <ul className="text-muted-foreground ml-6 grid gap-0.5">
                  {s.requires.map((r) => (
                    <li key={r.kind}>
                      {r.met ? '✓' : '⚠'} {r.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>

        {later.length > 0 && k.status === 'open' ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (target) advance.mutate()
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="advance-to">Move the case to</Label>
              <select
                id="advance-to"
                className="border-input bg-background h-9 rounded-md border px-2"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value)
                  setMissing(null)
                }}
              >
                {later.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={!target || advance.isPending}>
              Move
            </Button>
          </form>
        ) : null}

        {missing && missing.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>Not yet: these steps are missing</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 grid gap-1">
                {missing.map((m) => (
                  <li key={`${m.state}-${m.kind}`}>
                    <strong>{m.label}</strong> (for “{m.state_label}”): {m.hint}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {advance.isError ? (
          <p className="text-destructive text-sm">{advance.error.message}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EvidenceList({ k, onDone }: { k: ConsoleCase; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const add = useMutation({
    mutationFn: async (file: File) =>
      addEvidence({
        file,
        clientId: crypto.randomUUID(),
        caseId: k.id,
        location: await currentFix(2000),
      }),
    onSettled: onDone,
  })
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Evidence</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => input.current?.click()}
          disabled={add.isPending}
        >
          {add.isPending ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <FileUp aria-hidden />
          )}
          Add evidence
        </Button>
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label="Evidence file"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) add.mutate(file)
          }}
        />
      </CardHeader>
      <CardContent className="grid gap-2">
        {add.isError ? <p className="text-destructive text-sm">{add.error.message}</p> : null}
        {k.evidence.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No evidence yet. Items the complainant shares with their report appear here.
          </p>
        ) : (
          <ul className="grid gap-2">
            {k.evidence.map((e) => (
              <li key={e.id}>
                <Link
                  to={paths.console.evidence(k.id, e.id)}
                  className="hover:bg-accent/40 grid gap-1 rounded-md border p-2"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={e.status} />
                    <span className="truncate font-medium">{e.file_name}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatBytes(e.size_bytes)} · from {e.added_by} · held by{' '}
                      {e.custodian ?? 'nobody'}
                    </span>
                  </span>
                  <ChecklistChips checklist={e.checklist} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SiteVisit({ k, onDone }: { k: ConsoleCase; onDone: () => void }) {
  const checkin = useMutation({
    mutationFn: async () => {
      const fix = await currentFix(10_000)
      if (!fix) throw new Error('Location is off or unavailable. Turn it on and try again.')
      return caseCheckin(k.id, fix)
    },
    onSettled: onDone,
  })
  const visits = k.events.filter((e) => e.kind === 'site_visit')
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="text-primary size-5" aria-hidden /> Site visit
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {k.location ? (
          <>
            <p className="text-muted-foreground">
              Check in from the site; it counts within 200 m of the reported location.
            </p>
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => checkin.mutate()}
              disabled={checkin.isPending}
            >
              Check in here
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">This case has no site location.</p>
        )}
        {checkin.data ? (
          <p role="status">
            {checkin.data.within_geofence
              ? `Checked in, ${checkin.data.distance_m} m from the site.`
              : `You are ${checkin.data.distance_m} m away; that doesn't count as a site visit.`}
          </p>
        ) : null}
        {checkin.isError ? <p className="text-destructive">{checkin.error.message}</p> : null}
        {visits.map((v) => (
          <p key={v.id} className="text-muted-foreground">
            {v.within_geofence ? '✓' : '⚠'} {v.author}, {formatDateTime(v.created_at)} (
            {v.distance_m} m)
          </p>
        ))}
      </CardContent>
    </Card>
  )
}

function Notes({ k, onDone }: { k: ConsoleCase; onDone: () => void }) {
  const [kind, setKind] = useState<'statement' | 'note'>('statement')
  const [body, setBody] = useState('')
  const save = useMutation({
    mutationFn: () => addCaseNote(k.id, kind, body),
    onSuccess: () => setBody(''),
    onSettled: onDone,
  })
  const notes = k.events.filter((e) => e.kind !== 'site_visit')
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Statement and notes</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <div className="flex gap-3">
            {(['statement', 'note'] as const).map((value) => (
              <label key={value} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="note-kind"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {value === 'statement' ? "Complainant's statement" : 'Note'}
              </label>
            ))}
          </div>
          <Label htmlFor="case-note" className="sr-only">
            Text
          </Label>
          <textarea
            id="case-note"
            className="border-input bg-background min-h-24 rounded-md border p-2"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <Button
            type="submit"
            className="w-fit"
            disabled={body.trim().length < 3 || save.isPending}
          >
            Save
          </Button>
          {save.isError ? <p className="text-destructive">{save.error.message}</p> : null}
        </form>
        {notes.map((n) => (
          <div key={n.id} className="grid gap-1 border-t pt-2">
            <span className="text-muted-foreground text-xs">
              {n.kind === 'statement' ? 'Statement' : 'Note'} · {n.author} ·{' '}
              {formatDateTime(n.created_at)}
            </span>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
