import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchJourney,
  fetchRiskMap,
  journeyCheckIn,
  scoreRoutes,
  startJourney,
  type Journey,
} from '@/features/safe-map/api'
import { fetchWalkingRoutes, type LngLat } from '@/features/safe-map/routing'
import { citizen, createFakeAuthClient } from '@/test/fake-auth-client'
import { renderRoute } from '@/test/render-route'

vi.mock('@/features/safe-map/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/safe-map/api')>()),
  fetchRiskMap: vi.fn(),
  scoreRoutes: vi.fn(),
  startJourney: vi.fn(async () => ({ journey_id: 'j1', created: true })),
  fetchJourney: vi.fn(),
  journeyPing: vi.fn(async () => ({})),
  journeyCheckIn: vi.fn(async () => ({ ok: true })),
  endJourney: vi.fn(async () => ({})),
  reportZone: vi.fn(async () => {}),
}))
vi.mock('@/features/safe-map/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/safe-map/routing')>()),
  fetchWalkingRoutes: vi.fn(),
}))
vi.mock('@/features/sos/geo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/sos/geo')>()),
  currentFix: vi.fn(async () => null),
}))
vi.mock('@/features/sos/use-safe-points', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/sos/use-safe-points')>()),
  useSafePoints: () => ({ data: [] }),
}))

const JANPATH: LngLat[] = [
  [77.2196, 28.6328],
  [77.2188, 28.625],
  [77.2197, 28.617],
]
const EAST: LngLat[] = [
  [77.2196, 28.6328],
  [77.2245, 28.624],
  [77.2197, 28.617],
]
const score = (index: number, high: number, exposure: number) => ({
  index,
  exposure,
  high_cells: high,
  medium_cells: 0,
  safe_points: [],
})

const journey = (over: Partial<Journey> = {}): Journey => ({
  id: 'j1',
  journey_id: 'j1',
  status: 'active',
  monitoring: 'normal',
  interval_ms: 15000,
  check_in_due_at: null,
  check_in_reason: null,
  off_route_m: null,
  incident_id: null,
  escalation_reason: null,
  dest_lat: 28.617,
  dest_lng: 77.2197,
  dest_name: 'Janpath market (demo)',
  route: EAST,
  route_label: 'safest',
  expected_arrival_at: null,
  started_at: new Date().toISOString(),
  ended_at: null,
  last_ping_at: new Date().toISOString(),
  path: [],
  timeline: [
    {
      seq: 1,
      occurred_at: new Date().toISOString(),
      action: 'journey.started',
      payload: { route: 'safest' },
    },
  ],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchRiskMap).mockResolvedValue({
    period: 'night',
    cell_deg: 0.003,
    min_signals: 3,
    computed_at: null,
    cells: [
      {
        x: 25739,
        y: 9541,
        level: 'high',
        score: 15,
        signals: 8,
        factors: { 'zone:poor_lighting': 3, 'zone:isolated': 3, safe_points: 0 },
        bounds: [77.217, 28.623, 77.22, 28.626],
      },
    ],
  })
})

describe('safety map', () => {
  it('shows why an area is red and offers the safest route with the time trade-off', async () => {
    vi.mocked(fetchWalkingRoutes).mockResolvedValue([
      { coordinates: JANPATH, distanceM: 1800, durationS: 22 * 60 },
      { coordinates: EAST, distanceM: 2300, durationS: 28 * 60 },
    ])
    vi.mocked(scoreRoutes).mockResolvedValue({
      period: 'night',
      routes: [score(0, 1, 30), score(1, 0, 0)],
    })
    renderRoute('/app/map', createFakeAuthClient(citizen))
    expect(await screen.findByText(/poor lighting \(3\), isolated \(3\)/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Janpath market (demo)' }))
    await userEvent.click(screen.getByRole('button', { name: /Find the safest route/ }))
    expect(await screen.findByText(/Safest · 28 min/)).toBeInTheDocument()
    expect(screen.getByText(/Fastest · 22 min/)).toBeInTheDocument()
    expect(screen.getByText(/takes 6 min longer/)).toBeInTheDocument()
    expect(screen.getByText('Crosses 1 high-risk area')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Start a watched journey/ }))
    await waitFor(() => expect(startJourney).toHaveBeenCalled())
    const args = vi.mocked(startJourney).mock.calls[0][0]
    expect(args.route).toEqual(EAST)
    expect(args.label).toBe('safest')
    expect(args.expectedMinutes).toBe(33)
  })

  it('detours around the red zone when every route crosses it', async () => {
    vi.mocked(fetchWalkingRoutes)
      .mockResolvedValueOnce([{ coordinates: JANPATH, distanceM: 1800, durationS: 22 * 60 }])
      .mockResolvedValue([{ coordinates: EAST, distanceM: 2300, durationS: 27 * 60 }])
    vi.mocked(scoreRoutes)
      .mockResolvedValueOnce({ period: 'night', routes: [score(0, 1, 30)] })
      .mockResolvedValue({
        period: 'night',
        routes: [score(0, 1, 30), score(1, 0, 0), score(2, 0, 2)],
      })
    renderRoute('/app/map', createFakeAuthClient(citizen))
    await userEvent.click(await screen.findByRole('button', { name: 'Janpath market (demo)' }))
    await userEvent.click(screen.getByRole('button', { name: /Find the safest route/ }))
    expect(await screen.findByText(/going around the high-risk area/)).toBeInTheDocument()
    // One request for alternatives, then one through each detour point.
    expect(fetchWalkingRoutes).toHaveBeenCalledTimes(3)
    expect(vi.mocked(fetchWalkingRoutes).mock.calls[1][2]?.via).toBeDefined()
  })
})

describe('watched journey', () => {
  it('asks "Are you OK?" and sends the PIN', async () => {
    vi.mocked(fetchJourney).mockResolvedValue(
      journey({
        check_in_due_at: new Date(Date.now() + 45_000).toISOString(),
        check_in_reason: 'stopped',
      }),
    )
    renderRoute('/app/journeys/j1', createFakeAuthClient(citizen))
    expect(await screen.findByText('Are you OK?')).toBeInTheDocument()
    expect(screen.getByText(/stopped for a few minutes/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "I've arrived" })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('PIN'), '2580')
    await userEvent.click(screen.getByRole('button', { name: "I'm OK" }))
    await waitFor(() => expect(journeyCheckIn).toHaveBeenCalledWith('j1', '2580'))
  })

  it('links to the SOS once the journey escalated', async () => {
    vi.mocked(fetchJourney).mockResolvedValue(
      journey({ status: 'escalated', escalation_reason: 'lost_heartbeat', incident_id: 'inc-9' }),
    )
    renderRoute('/app/journeys/j1', createFakeAuthClient(citizen))
    expect(await screen.findByText('SOS raised')).toBeInTheDocument()
    expect(screen.getByText(/stopped sending its location/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the SOS' })).toHaveAttribute(
      'href',
      '/app/sos/inc-9',
    )
  })
})
