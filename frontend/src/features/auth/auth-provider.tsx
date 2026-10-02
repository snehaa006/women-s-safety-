import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { supabase } from '@/lib/supabase'

import { createSupabaseAuthClient, type AuthClient, type Profile } from './auth-client'
import { AuthContext, type AuthState } from './auth-context'

const defaultClient = createSupabaseAuthClient(supabase)

type ProfileResult = { userId: string } & ({ profile: Profile } | { error: string })

export function AuthProvider({
  client = defaultClient,
  children,
}: {
  client?: AuthClient
  children: ReactNode
}) {
  // undefined = not known yet, null = signed out
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [result, setResult] = useState<ProfileResult | null>(null)

  useEffect(() => client.subscribe(setUserId), [client])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    client.fetchProfile(userId).then(
      (profile) => !cancelled && setResult({ userId, profile }),
      (error: Error) => !cancelled && setResult({ userId, error: error.message }),
    )
    return () => {
      cancelled = true
    }
  }, [client, userId])

  const value = useMemo(() => {
    let state: AuthState
    if (userId === undefined) state = { status: 'loading' }
    else if (userId === null) state = { status: 'signed-out' }
    else if (result?.userId !== userId) state = { status: 'loading' }
    else if ('error' in result)
      state = { status: 'error', message: `We couldn't load your profile. ${result.error}` }
    else state = { status: 'signed-in', profile: result.profile }
    return { ...state, client }
  }, [client, userId, result])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
