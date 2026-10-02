import { createContext, useContext } from 'react'

import type { AuthClient, Profile } from './auth-client'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; profile: Profile }
  | { status: 'error'; message: string }

export type AuthContextValue = AuthState & {
  client: AuthClient
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
