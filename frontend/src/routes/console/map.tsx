import { PageHeader } from '@/components/page-header'
import { BoardMap } from '@/features/console/board-map'
import { useBoard } from '@/features/console/use-console'

export function Component() {
  const { board } = useBoard()
  return (
    <div className="grid gap-4">
      <PageHeader title="Map" description="Every active SOS you can see, updated live." />
      <BoardMap incidents={board.data ?? []} className="h-[70dvh]" />
    </div>
  )
}
