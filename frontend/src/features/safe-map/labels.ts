import type { Journey, RiskCell } from './api'

const FACTOR: Record<string, string> = {
  complaints: 'reports',
  sos: 'SOS alerts',
  'zone:poor_lighting': 'poor lighting',
  'zone:isolated': 'isolated',
  'zone:harassment': 'harassment',
  'zone:unsafe_crowd': 'unsafe crowd',
  'zone:no_transport': 'no transport',
  'zone:other': 'other concerns',
}

/** Why a cell is flagged: its top three factors, e.g. "poor lighting (3), isolated (2)". */
export function explainCell(cell: Pick<RiskCell, 'factors'>) {
  return Object.entries(cell.factors)
    .filter(([k, n]) => k !== 'safe_points' && n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${FACTOR[k] ?? k} (${n})`)
    .join(', ')
}

const REASON: Record<string, string> = {
  no_check_in: 'no answer to the check-in',
  lost_heartbeat: 'the phone went silent',
  duress_pin: 'check-in answered',
}

export function describeJourneyEntry(entry: Journey['timeline'][number]) {
  const p = entry.payload
  switch (entry.action) {
    case 'journey.started':
      return `Journey started${p.route ? ` on the ${String(p.route)} route` : ''}`
    case 'journey.active_monitoring':
      return 'Active monitoring on: high-risk area at night'
    case 'journey.check_in_requested':
      return p.reason === 'off_route'
        ? 'Asked "Are you OK?": off the route'
        : 'Asked "Are you OK?": stopped'
    case 'journey.checked_in':
      return 'Answered: OK'
    case 'journey.escalated':
      return `SOS raised: ${REASON[String(p.reason)] ?? String(p.reason)}`
    case 'journey.arrived':
      return 'Arrived'
    case 'journey.cancelled':
      return 'Stopped watching'
    default:
      return entry.action
  }
}
