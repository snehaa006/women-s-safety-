import { describe, expect, it } from 'vitest'

import type { Alert, ContactLink } from './api'
import { summarizeCircle } from './circle-status'

const alert = (over: Partial<Alert>): Alert => ({
  id: crypto.randomUUID(),
  contact_id: 'c-asha',
  recipient_name: 'Asha',
  channel: 'email',
  template: 'sos',
  status: 'queued',
  sent_at: null,
  last_error: null,
  ...over,
})

const link = (over: Partial<ContactLink>): ContactLink => ({
  id: 'l-asha',
  contact_id: 'c-asha',
  recipient_name: 'Asha',
  first_viewed_at: null,
  ...over,
})

describe('circle status', () => {
  it('shows each contact once, best news first', () => {
    const alerts = [
      alert({ status: 'sent', sent_at: '2026-10-03T10:00:00Z' }),
      alert({ contact_id: 'c-ravi', recipient_name: 'Ravi', status: 'sent' }),
      alert({
        contact_id: 'c-ravi',
        recipient_name: 'Ravi',
        channel: 'telegram',
        status: 'queued',
      }),
      alert({
        contact_id: 'c-mum',
        recipient_name: 'Mum',
        status: 'skipped',
        last_error: 'Email is not set up yet',
      }),
      alert({ template: 'reminder' }),
    ]
    const links = [
      link({ first_viewed_at: '2026-10-03T10:01:00Z' }),
      link({ id: 'l-ravi', contact_id: 'c-ravi', recipient_name: 'Ravi' }),
    ]
    const responders = [
      { name: 'Ravi', created_at: '2026-10-03T10:02:00Z', share_link_id: 'l-ravi' },
    ]

    const rows = summarizeCircle(alerts, links, responders)
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ['Asha', 'opened'],
      ['Ravi', 'responding'],
      ['Mum', 'problem'],
    ])
    expect(rows[2].detail).toBe('Email not sent: Email is not set up yet')
  })

  it('reports delivery per channel until the link is opened', () => {
    const rows = summarizeCircle(
      [
        alert({ status: 'sent', sent_at: '2026-10-03T10:00:00Z' }),
        alert({ channel: 'telegram', status: 'sending' }),
      ],
      [link({})],
      [],
    )
    expect(rows[0].state).toBe('sent')
    expect(rows[0].detail).toMatch(/^Email sent at .+ · Sending telegram…$/)
  })
})
