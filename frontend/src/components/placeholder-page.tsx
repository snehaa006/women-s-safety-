import { useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { PhaseBadge } from '@/components/phase-badge'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Stand-in for a screen a later phase builds. Shows the dynamic route params it received,
 * so the route tree can be exercised before the feature exists.
 */
export function PlaceholderPage({
  title,
  phase,
  module,
  description,
}: {
  title: string
  phase: string
  module?: string
  description: string
}) {
  const params = Object.entries(useParams()).filter(([, value]) => value)

  return (
    <div className="grid gap-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex gap-2">
            {module ? <PhaseBadge phase={module} /> : null}
            <PhaseBadge phase={phase} />
          </div>
        }
      />
      <Card className="border-dashed shadow-none">
        <CardContent className="text-muted-foreground grid gap-2 text-sm">
          <p>This screen is built in phase {phase}. The route already exists.</p>
          {params.length > 0 ? (
            <dl className="grid gap-1">
              {params.map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="font-mono">{key}</dt>
                  <dd className="text-foreground font-mono font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
