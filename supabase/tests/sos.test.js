// Phase 1: trusted circle, silent SOS, live location, PINs and live links.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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

const CP = { lat: 28.6315, lng: 77.2167 } // Connaught Place, New Delhi

async function sos(userId, args = {}) {
  return asUserCommitted(userId, async (c) => {
    const { rows } = await c.query(
      `select public.create_sos(p_client_id => $1, p_lat => $2, p_lng => $3, p_accuracy_m => $4)
         as r`,
      [args.clientId ?? null, args.lat ?? CP.lat, args.lng ?? CP.lng, args.accuracy ?? 12],
    )
    return rows[0].r
  })
}

async function resolve(userId, incidentId, pin = null) {
  return asUserCommitted(userId, async (c) => {
    const { rows } = await c.query('select public.resolve_incident($1, $2) as r', [incidentId, pin])
    return rows[0].r
  })
}

async function setPins(userId, sosPin, duressPin = null, currentPin = null) {
  return asUserCommitted(userId, async (c) => {
    const { rows } = await c.query('select public.set_sos_pins($1, $2, $3) as r', [
      sosPin,
      duressPin,
      currentPin,
    ])
    return rows[0].r
  })
}

async function incident(id) {
  const { rows } = await db.query('select * from public.incidents where id = $1', [id])
  return rows[0]
}

describe('trusted circle', () => {
  it('lets owners manage only their own contacts', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    await asUserCommitted(meera, (c) =>
      c.query(
        `insert into public.trusted_contacts (name, phone) values ('Meera''s mum', '+919800000001')`,
      ),
    )

    await asUser(priya, async (c) => {
      const added = await c.query(
        `insert into public.trusted_contacts (name, phone, relationship) values ('Asha', '+91 98000 00002', 'Sister')
         returning owner_id`,
      )
      assert.equal(added.rows[0].owner_id, priya)

      const visible = await c.query('select name from public.trusted_contacts')
      assert.deepEqual(
        visible.rows.map((r) => r.name),
        ['Asha'],
      )
      const edit = await c.query(
        `update public.trusted_contacts set name = 'x' where name = 'Meera''s mum'`,
      )
      assert.equal(edit.rowCount, 0)
    })
  })

  it('cannot add a contact for someone else', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    await asUser(priya, async (c) => {
      await assert.rejects(
        c.query(
          `insert into public.trusted_contacts (owner_id, name, phone) values ($1, 'x', '+919800000003')`,
          [meera],
        ),
        /permission denied/,
      )
    })
  })

  it('needs a phone number or an email', async () => {
    const priya = await createUser('Priya')
    await asUser(priya, async (c) => {
      await assert.rejects(
        c.query(`insert into public.trusted_contacts (name) values ('Nobody')`),
        /trusted_contacts_reachable/,
      )
    })
  })

  it('allows up to 10 contacts', async () => {
    const priya = await createUser('Priya')
    await asUser(priya, async (c) => {
      for (let i = 0; i < 10; i++) {
        await c.query(`insert into public.trusted_contacts (name, email) values ($1, $2)`, [
          `Contact ${i}`,
          `c${i}@example.test`,
        ])
      }
      await assert.rejects(
        c.query(
          `insert into public.trusted_contacts (name, email) values ('One more', 'x@example.test')`,
        ),
        /up to 10 trusted contacts/,
      )
    })
  })

  it('is hidden from anonymous visitors', async () => {
    await asAnon(async (c) => {
      await assert.rejects(c.query('select * from public.trusted_contacts'), /permission denied/)
    })
  })
})

