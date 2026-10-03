import { describe, expect, it } from 'vitest'

import type { PoliceResponse } from './api'
import { describePolice } from './police-status'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const base: PoliceResponse = {
  org_name: 'Connaught Place Police Station',
  org_phone: '011 2334 0101',
  state: 'unacknowledged',
  acknowledged_at: null,
  unit: null,
  eta_at: null,
  arrived_at: null,
  raised_to_control_room: false,
}

describe('describePolice', () => {
  it('says the station was alerted, and when the control room was too', () => {
    expect(describePolice(base, NOW).detail).toBe(
      'Sent to Connaught Place Police Station. Waiting for an officer to acknowledge.',
    )
    expect(describePolice({ ...base, raised_to_control_room: true }, NOW).detail).toMatch(
      /district control room was alerted too/,
    )
  })

  it('shows the unit and its ETA', () => {
    const status = describePolice(
      { ...base, state: 'responding', unit: 'CP-PCR-1', eta_at: '2026-10-03T12:06:00Z' },
      NOW,
    )
    expect(status.title).toBe('Officer on the way')
    expect(status.detail).toBe(
      'CP-PCR-1 from Connaught Place Police Station, arriving in about 6 minutes.',
    )
    expect(
      describePolice(
        { ...base, state: 'responding', unit: 'X', eta_at: '2026-10-03T11:59:00Z' },
        NOW,
      ).detail,
    ).toMatch(/any moment now/)
  })

  it('covers acknowledged and on scene', () => {
    expect(describePolice({ ...base, state: 'acknowledged' }, NOW).title).toBe(
      'Police have seen the SOS',
    )
    expect(describePolice({ ...base, state: 'on_scene', unit: 'CP-PCR-1' }, NOW).detail).toBe(
      'CP-PCR-1 from Connaught Place Police Station has arrived.',
    )
  })
})
