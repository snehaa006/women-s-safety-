// Phase 1 part B: automatic alerts to the circle, the Cron tick (with time travel), Telegram
// linking, live updates over Realtime, queued SOS times and nearby safe points.

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import {
  asAnon,
  asServiceRole,
  asUser,
  asUserCommitted,
  createUser,
  db,
  ledgerFor,
  setupTestDatabase,
} from './helpers.js'

setupTestDatabase()

const CP = { lat: 28.6315, lng: 77.2167 } // Connaught Place, New Delhi

async function sos(userId, extra = {}) {
  return asUserCommitted(userId, async (c) => {
    const { rows } = await c.query(
      `select public.create_sos(p_lat => $1, p_lng => $2, p_occurred_at => $3) as r`,
      [CP.lat, CP.lng, extra.occurredAt ?? null],
    )
    return rows[0].r
  })
}

async function addContact(userId, fields) {
  return asUserCommitted(userId, async (c) => {
    const { rows } = await c.query(
      `insert into public.trusted_contacts (name, phone, email, priority)
       values ($1, $2, $3, $4) returning id, telegram_code`,
      [fields.name, fields.phone ?? null, fields.email ?? null, fields.priority ?? 1],
    )
    return rows[0]
  })
}

async function linkTelegram(code, chatId, username = 'asha_t') {
  return asServiceRole(async (c) => {
    const { rows } = await c.query('select public.link_telegram($1, $2, $3) as r', [
      code,
      chatId,
      username,
    ])
    return rows[0].r
  })
}

/** A citizen with three contacts: email only, email + Telegram, phone only. */
async function citizenWithCircle(name = 'Priya Sharma') {
  const citizen = await createUser(name)
  const asha = await addContact(citizen, { name: 'Asha', email: 'asha@example.test', priority: 1 })
  const ravi = await addContact(citizen, { name: 'Ravi', email: 'ravi@example.test', priority: 2 })
  await addContact(citizen, { name: 'Mum', phone: '+919800000001', priority: 3 })
  await linkTelegram(ravi.telegram_code, 424242)
  return { citizen, asha: asha.id, ravi: ravi.id }
}

async function alertsFor(incidentId) {
  const { rows } = await db.query(
    `select a.*, l.token as link_token from public.alerts a
     left join public.share_links l on l.id = a.share_link_id
     where a.incident_id = $1 order by a.created_at, a.recipient_name, a.channel`,
    [incidentId],
  )
  return rows
}

async function claim(limit = 25) {
  return asServiceRole(async (c) => (await c.query('select * from public.claim_alerts($1)', [limit])).rows)
}

async function finish(alertId, outcome, opts = {}) {
  return asServiceRole(async (c) => {
    const { rows } = await c.query('select public.finish_alert($1, $2, $3, $4, $5) as r', [
      alertId,
      outcome,
      opts.ref ?? null,
      opts.error ?? null,
      opts.retry ?? false,
    ])
    return rows[0].r
  })
}

async function tick(minutesAhead = 0) {
  const { rows } = await db.query(
    `select private.tick(now() + make_interval(mins => $1)) as r`,
    [minutesAhead],
  )
  return rows[0].r
}

// Every test starts with an empty queue: earlier tests' alerts and timers don't leak in.
beforeEach(async () => {
  await db.query(`update public.alerts set status = 'cancelled' where status in ('queued', 'sending')`)
  await db.query(`update private.jobs set status = 'done' where status = 'pending'`)
})

async function clearQueue() {
  await db.query(`update public.alerts set status = 'cancelled' where status = 'queued'`)
}

