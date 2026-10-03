import { CLOSE_CODE, describeEntry } from '@/features/sos/timeline'

import type { BoardIncident, CloseCode, ConsoleTimelineEntry, ResponseState } from './api'

export const STATE_LABEL: Record<ResponseState, string> = {
  unacknowledged: 'Not acknowledged',
  acknowledged: 'Acknowledged',
  responding: 'Unit on the way',
  on_scene: 'On scene',
}

export const CLOSE_OPTIONS: { code: CloseCode; label: string }[] = [
  { code: 'user_safe', label: 'Person confirmed safe' },
  { code: 'assisted_on_scene', label: 'Assisted on scene' },
  { code: 'transferred_to_case', label: 'Moved to a case' },
  { code: 'false_alarm', label: 'False alarm' },
  { code: 'duplicate', label: 'Duplicate' },
]

/** "45 s", "3 min", "1 h 5 min". */
export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`
}

/** Seconds since the SOS started. */
export function waitingFor(incident: Pick<BoardIncident, 'started_at'>, now = Date.now()) {
  return (now - new Date(incident.started_at).getTime()) / 1000
}

/** Escalated and still unanswered: the row flashes red. */
export function isUrgent(incident: Pick<BoardIncident, 'escalation_level' | 'acknowledged_at'>) {
  return incident.escalation_level > 0 && incident.acknowledged_at === null
}

/** "Escalated to control room", "Escalated 3×" — null before the first escalation. */
export function escalationLabel(level: number) {
  if (level <= 0) return null
  if (level === 1) return 'Station re-alerted'
  if (level === 2) return 'Raised to control room'
  return `Escalated ${level}×`
}

/** Board counts for the summary line. */
export function summarize(incidents: BoardIncident[]) {
  return {
    total: incidents.length,
    unacknowledged: incidents.filter((i) => i.acknowledged_at === null).length,
    urgent: incidents.filter(isUrgent).length,
  }
}

/** Timeline labels for staff: police actions in staff terms, everything else as the citizen sees it. */
export function describeConsoleEntry(entry: ConsoleTimelineEntry) {
  const p = entry.payload
  switch (entry.action) {
    case 'sos.triggered':
      return `SOS raised from ${p.source === 'app' ? 'the app' : p.source === 'device' ? 'a wearable' : 'the virtual wearable'}`
    case 'alerts.queued':
      return `Trusted circle alerted: ${p.alerts} message${p.alerts === 1 ? '' : 's'}`
    case 'sos.no_response':
      return 'No contact responded: circle reminded'
    case 'incident.acknowledged':
      return `Acknowledged after ${formatDuration(Number(p.after_s))}`
    case 'incident.on_scene':
      return `${String(p.unit ?? 'Unit')} on scene after ${formatDuration(Number(p.after_s))}`
    case 'incident.closed':
      return `Closed: ${CLOSE_CODE[String(p.code)] ?? String(p.code)}${p.note ? ` — ${String(p.note)}` : ''}`
    case 'sos.resolved':
      return p.resolution === 'false_alarm'
        ? 'Citizen ended it as a false alarm'
        : 'Citizen marked safe'
    default:
      return describeEntry({ ...entry, lat: null, lng: null })
  }
}
