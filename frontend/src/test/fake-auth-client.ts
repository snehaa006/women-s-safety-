import { vi } from 'vitest'

import type { AuthClient, Profile } from '@/features/auth/auth-client'

/** In-memory AuthClient. Pass a profile to start signed in. */
export function createFakeAuthClient(profile: Profile | null = null) {
  let current = profile
  const listeners = new Set<(userId: string | null) => void>()
  const emit = () => listeners.forEach((listener) => listener(current?.id ?? null))

  const client = {
    configured: true,
    subscribe(onUserChange: (userId: string | null) => void) {
      listeners.add(onUserChange)
      onUserChange(current?.id ?? null)
      return () => listeners.delete(onUserChange)
    },
    fetchProfile: vi.fn(async (userId: string) => {
      if (!current || current.id !== userId) throw new Error('No profile')
      return current
    }),
    signIn: vi.fn(async (_email: string, _password: string) => {}),
    signUp: vi.fn(async (_fullName: string, _email: string, _password: string) => ({
      needsConfirmation: true,
    })),
    signOut: vi.fn(async () => {
      current = null
      emit()
    }),
    /** Test helper: simulate a sign-in that resolves to `next`. */
    becomeSignedIn(next: Profile) {
      current = next
      emit()
    },
  } satisfies AuthClient & Record<string, unknown>

  return client
}

export const citizen: Profile = { id: 'u-citizen', fullName: 'Priya Sharma', role: 'citizen' }
export const officer: Profile = { id: 'u-officer', fullName: 'Ravi Kumar', role: 'officer' }
export const admin: Profile = { id: 'u-admin', fullName: 'Asha Rao', role: 'admin' }
