import { LazyMap } from '@/features/map/lazy-map'
import type { MapViewProps } from '@/features/map/types'

import type { BoardIncident } from './api'

/** Active incidents as red dots, optionally over the risk layer. */
export function BoardMap({
  incidents,
  cells,
  className,
}: {
  incidents: BoardIncident[]
  cells?: MapViewProps['cells']
  className?: string
}) {
  return (
    <LazyMap
      className={className}
      cells={cells}
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