describe('alerts to the circle', () => {
  it('queues one alert per contact and channel, with a live link for each contact', async () => {
    const { citizen, asha, ravi } = await citizenWithCircle()
    const before = (await db.query('select count(*)::int as n from net.requests')).rows[0].n
    const { incident_id, share_token } = await sos(citizen)

    const alerts = await alertsFor(incident_id)
    assert.deepEqual(
      alerts.map((a) => [a.recipient_name, a.channel, a.template, a.level, a.status]),
      [
        ['Asha', 'email', 'sos', 0, 'queued'],
        ['Ravi', 'email', 'sos', 0, 'queued'],
        ['Ravi', 'telegram', 'sos', 0, 'queued'],
      ],
    )
    assert.equal(alerts[0].contact_id, asha)
    assert.equal(alerts[1].contact_id, ravi)
    assert.equal(alerts[1].link_token, alerts[2].link_token, 'one link per contact')
    assert.notEqual(alerts[0].link_token, alerts[1].link_token)
    assert.ok(![alerts[0].link_token, alerts[1].link_token].includes(share_token))

    // The SOS still returns her own shareable link.
    const shared = await db.query(
      `select audience from public.share_links where token = $1`,
      [share_token],
    )
    assert.equal(shared.rows[0].audience, 'shared')

    const queued = (await ledgerFor(incident_id)).find((e) => e.action === 'alerts.queued')
    assert.deepEqual(queued.payload, { alerts: 3, level: 0 })
    assert.equal(queued.actor_id, citizen)

    // The notify function was asked to run, in the same transaction as the SOS.
    const requests = await db.query('select url from net.requests order by id offset $1', [before])
    assert.deepEqual(
      requests.rows.map((r) => r.url),
      ['http://kong:8000/functions/v1/notify'],
    )

    const job = await db.query(
      `select kind, run_at - now() > interval '110 seconds' as later from private.jobs
       where payload ->> 'incident_id' = $1 and kind = 'sos.reminder'`,
      [incident_id],
    )
    assert.deepEqual(job.rows, [{ kind: 'sos.reminder', later: true }])
    await clearQueue()
  })

  it('sends nothing automatic when no contact has an email or Telegram', async () => {
    const citizen = await createUser('Meera')
    await addContact(citizen, { name: 'Dad', phone: '+919800000009' })
    const { incident_id } = await sos(citizen)
    assert.equal((await alertsFor(incident_id)).length, 0)
    assert.ok(!(await ledgerFor(incident_id)).some((e) => e.action === 'alerts.queued'))
  })

  it('lets the citizen read her own alerts, and nobody else', async () => {
    const { citizen } = await citizenWithCircle()
    const other = await createUser('Other')
    const { incident_id } = await sos(citizen)
    await asUser(citizen, async (c) => {
      const { rowCount } = await c.query('select 1 from public.alerts where incident_id = $1', [
        incident_id,
      ])
      assert.equal(rowCount, 3)
    })
    await asUser(other, async (c) => {
      const { rowCount } = await c.query('select 1 from public.alerts')
      assert.equal(rowCount, 0)
      await assert.rejects(c.query('select * from public.claim_alerts()'), /permission denied/)
    })
    await asAnon(async (c) => {
      await assert.rejects(c.query('select * from public.alerts'), /permission denied/)
    })
    await clearQueue()
  })
})

