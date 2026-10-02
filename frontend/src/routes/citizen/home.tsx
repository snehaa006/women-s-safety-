import { Footprints, MessageSquareWarning, PhoneIncoming, Users } from 'lucide-react'

import { PhaseBadge } from '@/components/phase-badge'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/features/auth/auth-context'
import { SosHoldButton } from '@/features/sos/sos-button'

const quickActions = [
  { icon: MessageSquareWarning, label: 'Report an incident', phase: 'P3' },
  { icon: Footprints, label: 'Start a safe journey', phase: 'P5' },
  { icon: PhoneIncoming, label: 'Fake call', phase: 'P7' },
] as const

export function Component() {
  const auth = useAuth()
  const firstName =
    auth.status === 'signed-in' ? (auth.profile.fullName?.split(' ')[0] ?? null) : null

  return (
    <div className="grid gap-8">
      <h1 className="text-2xl font-bold">{firstName ? `Hi ${firstName}` : 'Hi'}</h1>

      <SosHoldButton className="py-4" />

      <section aria-labelledby="quick-actions" className="grid gap-3">
        <h2 id="quick-actions" className="text-muted-foreground text-sm font-semibold uppercase">
          Quick actions
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {quickActions.map(({ icon: Icon, label, phase }) => (
            <li key={label}>
              <Card className="gap-0 py-4 opacity-70">
                <CardContent className="flex items-center justify-between gap-2 px-4">
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="text-primary size-5" aria-hidden />
                    {label}
                  </span>
                  <PhaseBadge phase={phase} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="circle" className="grid gap-3">
        <h2 id="circle" className="text-muted-foreground text-sm font-semibold uppercase">
          Trusted circle
        </h2>
        <Card className="border-dashed shadow-none">
          <CardContent className="flex items-start gap-3">
            <Users className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="grid gap-1">
              <p className="font-medium">No trusted contacts yet</p>
              <p className="text-muted-foreground text-sm">
                Adding the people who get your SOS comes in Phase 1.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
