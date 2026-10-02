// The wearable API: pairing, HMAC-signed events, replay protection, and SOS from a device.
// The virtual wearable in the app and the future ESP32 call exactly this.

import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'

import {
  asAnon,
  asUser,
  asUserCommitted,
  createUser,
  db,
  ledgerFor,
  setupTestDatabase,
} from './helpers.js'

setupTestDatabase()

async function pair(userId, name = 'Virtual keychain', kind = 'simulator') {
  return asUserCommitted(userId, async (c) => {
    const { rows } = await c.query('select public.register_device($1, $2) as r', [name, kind])
    return { deviceId: rows[0].r.device_id, secret: rows[0].r.secret }
  })
}

function body(type, fields = {}) {
  return JSON.stringify({
    type,
    ts: Math.floor(Date.now() / 1000),
    nonce: randomBytes(8).toString('hex'),
    ...fields,
  })
}

function sign(secret, text) {
  return createHmac('sha256', secret).update(text).digest('hex')
}

/** Sends an event the way a device does: no session, just the publishable key (role anon). */
async function send(device, text, signature = sign(device.secret, text)) {
  return asAnon(async (c) => {
    const { rows } = await c.query('select public.device_event($1, $2, $3) as r', [
      device.deviceId,
      text,
      signature,
    ])
    return rows[0].r
  })
}

describe('pairing', () => {
  it('returns a secret once and keeps it out of reach', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    const device = await pair(priya)
    assert.match(device.secret, /^[0-9a-f]{64}$/)

    await asUser(priya, async (c) => {
      const { rows } = await c.query('select name, kind, status from public.devices')
      assert.deepEqual(rows, [{ name: 'Virtual keychain', kind: 'simulator', status: 'active' }])
      await assert.rejects(c.query('select * from private.device_secrets'), /permission denied/)
    })
    await asUser(meera, async (c) => {
      const { rowCount } = await c.query('select 1 from public.devices')
      assert.equal(rowCount, 0)
    })
    assert.equal((await ledgerFor(device.deviceId))[0].action, 'device.registered')
  })

  it('allows up to 5 devices', async () => {
    const priya = await createUser('Priya')
    for (let i = 0; i < 5; i++) await pair(priya, `Device ${i}`)
    await asUser(priya, async (c) => {
      await assert.rejects(c.query(`select public.register_device('Sixth')`), /up to 5 devices/)
    })
  })

  it('stops accepting the old secret after a reset', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    const fresh = await asUserCommitted(priya, async (c) => {
      const { rows } = await c.query('select public.reset_device_secret($1) as r', [
        device.deviceId,
      ])
      return { deviceId: device.deviceId, secret: rows[0].r.secret }
    })
    await assert.rejects(send(device, body('heartbeat')), /Bad signature/)
    assert.equal((await send(fresh, body('heartbeat'))).accepted, true)
  })
})

