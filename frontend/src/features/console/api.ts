import { db, unwrap } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

export type ResponseState = 'unacknowledged' | 'acknowledged' | 'responding' | 'on_scene'
export type CloseCode =
  'user_safe' | 'assisted_on_scene' | 'transferred_to_case' | 'false_alarm' | 'duplicate'

/** One active incident on the live board (see private.board_row). */
export type BoardIncident = {
  id: string
  status: 'active' | 'resolved'
  source: 'app' | 'device' | 'simulator'
  is_demo: boolean
  started_at: string
  citizen_name: string
  citizen_phone: string | null
  battery_pct: number | null
  last_location: { lat: number; lng: number; accuracy_m: number | null; at: string } | null
  org_id: string | null
  org_name: string | null
  response_state: ResponseState
  escalation_level: number
  escalated_at: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  unit: { id: string; call_sign: string } | null
  dispatched_at: string | null
  eta_at: string | null
  arrived_at: string | null
  closed_under_duress: boolean
  responders: number
  close_code: CloseCode | null
}

export type UnitOption = {
  id: string
  call_sign: string
  kind: string
  status: 'available' | 'dispatched' | 'on_scene' | 'off_duty'
  org_name: string
  distance_m: number | null
}

export type ConsoleTimelineEntry = {
  seq: number
  occurred_at: string
  action: string
  actor_role: string | null
  payload: Record<string, unknown>
}

/** Everything the incident command view shows (see public.console_incident). */
export type ConsoleIncident = Omit<BoardIncident, 'responders'> & {
  resolved_at: string | null
  close_note: string | null
  metrics: { ack_s: number | null; dispatch_s: number | null; arrival_s: number | null }
  path: [number, number][]
  /** Contacts who said they're on the way. */
  responders: { name: string; at: string }[]
  units: UnitOption[]
  timeline: ConsoleTimelineEntry[]
}

export type Membership = Pick<Tables<'memberships'>, 'org_id' | 'role' | 'on_duty'> & {
  org_name: string
}

export type EscalationLevel = { after_s: number; to: 'station' | 'parent' }
export type EscalationPolicy = {
  id: string
  org_id: string | null
  org_name: string | null
  levels: EscalationLevel[]
  repeat_s: number
  updated_at: string
}

export const consoleKeys = {
  board: ['console', 'board'] as const,
  incident: (id: string) => ['console', 'incident', id] as const,
  memberships: (userId: string) => ['console', 'memberships', userId] as const,
  policies: ['console', 'policies'] as const,
  orgs: ['console', 'orgs'] as const,
}

export async function fetchBoard() {
  return unwrap(await db().rpc('console_board')) as BoardIncident[]
}

export async function fetchConsoleIncident(id: string) {
  return unwrap(await db().rpc('console_incident', { p_incident_id: id })) as ConsoleIncident
}

export async function acknowledgeIncident(id: string) {
  unwrap(await db().rpc('acknowledge_incident', { p_incident_id: id }))
}

export async function dispatchUnit(id: string, unitId: string, etaMinutes: number) {
  unwrap(
    await db().rpc('dispatch_unit', {
      p_incident_id: id,
      p_unit_id: unitId,
      p_eta_minutes: etaMinutes,
    }),
  )
}

export async function markOnScene(id: string) {
  unwrap(await db().rpc('mark_on_scene', { p_incident_id: id }))
}

export async function closeIncident(id: string, code: CloseCode, note: string) {
  unwrap(
    await db().rpc('close_incident', {
      p_incident_id: id,
      p_code: code,
      p_note: note.trim() || undefined,
    }),
  )
}

/** Admins and supervisors: replaces the demo incidents with three fresh ones. */
export async function loadDemoIncidents() {
  return unwrap(await db().rpc('admin_load_demo_incidents')) as number
}

/** The signed-in staff member's organisations. */
export async function fetchMemberships(userId: string): Promise<Membership[]> {
  const result = await db()
    .from('memberships')
    .select('org_id, role, on_duty, organizations(name)')
    .eq('user_id', userId)
  return unwrap(result).map(({ organizations, ...m }) => ({
    ...m,
    org_name: organizations?.name ?? 'Organisation',
  }))
}

export async function setOnDuty(orgId: string, onDuty: boolean) {
  unwrap(await db().rpc('set_on_duty', { p_org_id: orgId, p_on_duty: onDuty }))
}

export async function fetchOrganizations() {
  const result = await db()
    .from('organizations')
    .select('id, name, type, parent_id')
    .eq('is_active', true)
    .order('name')
  return unwrap(result)
}

export async function fetchPolicies(): Promise<EscalationPolicy[]> {
  const result = await db()
    .from('escalation_policies')
    .select('id, org_id, levels, repeat_s, updated_at, organizations(name)')
    .order('org_id', { nullsFirst: true })
  return unwrap(result).map(({ organizations, levels, ...p }) => ({
    ...p,
    levels: levels as EscalationLevel[],
    org_name: organizations?.name ?? null,
  }))
}

/** orgId null edits the default policy every station without its own uses. */
export async function saveEscalationPolicy(
  orgId: string | null,
  levels: EscalationLevel[],
  repeatS: number,
) {
  unwrap(
    await db().rpc('admin_set_escalation_policy', {
      // The default policy has no organisation; the RPC takes null for it.
      p_org_id: orgId as string,
      p_levels: levels,
      p_repeat_s: repeatS,
    }),
  )
}