describe('notify function contract (claim and finish)', () => {
  it('hands out each due alert once, with the address and the contact link', async () => {
    const { citizen } = await citizenWithCircle('Priya Sharma')
    await asUserCommitted(citizen, (c) =>
      c.query(`update public.profiles set phone = '+919876543210' where id = $1`, [citizen]),
    )
    const { incident_id } = await sos(citizen)

    const claimed = await claim()
    assert.equal(claimed.length, 3)
    const telegram = claimed.find((a) => a.channel === 'telegram')
    assert.equal(telegram.address, '424242')
    const email = claimed.find((a) => a.recipient_name === 'Asha')
    assert.equal(email.address, 'asha@example.test')
    assert.equal(email.citizen_name, 'Priya')
    assert.equal(email.citizen_phone, '+919876543210')
    assert.equal(email.template, 'sos')
    assert.equal(email.incident_status, 'active')
    assert.equal(Number(email.lat), CP.lat)
    assert.match(email.link_token, /^[A-Za-z0-9_-]{24}$/)
    assert.equal(email.attempts, 1)

    assert.equal((await claim()).length, 0, 'claimed alerts are not handed out twice')
    const statuses = (await alertsFor(incident_id)).map((a) => a.status)
    assert.deepEqual(statuses, ['sending', 'sending', 'sending'])

    for (const alert of claimed) await finish(alert.alert_id, 'sent', { ref: 'msg-1' })
  })

  it('records a delivered alert in the ledger', async () => {
    const { citizen } = await citizenWithCircle()
    const { incident_id } = await sos(citizen)
    const [first] = await claim(1)
    assert.equal(await finish(first.alert_id, 'sent', { ref: 'resend-123' }), 'sent')

    const row = (await alertsFor(incident_id)).find((a) => a.id === first.alert_id)
    assert.equal(row.status, 'sent')
    assert.equal(row.provider_ref, 'resend-123')
    assert.ok(row.sent_at)
    const sent = (await ledgerFor(incident_id)).find((e) => e.action === 'alert.sent')
    assert.deepEqual(sent.payload, {
      alert: first.alert_id,
      channel: first.channel,
      to: first.recipient_name,
      template: 'sos',
      level: 0,
    })
    assert.equal(sent.actor_id, null, 'sent by the system')
    // A late duplicate report changes nothing.
    assert.equal(await finish(first.alert_id, 'failed', { error: 'late' }), 'sent')
    await clearQueue()
  })

  it('retries a failed send after 30 s and 2 min, then records the failure', async () => {
    const citizen = await createUser('Priya')
    await addContact(citizen, { name: 'Asha', email: 'asha@example.test' })
    const { incident_id } = await sos(citizen)

    const [first] = await claim()
    assert.equal(await finish(first.alert_id, 'failed', { error: '503', retry: true }), 'queued')
    let [row] = await alertsFor(incident_id)
    const wait = await db.query(`select extract(epoch from $1::timestamptz - now()) as s`, [
      row.next_attempt_at,
    ])
    assert.ok(Math.abs(Number(wait.rows[0].s) - 30) < 5)
    assert.equal((await claim()).length, 0, 'not due yet')

    for (const expected of ['queued', 'failed']) {
      await db.query(`update public.alerts set next_attempt_at = now() where id = $1`, [
        first.alert_id,
      ])
      const [again] = await claim()
      assert.equal(await finish(again.alert_id, 'failed', { error: '503', retry: true }), expected)
    }
    ;[row] = await alertsFor(incident_id)
    assert.equal(row.status, 'failed')
    assert.equal(row.attempts, 3)
    const failed = (await ledgerFor(incident_id)).filter((e) => e.action === 'alert.failed')
    assert.equal(failed.length, 1)
    assert.equal(failed[0].payload.reason, '503')
  })

  it('records a skipped alert when the channel is not set up', async () => {
    const citizen = await createUser('Priya')
    await addContact(citizen, { name: 'Asha', email: 'asha@example.test' })
    const { incident_id } = await sos(citizen)
    const [first] = await claim()
    await finish(first.alert_id, 'skipped', { error: 'Email is not set up yet' })
    const skipped = (await ledgerFor(incident_id)).find((e) => e.action === 'alert.skipped')
    assert.equal(skipped.payload.reason, 'Email is not set up yet')
  })
})

describe('per-contact live links', () => {
  it('greets the contact by name, gives the live topic, and records who opened it', async () => {
    const { citizen } = await citizenWithCircle()
    const { incident_id } = await sos(citizen)
    const asha = (await alertsFor(incident_id)).find((a) => a.recipient_name === 'Asha')

    const view = await asAnon(async (c) => {
      const { rows } = await c.query('select public.view_share_link($1) as v', [asha.link_token])
      return rows[0].v
    })
    assert.equal(view.contact_name, 'Asha')
    assert.match(view.channel, /^live:[A-Za-z0-9_-]{24}$/)
    const opened = (await ledgerFor(incident_id)).find((e) => e.action === 'share_link.opened')
    assert.equal(opened.payload.name, 'Asha')

    await asAnon((c) => c.query(`select public.respond_to_share_link($1, 'Asha')`, [asha.link_token]))
    const [row] = (await alertsFor(incident_id)).filter((a) => a.recipient_name === 'Asha')
    assert.ok(row.acked_at, 'responding acknowledges her alert')
    await clearQueue()
  })
})

