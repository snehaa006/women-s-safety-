import { db, unwrap } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

import type { Fix } from './geo'

export type Incident = Tables<'incidents'>
export type Responder = Pick<
  Tables<'incident_responders'>,
  'id' | 'name' | 'created_at' | 'share_link_id'
>
export type Alert = Pick<
  Tables<'alerts'>,
  | 'id'
  | 'contact_id'
  | 'recipient_name'
  | 'channel'
  | 'template'
  | 'status'
  | 'sent_at'
  | 'last_error'
>
export type ContactLink = Pick<
  Tables<'share_links'>,
  'id' | 'contact_id' | 'recipient_name' | 'first_viewed_at'
>
export type SafePoint = {
  id: string
  name: string
  category: 'police' | 'hospital' | 'fire_station' | 'pharmacy'
  lat: number
  lng: number
  phone: string | null
  address: string | null
  distance_m: number
}

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

/** The police side of an SOS, as the citizen and her contacts see it. */
export type PoliceResponse = {
  org_name: string | null
  org_phone: string | null
  state: 'unacknowledged' | 'acknowledged' | 'responding' | 'on_scene'
  acknowledged_at: string | null
  /** Call sign of the unit on the way: "CP-PCR-1". */
  unit: string | null
  eta_at: string | null
  arrived_at: string | null
  raised_to_control_room: boolean
}

/** What a trusted contact sees on /t/:token. */
export type LiveView = {
  citizen_name: string | null
  /** Set when the link was sent to one contact: "Asha". */
  contact_name: string | null
  /** Public Realtime topic that pings when something changes. */
  channel: string
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
  police: PoliceResponse | null
}

export const sosKeys = {
  active: ['incidents', 'active'] as const,
  recent: ['incidents', 'recent'] as const,
  incident: (id: string) => ['incidents', id] as const,
  responders: (id: string) => ['incidents', id, 'responders'] as const,
  alerts: (id: string) => ['incidents', id, 'alerts'] as const,
  safePoints: (lat: number, lng: number) =>
    ['safe-points', lat.toFixed(3), lng.toFixed(3)] as const,
  path: (id: string) => ['incidents', id, 'path'] as const,
  timeline: (id: string) => ['incidents', id, 'timeline'] as const,
  police: (id: string) => ['incidents', id, 'police'] as const,
  pins: ['sos-pins'] as const,
  live: (token: string) => ['live-link', token] as const,
}

/** True once the citizen has closed the SOS on her side (normally or with the duress PIN). */
export function closedForCitizen(incident: Pick<Incident, 'status' | 'closed_by_citizen_at'>) {
  return incident.status !== 'active' || incident.closed_by_citizen_at !== null
}

/** occurredAt is set when a queued (offline) SOS is sent later: when it was really pressed. */
export async function createSos(
  clientId: string,
  fix: Fix | null,
  batteryPct: number | null,
  occurredAt?: string,
) {
  const result = await db().rpc('create_sos', {
    p_client_id: clientId,
    p_lat: fix?.lat,
    p_lng: fix?.lng,
    p_accuracy_m: fix?.accuracy ?? undefined,
    p_battery_pct: batteryPct ?? undefined,
    p_occurred_at: occurredAt,
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
    // Her own link; each alerted contact has a separate one.
    .eq('share_links.audience', 'shared')
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
    .select('id, name, created_at, share_link_id')
    .eq('incident_id', incidentId)
    .order('created_at')
  return unwrap(result)
}

/** What was sent to whom, and which contact links were opened. */
export async function fetchAlerts(incidentId: string) {
  const [alerts, links] = await Promise.all([
    db()
      .from('alerts')
      .select('id, contact_id, recipient_name, channel, template, status, sent_at, last_error')
      .eq('incident_id', incidentId)
      .order('created_at'),
    db()
      .from('share_links')
      .select('id, contact_id, recipient_name, first_viewed_at')
      .eq('incident_id', incidentId)
      .eq('audience', 'contact'),
  ])
  return { alerts: unwrap(alerts) as Alert[], links: unwrap(links) as ContactLink[] }
}

/** The nearest police stations and hospitals (anyone may call this, it is public data). */
export async function fetchSafePoints(lat: number, lng: number) {
  const result = await db().rpc('nearby_safe_points', {
    p_lat: lat,
    p_lng: lng,
    p_per_category: 2,
  })
  return unwrap(result) as SafePoint[]
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

export async function fetchPoliceResponse(incidentId: string) {
  const result = await db().rpc('incident_response', { p_incident_id: incidentId })
  return unwrap(result) as PoliceResponse | null
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
