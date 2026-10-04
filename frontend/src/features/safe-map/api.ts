import { db, unwrap } from '@/lib/supabase'

import type { LngLat, Scored } from './routing'

export type RiskCell = {
  x: number
  y: number
  level: 'low' | 'medium' | 'high'
  score: number
  signals: number
  factors: Record<string, number>
  bounds: [number, number, number, number]
}

export type RiskMap = {
  period: 'day' | 'night'
  cell_deg: number
  min_signals: number
  computed_at: string | null
  cells: RiskCell[]
}

export type ZoneKind =
  'poor_lighting' | 'isolated' | 'harassment' | 'unsafe_crowd' | 'no_transport' | 'other'

export type JourneyState = {
  journey_id: string
  status: 'active' | 'arrived' | 'cancelled' | 'escalated'
  monitoring: 'normal' | 'active'
  interval_ms: number
  check_in_due_at: string | null
  check_in_reason: 'off_route' | 'stopped' | null
  off_route_m: number | null
  incident_id: string | null
  escalation_reason: string | null
}

export type Journey = JourneyState & {
  id: string
  dest_lat: number
  dest_lng: number
  dest_name: string | null
  route: LngLat[] | null
  route_label: 'safest' | 'fastest' | 'direct' | null
  expected_arrival_at: string | null
  started_at: string
  ended_at: string | null
  last_ping_at: string | null
  path: LngLat[]
  timeline: { seq: number; occurred_at: string; action: string; payload: Record<string, unknown> }[]
}

export const safeMapKeys = {
  risk: (period: 'day' | 'night') => ['risk-map', period] as const,
  journey: (id: string) => ['journeys', id] as const,
}

export async function fetchRiskMap(period: 'day' | 'night') {
  return unwrap(await db().rpc('risk_map', { p_period: period })) as RiskMap
}

export async function reportZone(
  point: { lat: number; lng: number },
  kind: ZoneKind,
  atNight: boolean,
  note: string,
) {
  unwrap(
    await db().rpc('report_zone', {
      p_lat: point.lat,
      p_lng: point.lng,
      p_kind: kind,
      p_at_night: atNight,
      p_note: note.trim() || undefined,
    }),
  )
}

export async function scoreRoutes(routes: LngLat[][], at: Date) {
  return unwrap(await db().rpc('score_routes', { p_routes: routes, p_at: at.toISOString() })) as {
    period: 'day' | 'night'
    routes: Scored[]
  }
}

export type NewJourney = {
  clientId: string
  destination: { lat: number; lng: number; name: string }
  route: LngLat[] | null
  label: 'safest' | 'fastest' | 'direct'
  expectedMinutes: number | null
  from: { lat: number; lng: number } | null
}

export async function startJourney(j: NewJourney) {
  return unwrap(
    await db().rpc('start_journey', {
      p_dest_lat: j.destination.lat,
      p_dest_lng: j.destination.lng,
      p_dest_name: j.destination.name,
      p_route: j.route ?? undefined,
      p_route_label: j.label,
      p_expected_minutes: j.expectedMinutes ?? undefined,
      p_lat: j.from?.lat,
      p_lng: j.from?.lng,
      p_client_id: j.clientId,
    }),
  ) as { journey_id: string; created: boolean }
}

export async function fetchJourney(id: string) {
  return unwrap(await db().rpc('journey_view', { p_journey_id: id })) as Journey | null
}

export async function journeyPing(
  id: string,
  fix: { lat: number; lng: number; accuracy: number | null },
) {
  return unwrap(
    await db().rpc('journey_ping', {
      p_journey_id: id,
      p_lat: fix.lat,
      p_lng: fix.lng,
      p_accuracy_m: fix.accuracy ?? undefined,
    }),
  ) as JourneyState
}

export async function journeyCheckIn(id: string, pin: string) {
  return unwrap(
    await db().rpc('journey_check_in', { p_journey_id: id, p_pin: pin || undefined }),
  ) as Partial<JourneyState> & { ok: boolean; error?: 'wrong_pin' | 'locked' }
}

export async function endJourney(id: string, arrived: boolean) {
  return unwrap(
    await db().rpc('end_journey', { p_journey_id: id, p_arrived: arrived }),
  ) as JourneyState
}