describe('the Cron tick', () => {
  it('reminds the circle when nobody responds within 2 minutes, once', async () => {
    const { citizen } = await citizenWithCircle()
    const { incident_id } = await sos(citizen)
    await clearQueue()

    const early = await tick(1)
    assert.equal(
      (await alertsFor(incident_id)).filter((a) => a.template === 'reminder').length,
      0,
      'nothing before 2 minutes',
    )
    assert.equal(early.jobs, 0)

    const before = (await db.query('select count(*)::int as n from net.requests')).rows[0].n
    const result = await tick(3)
    assert.ok(result.jobs >= 1)
    const reminders = (await alertsFor(incident_id)).filter((a) => a.template === 'reminder')
    assert.deepEqual(
      reminders.map((a) => [a.recipient_name, a.channel, a.level]),
      [
        ['Asha', 'email', 1],
        ['Ravi', 'email', 1],
        ['Ravi', 'telegram', 1],
      ],
    )
    const noResponse = (await ledgerFor(incident_id)).find((e) => e.action === 'sos.no_response')
    assert.equal(noResponse.payload.reminders, 3)
    assert.ok(noResponse.payload.after_s >= 179)
    const after = (await db.query('select count(*)::int as n from net.requests')).rows[0].n
    assert.ok(after > before, 'the tick wakes the notify function while alerts are due')

    await tick(4)
    assert.equal(
      (await alertsFor(incident_id)).filter((a) => a.template === 'reminder').length,
      3,
      'the reminder runs once',
    )
    await clearQueue()
  })

  it('skips the reminder once a contact is responding', async () => {
    const { citizen } = await citizenWithCircle()
    const { incident_id, share_token } = await sos(citizen)
    await clearQueue()
    await asAnon((c) => c.query(`select public.respond_to_share_link($1, 'Asha')`, [share_token]))
    await tick(3)
    assert.equal(
      (await alertsFor(incident_id)).filter((a) => a.template === 'reminder').length,
      0,
    )
    assert.ok(!(await ledgerFor(incident_id)).some((e) => e.action === 'sos.no_response'))
  })

  it('records alerts that waited 15 minutes as failed', async () => {
    const citizen = await createUser('Priya')
    await addContact(citizen, { name: 'Asha', email: 'asha@example.test' })
    const { incident_id } = await sos(citizen)
    // Pretend the notify function has been down since the SOS.
    await db.query(`update private.jobs set status = 'done' where payload ->> 'incident_id' = $1`, [
      incident_id,
    ])
    const result = await tick(16)
    assert.equal(result.expired_alerts, 1)
    const [row] = await alertsFor(incident_id)
    assert.equal(row.status, 'failed')
    const failed = (await ledgerFor(incident_id)).find((e) => e.action === 'alert.failed')
    assert.equal(failed.payload.reason, 'Not delivered within 15 minutes')
  })
})

describe('ending the SOS', () => {
  it("cancels waiting alerts and tells contacts who got the SOS that she's safe", async () => {
    const { citizen } = await citizenWithCircle()
    const { incident_id } = await sos(citizen)
    // Asha's email went out; Ravi's two are still waiting.
    const claimed = await claim()
    const ashaAlert = claimed.find((a) => a.recipient_name === 'Asha')
    await finish(ashaAlert.alert_id, 'sent')
    await db.query(
      `update public.alerts set status = 'queued' where incident_id = $1 and status = 'sending'`,
      [incident_id],
    )

    await asUserCommitted(citizen, (c) => c.query('select public.resolve_incident($1)', [incident_id]))
    const alerts = await alertsFor(incident_id)
    assert.deepEqual(
      alerts.map((a) => [a.recipient_name, a.channel, a.template, a.status]),
      [
        ['Asha', 'email', 'sos', 'sent'],
        ['Ravi', 'email', 'sos', 'cancelled'],
        ['Ravi', 'telegram', 'sos', 'cancelled'],
        ['Asha', 'email', 'safe', 'queued'],
      ],
    )
    await tick(3)
    assert.ok(!(await alertsFor(incident_id)).some((a) => a.template === 'reminder'))
    await clearQueue()
  })

  it('with the duress PIN, sends no "safe" message and still reminds the circle', async () => {
    const { citizen } = await citizenWithCircle()
    await asUserCommitted(citizen, (c) => c.query(`select public.set_sos_pins('2580', '1470')`))
    const { incident_id } = await sos(citizen)
    for (const a of await claim()) await finish(a.alert_id, 'sent')

    await asUserCommitted(citizen, (c) =>
      c.query(`select public.resolve_incident($1, '1470')`, [incident_id]),
    )
    await tick(3)
    const templates = (await alertsFor(incident_id)).map((a) => a.template)
    assert.ok(!templates.includes('safe'))
    assert.equal(templates.filter((t) => t === 'reminder').length, 3)
    // Her own timeline still ends at "resolved".
    await asUser(citizen, async (c) => {
      const { rows } = await c.query('select action from public.incident_timeline($1)', [
        incident_id,
      ])
      assert.equal(rows.at(-1).action, 'sos.resolved')
    })
    await clearQueue()
  })
})

