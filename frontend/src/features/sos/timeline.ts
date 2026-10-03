import type { TimelineEntry } from './api'

const CHANNEL: Record<string, string> = { email: 'Email', telegram: 'Telegram message' }

const TEMPLATE: Record<string, string> = {
  sos: 'alert',
  reminder: 'reminder',
  safe: '"safe" message',
}

const SOURCE: Record<string, string> = {
  app: 'the app',
  device: 'your wearable',
  simulator: 'the virtual wearable',
}

/** Plain-language label for a ledger entry on the citizen's own timeline. */
export function describeEntry(entry: TimelineEntry): string {
  const p = entry.payload
  switch (entry.action) {
    case 'sos.triggered':
      return `SOS sent from ${SOURCE[String(p.source)] ?? 'the app'}${
        typeof p.delayed_s === 'number' ? ' (queued offline, delivered later)' : ''
      }`
    case 'alerts.queued':
      return `Alerting your circle: ${p.alerts} message${p.alerts === 1 ? '' : 's'}`
    case 'alert.sent':
      return `${CHANNEL[String(p.channel)] ?? 'Message'} ${TEMPLATE[String(p.template)] ?? 'alert'} sent to ${String(p.to)}`
    case 'alert.failed':
    case 'alert.skipped':
      return `${CHANNEL[String(p.channel)] ?? 'Message'} to ${String(p.to)} not sent${
        p.reason ? `: ${String(p.reason)}` : ''
      }`
    case 'sos.no_response':
      return `No one responded in ${Math.round(Number(p.after_s) / 60)} minutes: reminded your circle`
    case 'sos.retriggered':
      return `SOS pressed again from ${SOURCE[String(p.source)] ?? 'the app'}`
    case 'location.batch':
      return `Location sealed: ${p.pings} point${p.pings === 1 ? '' : 's'}`
    case 'share_link.opened':
      return p.name ? `${String(p.name)} opened your live link` : 'A contact opened your live link'
    case 'contact.responding':
      return `${String(p.name)} said they're responding`
    case 'sos.pin_failed':
      return 'Wrong PIN entered'
    case 'sos.resolved':
      return p.resolution === 'false_alarm' ? 'Ended as a false alarm' : 'Marked safe'
    default:
      return entry.action
  }
}