describe('SOS', () => {
  it('creates an incident, a live link, the first location and a ledger entry', async () => {
    const priya = await createUser('Priya Sharma')
    const result = await sos(priya)
    assert.equal(result.created, true)
    assert.match(result.share_token, /^[A-Za-z0-9_-]{24}$/)

    const row = await incident(result.incident_id)
    assert.equal(row.citizen_id, priya)
    assert.equal(row.source, 'app')
    assert.equal(row.status, 'active')
    assert.equal(Number(row.last_lat), CP.lat)

    const pings = await db.query(
      'select count(*)::int as n from public.location_pings where incident_id = $1',
      [result.incident_id],
    )
    assert.equal(pings.rows[0].n, 1)

    const entries = await ledgerFor(result.incident_id)
    assert.equal(entries[0].action, 'sos.triggered')
    assert.equal(entries[0].actor_id, priya)
    assert.equal(Number(entries[0].lat), CP.lat)
  })

  it('keeps one active SOS per person', async () => {
    const priya = await createUser('Priya')
    const first = await sos(priya)
    const again = await sos(priya)
    assert.equal(again.incident_id, first.incident_id)
    assert.equal(again.created, false)
    assert.deepEqual(
      (await ledgerFor(first.incident_id)).map((e) => e.action),
      ['sos.triggered', 'incident.routed', 'sos.retriggered'],
    )
  })

  it('treats a retried request (same client id) as the same SOS', async () => {
    const priya = await createUser('Priya')
    const clientId = randomUUID()
    const first = await sos(priya, { clientId })
    const retry = await sos(priya, { clientId })
    assert.equal(retry.incident_id, first.incident_id)
    assert.deepEqual(
      (await ledgerFor(first.incident_id)).map((e) => e.action),
      ['sos.triggered', 'incident.routed'],
    )
  })

  it('needs a signed-in user', async () => {
    await asAnon(async (c) => {
      await assert.rejects(c.query('select public.create_sos()'), /permission denied/)
    })
  })

  it('records live location only for the owner while the SOS is active', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    const { incident_id } = await sos(priya)

    await asUserCommitted(priya, (c) =>
      c.query('select public.record_location($1, 28.632, 77.2175, 8)', [incident_id]),
    )
    assert.equal(Number((await incident(incident_id)).last_lat), 28.632)

    await asUser(meera, async (c) => {
      await assert.rejects(
        c.query('select public.record_location($1, 28.6, 77.2)', [incident_id]),
        /No such SOS/,
      )
    })
    await asUser(meera, async (c) => {
      const peek = await c.query('select * from public.location_pings where incident_id = $1', [
        incident_id,
      ])
      assert.equal(peek.rowCount, 0)
    })

    await resolve(priya, incident_id)
    await asUser(priya, async (c) => {
      await assert.rejects(
        c.query('select public.record_location($1, 28.6, 77.2)', [incident_id]),
        /This SOS has ended/,
      )
    })
  })

  it('seals a minute of location pings in one ledger entry', async () => {
    const priya = await createUser('Priya')
    const { incident_id } = await sos(priya)
    await asUserCommitted(priya, (c) =>
      c.query('select public.record_location($1, 28.6320, 77.2170)', [incident_id]),
    )
    // Pretend the batch started over a minute ago.
    await db.query(
      `update public.incidents set ledger_batch_at = now() - interval '61 seconds' where id = $1`,
      [incident_id],
    )
    await asUserCommitted(priya, (c) =>
      c.query('select public.record_location($1, 28.6325, 77.2172)', [incident_id]),
    )

    const batch = (await ledgerFor(incident_id)).find((e) => e.action === 'location.batch')
    assert.ok(batch, 'a location.batch entry was written')
    assert.equal(batch.payload.pings, 3)
    assert.match(batch.payload.sha256, /^[0-9a-f]{64}$/)
  })
})

