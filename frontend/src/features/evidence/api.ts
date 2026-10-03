import { db, unwrap } from '@/lib/supabase'

import { hashFile, kindFromMime, type ProofStep } from './hash'

export type EvidenceStatus = 'registered' | 'sealed' | 'rejected' | 'deleted'
export type EvidenceKind = 'photo' | 'video' | 'audio' | 'document' | 'file'

export type Anchor = {
  from_seq: number
  to_seq: number
  leaf_count: number
  merkle_root: string
  created_at: string
  ots_status: 'pending' | 'claimed' | 'submitted' | 'failed'
  ots_calendar: string | null
  submitted_at: string | null
  receipt: string | null
  proof: ProofStep[] | null
}

export type TimelineEntry = {
  seq: number
  occurred_at: string
  action: string
  actor_role?: string | null
  payload: Record<string, unknown>
  entry_hash?: string
}

/** A vault item as its owner reads it (RLS: own rows only). */
export type VaultItem = {
  id: string
  kind: EvidenceKind
  source: 'upload' | 'capture' | 'recording'
  file_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  status: EvidenceStatus
  captured_at: string | null
  sealed_at: string | null
  reject_reason: string | null
  complaint_id: string | null
  incident_id: string | null
  shared_at: string | null
  delete_after: string | null
  created_at: string
}

export type VaultItemDetail = VaultItem & {
  storage_path: string
  note: string | null
  sealed_seq: number | null
  complaint_reference: string | null
  on_case: boolean
  anchor: Anchor | null
  timeline: TimelineEntry[]
}

export type Verification =
  | { found: false; sha256: string }
  | {
      found: true
      sha256: string
      size_bytes: number
      mime_type: string
      registered_at: string
      sealed_at: string
      deleted_at: string | null
      copies: number
      entry: {
        seq: number
        action: string
        occurred_at: string
        recorded_at: string
        payload_text: string
        payload_hash: string
        prev_hash: string
        entry_hash: string
        material: string
      }
      anchor: Anchor | null
    }

export const vaultKeys = {
  list: ['vault'] as const,
  one: (id: string) => ['vault', id] as const,
}

const LIST =
  'id, kind, source, file_name, mime_type, size_bytes, sha256, status, captured_at, sealed_at, reject_reason, complaint_id, incident_id, shared_at, delete_after, created_at'

export async function listVault() {
  const result = await db()
    .from('evidence_items')
    .select(LIST)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(100)
  return unwrap(result) as VaultItem[]
}

export async function fetchVaultItem(id: string) {
  return unwrap(await db().rpc('vault_item', { p_evidence_id: id })) as VaultItemDetail
}

export type UploadStage = 'hashing' | 'registering' | 'uploading' | 'sealing'

export type NewEvidence = {
  file: File
  clientId: string
  source?: 'upload' | 'capture' | 'recording'
  location?: { lat: number; lng: number; accuracy: number | null } | null
  note?: string
  caseId?: string
  onStage?: (stage: UploadStage) => void
}

/**
 * Hash on the device, register the hash, upload straight to the private bucket, then ask the
 * server to re-hash. Retrying with the same client id never creates a second item.
 */
export async function addEvidence(e: NewEvidence) {
  e.onStage?.('hashing')
  const sha256 = await hashFile(e.file)
  e.onStage?.('registering')
  const mime = e.file.type || 'application/octet-stream'
  const registered = unwrap(
    await db().rpc('register_evidence', {
      p_file_name: e.file.name || 'evidence',
      p_mime_type: mime,
      p_size_bytes: e.file.size,
      p_sha256: sha256,
      p_kind: kindFromMime(mime),
      p_source: e.source ?? 'upload',
      p_captured_at: new Date(e.file.lastModified || Date.now()).toISOString(),
      p_lat: e.location?.lat,
      p_lng: e.location?.lng,
      p_accuracy_m: e.location?.accuracy ?? undefined,
      p_note: e.note?.trim() || undefined,
      p_client_id: e.clientId,
      p_case_id: e.caseId,
    }),
  ) as { evidence_id: string; storage_path: string; status: EvidenceStatus; created: boolean }

  if (registered.status === 'registered') {
    e.onStage?.('uploading')
    const { error } = await db()
      .storage.from('evidence')
      .upload(registered.storage_path, e.file, { contentType: mime, upsert: false })
    // A retry after a successful upload finds the file already there; that is fine.
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(error.message)
    e.onStage?.('sealing')
    unwrap(await db().rpc('confirm_evidence_upload', { p_evidence_id: registered.evidence_id }))
  }
  return { evidenceId: registered.evidence_id, sha256 }
}

