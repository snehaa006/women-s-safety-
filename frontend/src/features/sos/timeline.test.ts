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

  it('describes alerts to the circle, including what was not sent and why', () => {
    expect(describeEntry(entry('alerts.queued', { alerts: 3 }))).toBe(
      'Alerting your circle: 3 messages',
    )
    expect(
      describeEntry(entry('alert.sent', { channel: 'telegram', template: 'sos', to: 'Asha' })),
    ).toBe('Telegram message alert sent to Asha')
    expect(
      describeEntry(
        entry('alert.skipped', { channel: 'email', to: 'Ravi', reason: 'Email is not set up yet' }),
      ),
    ).toBe('Email to Ravi not sent: Email is not set up yet')
    expect(describeEntry(entry('sos.no_response', { after_s: 120, reminders: 2 }))).toBe(
      'No one responded in 2 minutes: reminded your circle',
    )
    expect(describeEntry(entry('share_link.opened', { name: 'Asha' }))).toBe(
      'Asha opened your live link',
    )
    expect(describeEntry(entry('sos.triggered', { source: 'app', delayed_s: 240 }))).toBe(
      'SOS sent from the app (queued offline, delivered later)',
    )
  })

  it('describes the police response', () => {
    expect(describeEntry(entry('incident.routed', { name: 'Tilak Marg PS' }))).toBe(
      'Sent to Tilak Marg PS',
    )
    expect(
      describeEntry(entry('incident.escalated', { to: 'parent', org_name: 'Control Room' })),
    ).toBe('Not acknowledged in time: raised to Control Room')
    expect(describeEntry(entry('incident.escalated', { to: 'parent', oversight: true }))).toBe(
      'Still not acknowledged: oversight notified',
    )
    expect(describeEntry(entry('incident.dispatched', { unit: 'CP-PCR-1', eta_min: 6 }))).toBe(
      'CP-PCR-1 sent, ETA 6 min',
    )
    expect(describeEntry(entry('incident.closed', { code: 'false_alarm' }))).toBe(
      'Closed by police: false alarm',
    )
  })
})
