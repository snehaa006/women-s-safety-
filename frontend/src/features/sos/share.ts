import { paths } from '@/lib/paths'

/** The live link a trusted contact opens, on this site's own domain. */
export function liveLinkUrl(token: string) {
  return new URL(paths.contactLive(token), window.location.origin).toString()
}

export function sosMessage(url: string) {
  return `SOS: I need help. Follow my live location here: ${url}`
}

export function whatsappLink(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Opens the SMS app with the numbers and message filled in. `?&body=` works on Android and iOS. */
export function smsLink(phones: string[], text: string) {
  const to = phones.map((phone) => phone.replace(/[^\d+]/g, '')).join(',')
  return `sms:${to}?&body=${encodeURIComponent(text)}`
}
