import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'

import { routes } from '@/app/router'
import type { AuthClient } from '@/features/auth/auth-client'
import { AuthProvider } from '@/features/auth/auth-provider'

export function renderRoute(path: string, client: AuthClient) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <AuthProvider client={client}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { router, ...view }
}
