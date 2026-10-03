import type { PoliceResponse } from './api'

export type PoliceStatus = {
  /** "Officer on the way". */
  title: string
  /** "CP-PCR-1 from Connaught Place Police Station, arriving in about 6 minutes." */
  detail: string
  tone: 'waiting' | 'acknowledged' | 'moving' | 'arrived'
}

/** "about 6 minutes", "any moment now". */
function etaText(etaAt: string, now: number) {
  const minutes = Math.round((new Date(etaAt).getTime() - now) / 60_000)
  if (minutes <= 0) return 'any moment now'
  return `in about ${minutes} minute${minutes === 1 ? '' : 's'}`
}

/** Plain-language police status for the citizen's SOS screen and her contacts' live page. */
export function describePolice(response: PoliceResponse, now = Date.now()): PoliceStatus {
  const station = response.org_name ?? 'the police'
  switch (response.state) {
    case 'on_scene':
      return {
        title: 'Police have arrived',
        detail: `${response.unit ?? 'A unit'} from ${station} has arrived.`,
        tone: 'arrived',
      }
    case 'responding':
      return {
        title: 'Officer on the way',
        detail: `${response.unit ?? 'A unit'} from ${station}${
          response.eta_at ? `, arriving ${etaText(response.eta_at, now)}` : ''
        }.`,
        tone: 'moving',
      }
    case 'acknowledged':
      return {
        title: 'Police have seen the SOS',
        detail: `${station} acknowledged it and is sending help.`,
        tone: 'acknowledged',
      }
    default:
      return {
        title: 'Alerting the police',
        detail: response.raised_to_control_room
          ? `Sent to ${station}. Not answered yet, so the district control room was alerted too.`
          : `Sent to ${station}. Waiting for an officer to acknowledge.`,
        tone: 'waiting',
      }
  }
}
