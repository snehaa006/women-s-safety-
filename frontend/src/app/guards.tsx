import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router'

import { FullPageStatus } from '@/components/full-page-status'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { homePathForRole, type Role } from '@/lib/roles'

/** Lets a signed-in user with one of `roles` through. Everyone else is redirected or blocked. */
export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') return <FullPageStatus />
  if (auth.status === 'error') return <FullPageStatus>{auth.message}</FullPageStatus>
  if (auth.status === 'signed-out') {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (!roles.includes(auth.profile.role)) {
    return <Forbidden home={homePathForRole(auth.profile.role)} />
  }
  return children
}

function Forbidden({ home }: { home: string }) {
  const staffArea = home === '/app'
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 p-6 text-center">
      <ShieldAlert className="text-muted-foreground mx-auto size-10" aria-hidden />
      <h1 className="text-2xl font-bold">You can't open this page</h1>
      <p className="text-muted-foreground">
        {staffArea
          ? 'This area is for authority staff. Accounts for it are created by an administrator.'
          : 'This area is for citizens using the safety app.'}
      </p>
      <Button asChild size="touch">
        <Link to={home}>Go to your home screen</Link>
      </Button>
    </main>
  )
}
