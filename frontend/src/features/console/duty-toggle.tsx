import { useMutation, useQueryClient } from '@tanstack/react-query'

import { cn } from '@/lib/utils'

import { consoleKeys, setOnDuty } from './api'
import { useStaff } from './use-console'

/** On duty / off duty for the staff member's station, in the console header. */
export function DutyToggle() {
  const { profile, memberships } = useStaff()
  const queryClient = useQueryClient()
  const membership = memberships.data?.[0]
  const toggle = useMutation({
    mutationFn: (onDuty: boolean) => setOnDuty(membership!.org_id, onDuty),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: consoleKeys.memberships(profile?.id ?? '') }),
  })
  if (!membership) return null

  const onDuty = toggle.isPending ? toggle.variables : membership.on_duty
  return (
    <button
      type="button"
      role="switch"
      aria-checked={onDuty}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(!membership.on_duty)}
      title={membership.org_name}
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium',
        onDuty
          ? 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
          : 'text-muted-foreground',
      )}
    >
      <span
        className={cn('size-2 rounded-full', onDuty ? 'bg-emerald-600' : 'bg-muted-foreground')}
        aria-hidden
      />
      {onDuty ? 'On duty' : 'Off duty'}
      <span className="sr-only">at {membership.org_name}</span>
    </button>
  )
}
