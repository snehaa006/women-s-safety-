import { useQuery } from '@tanstack/react-query'

import { fetchSafePoints, sosKeys } from './api'

export function formatDistance(metres: number) {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`
}

/**
 * The nearest police stations and hospitals. Keyed on the position rounded to about 100 m, so a
 * walk refreshes it now and then rather than on every location ping.
 */
export function useSafePoints(position: { lat: number; lng: number } | null) {
  const lat = position ? Math.round(position.lat * 1000) / 1000 : null
  const lng = position ? Math.round(position.lng * 1000) / 1000 : null
  return useQuery({
    queryKey: sosKeys.safePoints(lat ?? 0, lng ?? 0),
    queryFn: () => fetchSafePoints(lat!, lng!),
    enabled: lat !== null && lng !== null,
    staleTime: 10 * 60_000,
  })
}
