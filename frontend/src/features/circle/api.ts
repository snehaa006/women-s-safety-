import type { Tables } from '@/lib/database.types'
import { db, unwrap } from '@/lib/supabase'

export type Contact = Tables<'trusted_contacts'>
export type ContactInput = Pick<Contact, 'name' | 'phone' | 'email' | 'relationship'>

export const circleKeys = { all: ['trusted-contacts'] as const }

export const MAX_CONTACTS = 10

export async function listContacts(): Promise<Contact[]> {
  const result = await db()
    .from('trusted_contacts')
    .select('*')
    .order('priority')
    .order('created_at')
  return unwrap(result)
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