export async function shareEvidence(id: string, complaintId: string) {
  unwrap(await db().rpc('share_evidence', { p_evidence_id: id, p_complaint_id: complaintId }))
}

export async function requestDeletion(id: string) {
  return unwrap(await db().rpc('request_evidence_deletion', { p_evidence_id: id })) as {
    delete_after: string
  }
}

export async function cancelDeletion(id: string) {
  unwrap(await db().rpc('cancel_evidence_deletion', { p_evidence_id: id }))
}

export async function verifyHash(sha256: string) {
  return unwrap(await db().rpc('verify_evidence', { p_sha256: sha256 })) as Verification
}

/** A short-lived link to the file; Storage checks the reader's right to it. */
export async function evidenceUrl(storagePath: string) {
  const { data, error } = await db().storage.from('evidence').createSignedUrl(storagePath, 300)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

// =============================================================================================
// Console: cases, custody and workflows
// =============================================================================================

export type ChecklistStep = {
  step: 'captured' | 'hashed' | 'sealed' | 'signed' | 'custody' | 'anchored'
  label: string
  done: boolean
  detail?: string
}
export type Checklist = { steps: ChecklistStep[]; missing: string[] }

export type CaseRow = {
  id: string
  reference: string
  title: string
  status: 'open' | 'closed'
  state: string
  state_label: string
  state_index: number
  state_count: number
  org_id: string
  org_name: string
  lead_officer: string
  lead_officer_id: string
  complaint_id: string | null
  complaint_reference: string | null
  incident_id: string | null
  evidence_count: number
  locked_count: number
  created_at: string
  updated_at: string
}

export type Requirement = { kind: string; label: string; hint: string; met: boolean }
export type CaseState = { key: string; label: string; index: number; requires: Requirement[] }
export type StaffMember = { id: string; name: string; role: string }

export type CaseEvidence = {
  id: string
  file_name: string
  kind: EvidenceKind
  mime_type: string
  size_bytes: number
  sha256: string
  status: EvidenceStatus
  captured_at: string | null
  sealed_at: string | null
  locked_at: string | null
  added_at: string
  added_by: string
  custodian: string | null
  custodian_id: string | null
  checklist: Checklist
}

export type CaseEvent = {
  id: string
  kind: 'note' | 'statement' | 'site_visit'
  body: string | null
  distance_m: number | null
  within_geofence: boolean | null
  created_at: string
  author: string
}

export type ConsoleCase = CaseRow & {
  location: { lat: number; lng: number } | null
  workflow: { key: string; version: number; name: string }
  states: CaseState[]
  me: { is_lead: boolean; is_supervisor: boolean }
  evidence: CaseEvidence[]
  events: CaseEvent[]
  staff: StaffMember[]
  timeline: TimelineEntry[]
}

export type Signature = {
  id: string
  capacity: 'investigating_officer' | 'supervisor' | 'sender' | 'receiver'
  purpose: 'lock' | 'transfer_send' | 'transfer_accept'
  transfer_id: string | null
  signer: string
  payload_sha256: string
  signature: string
  key_fingerprint: string
  signed_at: string
  valid: boolean
}

export type Transfer = {
  id: string
  status: 'pending' | 'accepted' | 'completed' | 'mismatch' | 'declined' | 'cancelled'
  reason: string
  from_id: string
  to_id: string
  from: string
  to: string
  initiated_at: string
  accepted_at: string | null
  completed_at: string | null
  rehash_sha256: string | null
  rehash_ok: boolean | null
}

export type ConsoleEvidence = {
  id: string
  case: CaseRow
  file_name: string
  kind: EvidenceKind
  source: string
  mime_type: string
  size_bytes: number
  sha256: string
  status: EvidenceStatus
  reject_reason: string | null
  storage_path: string | null
  captured_at: string | null
  location: { lat: number; lng: number; accuracy_m: number | null } | null
  note: string | null
  registered_at: string
  sealed_at: string | null
  sealed_seq: number | null
  added_by: string
  locked_at: string | null
  custodian: string | null
  custodian_id: string | null
  checklist: Checklist
  me: { id: string; is_lead: boolean; is_supervisor: boolean; is_custodian: boolean }
  signatures: Signature[]
  transfers: Transfer[]
  staff: StaffMember[]
  anchor: Anchor | null
  timeline: TimelineEntry[]
}

export type MissingRequirement = {
  state: string
  state_label: string
  kind: string
  label: string
  hint: string
}

export type Workflow = {
  id: string
  key: string
  version: number
  name: string
  states: { key: string; label: string; requires: string[] }[]
  created_at: string
  open_cases: number
}

// Under ['console', ...] so the station's Realtime topic refreshes them.
export const caseKeys = {
  list: ['console', 'cases'] as const,
  one: (id: string) => ['console', 'cases', id] as const,
  evidence: (caseId: string, id: string) => ['console', 'cases', caseId, 'evidence', id] as const,
  workflows: ['console', 'workflows'] as const,
}

export async function fetchCases() {
  return unwrap(await db().rpc('console_cases')) as CaseRow[]
}

export async function fetchCase(id: string) {
  return unwrap(await db().rpc('console_case', { p_case_id: id })) as ConsoleCase
}

export async function fetchCaseEvidence(caseId: string, id: string) {
  return unwrap(
    await db().rpc('console_evidence', { p_case_id: caseId, p_evidence_id: id }),
  ) as ConsoleEvidence
}

export async function openCase(title: string, complaintId: string) {
  return unwrap(await db().rpc('open_case', { p_title: title, p_complaint_id: complaintId })) as {
    case_id: string
    reference: string
    created: boolean
  }
}

export async function addCaseNote(caseId: string, kind: 'note' | 'statement', body: string) {
  unwrap(await db().rpc('add_case_note', { p_case_id: caseId, p_kind: kind, p_body: body }))
}

export async function caseCheckin(
  caseId: string,
  fix: { lat: number; lng: number; accuracy: number | null },
) {
  return unwrap(
    await db().rpc('case_checkin', {
      p_case_id: caseId,
      p_lat: fix.lat,
      p_lng: fix.lng,
      p_accuracy_m: fix.accuracy ?? undefined,
    }),
  ) as { distance_m: number; within_geofence: boolean }
}

export async function advanceCase(caseId: string, toState: string) {
  return unwrap(await db().rpc('advance_case', { p_case_id: caseId, p_to_state: toState })) as {
    ok: boolean
    state: string
    missing: MissingRequirement[]
  }
}

export async function signLock(caseId: string, evidenceId: string) {
  return unwrap(
    await db().rpc('sign_evidence_lock', { p_case_id: caseId, p_evidence_id: evidenceId }),
  ) as { capacity: string; locked: boolean }
}

export async function startTransfer(
  caseId: string,
  evidenceId: string,
  to: string,
  reason: string,
) {
  unwrap(
    await db().rpc('start_custody_transfer', {
      p_case_id: caseId,
      p_evidence_id: evidenceId,
      p_to_user: to,
      p_reason: reason,
    }),
  )
}

export async function respondTransfer(id: string, decision: 'accept' | 'decline' | 'cancel') {
  unwrap(await db().rpc('respond_custody_transfer', { p_transfer_id: id, p_decision: decision }))
}

export async function fetchWorkflows() {
  return unwrap(await db().rpc('console_workflows')) as {
    workflows: Workflow[]
    requirements: { kind: string; label: string; hint: string }[]
  }
}

export async function saveWorkflow(key: string, name: string, states: Workflow['states']) {
  return unwrap(
    await db().rpc('admin_save_workflow', { p_key: key, p_name: name, p_states: states }),
  ) as { workflow_id: string; version: number }
}
