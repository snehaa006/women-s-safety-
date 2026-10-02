import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

export function Component() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 p-6 text-center">
      <p className="text-muted-foreground font-mono text-sm">404</p>
      <h1 className="text-2xl font-bold">This page doesn't exist</h1>
      <Button asChild size="touch">
        <Link to="/">Back to start</Link>
      </Button>
    </main>
  )
}
