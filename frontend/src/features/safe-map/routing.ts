// Walking routes for the safe-route planner (docs/02-architecture.md §10). The routes come from
// the public OSRM foot router run by FOSSGIS (no key); the database scores them by risk. When
// every option crosses a high-risk cell, we ask again through detour points beside the worst cell
// (the keyless router has no avoid_polygons).

import { distanceM } from '@/features/sos/geo'

export type LngLat = [number, number]
export type WalkingRoute = { coordinates: LngLat[]; distanceM: number; durationS: number }

export const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'

type OsrmResponse = {
  code: string
  message?: string
  routes?: { distance: number; duration: number; geometry: { coordinates: LngLat[] } }[]
}

/** Up to three alternatives between two points, optionally through one via point. */
export async function fetchWalkingRoutes(
  from: LngLat,
  to: LngLat,
  { via, fetchFn = fetch }: { via?: LngLat; fetchFn?: typeof fetch } = {},
): Promise<WalkingRoute[]> {
  const points = [from, ...(via ? [via] : []), to].map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url = `${ROUTER}/${points}?overview=full&geometries=geojson&alternatives=${via ? 'false' : '3'}`
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`The route service answered ${response.status}`)
  const body = (await response.json()) as OsrmResponse
  if (body.code !== 'Ok' || !body.routes?.length) {
    throw new Error(body.message ?? 'No walking route found')
  }
  return body.routes.map((r) => ({
    coordinates: r.geometry.coordinates,
    distanceM: Math.round(r.distance),
    // OSRM's foot profile walks at about 5 km/h.
    durationS: Math.round(r.duration),
  }))
}

/** Points about every `stepM` metres along a line, for scoring (at most `max`). */
export function sampleLine(line: LngLat[], stepM = 50, max = 1500): LngLat[] {
  const out: LngLat[] = []
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]]
    const length = distanceM({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })
    const steps = Math.max(1, Math.ceil(length / stepM))
    for (let s = 0; s < steps; s++) {
      out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps])
    }
  }
  if (line.length) out.push(line[line.length - 1])
  if (out.length <= max) return out
  const stride = Math.ceil(out.length / max)
  return out.filter((_, i) => i % stride === 0 || i === out.length - 1)
}

/**
 * Two detour points on either side of the worst cell, at right angles to the trip, `offsetM`
 * metres from the cell centre.
 */
export function detourPoints(
  from: LngLat,
  to: LngLat,
  cellCentre: LngLat,
  offsetM = 450,
): [LngLat, LngLat] {
  const latScale = 111_320
  const lngScale = 111_320 * Math.cos((cellCentre[1] * Math.PI) / 180)
  const dx = (to[0] - from[0]) * lngScale
  const dy = (to[1] - from[1]) * latScale
  const length = Math.hypot(dx, dy) || 1
  // Unit vector at right angles to the trip, in metres.
  const [px, py] = [-dy / length, dx / length]
  const at = (sign: number): LngLat => [
    cellCentre[0] + (sign * px * offsetM) / lngScale,
    cellCentre[1] + (sign * py * offsetM) / latScale,
  ]
  return [at(1), at(-1)]
}

export type Scored = {
  index: number
  exposure: number
  high_cells: number
  medium_cells: number
  safe_points: { name: string; category: string; lat: number; lng: number }[]
}

/** Fastest is the quickest route; safest the least exposed (ties go to the quicker one). */
export function pickRoutes(routes: WalkingRoute[], scores: Scored[]) {
  const options = routes.map((route, i) => ({ route, score: scores[i] }))
  const fastest = [...options].sort((a, b) => a.route.durationS - b.route.durationS)[0]
  const safest = [...options].sort(
    (a, b) =>
      a.score.high_cells - b.score.high_cells ||
      a.score.exposure - b.score.exposure ||
      a.route.durationS - b.route.durationS,
  )[0]
  return { fastest, safest, same: fastest === safest }
}

export function minutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60))
}
