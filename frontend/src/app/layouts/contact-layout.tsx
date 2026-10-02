import { Outlet } from 'react-router'

import { Brand } from '@/components/brand'

/** Trusted contacts open a live link without an account, so this shell has no navigation. */
export function ContactLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center px-4">
          <Brand />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
