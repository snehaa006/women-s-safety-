import type { ComplaintStatus, ComplaintTimelineEntry, Severity } from './api'

export const SEVERITY: Record<Severity, { label: string; short: string; tone: string }> = {
  5: { label: 'L5 Critical', short: 'L5', tone: 'bg-sos text-sos-foreground' },
  4: { label: 'L4 High', short: 'L4', tone: 'bg-orange-600 text-white' },
  3: { label: 'L3 Elevated', short: 'L3', tone: 'bg-amber-500 text-black' },
  2: { label: 'L2 Moderate', short: 'L2', tone: 'bg-primary/15 text-foreground' },
  1: { label: 'L1 Low', short: 'L1', tone: 'bg-muted text-muted-foreground' },
}

export const SEVERITY_HELP: Record<Severity, string> = {
  5: 'Immediate danger to life or body',
  4: 'Threat in progress',
  3: 'Just happened, or risk nearby',
  2: 'Past incident',
  1: 'General concern',
}

export const CATEGORY: Record<string, string> = {
  abduction: 'Abduction or attempted abduction',
  sexual_assault: 'Sexual assault',
  domestic_violence: 'Domestic violence',
  assault: 'Physical assault',
  stalking: 'Stalking or being followed',
  sexual_harassment: 'Groping or sexual harassment',
  threat: 'Threats or intimidation',
  cyber_harassment: 'Online harassment',
  harassment: 'Verbal harassment',
  suspicious_activity: 'Suspicious people nearby',
  public_safety: 'Unsafe place (lighting, CCTV)',
  other: 'Other',
}

export const STATUS: Record<ComplaintStatus, string> = {
  submitted: 'Sent to the police',
  acknowledged: 'Seen by an officer',
  in_progress: 'Being handled',
  resolved: 'Resolved',
  closed: 'Closed',
}

/** "2:41 left", "4 min overdue", "3 h 5 min left". Negative seconds are overdue. */
export function timeLeft(slaDueAt: string, now = Date.now()) {
  const seconds = Math.round((new Date(slaDueAt).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  let text: string
  if (abs < 600) {
    text = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
  } else if (abs < 3600) {
    text = `${Math.floor(abs / 60)} min`
  } else {
    const minutes = Math.floor(abs / 60)
    text = `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  }
  return { seconds, overdue: seconds < 0, text: seconds < 0 ? `${text} overdue` : `${text} left` }
}

const SIGNAL: Record<string, string> = {
  ongoing: 'happening now',
  repeated: 'keeps happening',
  just_now: 'just happened',
  past: 'in the past',
  weapon: 'weapon',
  urgent_help: 'asks for help now',
  image_abuse: 'images or blackmail',
  night: 'at night',
  isolated: 'alone or isolated',
  public_transport: 'public transport',
  injury: 'injury',
  linked_sos: 'linked to an SOS',
}

export function signalLabel(signal: string) {
  return SIGNAL[signal] ?? signal.replaceAll('_', ' ')
}

/** Timeline labels, for the citizen (`staff` false) or the console. */
export function describeComplaintEntry(entry: ComplaintTimelineEntry, staff = false): string {
  const p = entry.payload
  const level = (n: unknown) => `L${Number(n)}`
  switch (entry.action) {
    case 'complaint.filed':
      return `Report filed${p.severity ? `: ${CATEGORY[String(p.category)] ?? 'Other'}, ${level(p.severity)}` : ''}`
    case 'complaint.ai_triaged':
      return p.raised
        ? `AI review raised it to ${level(p.severity)}`
        : `AI review agreed (${level(p.severity)})`
    case 'complaint.ai_skipped':
      return staff ? `AI review skipped: ${String(p.reason ?? '')}` : 'Scored by the rules'
    case 'complaint.ai_failed':
      return staff ? `AI review failed: ${String(p.reason ?? '')}` : 'Scored by the rules'
    case 'complaint.acknowledged':
      return staff
        ? `Acknowledged ${p.within_sla ? 'within' : 'after'} the deadline`
        : 'An officer has seen your report'
    case 'complaint.escalated':
      return p.oversight
        ? 'Still not acknowledged: oversight notified'
        : p.to === 'parent'
          ? `Not acknowledged in time: raised to ${String(p.org_name ?? 'the control room')}`
          : 'Not acknowledged in time: the station was alerted again'
    case 'complaint.severity_changed':
      return `Priority changed from ${level(p.from)} to ${level(p.to)}`
    case 'complaint.severity_overridden':
      return staff
        ? `Lowered from ${level(p.from)} to ${level(p.to)} below the ${level(p.baseline)} baseline: "${String(p.justification)}"`
        : `Priority changed from ${level(p.from)} to ${level(p.to)}`
    case 'complaint.override_reviewed':
      return `Supervisor ${p.decision === 'reversed' ? 'reversed the downgrade' : 'upheld the downgrade'}${p.note ? `: ${String(p.note)}` : ''}`
    case 'complaint.status_changed':
      return `${STATUS[String(p.to) as ComplaintStatus] ?? String(p.to)}${p.note ? `: ${String(p.note)}` : ''}`
    case 'complaint.identity_shared':
      return 'You shared your name with the police'
    default:
      return entry.action
  }
}
