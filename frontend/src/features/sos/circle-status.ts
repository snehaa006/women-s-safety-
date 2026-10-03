import { formatTime } from '@/lib/time'

import type { Alert, ContactLink, Responder } from './api'

export type ContactState = 'responding' | 'opened' | 'sent' | 'sending' | 'problem'

export type ContactStatus = {
  key: string
  name: string
  state: ContactState
  /** Plain language: "Opened your link at 10:42", "Email sent at 10:41". */
  detail: string
}

const CHANNEL: Record<string, string> = { email: 'Email', telegram: 'Telegram' }

function channelLine(alert: Alert) {
  const channel = CHANNEL[alert.channel] ?? alert.channel
  switch (alert.status) {
    case 'sent':
      return `${channel} sent${alert.sent_at ? ` at ${formatTime(alert.sent_at)}` : ''}`
    case 'queued':
    case 'sending':
      return `Sending ${channel.toLowerCase()}…`
    case 'cancelled':
      return `${channel} not needed`
    default:
      return `${channel} not sent${alert.last_error ? `: ${alert.last_error}` : ''}`
  }
}

/**
 * One line per alerted contact, best news first: responding, then opened the link, then the
 * delivery state of the SOS alert (reminders and "safe" messages are left out).
 */
export function summarizeCircle(
  alerts: Alert[],
  links: ContactLink[],
  responders: Pick<Responder, 'name' | 'created_at' | 'share_link_id'>[],
): ContactStatus[] {
  const sos = alerts.filter((a) => a.template === 'sos')
  const keys = [...new Set(sos.map((a) => a.contact_id ?? a.recipient_name))]

  return keys.map((key) => {
    const mine = sos.filter((a) => (a.contact_id ?? a.recipient_name) === key)
    const name = mine[0].recipient_name
    const link = links.find((l) => l.contact_id === key)
    const response = link ? responders.find((r) => r.share_link_id === link.id) : undefined

    if (response) {
      return {
        key,
        name,
        state: 'responding',
        detail: `Responding since ${formatTime(response.created_at)}`,
      }
    }
    if (link?.first_viewed_at) {
      return {
        key,
        name,
        state: 'opened',
        detail: `Opened your live link at ${formatTime(link.first_viewed_at)}`,
      }
    }
    const lines = mine.map(channelLine).join(' · ')
    const state: ContactState = mine.some((a) => a.status === 'sent')
      ? 'sent'
      : mine.some((a) => a.status === 'queued' || a.status === 'sending')
        ? 'sending'
        : 'problem'
    return { key, name, state, detail: lines }
  })
}
