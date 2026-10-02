export const ROLES = ['citizen', 'officer', 'supervisor', 'oversight', 'admin'] as const
export type Role = (typeof ROLES)[number]

/** Roles that work in the authority console. */
export const STAFF_ROLES: readonly Role[] = ['officer', 'supervisor', 'oversight', 'admin']

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role)
}

export function homePathForRole(role: Role): string {
  return isStaff(role) ? '/console' : '/app'
}

/**
 * Where to go after sign-in. Honors a `next` path only when it is an internal path
 * this role may open; otherwise falls back to the role's home.
 */
export function resolvePostLoginPath(next: string | null, role: Role): string {
  const home = homePathForRole(role)
  if (!next || !next.startsWith('/') || next.startsWith('//')) return home
  const staffArea = next === '/console' || next.startsWith('/console/')
  const citizenArea = next === '/app' || next.startsWith('/app/')
  if (staffArea && !isStaff(role)) return home
  if (citizenArea && role !== 'citizen') return home
  if (next === '/login' || next === '/signup') return home
  return next
}
