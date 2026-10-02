import { db, unwrap } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

import type { Fix } from './geo'

export type Incident = Tables<'incidents'>
export type Responder = Pick<Tables<'incident_responders'>, 'id' | 'name' | 'created_at'>

export type SosStarted = { incident_id: string; share_token: string; created: boolean }
export type ResolveStatus = 'resolved' | 'wrong_pin' | 'locked'
export type ResolveResult = { status: ResolveStatus; keep_sharing: boolean }
export type PinStatus = { has_pin: boolean; has_duress_pin: boolean }

export type TimelineEntry = {
  seq: number
  occurred_at: string
  action: string
  actor_role: string | null
  lat: number | null
  lng: number | null
  payload: Record<string, unknown>
}

/** What a trusted contact sees on /t/:token. */
export type LiveView = {
  citizen_name: string | null
  citizen_phone: string | null
  status: 'active' | 'resolved'
  closed_under_duress: boolean
  source: 'app' | 'device' | 'simulator'
  started_at: string
  resolved_at: string | null
  resolution: 'safe' | 'false_alarm' | null
  battery_pct: number | null
  last_location: { lat: number; lng: number; accuracy_m: number | null; at: string } | null
  path: [number, number][]
  responders: { name: string; at: string }[]
}

export const sosKeys = {
  active: ['incidents', 'active'] as const,
  recent: ['incidents', 'recent'] as const,
  incident: (id: string) => ['incidents', id] as const,
  responders: (id: string) => ['incidents', id, 'responders'] as const,
  path: (id: string) => ['incidents', id, 'path'] as const,
  timeline: (id: string) => ['incidents', id, 'timeline'] as const,
  pins: ['sos-pins'] as const,
  live: (token: string) => ['live-link', token] as const,
}

/** True once the citizen has closed the SOS on her side (normally or with the duress PIN). */
export function closedForCitizen(incident: Pick<Incident, 'status' | 'closed_by_citizen_at'>) {
  return incident.status !== 'active' || incident.closed_by_citizen_at !== null
}

export async function createSos(clientId: string, fix: Fix | null, batteryPct: number | null) {
  const result = await db().rpc('create_sos', {
    p_client_id: clientId,
    p_lat: fix?.lat,
    p_lng: fix?.lng,
    p_accuracy_m: fix?.accuracy ?? undefined,
    p_battery_pct: batteryPct ?? undefined,
  })
  return unwrap(result) as SosStarted
}

export async function recordLocation(incidentId: string, fix: Fix, batteryPct: number | null) {
  unwrap(
    await db().rpc('record_location', {
      p_incident_id: incidentId,
      p_lat: fix.lat,
      p_lng: fix.lng,
      p_accuracy_m: fix.accuracy ?? undefined,
      p_speed_mps: fix.speed ?? undefined,
      p_heading_deg: fix.heading ?? undefined,
      p_battery_pct: batteryPct ?? undefined,
    }),
  )
}

export async function resolveIncident(
  incidentId: string,
  pin: string | null,
  resolution: 'safe' | 'false_alarm' = 'safe',
) {
  const result = await db().rpc('resolve_incident', {
    p_incident_id: incidentId,
    p_pin: pin ?? undefined,
    p_resolution: resolution,
  })
  return unwrap(result) as ResolveResult
}

export async function fetchIncident(id: string) {
  const result = await db()
    .from('incidents')
    .select('*, share_links(token)')
    .eq('id', id)
    .maybeSingle()
  const row = unwrap(result)
  if (!row) return null
  const { share_links, ...incident } = row
  return { incident: incident as Incident, shareToken: share_links[0]?.token ?? null }
}

/** The SOS the citizen still sees as active, if any. */
export async function fetchActiveIncident() {
  const result = await db()
    .from('incidents')
    .select('id, started_at, source')
    .eq('status', 'active')
    .is('closed_by_citizen_at', null)
    .maybeSingle()
  return unwrap(result)
}

export async function fetchRecentIncidents() {
  const result = await db()
    .from('incidents')
    .select('id, started_at, source, status, closed_by_citizen_at, resolution')
    .order('started_at', { ascending: false })
    .limit(5)
  return unwrap(result)
}

export async function fetchResponders(incidentId: string): Promise<Responder[]> {
  const result = await db()
    .from('incident_responders')
    .select('id, name, created_at')
    .eq('incident_id', incidentId)
    .order('created_at')
  return unwrap(result)
}

/** Location history as [lng, lat] pairs, oldest first. */
export async function fetchPath(incidentId: string): Promise<[number, number][]> {
  const result = await db()
    .from('location_pings')
    .select('lng, lat')
    .eq('incident_id', incidentId)
    .order('at')
    .limit(1000)
  return unwrap(result).map((p) => [p.lng, p.lat])
}

export async function fetchTimeline(incidentId: string) {
  const result = await db().rpc('incident_timeline', { p_incident_id: incidentId })
  return unwrap(result) as TimelineEntry[]
}

export async function fetchPinStatus() {
  return unwrap(await db().rpc('sos_pin_status')) as PinStatus
}

export async function setPins(sosPin: string, duressPin: string | null, currentPin: string | null) {
  const result = await db().rpc('set_sos_pins', {
    p_sos_pin: sosPin,
    p_duress_pin: duressPin ?? undefined,
    p_current_pin: currentPin ?? undefined,
  })
  return unwrap(result) as { status: 'saved' | 'wrong_pin' | 'locked' }
}

/** Works without signing in: the token is the key. Null when the link is unknown or expired. */
export async function viewLiveLink(token: string) {
  return unwrap(await db().rpc('view_share_link', { p_token: token })) as LiveView | null
}

export async function respondToLiveLink(token: string, name: string) {
  unwrap(await db().rpc('respond_to_share_link', { p_token: token, p_name: name }))
}
