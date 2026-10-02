import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** Null until VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set (see .env.example). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
