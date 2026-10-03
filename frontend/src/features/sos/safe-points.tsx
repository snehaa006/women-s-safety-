import { Hospital, Navigation, PhoneCall, Shield } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { mapsLink } from '@/features/map/links'

import type { SafePoint } from './api'
import { formatDistance } from './use-safe-points'

const LABEL: Record<SafePoint['category'], string> = {
  police: 'Police',
  hospital: 'Hospital',
  fire_station: 'Fire station',
  pharmacy: 'Pharmacy',
}

export function SafePointsCard({
  points,
  pending,
}: {
  points: SafePoint[] | undefined
  pending: boolean
}) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="text-primary size-5" aria-hidden />
          Nearest help
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {pending ? (
          <p className="text-muted-foreground text-sm">
            Looking for police and hospitals near you…
          </p>
        ) : !points?.length ? (
          <p className="text-muted-foreground text-sm">
            No police station or hospital on file within 10 km. Call 112 for the nearest help.
          </p>
        ) : (
          <ul className="grid gap-3">
            {points.map((point) => (
              <li key={point.id} className="flex items-center gap-3">
                {point.category === 'hospital' ? (
                  <Hospital className="size-5 shrink-0 text-emerald-700" aria-hidden />
                ) : (
                  <Shield className="text-primary size-5 shrink-0" aria-hidden />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-semibold">{point.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {LABEL[point.category]} · {formatDistance(point.distance_m)}
                  </span>
                </span>
                {point.phone ? (
                  <Button asChild variant="ghost" size="icon" aria-label={`Call ${point.name}`}>
                    <a href={`tel:${point.phone.replace(/[^\d+]/g, '')}`}>
                      <PhoneCall />
                    </a>
                  </Button>
                ) : null}
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label={`Directions to ${point.name}`}
                >
                  <a href={mapsLink(point.lat, point.lng)} target="_blank" rel="noreferrer">
                    <Navigation />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          Places from © OpenStreetMap contributors. Check before relying on them.
        </p>
      </CardContent>
    </Card>
  )
}
