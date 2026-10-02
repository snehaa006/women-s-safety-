import { db, unwrap } from '@/lib/supabase'

export const profileKeys = { mine: (userId: string) => ['profile', userId] as const }

export async function fetchMyProfile(userId: string) {
  const result = await db()
    .from('profiles')
    .select('id, full_name, phone')
    .eq('id', userId)
    .single()
  return unwrap(result)
}

export async function updateMyProfile(
  userId: string,
  values: { full_name: string; phone: string | null },
) {
  unwrap(await db().from('profiles').update(values).eq('id', userId))
}
