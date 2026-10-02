import type { TimelineEntry } from './api'

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
      return `SOS sent from ${SOURCE[String(p.source)] ?? 'the app'}`
    case 'sos.retriggered':
      return `SOS pressed again from ${SOURCE[String(p.source)] ?? 'the app'}`
    case 'location.batch':
      return `Location sealed: ${p.pings} point${p.pings === 1 ? '' : 's'}`
    case 'share_link.opened':
      return 'A contact opened your live link'
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
