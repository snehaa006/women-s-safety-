import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enqueueSos, flushOutbox, isNetworkError, resetOutbox, type QueuedSos } from './outbox'

const item = (clientId: string, occurredAt: string): QueuedSos => ({
  clientId,
  occurredAt,
  fix: { lat: 28.6315, lng: 77.2167, accuracy: 8, speed: null, heading: null, at: 0 },
  batteryPct: 40,
})

beforeEach(() => resetOutbox())

describe('offline SOS queue', () => {
  it('tells network failures from server errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
    expect(isNetworkError(new Error('This SOS has ended'))).toBe(false)
  })

  it('keeps an SOS until it is sent, then sends it with its original time', async () => {
    await enqueueSos(item('a', '2026-10-03T10:00:00.000Z'))
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await flushOutbox(offline)).toBe(1)

    const online = vi
      .fn()
      .mockResolvedValue({ incident_id: 'inc-1', share_token: 't', created: true })
    expect(await flushOutbox(online)).toBe(0)
    expect(online).toHaveBeenCalledWith('a', item('a', '').fix, 40, '2026-10-03T10:00:00.000Z')
  })

  it('drops an SOS the server says is more than a day old', async () => {
    await enqueueSos(item('old', '2026-10-01T10:00:00.000Z'))
    const send = vi.fn().mockRejectedValue(new Error('This queued SOS is more than a day old'))
    expect(await flushOutbox(send)).toBe(0)
  })
})
