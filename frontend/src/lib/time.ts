const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const timeWithSeconds = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** "just now", "3 minutes ago", "2 hours ago"... */
export function timeAgo(value: string | number | Date, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000)
  if (Math.abs(seconds) < 10) return 'just now'
  if (Math.abs(seconds) < 60) return relative.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}

export function formatTime(value: string | number | Date, withSeconds = false) {
  return (withSeconds ? timeWithSeconds : timeOnly).format(new Date(value))
}

export function formatDateTime(value: string | number | Date) {
  return dateTime.format(new Date(value))
}
