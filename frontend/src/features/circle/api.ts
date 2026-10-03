import type { Tables } from '@/lib/database.types'
import { db, unwrap } from '@/lib/supabase'

export type Contact = Tables<'trusted_contacts'>
export type ContactInput = Pick<Contact, 'name' | 'phone' | 'email' | 'relationship'>

export const circleKeys = { all: ['trusted-contacts'] as const }

export const MAX_CONTACTS = 10

const PHONES_KEY = 'circle-phones'

export async function listContacts(): Promise<Contact[]> {
  const result = await db()
    .from('trusted_contacts')
    .select('*')
    .order('priority')
    .order('created_at')
  const contacts = unwrap(result)
  rememberPhones(contacts)
  return contacts
}

/** Kept on the device so the offline SOS can still text the circle without internet. */
function rememberPhones(contacts: Contact[]) {
  try {
    const phones = contacts.flatMap((c) => (c.phone ? [c.phone] : []))
    localStorage.setItem(PHONES_KEY, JSON.stringify(phones))
  } catch {
    // Storage blocked: the offline SMS just opens without numbers.
  }
}

export function rememberedPhones(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PHONES_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/** The invite a contact opens once so the bot can send them SOS alerts. */
export function telegramInviteLink(bot: string, code: string) {
  return `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(code)}`
}

export async function disconnectTelegram(contactId: string) {
  unwrap(await db().rpc('disconnect_telegram', { p_contact_id: contactId }))
}

export async function addContact(input: ContactInput, priority: number) {
  return unwrap(
    await db()
      .from('trusted_contacts')
      .insert({ ...input, priority })
      .select()
      .single(),
  )
}

export async function updateContact(id: string, input: ContactInput) {
  unwrap(await db().from('trusted_contacts').update(input).eq('id', id))
}

export async function removeContact(id: string) {
  unwrap(await db().from('trusted_contacts').delete().eq('id', id))
}

/** Saves a new alert order: the first contact gets priority 1. */
export async function reorderContacts(ordered: Contact[]) {
  const changed = ordered
    .map((contact, index) => ({ contact, priority: index + 1 }))
    .filter(({ contact, priority }) => contact.priority !== priority)
  for (const { contact, priority } of changed) {
    unwrap(await db().from('trusted_contacts').update({ priority }).eq('id', contact.id))
  }
}

/** The bot's username (public), e.g. WomensSafetyAlertsBot. Unset until Telegram is set up. */
export const telegramBot = (import.meta.env.VITE_TELEGRAM_BOT as string | undefined)?.trim() || null