describe('device events', () => {
  it('starts an SOS from a long press, like the app button', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    const result = await send(
      device,
      body('sos', { lat: 28.6315, lng: 77.2167, accuracy_m: 15, battery_pct: 81 }),
    )
    assert.equal(result.accepted, true)
    assert.ok(result.incident_id)

    const { rows } = await db.query('select * from public.incidents where id = $1', [
      result.incident_id,
    ])
    assert.equal(rows[0].citizen_id, priya)
    assert.equal(rows[0].source, 'simulator')
    assert.equal(rows[0].device_id, device.deviceId)
    assert.equal(rows[0].last_battery_pct, 81)

    const [entry] = await ledgerFor(result.incident_id)
    assert.equal(entry.action, 'sos.triggered')
    assert.equal(entry.actor_id, priya, 'the owner is the actor')
    assert.equal(entry.device_id, device.deviceId)

    const event = await db.query(
      'select type, incident_id from public.device_events where id = $1',
      [result.event_id],
    )
    assert.deepEqual(event.rows[0], { type: 'sos', incident_id: result.incident_id })
  })

  it('marks real hardware incidents as source device', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya, 'Keychain', 'keychain')
    const { incident_id } = await send(device, body('sos'))
    const { rows } = await db.query('select source from public.incidents where id = $1', [
      incident_id,
    ])
    assert.equal(rows[0].source, 'device')
  })

  it('adds location to the active SOS, and just tracks the device otherwise', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)

    const idle = await send(device, body('location', { lat: 28.62, lng: 77.21 }))
    assert.equal(idle.incident_id, null)
    const tracked = await db.query('select last_lat from public.devices where id = $1', [
      device.deviceId,
    ])
    assert.equal(Number(tracked.rows[0].last_lat), 28.62)

    const { incident_id } = await send(device, body('sos', { lat: 28.6315, lng: 77.2167 }))
    const moving = await send(device, body('location', { lat: 28.632, lng: 77.2175 }))
    assert.equal(moving.incident_id, incident_id)
    const pings = await db.query(
      `select source, lat from public.location_pings where incident_id = $1 order by id`,
      [incident_id],
    )
    assert.deepEqual(
      pings.rows.map((r) => [r.source, Number(r.lat)]),
      [
        ['simulator', 28.6315],
        ['simulator', 28.632],
      ],
    )
  })

  it('flags tamper and low battery in the ledger', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    await send(device, body('tamper', { reason: 'case_opened' }))
    await send(device, body('battery_low', { battery_pct: 9 }))

    const { rows } = await db.query(
      'select status, battery_pct from public.devices where id = $1',
      [device.deviceId],
    )
    assert.deepEqual(rows[0], { status: 'tamper', battery_pct: 9 })
    const actions = (await ledgerFor(device.deviceId)).map((e) => [e.action, e.payload])
    assert.deepEqual(actions.slice(1), [
      ['device.tamper', { reason: 'case_opened' }],
      ['device.battery_low', { battery_pct: 9 }],
    ])
  })

  it('stores gestures and heartbeats with their extra fields', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    await send(device, body('gesture', { clicks: 2 }))
    await send(device, body('heartbeat', { battery_pct: 64, signal: -71 }))
    await asUser(priya, async (c) => {
      const { rows } = await c.query(
        'select type, battery_pct, payload from public.device_events order by id',
      )
      assert.deepEqual(rows, [
        { type: 'gesture', battery_pct: null, payload: { clicks: 2 } },
        { type: 'heartbeat', battery_pct: 64, payload: { signal: -71 } },
      ])
    })
  })
})

describe('device authentication', () => {
  it('rejects a wrong signature, an unknown device and a tampered body', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    const text = body('sos')

    await assert.rejects(send(device, text, 'a'.repeat(64)), /Bad signature/)
    await assert.rejects(
      send({ deviceId: '00000000-0000-4000-8000-00000000dead', secret: device.secret }, text),
      /Unknown device/,
    )
    const signature = sign(device.secret, text)
    await assert.rejects(
      send(device, text.replace('"sos"', '"tamper"'), signature),
      /Bad signature/,
    )

    const { rowCount } = await db.query('select 1 from public.incidents where citizen_id = $1', [
      priya,
    ])
    assert.equal(rowCount, 0, 'nothing was triggered')
  })

  it('rejects a replayed request', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    const text = body('heartbeat')
    await send(device, text)
    await assert.rejects(send(device, text), /Replayed request/)
  })

  it('rejects timestamps more than 5 minutes off', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    const stale = body('heartbeat', { ts: Math.floor(Date.now() / 1000) - 600 })
    await assert.rejects(send(device, stale), /more than 5 minutes/)
  })

  it('validates the body', async () => {
    const priya = await createUser('Priya')
    const device = await pair(priya)
    await assert.rejects(send(device, 'not json'), /not valid JSON/)
    await assert.rejects(send(device, body('explode')), /Unknown event type/)
    await assert.rejects(send(device, body('sos', { nonce: 'short' })), /nonce/)
    await assert.rejects(send(device, body('sos', { lat: 28.6 })), /lat and lng/)
    await assert.rejects(send(device, body('sos', { lat: 128.6, lng: 77.2 })), /out of range/)
  })
})
