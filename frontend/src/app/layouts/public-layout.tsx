import { Link, Outlet } from 'react-router'

import { Brand } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { ThemeToggle } from '@/features/theme/theme-toggle'
import { homePathForRole } from '@/lib/roles'

export function PublicLayout() {
  const auth = useAuth()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {auth.status === 'signed-in' ? (
              <Button asChild size="sm">
                <Link to={homePathForRole(auth.profile.role)}>Open the app</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link to="/login">Sign in</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <footer className="text-muted-foreground border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm">
          In an emergency, call 112. This project is in development.
        </div>
      </footer>
    </div>
  )
}
