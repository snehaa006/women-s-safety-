import { describe, expect, it } from 'vitest'

import { homePathForRole, resolvePostLoginPath } from './roles'

describe('homePathForRole', () => {
  it('sends citizens to the app and staff to the console', () => {
    expect(homePathForRole('citizen')).toBe('/app')
    expect(homePathForRole('officer')).toBe('/console')
    expect(homePathForRole('admin')).toBe('/console')
  })
})

describe('resolvePostLoginPath', () => {
  it('honors an allowed internal path', () => {
    expect(resolvePostLoginPath('/app/vault', 'citizen')).toBe('/app/vault')
    expect(resolvePostLoginPath('/console/map', 'supervisor')).toBe('/console/map')
  })

  it('falls back to home for areas the role may not open', () => {
    expect(resolvePostLoginPath('/console', 'citizen')).toBe('/app')
    expect(resolvePostLoginPath('/app/report', 'officer')).toBe('/console')
  })

  it('ignores external or missing targets', () => {
    expect(resolvePostLoginPath('https://evil.example', 'citizen')).toBe('/app')
    expect(resolvePostLoginPath('//evil.example', 'citizen')).toBe('/app')
    expect(resolvePostLoginPath(null, 'officer')).toBe('/console')
    expect(resolvePostLoginPath('/login', 'citizen')).toBe('/app')
  })
})
