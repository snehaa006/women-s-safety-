import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  consoleComplaintKeys,
  fetchReviews,
  reviewOverride,
  type ReviewItem,
} from '@/features/complaints/api'
import { SeverityBadge } from '@/features/complaints/severity-badge'
import { useListenOrg, useOrgChannel } from '@/features/console/use-console'
import { paths } from '@/lib/paths'
import { fallbackInterval } from '@/lib/realtime'
import { formatDateTime } from '@/lib/time'

const weekLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** Supervisors' queue of severity downgrades below the AI baseline, grouped by week. */
export function Component() {
  const live = useOrgChannel(useListenOrg())
  const reviews = useQuery({
    queryKey: consoleComplaintKeys.reviews,
    queryFn: fetchReviews,
    refetchInterval: fallbackInterval(live),
  })
  const items = reviews.data ?? []
  const weeks = [...new Set(items.map((i) => i.week))]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reviews"
        description="Severity downgrades below the AI baseline. Uphold them, or reverse them back to the baseline."
      />
      {reviews.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : reviews.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{reviews.error.message}</AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground text-sm">
            Nothing to review. Downgrades by officers in your organisations appear here.
          </CardContent>
        </Card>
      ) : (
        weeks.map((week) => (
          <section
            key={week}
            className="grid gap-3"
            aria-label={`Week of ${weekLabel.format(new Date(week))}`}
          >
            <h2 className="text-muted-foreground text-sm font-semibold uppercase">
              Week of {weekLabel.format(new Date(week))}
            </h2>
            <ul className="grid gap-3">
              {items
                .filter((i) => i.week === week)
                .map((item) => (
                  <ReviewCard key={item.id} item={item} />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const decide = useMutation({
    mutationFn: (decision: 'upheld' | 'reversed') => reviewOverride(item.id, decision, note),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['console'] }),
  })
  const noteId = `note-${item.id}`

  return (
    <li className="bg-card grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={item.from} />→<SeverityBadge severity={item.to} />
        <span className="text-muted-foreground text-sm">baseline L{item.baseline}</span>
        <Link to={paths.console.complaint(item.complaint_id)} className="font-medium underline">
          {item.reference}
        </Link>
        <span className="text-muted-foreground text-sm">{item.category_label}</span>
      </div>
      <p className="text-muted-foreground line-clamp-2 text-sm">{item.excerpt}</p>
      <blockquote className="border-l-2 pl-3 text-sm">
        "{item.justification}"
        <footer className="text-muted-foreground mt-1 text-xs">
          {item.officer ?? 'An officer'}, {item.org_name} · {formatDateTime(item.at)}
        </footer>
      </blockquote>
      <div className="grid gap-1">
        <Label htmlFor={noteId}>Note (needed to reverse)</Label>
        <input
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => decide.mutate('upheld')}
          disabled={decide.isPending}
        >
          Uphold
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => decide.mutate('reversed')}
          disabled={decide.isPending || !note.trim()}
        >
          Reverse to L{item.baseline}
        </Button>
      </div>
      {decide.isError ? <p className="text-destructive text-sm">{decide.error.message}</p> : null}
    </li>
  )
}
