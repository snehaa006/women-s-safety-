import { distanceM } from '@/features/sos/geo'

/**
 * A walk from Rajiv Chowk metro through Connaught Place and down Janpath, New Delhi, used by the
 * virtual wearable to send realistic movement. [lng, lat] pairs, like GeoJSON.
 */
export const DEMO_WAYPOINTS: [number, number][] = [
  [77.2196, 28.6328],
  [77.2208, 28.6315],
  [77.2201, 28.6299],
  [77.2193, 28.6276],
  [77.2188, 28.625],
  [77.2185, 28.6223],
  [77.2188, 28.6198],
  [77.2197, 28.617],
]

/** Points every `stepM` metres along the waypoints, so each tick moves a believable distance. */
export function interpolateRoute(waypoints: [number, number][], stepM = 20): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [aLng, aLat] = waypoints[i]
    const [bLng, bLat] = waypoints[i + 1]
    const length = distanceM({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng })
    const steps = Math.max(1, Math.round(length / stepM))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      points.push([round6(aLng + (bLng - aLng) * t), round6(aLat + (bLat - aLat) * t)])
    }
  }
  points.push(waypoints[waypoints.length - 1])
  return points
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6
}

export const DEMO_ROUTE = interpolateRoute(DEMO_WAYPOINTS)
