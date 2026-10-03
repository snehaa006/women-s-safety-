// What contacts receive. Plain language, the live link first, and nothing the contact can't act on.
// Pure functions: no Deno or network APIs, so they run in the Node tests too.

/** One row from public.claim_alerts(). */
export type ClaimedAlert = {
  alert_id: string
  channel: 'email' | 'telegram'
  template: 'sos' | 'reminder' | 'safe'
  level: number
  attempts: number
  address: string | null
  recipient_name: string
  citizen_name: string | null
  citizen_phone: string | null
  link_token: string | null
  incident_status: string
  lat: number | string | null
  lng: number | string | null
  location_at: string | null
  started_at: string
  source: string
}

export type Message = {
  subject: string
  text: string
  html: string
  /** The button under a Telegram message. */
  button: { label: string; url: string } | null
}

export type MessageOptions = {
  siteUrl: string
  timeZone: string
  now?: Date
}

const SOURCE: Record<string, string> = {
  app: 'from her phone',
  device: 'from her wearable',
  simulator: 'from her wearable',
}

export function liveLink(siteUrl: string, token: string) {
  return `${siteUrl.replace(/\/+$/, '')}/t/${encodeURIComponent(token)}`
}

export function mapsLink(lat: number, lng: number) {
  return `https://maps.google.com/?q=${lat},${lng}`
}

function clock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value))
}

function ago(value: string, now: Date) {
  const minutes = Math.round((now.getTime() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

function linkify(line: string) {
  return escapeHtml(line).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
}

export function renderMessage(alert: ClaimedAlert, options: MessageOptions): Message {
  const now = options.now ?? new Date()
  const name = alert.citizen_name ?? 'Your contact'
  const link = alert.link_token ? liveLink(options.siteUrl, alert.link_token) : null
  const lat = alert.lat === null ? null : Number(alert.lat)
  const lng = alert.lng === null ? null : Number(alert.lng)
  const started = clock(alert.started_at, options.timeZone)
  const footer = `You get this because ${name} added you to her trusted circle on Women's Safety.`

  let subject: string
  const lines: string[] = []

  if (alert.template === 'safe') {
    subject = `${name} is safe`
    lines.push(`${name} ended the SOS she sent at ${started} and marked herself safe.`)
    lines.push('No need to act on the earlier alert.')
  } else {
    subject =
      alert.template === 'reminder'
        ? `Reminder: ${name}'s SOS is still active`
        : `SOS: ${name} needs help`
    lines.push(
      alert.template === 'reminder'
        ? `${name}'s SOS from ${started} is still active, and nobody has said they're responding yet.`
        : `${name} sent an SOS at ${started} ${SOURCE[alert.source] ?? ''}.`.replace(' .', '.'),
    )
    if (link) lines.push(`Follow her live location: ${link}`)
    if (lat !== null && lng !== null) {
      lines.push(
        `Last known position${alert.location_at ? ` (${ago(alert.location_at, now)})` : ''}: ${mapsLink(lat, lng)}`,
      )
    }
    if (alert.citizen_phone) lines.push(`Call ${name}: ${alert.citizen_phone}`)
    lines.push(`If you can't reach ${name} and think she is in danger, call 112.`)
    if (link) lines.push(`On the live page, tap "I'm responding" so ${name} knows help is coming.`)
  }

  const text = [...lines, '', footer].join('\n')
  const html = [
    ...lines.map((line) => `<p>${linkify(line)}</p>`),
    `<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`,
  ].join('\n')

  return {
    subject,
    text,
    html,
    button:
      link && alert.template !== 'safe'
        ? { label: 'Open live location', url: link }
        : null,
  }
}