describe("I'm safe", () => {
  it('needs no PIN until one is set, then expires the live link a day later', async () => {
    const priya = await createUser('Priya')
    const { incident_id } = await sos(priya)
    assert.deepEqual(await resolve(priya, incident_id), { status: 'resolved', keep_sharing: false })

    const row = await incident(incident_id)
    assert.equal(row.status, 'resolved')
    assert.equal(row.resolution, 'safe')
    const link = await db.query(
      `select expires_at - now() > interval '23 hours' as later from public.share_links where incident_id = $1`,
      [incident_id],
    )
    assert.equal(link.rows[0].later, true)
    assert.equal((await ledgerFor(incident_id)).at(-1).action, 'sos.resolved')
  })

  it('needs the SOS PIN once set, and locks after five wrong tries', async () => {
    const priya = await createUser('Priya')
    assert.deepEqual(await setPins(priya, '2580', '1470'), { status: 'saved' })
    const { incident_id } = await sos(priya)

    assert.equal((await resolve(priya, incident_id, '0000')).status, 'wrong_pin')
    assert.equal((await resolve(priya, incident_id)).status, 'wrong_pin')
    assert.equal((await incident(incident_id)).status, 'active')

    for (let i = 0; i < 2; i++) await resolve(priya, incident_id, '1111')
    assert.equal((await resolve(priya, incident_id, '1111')).status, 'locked')
    // Even the right PIN waits out the lock.
    assert.equal((await resolve(priya, incident_id, '2580')).status, 'locked')

    await db.query(`delete from private.pin_failures where user_id = $1`, [priya])
    assert.equal((await resolve(priya, incident_id, '2580')).status, 'resolved')
    assert.equal((await incident(incident_id)).status, 'resolved')
  })

  it('with the duress PIN, looks resolved to her but stays active for everyone else', async () => {
    const priya = await createUser('Priya')
    await setPins(priya, '2580', '1470')
    const { incident_id, share_token } = await sos(priya)

    assert.deepEqual(await resolve(priya, incident_id, '1470'), {
      status: 'resolved',
      keep_sharing: true,
    })
    const row = await incident(incident_id)
    assert.equal(row.status, 'active')
    assert.ok(row.closed_by_citizen_at)

    // Her phone keeps sending location quietly.
    await asUserCommitted(priya, (c) =>
      c.query('select public.record_location($1, 28.64, 77.22)', [incident_id]),
    )
    // Her timeline shows a normal "resolved" and nothing after it.
    await db.query(
      `update public.incidents set ledger_batch_at = now() - interval '61 seconds' where id = $1`,
      [incident_id],
    )
    await asUserCommitted(priya, (c) =>
      c.query('select public.record_location($1, 28.641, 77.221)', [incident_id]),
    )
    await asUser(priya, async (c) => {
      const { rows } = await c.query('select action, payload from public.incident_timeline($1)', [
        incident_id,
      ])
      assert.deepEqual(
        rows.map((r) => r.action),
        ['sos.triggered', 'incident.routed', 'sos.resolved'],
      )
      assert.deepEqual(rows[2].payload, { resolution: 'safe' })
    })
    // Her contacts are told it is still active.
    const view = await asAnon(async (c) => {
      const { rows } = await c.query('select public.view_share_link($1) as v', [share_token])
      return rows[0].v
    })
    assert.equal(view.status, 'active')
    assert.equal(view.closed_under_duress, true)

    // Pressing SOS again reopens the same incident.
    const again = await sos(priya)
    assert.equal(again.incident_id, incident_id)
    assert.equal((await incident(incident_id)).closed_by_citizen_at, null)
  })
})

describe('SOS PINs', () => {
  it('must be 4 to 6 digits and differ from each other', async () => {
    const priya = await createUser('Priya')
    const cases = [
      [`select public.set_sos_pins('123')`, /4 to 6 digits/],
      [`select public.set_sos_pins('12a4')`, /4 to 6 digits/],
      [`select public.set_sos_pins('1234', '99')`, /4 to 6 digits/],
      [`select public.set_sos_pins('1234', '1234')`, /must differ from the SOS PIN/],
    ]
    for (const [sql, error] of cases) {
      await asUser(priya, (c) => assert.rejects(c.query(sql), error))
    }
  })

  it('needs the current PIN to change them, and never exposes the hashes', async () => {
    const priya = await createUser('Priya')
    await setPins(priya, '2580')
    assert.deepEqual(await setPins(priya, '9999', null, '0000'), { status: 'wrong_pin' })
    assert.deepEqual(await setPins(priya, '9999', '7777', '2580'), { status: 'saved' })

    await asUser(priya, async (c) => {
      const { rows } = await c.query('select public.sos_pin_status() as s')
      assert.deepEqual(rows[0].s, { has_pin: true, has_duress_pin: true })
      await assert.rejects(c.query('select * from private.sos_pins'), /permission denied/)
    })
  })
})

