import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/page-header'
import { BoardMap } from '@/features/console/board-map'
import { useBoard } from '@/features/console/use-console'
import { fetchRiskMap, safeMapKeys } from '@/features/safe-map/api'
import { explainCell } from '@/features/safe-map/labels'
import { cn } from '@/lib/utils'

export function Component() {
  const { board } = useBoard()
  const [layer, setLayer] = useState<'off' | 'day' | 'night'>('night')
  const risk = useQuery({
    queryKey: safeMapKeys.risk(layer === 'day' ? 'day' : 'night'),
    queryFn: () => fetchRiskMap(layer === 'day' ? 'day' : 'night'),
    enabled: layer !== 'off',
  })
  const cells = layer === 'off' ? [] : (risk.data?.cells ?? [])
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Map"
        description="Every active SOS you can see, updated live, over the risk areas citizens flagged."
      />
      <div className="flex w-fit rounded-md border p-0.5" role="group" aria-label="Risk layer">
        {(['off', 'day', 'night'] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={layer === l}
            onClick={() => setLayer(l)}
            className={cn(
              'rounded px-3 py-1 text-sm',
              layer === l ? 'bg-accent font-medium' : 'text-muted-foreground',
            )}
          >
            {l === 'off' ? 'No risk layer' : l === 'day' ? 'Day risk' : 'Night risk'}
          </button>
        ))}
      </div>
      <BoardMap
        incidents={board.data ?? []}
        cells={cells.map((c) => ({ bounds: c.bounds, level: c.level }))}
        className="h-[70dvh]"
      />
      {cells.length ? (
        <ul className="text-muted-foreground grid gap-1 text-sm">
          {cells.slice(0, 5).map((c) => (
            <li key={`${c.x}-${c.y}`}>
              {c.level === 'high' ? 'High' : 'Medium'} risk: {explainCell(c)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
