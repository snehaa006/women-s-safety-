import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom has no WebGL, so screens render a stand-in for the map.
vi.mock('@/features/map/lazy-map', () => ({
  LazyMap: ({ label }: { label?: string }) => <div role="img" aria-label={label ?? 'Map'} />,
}))

afterEach(() => cleanup())