describe('live link', () => {
  it('shows a trusted contact the live status without an account', async () => {
    const priya = await createUser('Priya Sharma')
    const { incident_id, share_token } = await sos(priya)
    await asUserCommitted(priya, (c) =>
      c.query('select public.record_location($1, 28.632, 77.2175, 9)', [incident_id]),
    )

    const view = await asAnon(async (c) => {
      const { rows } = await c.query('select public.view_share_link($1) as v', [share_token])
      return rows[0].v
    })
    assert.equal(view.citizen_name, 'Priya')
    assert.equal(view.status, 'active')
    assert.equal(view.closed_under_duress, false)
    assert.equal(view.last_location.lat, 28.632)
    assert.deepEqual(view.path, [
      [CP.lng, CP.lat],
      [77.2175, 28.632],
    ])
    assert.equal(view.incident_id, undefined, 'internal ids stay private')
  })

  it('records the first view in the ledger, once', async () => {
    const priya = await createUser('Priya')
    const { incident_id, share_token } = await sos(priya)
    for (let i = 0; i < 3; i++) {
      await asAnon((c) => c.query('select public.view_share_link($1)', [share_token]))
    }
    const opened = (await ledgerFor(incident_id)).filter((e) => e.action === 'share_link.opened')
    assert.equal(opened.length, 1)
  })

  it('returns nothing for an unknown or expired token', async () => {
    const priya = await createUser('Priya')
    const { incident_id, share_token } = await sos(priya)
    await asAnon(async (c) => {
      const unknown = await c.query(`select public.view_share_link('not-a-real-token') as v`)
      assert.equal(unknown.rows[0].v, null)
    })
    await resolve(priya, incident_id)
    await db.query(
      `update public.share_links set expires_at = now() - interval '1 minute' where incident_id = $1`,
      [incident_id],
    )
    await asAnon(async (c) => {
      const expired = await c.query('select public.view_share_link($1) as v', [share_token])
      assert.equal(expired.rows[0].v, null)
    })
  })

  it("lets a contact say they're responding, and the citizen sees it", async () => {
    const priya = await createUser('Priya')
    const { incident_id, share_token } = await sos(priya)
    await asAnon((c) =>
      c.query(`select public.respond_to_share_link($1, 'Asha (sister)')`, [share_token]),
    )

    await asUser(priya, async (c) => {
      const { rows } = await c.query(
        'select name from public.incident_responders where incident_id = $1',
        [incident_id],
      )
      assert.deepEqual(rows, [{ name: 'Asha (sister)' }])
    })
    const entry = (await ledgerFor(incident_id)).find((e) => e.action === 'contact.responding')
    assert.deepEqual(entry.payload, { name: 'Asha (sister)' })

    await resolve(priya, incident_id)
    await asAnon(async (c) => {
      await assert.rejects(
        c.query(`select public.respond_to_share_link($1, 'Late')`, [share_token]),
        /This SOS has ended/,
      )
    })
  })

  it("keeps a citizen's incidents, pings, links and responders from other users", async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    await sos(priya)
    await asUser(meera, async (c) => {
      for (const table of ['incidents', 'location_pings', 'share_links', 'incident_responders']) {
        const { rowCount } = await c.query(`select 1 from public.${table}`)
        assert.equal(rowCount, 0, table)
      }
    })
    await asAnon(async (c) => {
      await assert.rejects(c.query('select * from public.incidents'), /permission denied/)
    })
  })
})