describe('Telegram linking', () => {
  it('links a chat once, rotates the code, and unlinks on /stop', async () => {
    const citizen = await createUser('Priya Sharma')
    const contact = await addContact(citizen, { name: 'Asha', phone: '+919800000002' })

    assert.deepEqual(await linkTelegram('not-a-code', 1), { status: 'unknown_code' })
    assert.deepEqual(await linkTelegram(contact.telegram_code, 777, 'asha'), {
      status: 'linked',
      owner_name: 'Priya',
      contact_name: 'Asha',
    })
    assert.deepEqual(await linkTelegram(contact.telegram_code, 666), { status: 'unknown_code' })

    await asUser(citizen, async (c) => {
      const { rows } = await c.query(
        'select telegram_linked_at, telegram_username, telegram_code from public.trusted_contacts',
      )
      assert.ok(rows[0].telegram_linked_at)
      assert.equal(rows[0].telegram_username, 'asha')
      assert.notEqual(rows[0].telegram_code, contact.telegram_code)
      await assert.rejects(c.query('select * from private.contact_telegram'), /permission denied/)
    })
    await asUser(citizen, async (c) => {
      await assert.rejects(
        c.query(`update public.trusted_contacts set telegram_linked_at = now()`),
        /permission denied/,
      )
    })
    // A phone-only contact now gets Telegram alerts.
    const { incident_id } = await sos(citizen)
    assert.deepEqual(
      (await alertsFor(incident_id)).map((a) => a.channel),
      ['telegram'],
    )
    await clearQueue()

    const unlinked = await asServiceRole(async (c) =>
      (await c.query('select public.unlink_telegram_chat(777) as n')).rows[0].n,
    )
    assert.equal(unlinked, 1)
    const { rows } = await db.query(
      'select telegram_linked_at from public.trusted_contacts where id = $1',
      [contact.id],
    )
    assert.equal(rows[0].telegram_linked_at, null)
    const actions = (await ledgerFor(citizen)).map((e) => e.action)
    assert.ok(actions.includes('contact.telegram_linked'))
    assert.ok(actions.includes('contact.telegram_unlinked'))
  })

  it('lets only the owner disconnect a contact', async () => {
    const citizen = await createUser('Priya')
    const other = await createUser('Other')
    const contact = await addContact(citizen, { name: 'Asha', phone: '+919800000002' })
    await linkTelegram(contact.telegram_code, 888)

    await asUser(other, async (c) => {
      await assert.rejects(
        c.query('select public.disconnect_telegram($1)', [contact.id]),
        /No such contact/,
      )
    })
    await asUserCommitted(citizen, (c) => c.query('select public.disconnect_telegram($1)', [contact.id]))
    const { rows } = await db.query(
      'select count(*)::int as n from private.contact_telegram where contact_id = $1 and unlinked_at is null',
      [contact.id],
    )
    assert.equal(rows[0].n, 0)
  })
})

describe('live updates over Realtime', () => {
  it('pings the private SOS topic, the user topic and the public live-link topic', async () => {
    const citizen = await createUser('Priya')
    const { incident_id, share_token } = await sos(citizen)
    await asUserCommitted(citizen, (c) =>
      c.query('select public.record_location($1, 28.632, 77.2175)', [incident_id]),
    )
    const { rows } = await db.query(`select live_topic from public.incidents where id = $1`, [
      incident_id,
    ])
    const live = `live:${rows[0].live_topic}`
    const messages = await db.query(
      `select topic, private, payload ->> 'what' as what from realtime.messages
       where topic in ($1, $2, $3) order by inserted_at`,
      [`incident:${incident_id}`, `user:${citizen}`, live],
    )
    const seen = messages.rows.map((m) => `${m.topic.split(':')[0]}/${m.what}/${m.private}`)
    assert.ok(seen.includes('user/status/true'), 'a new SOS pings her app')
    assert.ok(seen.includes('incident/location/true'))
    assert.ok(seen.includes('live/location/false'))
    assert.ok(
      messages.rows.every((m) => m.what && Object.keys(m).length === 3),
      'pings only, no data',
    )

    const view = await asAnon(async (c) => {
      const r = await c.query('select public.view_share_link($1) as v', [share_token])
      return r.rows[0].v
    })
    assert.equal(view.channel, live)
  })

  it('lets only the citizen join her private topics', async () => {
    const citizen = await createUser('Priya')
    const other = await createUser('Other')
    const { incident_id } = await sos(citizen)

    async function canRead(userId, topic) {
      return asUser(userId, async (c) => {
        await c.query(`select set_config('realtime.topic', $1, true)`, [topic])
        const { rowCount } = await c.query(
          'select 1 from realtime.messages where topic = $1 limit 1',
          [topic],
        )
        return rowCount > 0
      })
    }
    assert.equal(await canRead(citizen, `incident:${incident_id}`), true)
    assert.equal(await canRead(citizen, `user:${citizen}`), true)
    assert.equal(await canRead(other, `incident:${incident_id}`), false)
    assert.equal(await canRead(other, `user:${citizen}`), false)
  })
})

