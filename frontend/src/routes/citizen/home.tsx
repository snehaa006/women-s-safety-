import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Footprints,
  History,
  KeyRound,
  MessageSquareWarning,
  PhoneIncoming,
  Siren,
  Users,
  Watch,
} from 'lucide-react'
import { Link } from 'react-router'

import { PhaseBadge } from '@/components/phase-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/features/auth/auth-context'
import { circleKeys, listContacts } from '@/features/circle/api'
import {
  closedForCitizen,
  fetchActiveIncident,
  fetchPinStatus,
  fetchRecentIncidents,
  sosKeys,
} from '@/features/sos/api'
import { SosHoldButton } from '@/features/sos/sos-button'
import { paths } from '@/lib/paths'
import { formatDateTime } from '@/lib/time'

const quickActions = [
  { icon: MessageSquareWarning, label: 'Report an incident', phase: null, to: paths.app.report },
  { icon: Footprints, label: 'Start a safe journey', phase: 'P5', to: null },
  { icon: PhoneIncoming, label: 'Fake call', phase: 'P7', to: null },
] as const

export function Component() {
  const auth = useAuth()
  const firstName =
    auth.status === 'signed-in' ? (auth.profile.fullName?.split(' ')[0] ?? null) : null
  const active = useQuery({ queryKey: sosKeys.active, queryFn: fetchActiveIncident })

  return (
    <div className="grid gap-8">
      <h1 className="text-2xl font-bold">{firstName ? `Hi ${firstName}` : 'Hi'}</h1>

      {active.data ? (
        <Link
          to={paths.app.sos(active.data.id)}
          className="bg-sos text-sos-foreground flex items-center gap-3 rounded-xl p-4 shadow-md"
        >
          <Siren className="size-6 animate-pulse" aria-hidden />
          <span className="flex-1 font-semibold">Your SOS is active. Open it.</span>
          <ChevronRight aria-hidden />
        </Link>
      ) : (
        <SosHoldButton className="py-4" />
      )}

      <SetupChecklist />

      <section aria-labelledby="quick-actions" className="grid gap-3">
        <h2 id="quick-actions" className="text-muted-foreground text-sm font-semibold uppercase">
          Quick actions
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {quickActions.map(({ icon: Icon, label, phase, to }) => (
            <li key={label}>
              {to ? (
                <Link to={to} className="block">
                  <Card className="hover:bg-accent/40 gap-0 py-4">
                    <CardContent className="flex items-center justify-between gap-2 px-4">
                      <span className="flex items-center gap-2 font-medium">
                        <Icon className="text-primary size-5" aria-hidden />
                        {label}
                      </span>
                      <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                    </CardContent>
                  </Card>
                </Link>
              ) : (
                <Card className="gap-0 py-4 opacity-70">
                  <CardContent className="flex items-center justify-between gap-2 px-4">
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="text-primary size-5" aria-hidden />
                      {label}
                    </span>
                    {phase ? <PhaseBadge phase={phase} /> : null}
                  </CardContent>
                </Card>
              )}
            </li>
          ))}
        </ul>
      </section>

      <RecentSos />
    </div>
  )
}

/** The three things that make SOS useful, until they are done. */
function SetupChecklist() {
  const contacts = useQuery({ queryKey: circleKeys.all, queryFn: listContacts })
  const pins = useQuery({ queryKey: sosKeys.pins, queryFn: fetchPinStatus })

  const items = [
    {
      done: (contacts.data?.length ?? 0) >= 2,
      icon: Users,
      title:
        contacts.data && contacts.data.length > 0
          ? `Trusted circle: ${contacts.data.length} ${contacts.data.length === 1 ? 'person' : 'people'}`
          : 'Add your trusted circle',
      text: 'At least two people who get your live location.',
      to: paths.app.circle,
    },
    {
      done: pins.data?.has_pin ?? false,
      icon: KeyRound,
      title: pins.data?.has_pin ? 'SOS PIN is set' : 'Set an SOS PIN',
      text: 'So only you can end an SOS. Add a duress PIN too.',
      to: paths.app.settings,
    },
    {
      done: false,
      icon: Watch,
      title: 'Try the virtual wearable',
      text: 'Send an SOS from the keychain simulator, no hardware needed.',
      to: paths.app.simulator,
    },
  ]
  if (contacts.isPending || pins.isPending) return null

  return (
    <section aria-labelledby="setup" className="grid gap-3">
      <h2 id="setup" className="text-muted-foreground text-sm font-semibold uppercase">
        Your safety setup
      </h2>
      <ul className="grid gap-2">
        {items.map(({ done, icon: Icon, title, text, to }) => (
          <li key={title}>
            <Link to={to} className="block">
              <Card className="hover:bg-accent/50 gap-0 py-3 transition-colors">
                <CardContent className="flex items-center gap-3 px-4">
                  <Icon
                    className={done ? 'size-5 text-emerald-600' : 'text-primary size-5'}
                    aria-hidden
                  />
                  <span className="grid flex-1">
                    <span className="font-semibold">{title}</span>
                    <span className="text-muted-foreground text-sm">{text}</span>
                  </span>
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RecentSos() {
  const recent = useQuery({ queryKey: sosKeys.recent, queryFn: fetchRecentIncidents })
  if (!recent.data?.length) return null

  return (
    <section aria-labelledby="recent" className="grid gap-3">
      <h2 id="recent" className="text-muted-foreground text-sm font-semibold uppercase">
        Past SOS
      </h2>
      <ul className="grid gap-2">
        {recent.data.map((incident) => (
          <li key={incident.id}>
            <Button asChild variant="ghost" className="h-auto w-full justify-start px-3 py-2">
              <Link to={paths.app.incident(incident.id)}>
                <History aria-hidden />
                <span className="flex-1 text-left">{formatDateTime(incident.started_at)}</span>
                <span className="text-muted-foreground text-sm">
                  {closedForCitizen(incident)
                    ? incident.resolution === 'false_alarm'
                      ? 'False alarm'
                      : 'Ended'
                    : 'Active'}
                </span>
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
