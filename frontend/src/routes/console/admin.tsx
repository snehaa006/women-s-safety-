import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { NavLink, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { PhaseBadge } from '@/components/phase-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  consoleKeys,
  fetchOrganizations,
  fetchPolicies,
  saveEscalationPolicy,
  type EscalationLevel,
  type EscalationPolicy,
} from '@/features/console/api'
import { formatDuration } from '@/features/console/board'
import { paths } from '@/lib/paths'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'escalation', label: 'Escalation' },
  { id: 'stations', label: 'Stations' },
] as const

export function Component() {
  const { section = 'escalation' } = useParams()
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Administration"
        description="How long an SOS may wait before it is raised, and the stations that take them."
      />
      <nav aria-label="Administration" className="flex gap-1">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.id}
            to={paths.console.admin(s.id)}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
      {section === 'stations' ? <Stations /> : <Escalation />}
    </div>
  )
}

function Stations() {
  const orgs = useQuery({ queryKey: consoleKeys.orgs, queryFn: fetchOrganizations })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stations</CardTitle>
        <CardDescription className="flex items-center gap-2">
          Editing stations, jurisdictions and members comes with oversight tools.
          <PhaseBadge phase="P9" />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 text-sm">
          {(orgs.data ?? []).map((o) => (
            <li key={o.id}>
              {o.name} <span className="text-muted-foreground">· {o.type.replace('_', ' ')}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Escalation() {
  const policies = useQuery({ queryKey: consoleKeys.policies, queryFn: fetchPolicies })
  if (policies.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading policies…
      </p>
    )
  }
  if (policies.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{policies.error.message}</AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="grid gap-4">
      {policies.data.map((policy) => (
        <PolicyForm key={policy.id} policy={policy} />
      ))}
    </div>
  )
}

/** Levels in minutes on screen, seconds in the database. */
function PolicyForm({ policy }: { policy: EscalationPolicy }) {
  const queryClient = useQueryClient()
  const [levels, setLevels] = useState(() =>
    policy.levels.map((l) => ({ minutes: String(l.after_s / 60), to: l.to })),
  )
  const [repeat, setRepeat] = useState(String(policy.repeat_s / 60))
  const save = useMutation({
    mutationFn: () =>
      saveEscalationPolicy(
        policy.org_id,
        levels.map<EscalationLevel>((l) => ({
          after_s: Math.round(Number(l.minutes) * 60),
          to: l.to,
        })),
        Math.round(Number(repeat) * 60),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: consoleKeys.policies }),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{policy.org_name ?? 'Default policy'}</CardTitle>
        <CardDescription>
          {policy.org_id
            ? 'Overrides the default for this station.'
            : 'Used by every station without its own policy.'}{' '}
          Updated {formatDateTime(policy.updated_at)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <ol className="grid gap-3">
            {levels.map((level, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`${policy.id}-after-${index}`}>
                    Level {index + 1}: unacknowledged after (min)
                  </Label>
                  <Input
                    id={`${policy.id}-after-${index}`}
                    type="number"
                    min={0.5}
                    max={60}
                    step={0.5}
                    required
                    className="w-28"
                    value={level.minutes}
                    onChange={(e) =>
                      setLevels(
                        levels.map((l, i) => (i === index ? { ...l, minutes: e.target.value } : l)),
                      )
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${policy.id}-to-${index}`}>Alert</Label>
                  <select
                    id={`${policy.id}-to-${index}`}
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={level.to}
                    onChange={(e) =>
                      setLevels(
                        levels.map((l, i) =>
                          i === index ? { ...l, to: e.target.value as EscalationLevel['to'] } : l,
                        ),
                      )
                    }
                  >
                    <option value="station">The station again</option>
                    <option value="parent">The control room above it</option>
                  </select>
                </div>
                {levels.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove level ${index + 1}`}
                    onClick={() => setLevels(levels.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
          {levels.length < 5 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                const last = Number(levels.at(-1)?.minutes ?? 0)
                setLevels([...levels, { minutes: String(last + 5), to: 'parent' }])
              }}
            >
              <Plus aria-hidden /> Add level
            </Button>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor={`${policy.id}-repeat`}>Then repeat every (min)</Label>
            <Input
              id={`${policy.id}-repeat`}
              type="number"
              min={1}
              max={60}
              step={0.5}
              required
              className="w-28"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Each repeat past the last level also flags oversight. Currently:{' '}
              {policy.levels.map((l) => formatDuration(l.after_s)).join(' → ')}, then every{' '}
              {formatDuration(policy.repeat_s)}.
            </p>
          </div>
          {save.isError ? <p className="text-destructive text-sm">{save.error.message}</p> : null}
          {save.isSuccess ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>
          ) : null}
          <Button type="submit" className="w-fit" disabled={save.isPending}>
            Save policy
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