describe('queued (offline) SOS', () => {
  it('keeps the original trigger time and records the delay', async () => {
    const citizen = await createUser('Priya')
    const { rows } = await db.query(`select now() - interval '5 minutes' as t`)
    const { incident_id } = await sos(citizen, { occurredAt: rows[0].t })

    const incident = await db.query(
      `select started_at = $2::timestamptz as same from public.incidents where id = $1`,
      [incident_id, rows[0].t],
    )
    assert.equal(incident.rows[0].same, true)
    const triggered = await db.query(
      `select occurred_at = $2::timestamptz as same, recorded_at - occurred_at > interval '299 seconds' as later,
              payload from public.ledger_entries
       where subject_id = $1 and action = 'sos.triggered'`,
      [incident_id, rows[0].t],
    )
    assert.equal(triggered.rows[0].same, true)
    assert.equal(triggered.rows[0].later, true)
    assert.ok(triggered.rows[0].payload.delayed_s >= 299)
  })

  it('refuses times in the future or more than a day old', async () => {
    const citizen = await createUser('Priya')
    await asUser(citizen, async (c) => {
      await assert.rejects(
        c.query(`select public.create_sos(p_occurred_at => now() + interval '1 hour')`),
        /in the future/,
      )
    })
    await asUser(citizen, async (c) => {
      await assert.rejects(
        c.query(`select public.create_sos(p_occurred_at => now() - interval '25 hours')`),
        /more than a day old/,
      )
    })
  })
})

describe('nearby safe points', () => {
  // In Shillong, far from the OpenStreetMap places the migrations load around New Delhi.
  const HERE = { lat: 25.5788, lng: 91.8933 }

  it('returns the closest places of each category, nearest first, to anyone', async () => {
    await db.query(`
      insert into public.safe_points (name, category, lat, lng, source, osm_ref) values
        ('Nearest Police Station', 'police', 25.5793, 91.8956, 'osm', 'node/9000001'),
        ('Second Police Station', 'police', 25.5703, 91.8886, 'osm', 'node/9000002'),
        ('Far Police Post', 'police', 25.6473, 91.7766, 'osm', 'node/9000003'),
        ('Nearest Hospital', 'hospital', 25.5823, 91.8866, 'osm', 'node/9000004'),
        ('Faraway Hospital', 'hospital', 19.0760, 72.8777, 'osm', 'node/9000005')`)

    const rows = await asAnon(async (c) => {
      const r = await c.query(
        'select name, category, distance_m from public.nearby_safe_points($1, $2, 1)',
        [HERE.lat, HERE.lng],
      )
      return r.rows
    })
    assert.deepEqual(
      rows.map((r) => [r.name, r.category]),
      [
        ['Nearest Police Station', 'police'],
        ['Nearest Hospital', 'hospital'],
      ],
    )
    assert.ok(rows[0].distance_m > 150 && rows[0].distance_m < 400, `${rows[0].distance_m} m`)

    const wider = await asAnon(async (c) => {
      const r = await c.query(
        'select name from public.nearby_safe_points($1, $2, 5, 20000) where category = $3',
        [HERE.lat, HERE.lng, 'police'],
      )
      return r.rows.map((x) => x.name)
    })
    assert.deepEqual(wider, [
      'Nearest Police Station',
      'Second Police Station',
      'Far Police Post',
    ])

    await asUser(await createUser('Priya'), async (c) => {
      await assert.rejects(
        c.query(`insert into public.safe_points (name, category, lat, lng, source) values ('x', 'police', 1, 1, 'admin')`),
        /permission denied/,
      )
    })
  })
})
