import {
  Activity,
  ClipboardCheck,
  FolderLock,
  Inbox,
  LogOut,
  Map,
  SlidersHorizontal,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'

import { Brand } from '@/components/brand'
import { PhaseBadge } from '@/components/phase-badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { ThemeToggle } from '@/features/theme/theme-toggle'
import { paths } from '@/lib/paths'
import { cn } from '@/lib/utils'

const nav = [
  { to: paths.console.live, label: 'Live board', icon: Activity, end: true, adminOnly: false },
  { to: paths.console.complaints, label: 'Complaints', icon: Inbox, end: false, adminOnly: false },
  { to: paths.console.cases, label: 'Cases', icon: FolderLock, end: false, adminOnly: false },
  { to: paths.console.map, label: 'Map', icon: Map, end: false, adminOnly: false },
  {
    to: paths.console.reviews,
    label: 'Reviews',
    icon: ClipboardCheck,
    end: false,
    adminOnly: false,
  },
  {
    to: paths.console.admin(),
    label: 'Admin',
    icon: SlidersHorizontal,
    end: false,
    adminOnly: true,
  },
] as const

const roleLabel = {
  citizen: 'Citizen',
  officer: 'Officer',
  supervisor: 'Supervisor',
  oversight: 'Oversight',
  admin: 'Administrator',
} as const

export function ConsoleLayout() {
  const auth = useAuth()
  const navigate = useNavigate()
  const profile = auth.status === 'signed-in' ? auth.profile : null
  const items = nav.filter((item) => !item.adminOnly || profile?.role === 'admin')

  async function signOut() {
    await auth.client.signOut()
    navigate('/')
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="bg-card flex flex-col border-b md:sticky md:top-0 md:h-dvh md:w-60 md:border-r md:border-b-0">
        <div className="flex h-14 items-center px-4">
          <Brand to={paths.console.live} />
        </div>
        <nav aria-label="Console" className="flex-1 overflow-x-auto px-2 pb-2 md:overflow-visible">
          <ul className="flex gap-1 md:flex-col">
            {items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )
                  }
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {profile ? (
          <div className="hidden items-center justify-between gap-2 border-t p-3 md:flex">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{profile.fullName ?? 'Staff member'}</p>
              <p className="text-muted-foreground">{roleLabel[profile.role]}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut />
            </Button>
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-4">
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            On-duty status <PhaseBadge phase="P2" />
          </span>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            aria-label="Sign out"
            className="md:hidden"
          >
            <LogOut />
          </Button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
