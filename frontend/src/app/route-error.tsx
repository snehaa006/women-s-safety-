import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

import { Button } from '@/components/ui/button'

export function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Something went wrong.'

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">This page failed to load</h1>
      <p className="text-muted-foreground">{message}</p>
      <p className="text-muted-foreground text-sm">If you need help right now, call 112.</p>
      <Button asChild size="touch">
        <Link to="/">Back to start</Link>
      </Button>
    </main>
  )
}
