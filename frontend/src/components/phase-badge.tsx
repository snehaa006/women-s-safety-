import { Badge } from '@/components/ui/badge'

/** Marks a feature that a later roadmap phase builds (see docs/04-roadmap.md). */
export function PhaseBadge({ phase }: { phase: string }) {
  return (
    <Badge variant="secondary" className="font-mono">
      {phase}
    </Badge>
  )
}
