// @vitest-environment node
/// <reference types="node" />
import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEMO_ROUTE, DEMO_WAYPOINTS, interpolateRoute } from './demo-route'
import { DeviceApiError, eventBody, sendDeviceEvent, signBody } from './protocol'
import { distanceM } from '@/features/sos/geo'

const secret = 'a3f1'.repeat(16)
const device = { deviceId: '6f1c2c43-6a59-4a39-9d1e-3b3f0c1b2a10', secret }
const api = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }

afterEach(() => vi.unstubAllGlobals())

describe('signBody', () => {
  it('matches HMAC-SHA256 keyed with the secret text, as Postgres computes it', async () => {
    const body = '{"type":"sos","ts":1790950000,"nonce":"0123456789abcdef"}'
    const expected = createHmac('sha256', secret).update(body).digest('hex')
    expect(await signBody(secret, body)).toBe(expected)
  })
})

describe('eventBody', () => {
  it('carries type, Unix seconds, a fresh nonce and the given fields', () => {
    const a = JSON.parse(
      eventBody('location', { lat: 28.63, lng: 77.22, battery_pct: 80 }, 1790950000123),
    )
    const b = JSON.parse(eventBody('location', {}, 1790950000123))
    expect(a).toMatchObject({
      type: 'location',
      ts: 1790950000,
      lat: 28.63,
      lng: 77.22,
      battery_pct: 80,
    })
    expect(a.nonce).toMatch(/^[0-9a-f]{16}$/)
    expect(a.nonce).not.toBe(b.nonce)
  })

  it('leaves out fields that are undefined', () => {
    expect(JSON.parse(eventBody('heartbeat', { lat: undefined }))).not.toHaveProperty('lat')
  })
})

describe('sendDeviceEvent', () => {
  it('posts the signed body with only the publishable key, like the hardware', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ accepted: true, event_id: 7, incident_id: 'inc-1' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendDeviceEvent(api, device, 'sos', { lat: 28.6328, lng: 77.2196 })
    expect(result).toEqual({ accepted: true, event_id: 7, incident_id: 'inc-1' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/device_event')
    expect(init.headers).toEqual({
      apikey: 'sb_publishable_test',
      'Content-Type': 'application/json',
    })
    const sent = JSON.parse(init.body as string)
    expect(sent.p_device_id).toBe(device.deviceId)
    expect(JSON.parse(sent.p_body)).toMatchObject({ type: 'sos', lat: 28.6328, lng: 77.2196 })
    expect(sent.p_signature).toBe(createHmac('sha256', secret).update(sent.p_body).digest('hex'))
  })

  it("surfaces the server's reason when an event is rejected", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ message: 'Bad signature' }, { status: 403 })),
    )
    const error = await sendDeviceEvent(api, device, 'heartbeat').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeviceApiError)
    expect(error).toMatchObject({ message: 'Bad signature', status: 403 })
  })
})

describe('demo route', () => {
  it('starts and ends at the waypoints and moves about 20 m per step', () => {
    expect(DEMO_ROUTE[0]).toEqual(DEMO_WAYPOINTS[0])
    expect(DEMO_ROUTE.at(-1)).toEqual(DEMO_WAYPOINTS.at(-1))
    for (let i = 1; i < DEMO_ROUTE.length; i++) {
      const [aLng, aLat] = DEMO_ROUTE[i - 1]
      const [bLng, bLat] = DEMO_ROUTE[i]
      const step = distanceM({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng })
      expect(step).toBeGreaterThan(10)
      expect(step).toBeLessThan(30)
    }
  })

  it('keeps a straight segment in one step when it is shorter than the step size', () => {
    const route = interpolateRoute(
      [
        [77.2, 28.6],
        [77.2001, 28.6],
      ],
      20,
    )
    expect(route).toEqual([
      [77.2, 28.6],
      [77.2001, 28.6],
    ])
  })
})
