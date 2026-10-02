import { describe, expect, it } from 'vitest'

import { describeEntry } from './timeline'

const entry = (action: string, payload: Record<string, unknown> = {}) => ({
  seq: 1,
  occurred_at: '2026-10-02T10:00:00Z',
  action,
  actor_role: 'citizen',
  lat: null,
  lng: null,
  payload,
})

describe('timeline labels', () => {
  it('describes each step in plain language', () => {
    expect(describeEntry(entry('sos.triggered', { source: 'simulator' }))).toBe(
      'SOS sent from the virtual wearable',
    )
    expect(describeEntry(entry('location.batch', { pings: 12 }))).toBe('Location sealed: 12 points')
    expect(describeEntry(entry('contact.responding', { name: 'Asha' }))).toBe(
      "Asha said they're responding",
    )
    expect(describeEntry(entry('sos.resolved', { resolution: 'false_alarm' }))).toBe(
      'Ended as a false alarm',
    )
  })
})
