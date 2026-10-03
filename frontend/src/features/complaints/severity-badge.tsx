import { cn } from '@/lib/utils'

import type { Severity } from './api'
import { SEVERITY, SEVERITY_HELP } from './labels'

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEVERITY[severity] ?? SEVERITY[2]
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', s.tone, className)}
      title={SEVERITY_HELP[severity]}
    >
      {s.short}
    </span>
  )
}
