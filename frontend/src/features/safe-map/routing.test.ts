import { describe, expect, it, vi } from 'vitest'

import { distanceM } from '@/features/sos/geo'

import {
  detourPoints,
  fetchWalkingRoutes,
  pickRoutes,
  ROUTER,
  sampleLine,
  type LngLat,
} from './routing'

const from: LngLat = [77.2196, 28.6328]
const to: LngLat = [77.2197, 28.617]

describe('walking routes', () => {
  it('asks the keyless foot router for alternatives, or for one route through a via point', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      Response.json({
        code: 'Ok',
        routes: [{ distance: 1800.4, duration: 1290, geometry: { coordinates: [from, to] } }],
      }),
    )
    const routes = await fetchWalkingRoutes(from, to, { fetchFn: fetchFn as typeof fetch })
    expect(fetchFn.mock.calls[0][0]).toBe(
      `${ROUTER}/77.2196,28.6328;77.2197,28.617?overview=full&geometries=geojson&alternatives=3`,
    )
    expect(routes[0]).toEqual({ coordinates: [from, to], distanceM: 1800, durationS: 1290 })

    await fetchWalkingRoutes(from, to, { via: [77.224, 28.625], fetchFn: fetchFn as typeof fetch })
    expect(fetchFn.mock.calls[1][0]).toContain('77.2196,28.6328;77.224,28.625;77.2197,28.617')
    expect(fetchFn.mock.calls[1][0]).toContain('alternatives=false')
  })

  it('reports a router error', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ code: 'NoRoute', message: 'Impossible route' }),
    )
    await expect(
      fetchWalkingRoutes(from, to, { fetchFn: fetchFn as typeof fetch }),
    ).rejects.toThrow('Impossible route')
  })

  it('samples about every 50 m', () => {
    const points = sampleLine([from, to])
    const length = distanceM({ lng: from[0], lat: from[1] }, { lng: to[0], lat: to[1] })
    expect(points.length).toBe(Math.ceil(length / 50) + 1)
    expect(points.at(-1)).toEqual(to)
    expect(sampleLine([from, to], 1, 100).length).toBeLessThanOrEqual(101)
  })

  it('places detour points on either side of the trip', () => {
    const centre: LngLat = [77.219, 28.625]
    const [east, west] = detourPoints(from, to, centre, 450)
    // The trip runs north to south, so the detours sit east and west of the cell.
    expect(east[0]).not.toBeCloseTo(west[0], 3)
    expect(Math.abs(east[1] - centre[1])).toBeLessThan(0.0005)
    expect(
      distanceM({ lng: east[0], lat: east[1] }, { lng: centre[0], lat: centre[1] }),
    ).toBeCloseTo(450, -1)
  })

  it('picks the least exposed route as safest and the quickest as fastest', () => {
    const route = (durationS: number) => ({ coordinates: [from, to], distanceM: 0, durationS })
    const score = (index: number, high: number, exposure: number) => ({
      index,
      exposure,
      high_cells: high,
      medium_cells: 0,
      safe_points: [],
    })
    const pick = pickRoutes([route(1200), route(1500)], [score(0, 2, 40), score(1, 0, 3)])
    expect(pick.fastest.route.durationS).toBe(1200)
    expect(pick.safest.route.durationS).toBe(1500)
    expect(pick.same).toBe(false)
  })
})
