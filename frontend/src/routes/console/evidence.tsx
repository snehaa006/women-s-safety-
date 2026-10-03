import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Download, LoaderCircle, PenLine, ShieldCheck, ShieldX } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useListenOrg, useOrgChannel } from '@/features/console/use-console'
import {
  caseKeys,
  evidenceUrl,
  fetchCaseEvidence,
  respondTransfer,
  signLock,
  startTransfer,
  type ConsoleEvidence,
  type Signature,
} from '@/features/evidence/api'
import { formatBytes, shortHash } from '@/features/evidence/hash'
import { CAPACITY, TRANSFER } from '@/features/evidence/labels'
import {
  AnchorReceipt,
  ChecklistView,
  EntryList,
  HashBlock,
  StatusBadge,
} from '@/features/evidence/parts'
import { paths } from '@/lib/paths'
import { fallbackInterval } from '@/lib/realtime'
import { formatDateTime } from '@/lib/time'

export function Component() {
  const { caseId = '', evidenceId = '' } = useParams()
  const live = useOrgChannel(useListenOrg())
  const queryClient = useQueryClient()
  const item = useQuery({
    queryKey: caseKeys.evidence(caseId, evidenceId),
    queryFn: () => fetchCaseEvidence(caseId, evidenceId),
    // A hand-off waiting for its re-hash refreshes quickly.
    refetchInterval: (q) =>
      q.state.data?.transfers.some((t) => t.status === 'accepted') ? 3000 : fallbackInterval(live),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['console', 'cases'] })

  if (item.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
      </p>
    )
  }
  if (item.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this item</AlertTitle>
        <AlertDescription>
          {item.error.message}{' '}
          <Link to={paths.console.case(caseId)} className="underline">
            Back to the case
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  const e = item.data

  return (
    <div className="grid gap-5">
      <Link to={paths.console.case(caseId)} className="text-muted-foreground w-fit text-sm">
        ← {e.case.reference} · {e.case.title}
      </Link>
      <header className="grid gap-2">
        <h1 className="text-2xl font-bold break-all">{e.file_name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={e.status} />
          {e.locked_at ? <Badge>Locked {formatDateTime(e.locked_at)}</Badge> : null}
          <span className="text-muted-foreground">
            {formatBytes(e.size_bytes)} · {e.mime_type} · from {e.added_by} · held by{' '}
            {e.custodian ?? 'nobody'}
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-5">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Integrity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <HashBlock value={e.sha256} />
              <p>
                Registered {formatDateTime(e.registered_at)}
                {e.sealed_at
                  ? `, sealed ${formatDateTime(e.sealed_at)} (ledger #${e.sealed_seq})`
                  : ''}
                {e.captured_at ? `. Captured ${formatDateTime(e.captured_at)}` : ''}.
              </p>
              {e.reject_reason ? <p className="text-destructive">{e.reject_reason}</p> : null}
              {e.storage_path ? <Open path={e.storage_path} /> : null}
            </CardContent>
          </Card>
          <Lock e={e} onDone={refresh} />
          <Custody e={e} onDone={refresh} />
        </div>
        <div className="grid content-start gap-5">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <ChecklistView checklist={e.checklist} />
            </CardContent>
          </Card>
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Anchor receipt</CardTitle>
            </CardHeader>
            <CardContent>
              {e.status === 'sealed' ? (
                <AnchorReceipt anchor={e.anchor} sha256={e.sha256} />
              ) : (
                <p className="text-muted-foreground text-sm">Only sealed items are anchored.</p>
              )}
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>Chain of custody (ledger)</CardTitle>
            </CardHeader>
            <CardContent>
              <EntryList entries={e.timeline} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Open({ path }: { path: string }) {
  const open = useMutation({
    mutationFn: () => evidenceUrl(path),
    onSuccess: (url) => window.open(url, '_blank', 'noopener'),
  })
  return (
    <div className="grid gap-1">
      <Button variant="outline" size="sm" className="w-fit" onClick={() => open.mutate()}>
        <Download aria-hidden /> Open the file
      </Button>
      {open.isError ? <p className="text-destructive">{open.error.message}</p> : null}
    </div>
  )
}

function SignatureLine({ s }: { s: Signature }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      {s.valid ? (
        <ShieldCheck className="size-4 text-emerald-600" aria-label="signature valid" />
      ) : (
        <ShieldX className="text-destructive size-4" aria-label="signature invalid" />
      )}
      <span>
        {CAPACITY[s.capacity]}: <strong>{s.signer}</strong>, {formatDateTime(s.signed_at)}
      </span>
      <code className="text-muted-foreground text-xs" title={s.signature}>
        {shortHash(s.signature)} · {s.key_fingerprint}
      </code>
    </li>
  )
}

function Lock({ e, onDone }: { e: ConsoleEvidence; onDone: () => void }) {
  const sign = useMutation({ mutationFn: () => signLock(e.case.id, e.id), onSettled: onDone })
  const lockSigs = e.signatures.filter((s) => s.purpose === 'lock')
  const signed = lockSigs.map((s) => s.capacity)
  const canSign =
    !e.locked_at &&
    e.status === 'sealed' &&
    ((e.me.is_lead && !signed.includes('investigating_officer')) ||
      (!e.me.is_lead && e.me.is_supervisor && !signed.includes('supervisor')))
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Two-signature lock</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          The investigating officer and a supervisor each sign. The second signature locks the item.
        </p>
        <ul className="grid gap-1">
          {lockSigs.map((s) => (
            <SignatureLine key={s.id} s={s} />
          ))}
          {(['investigating_officer', 'supervisor'] as const)
            .filter((c) => !signed.includes(c))
            .map((c) => (
              <li key={c} className="text-muted-foreground text-sm">
                ⚠ Waiting for the {CAPACITY[c].toLowerCase()}
              </li>
            ))}
        </ul>
        {canSign ? (
          <Button className="w-fit" onClick={() => sign.mutate()} disabled={sign.isPending}>
            <PenLine aria-hidden /> Sign as {e.me.is_lead ? 'investigating officer' : 'supervisor'}
          </Button>
        ) : null}
        {sign.isError ? <p className="text-destructive text-sm">{sign.error.message}</p> : null}
      </CardContent>
    </Card>
  )
}

function Custody({ e, onDone }: { e: ConsoleEvidence; onDone: () => void }) {
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const start = useMutation({
    mutationFn: () => startTransfer(e.case.id, e.id, to, reason),
    onSuccess: () => {
      setTo('')
      setReason('')
    },
    onSettled: onDone,
  })
  const respond = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accept' | 'decline' | 'cancel' }) =>
      respondTransfer(id, decision),
    onSettled: onDone,
  })
  const open = e.transfers.find((t) => t.status === 'pending' || t.status === 'accepted')
  const others = e.staff.filter((s) => s.id !== e.me.id)

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Custody</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p>
          Held by <strong>{e.custodian ?? 'nobody'}</strong>. A hand-off is signed by both officers,
          and the stored file is re-hashed before custody moves.
        </p>

        {e.transfers.length > 0 ? (
          <ol className="grid gap-3" aria-label="Hand-offs">
            {e.transfers.map((t) => (
              <li key={t.id} className="grid gap-1 rounded-md border p-2">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {t.from} <ArrowRight className="size-4" aria-hidden /> {t.to}
                  <Badge
                    variant={
                      t.status === 'completed'
                        ? 'default'
                        : t.status === 'mismatch'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {TRANSFER[t.status]}
                  </Badge>
                </span>
                <span className="text-muted-foreground">
                  “{t.reason}” · started {formatDateTime(t.initiated_at)}
                </span>
                <ul className="grid gap-1">
                  {e.signatures
                    .filter((s) => s.transfer_id === t.id)
                    .map((s) => (
                      <SignatureLine key={s.id} s={s} />
                    ))}
                </ul>
                {t.rehash_sha256 ? (
                  <span className={t.rehash_ok ? 'text-emerald-700' : 'text-destructive'}>
                    Re-hash {shortHash(t.rehash_sha256)}{' '}
                    {t.rehash_ok ? 'matches' : 'does NOT match'} the sealed fingerprint
                  </span>
                ) : null}
                {t.status === 'pending' && t.to_id === e.me.id ? (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => respond.mutate({ id: t.id, decision: 'accept' })}
                      disabled={respond.isPending}
                    >
                      Accept and sign
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => respond.mutate({ id: t.id, decision: 'decline' })}
                      disabled={respond.isPending}
                    >
                      Decline
                    </Button>
                  </span>
                ) : null}
                {t.status === 'pending' && t.from_id === e.me.id ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => respond.mutate({ id: t.id, decision: 'cancel' })}
                    disabled={respond.isPending}
                  >
                    Cancel hand-off
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {respond.isError ? <p className="text-destructive">{respond.error.message}</p> : null}

        {e.me.is_custodian && !open && e.status === 'sealed' ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              start.mutate()
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="transfer-to">Hand over to</Label>
              <select
                id="transfer-to"
                className="border-input bg-background h-9 rounded-md border px-2"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                <option value="">Choose an officer</option>
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="transfer-reason">Reason</Label>
              <Input
                id="transfer-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="For example: to the forensic lab"
              />
            </div>
            <Button
              type="submit"
              className="w-fit"
              disabled={!to || reason.trim().length < 3 || start.isPending}
            >
              <PenLine aria-hidden /> Sign and hand over
            </Button>
            {start.isError ? <p className="text-destructive">{start.error.message}</p> : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
