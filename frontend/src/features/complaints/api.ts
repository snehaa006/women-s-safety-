import { db, unwrap } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

export type Severity = 1 | 2 | 3 | 4 | 5
export type ComplaintStatus = 'submitted' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed'
export type TriageState = 'pending' | 'done' | 'skipped' | 'failed'

/** The rules engine's instant answer (private.triage_rules). */
export type RulesResult = {
  category: string
  category_label: string
  severity: Severity
  signals: string[]
  language: 'en' | 'hi' | 'hinglish'
  rationale: string
}

/** The AI's answer, once it came back. */
export type AiResult = {
  category: string
  severity: Severity
  confidence: number | null
  signals: string[]
  rationale: string
  legal_tags: string[]
  provider: string
  model: string
  rules_floor: Severity
  final: Severity
}

export type Filed = {
  complaint_id: string
  reference: string
  created: boolean
  category?: string
  severity?: Severity
  rationale?: string
  sla_due_at?: string
  org_name?: string | null
}

/** A citizen's own complaint, read straight from the table (RLS: own rows only). */
export type MyComplaint = Pick<
  Tables<'complaints'>,
  | 'id'
  | 'reference'
  | 'description'
  | 'status'
  | 'category'
  | 'severity'
  | 'confidential'
  | 'identity_shared_at'
  | 'created_at'
  | 'occurred_at'
  | 'acknowledged_at'
  | 'resolved_at'
  | 'outcome_note'
  | 'triage_state'
  | 'input_mode'
>

export type ComplaintTimelineEntry = {
  seq: number
  occurred_at: string
  action: string
  actor_role?: string | null
  payload: Record<string, unknown>
}

export type Reporter = {
  confidential: boolean
  alias: string
  name: string | null
  phone: string | null
  shared_at?: string | null
}

/** One row of the console queue (private.complaint_row). */
export type QueueComplaint = {
  id: string
  reference: string
  status: ComplaintStatus
  category: string
  category_label: string
  severity: Severity
  baseline_severity: Severity
  triage_state: TriageState
  excerpt: string
  input_mode: 'text' | 'voice'
  created_at: string
  occurred_at: string | null
  sla_due_at: string
  acknowledged_at: string | null
  escalation_level: number
  org_id: string | null
  org_name: string | null
  reporter: Reporter
  is_demo: boolean
  pending_review: boolean
}

export type Override = {
  id: string
  from: Severity
  to: Severity
  baseline: Severity
  justification: string
  officer: string | null
  at: string
  review_status: 'pending' | 'upheld' | 'reversed'
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
}

/** The workbench (public.console_complaint). */
export type ConsoleComplaint = QueueComplaint & {
  description: string
  location: { lat: number; lng: number; accuracy_m: number | null } | null
  incident_id: string | null
  rules: RulesResult
  ai: AiResult | null
  resolved_at: string | null
  outcome_note: string | null
  acknowledged_by: string | null
  overrides: Override[]
  timeline: ComplaintTimelineEntry[]
}

export type ReviewItem = {
  id: string
  complaint_id: string
  reference: string
  category_label: string
  excerpt: string
  from: Severity
  to: Severity
  baseline: Severity
  justification: string
  officer: string | null
  org_name: string | null
  at: string
  week: string
}

export const complaintKeys = {
  mine: ['complaints', 'mine'] as const,
  mineOne: (id: string) => ['complaints', 'mine', id] as const,
  timeline: (id: string) => ['complaints', 'mine', id, 'timeline'] as const,
  preview: (text: string) => ['complaints', 'preview', text] as const,
}

// Console queries live under ['console', ...] so the station's Realtime topic refreshes them.
export const consoleComplaintKeys = {
  queue: ['console', 'complaints'] as const,
  one: (id: string) => ['console', 'complaints', id] as const,
  reviews: ['console', 'reviews'] as const,
}

export async function triagePreview(text: string) {
  return unwrap(await db().rpc('triage_preview', { p_text: text })) as RulesResult | null
}

export type NewComplaint = {
  clientId: string
  description: string
  inputMode: 'text' | 'voice'
  occurredAt: string | null
  location: { lat: number; lng: number; accuracy: number | null } | null
  confidential: boolean
}

export async function createComplaint(c: NewComplaint) {
  const result = await db().rpc('create_complaint', {
    p_description: c.description,
    p_input_mode: c.inputMode,
    p_occurred_at: c.occurredAt ?? undefined,
    p_lat: c.location?.lat,
    p_lng: c.location?.lng,
    p_accuracy_m: c.location?.accuracy ?? undefined,
    p_confidential: c.confidential,
    p_client_id: c.clientId,
  })
  return unwrap(result) as Filed
}

const MINE =
  'id, reference, description, status, category, severity, confidential, identity_shared_at, created_at, occurred_at, acknowledged_at, resolved_at, outcome_note, triage_state, input_mode'

export async function listMyComplaints() {
  const result = await db()
    .from('complaints')
    .select(MINE)
    .order('created_at', { ascending: false })
    .limit(50)
  return unwrap(result) as MyComplaint[]
}

export async function fetchMyComplaint(id: string) {
  const result = await db().from('complaints').select(MINE).eq('id', id).maybeSingle()
  return unwrap(result) as MyComplaint | null
}

export async function fetchComplaintTimeline(id: string) {
  const result = await db().rpc('complaint_timeline', { p_complaint_id: id })
  return unwrap(result) as ComplaintTimelineEntry[]
}

export async function shareIdentity(id: string) {
  unwrap(await db().rpc('share_complaint_identity', { p_complaint_id: id }))
}

export async function fetchQueue() {
  return unwrap(await db().rpc('console_complaints')) as QueueComplaint[]
}

export async function fetchConsoleComplaint(id: string) {
  return unwrap(await db().rpc('console_complaint', { p_complaint_id: id })) as ConsoleComplaint
}

export async function acknowledgeComplaint(id: string) {
  unwrap(await db().rpc('acknowledge_complaint', { p_complaint_id: id }))
}

export async function setComplaintStatus(
  id: string,
  status: 'in_progress' | 'resolved' | 'closed',
  note: string,
) {
  unwrap(
    await db().rpc('set_complaint_status', {
      p_complaint_id: id,
      p_status: status,
      p_note: note.trim() || undefined,
    }),
  )
}

export async function setComplaintSeverity(id: string, severity: Severity, justification: string) {
  const result = await db().rpc('set_complaint_severity', {
    p_complaint_id: id,
    p_severity: severity,
    p_justification: justification.trim() || undefined,
  })
  return unwrap(result) as { severity: Severity; review: boolean }
}

export async function fetchReviews() {
  return unwrap(await db().rpc('console_reviews')) as ReviewItem[]
}

export async function reviewOverride(id: string, decision: 'upheld' | 'reversed', note: string) {
  unwrap(
    await db().rpc('review_override', {
      p_override_id: id,
      p_decision: decision,
      p_note: note.trim() || undefined,
    }),
  )
}

export async function loadDemoComplaints() {
  return unwrap(await db().rpc('admin_load_demo_complaints')) as number
}
