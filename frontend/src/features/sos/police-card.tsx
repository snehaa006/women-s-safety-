import { PhoneCall, Siren } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

import type { PoliceResponse } from './api'
import { describePolice } from './police-status'

const DOT = {
  waiting: 'bg-muted-foreground animate-pulse',
  acknowledged: 'bg-primary',
  moving: 'bg-primary animate-pulse',
  arrived: 'bg-emerald-600',
} as const

/** Where the police response stands, for the citizen and for her contacts. */
export function PoliceCard({ response }: { response: PoliceResponse }) {
  const now = useNow(15_000)
  const status = describePolice(response, now)
  return (
    <Card className="gap-3" aria-live="polite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Siren className="text-primary size-5" aria-hidden />
          Police
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', DOT[status.tone])}
            aria-hidden
          />
          <span className="grid">
            <span className="font-semibold">{status.title}</span>
            <span className="text-muted-foreground text-sm">{status.detail}</span>
          </span>
        </div>
        {response.org_phone ? (
          <Button asChild variant="outline" className="w-full sm:w-fit">
            <a href={`tel:${response.org_phone.replace(/\s+/g, '')}`}>
              <PhoneCall aria-hidden />
              Call the station's duty desk
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
