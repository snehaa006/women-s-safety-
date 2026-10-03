import { LazyMap } from '@/features/map/lazy-map'

import type { BoardIncident } from './api'

/** Active incidents as red dots. */
export function BoardMap({
  incidents,
  className,
}: {
  incidents: BoardIncident[]
  className?: string
}) {
  return (
    <LazyMap
      className={className}
      path={[]}
      follow={false}
      points={incidents.flatMap((i) =>
        i.last_location
          ? [
              {
                lat: i.last_location.lat,
                lng: i.last_location.lng,
                name: i.citizen_name,
                category: 'sos',
              },
            ]
          : [],
      )}
      label={`Map of ${incidents.length} active incident${incidents.length === 1 ? '' : 's'}`}
    />
  )
}
