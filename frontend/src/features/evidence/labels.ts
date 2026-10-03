import type { EvidenceStatus, TimelineEntry } from './api'

export const STATUS: Record<EvidenceStatus, string> = {
  registered: 'Checking…',
  sealed: 'Sealed',
  rejected: 'Not sealed',
  deleted: 'Deleted',
}

export const CAPACITY: Record<string, string> = {
  investigating_officer: 'Investigating officer',
  supervisor: 'Supervisor',
  sender: 'Handed over by',
  receiver: 'Received by',
}

export const TRANSFER: Record<string, string> = {
  pending: 'Waiting for the receiver',
  accepted: 'Accepted, re-checking the file',
  completed: 'Completed, file re-verified',
  mismatch: 'Stopped: the file did not match',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

/** One line per ledger entry about an item or a case. */
export function describeEntry(entry: TimelineEntry) {
  const p = entry.payload
  switch (entry.action) {
    case 'evidence.registered':
      return 'Fingerprint taken on the device and registered'
    case 'evidence.uploaded':
      return 'File uploaded'
    case 'evidence.sealed':
      return 'Sealed: the server re-hash matched'
    case 'evidence.rejected':
      return `Not sealed: ${String(p.reason ?? 'the file did not match')}`
    case 'evidence.shared':
      return 'Shared with the police'
    case 'evidence.deletion_requested':
      return 'Deletion requested (30 days to cancel)'
    case 'evidence.deletion_cancelled':
      return 'Deletion cancelled'
    case 'evidence.deleted':
      return 'File deleted; its fingerprint stays in the ledger'
    case 'evidence.lock_signed':
      return `Signed by the ${CAPACITY[String(p.capacity)]?.toLowerCase() ?? 'officer'}`
    case 'evidence.locked':
      return 'Locked with two signatures'
    case 'custody.received':
      return 'Added to the case; custody starts with the investigating officer'
    case 'custody.transfer_started':
      return `Hand-off started: ${String(p.reason ?? '')}`
    case 'custody.transfer_accepted':
      return 'Hand-off accepted and signed by the receiver'
    case 'custody.transferred':
      return 'Custody transferred; the file was re-verified'
    case 'custody.hash_mismatch':
      return 'Hand-off stopped: the stored file did not match its fingerprint'
    case 'custody.transfer_declined':
      return 'Hand-off declined'
    case 'custody.transfer_cancelled':
      return 'Hand-off cancelled'
    case 'case.opened':
      return 'Case opened'
    case 'case.state_changed':
      return `Moved to ${String(p.to ?? '').replace(/_/g, ' ')}`
    case 'case.advance_blocked':
      return `Blocked moving to ${String(p.to ?? '').replace(/_/g, ' ')}: steps missing`
    case 'case.statement_added':
      return 'Statement recorded'
    case 'case.note_added':
      return 'Note added'
    case 'case.site_checkin':
      return p.within_geofence
        ? `Site visit checked in (${Number(p.distance_m)} m from the site)`
        : `Check-in too far from the site (${Number(p.distance_m)} m)`
    default:
      return entry.action
  }
}
