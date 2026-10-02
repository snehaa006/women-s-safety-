import { House, Lock, LogOut, Map, MessageSquareWarning, Settings, Users } from 'lucide-react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'

import { Brand } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { SosQuickButton } from '@/features/sos/sos-button'
import { ThemeToggle } from '@/features/theme/theme-toggle'
import { paths } from '@/lib/paths'
import { cn } from '@/lib/utils'

const tabs = [
  { to: paths.app.home, label: 'Home', icon: House, end: true },
  { to: paths.app.map, label: 'Map', icon: Map, end: false },
  { to: paths.app.report, label: 'Report', icon: MessageSquareWarning, end: false },
  { to: paths.app.vault, label: 'Vault', icon: Lock, end: false },
  { to: paths.app.circle, label: 'Circle', icon: Users, end: false },
] as const

export function CitizenLayout() {
  const { client } = useAuth()
  const navigate = useNavigate()

  async function signOut() {
    await client.signOut()
    navigate('/')
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/95 sticky top-0 z-10 border-b pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-2 px-4">
          <Brand to={paths.app.home} />
          <div className="flex items-center gap-1">
            <SosQuickButton />
            <Button asChild variant="ghost" size="icon" aria-label="Settings">
              <Link to={paths.app.settings}>
                <Settings />
              </Link>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-28">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium',
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
