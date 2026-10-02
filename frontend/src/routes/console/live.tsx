import { Inbox, Radio } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { PhaseBadge } from '@/components/phase-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Component() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Live board"
        description="Active SOS alerts and complaints waiting for action, most urgent first."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="text-sos size-4" aria-hidden />
              Active SOS
            </CardTitle>
            <CardDescription>Live location, battery and who has acknowledged.</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
            No active incidents. Alerts appear here once routing is built.
            <PhaseBadge phase="P2" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="text-primary size-4" aria-hidden />
              Complaint queue
            </CardTitle>
            <CardDescription>Sorted by time left to acknowledge.</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
            No complaints yet. Triage and countdowns arrive with smart complaints.
            <PhaseBadge phase="P3" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
