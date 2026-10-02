import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export function FullPageStatus({ children }: { children?: ReactNode }) {
  return (
    <div className="text-muted-foreground flex min-h-dvh items-center justify-center gap-2 p-6">
      {children ?? (
        <>
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          <span>Loading…</span>
        </>
      )}
    </div>
  )
}
