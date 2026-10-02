import type { SupabaseClient } from '@supabase/supabase-js'

import { ROLES, type Role } from '@/lib/roles'

export type Profile = {
  id: string
  fullName: string | null
  role: Role
}

/** The only place the app talks to Supabase Auth. Tests swap in a fake. */
export interface AuthClient {
  /** False until the Supabase URL and publishable key are configured. */
  readonly configured: boolean
  /** Calls back with the current user id right away, then on every sign-in or sign-out. */
  subscribe(onUserChange: (userId: string | null) => void): () => void
  fetchProfile(userId: string): Promise<Profile>
  signIn(email: string, password: string): Promise<void>
  signUp(fullName: string, email: string, password: string): Promise<{ needsConfirmation: boolean }>
  signOut(): Promise<void>
}

const NOT_CONFIGURED = 'Sign-in is not set up yet. Add the Supabase keys to frontend/.env.local.'

export function createSupabaseAuthClient(client: SupabaseClient | null): AuthClient {
  if (!client) {
    return {
      configured: false,
      subscribe(onUserChange) {
        onUserChange(null)
        return () => {}
      },
      fetchProfile: () => Promise.reject(new Error(NOT_CONFIGURED)),
      signIn: () => Promise.reject(new Error(NOT_CONFIGURED)),
      signUp: () => Promise.reject(new Error(NOT_CONFIGURED)),
      signOut: () => Promise.resolve(),
    }
  }

  return {
    configured: true,
    subscribe(onUserChange) {
      // Fires INITIAL_SESSION immediately. Keep this callback synchronous: Supabase warns that
      // awaiting other Supabase calls inside it can deadlock, so profile loading happens elsewhere.
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        onUserChange(session?.user.id ?? null)
      })
      return () => data.subscription.unsubscribe()
    },
    async fetchProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', userId)
        .single()
      if (error) throw new Error(error.message)
      if (!ROLES.includes(data.role)) throw new Error(`Unknown role "${data.role}"`)
      return { id: data.id, fullName: data.full_name, role: data.role }
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
    },
    async signUp(fullName, email, password) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      })
      if (error) throw new Error(error.message)
      return { needsConfirmation: !data.session }
    },
    async signOut() {
      const { error } = await client.auth.signOut()
      if (error) throw new Error(error.message)
    },
  }
}
