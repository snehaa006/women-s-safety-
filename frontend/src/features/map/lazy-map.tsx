import { lazy, Suspense } from 'react'

import { cn } from '@/lib/utils'

import type { MapViewProps } from './types'

// MapLibre is large, so it loads only on screens that show a map.
const MapView = lazy(() => import('./map-view'))

export function LazyMap(props: MapViewProps) {
  return (
    <Suspense
      fallback={
        <div
          className={cn('bg-muted animate-pulse rounded-lg border', props.className)}
          aria-label="Loading map"
        />
      }
    >
      <MapView {...props} />
    </Suspense>
  )
}
