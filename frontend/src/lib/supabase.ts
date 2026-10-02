import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** Null until VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set (see .env.example). */
export const supabase: SupabaseClient<Database> | null =
  supabaseUrl && supabaseKey ? createClient<Database>(supabaseUrl, supabaseKey) : null

/** The client, or an error the screens can show when the keys are missing. */
export function db(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error('The app is not connected yet. Add the Supabase keys to frontend/.env.local.')
  }
  return supabase
}

/** Turns a Supabase { data, error } result into data or a thrown Error with a readable message. */
export function unwrap<T>(
  result: { data: T; error: null } | { data: unknown; error: { message: string } },
): T {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}
