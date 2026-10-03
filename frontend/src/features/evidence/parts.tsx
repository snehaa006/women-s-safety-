import { CircleAlert, CircleCheck, CircleDashed, Download, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { paths } from '@/lib/paths'
import { formatDateTime, formatTime } from '@/lib/time'

import type { Anchor, Checklist, EvidenceStatus, TimelineEntry } from './api'
import { otsFile } from './hash'
import { describeEntry, STATUS } from './labels'

export function StatusBadge({ status }: { status: EvidenceStatus }) {
  if (status === 'sealed') {
    return (
      <Badge className="bg-emerald-600 text-white">
        <ShieldCheck aria-hidden /> Sealed
      </Badge>
    )
  }
  return (
    <Badge variant={status === 'rejected' ? 'destructive' : 'secondary'}>{STATUS[status]}</Badge>
  )
}

/** The full fingerprint, selectable, in a monospace block. */
export function HashBlock({
  label = 'SHA-256 fingerprint',
  value,
}: {
  label?: string
  value: string
}) {
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <code className="bg-muted rounded px-2 py-1 font-mono text-xs break-all select-all">
        {value}
      </code>
    </div>
  )
}

export function ChecklistView({ checklist }: { checklist: Checklist }) {
  return (
    <ul className="grid gap-1 text-sm" aria-label="Evidence checklist">
      {checklist.steps.map((s) => (
        <li key={s.step} className="flex items-center gap-2">
          {s.done ? (
            <CircleCheck className="size-4 text-emerald-600" aria-hidden />
          ) : (
            <CircleAlert className="size-4 text-amber-600" aria-hidden />
          )}
          <span className={s.done ? '' : 'font-medium'}>
            {s.done ? '✓' : '⚠'} {s.label}
          </span>
          {s.detail && !s.done ? (
            <span className="text-muted-foreground text-xs">({s.detail})</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** Compact ✓/⚠ chips for lists. */
export function ChecklistChips({ checklist }: { checklist: Checklist }) {
  return (
    <span className="flex flex-wrap gap-1">
      {checklist.steps.map((s) => (
        <span
          key={s.step}
          title={s.label}
          className={
            s.done
              ? 'rounded bg-emerald-100 px-1.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200'
          }
        >
          {s.done ? '✓' : '⚠'} {s.step}
        </span>
      ))}
    </span>
  )
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Where the item's ledger entry is anchored, and the OpenTimestamps receipt. */
export function AnchorReceipt({
  anchor,
  sha256,
  verifyLink = true,
}: {
  anchor: Anchor | null
  sha256: string
  verifyLink?: boolean
}) {
  if (!anchor) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <CircleDashed className="size-4" aria-hidden /> Waiting for the next anchor (every 10
        minutes).
      </p>
    )
  }
  return (
    <div className="grid gap-2 text-sm">
      <p>
        Ledger entries {anchor.from_seq}–{anchor.to_seq} were combined into one Merkle root on{' '}
        {formatDateTime(anchor.created_at)}.
      </p>
      <code className="bg-muted rounded px-2 py-1 font-mono text-xs break-all">
        {anchor.merkle_root}
      </code>
      {anchor.ots_status === 'submitted' && anchor.receipt ? (
        <>
          <p>
            Stamped by OpenTimestamps
            {anchor.ots_calendar ? ` (${new URL(anchor.ots_calendar).host})` : ''}
            {anchor.submitted_at ? ` at ${formatTime(anchor.submitted_at)}` : ''}. The proof
            completes once the calendar commits it to Bitcoin (a few hours).
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() =>
              download(
                `ledger-${anchor.from_seq}-${anchor.to_seq}.ots`,
                otsFile(anchor.merkle_root, anchor.receipt!),
              )
            }
          >
            <Download aria-hidden /> Anchor receipt (.ots)
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground">
          {anchor.ots_status === 'failed'
            ? 'The timestamp calendars could not be reached; the root stays in the ledger.'
            : 'Sending the root to OpenTimestamps…'}
        </p>
      )}
      {verifyLink ? (
        <Link to={paths.verify(sha256)} className="text-primary w-fit underline">
          Check it on the public verifier
        </Link>
      ) : null}
    </div>
  )
}

export function EntryList({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="text-muted-foreground text-sm">Nothing yet.</p>
  return (
    <ol className="grid gap-2 text-sm">
      {entries.map((entry) => (
        <li key={entry.seq} className="grid grid-cols-[4.5rem_1fr] gap-2">
          <span className="text-muted-foreground tabular-nums">
            {formatTime(entry.occurred_at)}
          </span>
          <span>
            {describeEntry(entry)}
            <span className="text-muted-foreground"> · #{entry.seq}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
