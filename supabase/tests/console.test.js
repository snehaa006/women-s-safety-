// Phase 2: routing by jurisdiction, who on the authority side sees what, the escalation ladder
// (with a fake clock), acknowledge → dispatch → on scene → close, duty, policies and demo data.

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

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

const ORG = {
  control: '00000000-0000-4000-8000-000000000001',
  cp: '00000000-0000-4000-8000-000000000011',
  tilak: '00000000-0000-4000-8000-000000000012',
  chanakya: '00000000-0000-4000-8000-000000000013',
  mandir: '00000000-0000-4000-8000-000000000014',
}
const AT = {
  cp: { lat: 28.6315, lng: 77.2167 }, // Connaught Place
  tilak: { lat: 28.6098, lng: 77.2405 },
  rohini: { lat: 28.7, lng: 77.1 }, // outside every jurisdiction, within 50 km
}

/** A staff member: a role, plus membership of one organisation. */
async function createStaff(name, role, orgId, memberRole = 'officer') {
  const id = await createUser(name)
  await db.query('select public.admin_set_role($1, $2)', [id, role])
  if (orgId) {
    await db.query(
      `insert into public.memberships (user_id, org_id, role, on_duty) values ($1, $2, $3, true)`,
      [id, orgId, memberRole],
    )
  }
  return id
}

async function sos(userId, at = AT.cp, occurredAt = null) {
  return asUserCommitted(userId, async (c) => {
    const { rows } = await c.query(
      `select public.create_sos(p_lat => $1, p_lng => $2, p_occurred_at => $3) as r`,
      [at?.lat ?? null, at?.lng ?? null, occurredAt],
    )
    return rows[0].r.incident_id
  })
}

async function incident(id) {
  const { rows } = await db.query('select * from public.incidents where id = $1', [id])
  return rows[0]
}

async function board(userId) {
  return asUser(userId, async (c) => (await c.query('select public.console_board() as b')).rows[0].b)
}

async function call(userId, sql, params = []) {
  return asUserCommitted(userId, async (c) => (await c.query(sql, params)).rows[0])
}

async function tick(minutesAhead) {
  const { rows } = await db.query(`select private.tick(now() + make_interval(secs => $1)) as r`, [
    minutesAhead * 60,
  ])
  return rows[0].r
}

beforeEach(async () => {
  await db.query(`update private.jobs set status = 'done' where status = 'pending'`)
  await db.query(`update public.alerts set status = 'cancelled' where status in ('queued', 'sending')`)
  await db.query(`update public.patrol_units set status = 'available'`)
})

describe('routing', () => {
  it('sends an SOS to the station whose jurisdiction contains it', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    const atCp = await sos(priya, AT.cp)
    const atTilak = await sos(meera, AT.tilak)
    assert.equal((await incident(atCp)).assigned_org_id, ORG.cp)
    assert.equal((await incident(atTilak)).assigned_org_id, ORG.tilak)
    const routed = (await ledgerFor(atCp)).find((e) => e.action === 'incident.routed')
    assert.deepEqual(routed.payload, {
      org: ORG.cp,
      name: 'Connaught Place Police Station',
      how: 'jurisdiction',
    })
  })

  it('falls back to the nearest station, and to the control room without a location', async () => {
    const far = await sos(await createUser('Asha'), AT.rohini)
    const routed = (await ledgerFor(far)).find((e) => e.action === 'incident.routed')
    assert.equal(routed.payload.how, 'nearest')
    assert.equal(routed.payload.org, ORG.mandir)

    const nowhere = await createUser('Kavya')
    const id = await sos(nowhere, null)
    assert.equal((await incident(id)).assigned_org_id, ORG.control)
    // The first fix routes it.
    await call(nowhere, 'select public.record_location($1, $2, $3)', [id, AT.tilak.lat, AT.tilak.lng])
    assert.equal((await incident(id)).assigned_org_id, ORG.tilak)
  })
})

describe('who sees what', () => {
  it('shows each station its own incidents, and the district only once escalated', async () => {
    const cpOfficer = await createStaff('Ravi', 'officer', ORG.cp)
    const tilakOfficer = await createStaff('Arjun', 'officer', ORG.tilak)
    const controlOfficer = await createStaff('Neha', 'officer', ORG.control)
    const controlSupervisor = await createStaff('Inspector Rao', 'supervisor', ORG.control, 'supervisor')
    const admin = await createStaff('Asha Admin', 'admin', null)
    const citizen = await createUser('Priya')
    const id = await sos(citizen, AT.cp)

    const ids = async (user) => (await board(user)).map((row) => row.id)
    assert.ok((await ids(cpOfficer)).includes(id))
    assert.ok(!(await ids(tilakOfficer)).includes(id))
    assert.ok(!(await ids(controlOfficer)).includes(id), 'district officers wait for level 2')
    assert.ok((await ids(controlSupervisor)).includes(id), 'district supervisors always see')
    assert.ok((await ids(admin)).includes(id))
    assert.deepEqual(await board(citizen), [], 'citizens are not staff')

    const row = (await board(cpOfficer)).find((r) => r.id === id)
    assert.equal(row.citizen_name, 'Priya')
    assert.equal(row.org_name, 'Connaught Place Police Station')
    assert.equal(row.response_state, 'unacknowledged')

    await asUser(tilakOfficer, async (c) => {
      await assert.rejects(c.query('select public.console_incident($1)', [id]), /No such incident/)
    })
    await asUser(tilakOfficer, async (c) => {
      await assert.rejects(c.query('select public.acknowledge_incident($1)', [id]), /No such incident/)
    })

    await tick(6)
    await tick(6)
    assert.ok((await ids(controlOfficer)).includes(id), 'level 2 reaches the district')
  })

  it("lets staff join their organisations' and incidents' live topics only", async () => {
    const cpOfficer = await createStaff('Ravi', 'officer', ORG.cp)
    const id = await sos(await createUser('Priya'), AT.cp)
    const tilakId = await sos(await createUser('Meera'), AT.tilak)

    async function canRead(topic) {
      return asUser(cpOfficer, async (c) => {
        await c.query(`select set_config('realtime.topic', $1, true)`, [topic])
        const { rowCount } = await c.query('select 1 from realtime.messages where topic = $1', [topic])
        return rowCount > 0
      })
    }
    assert.equal(await canRead(`org:${ORG.cp}`), true)
    assert.equal(await canRead(`incident:${id}`), true)
    assert.equal(await canRead(`org:${ORG.tilak}`), false)
    assert.equal(await canRead(`incident:${tilakId}`), false)
  })
})

describe('escalation ladder (fake clock)', () => {
  it('climbs station → district → oversight while nobody acknowledges', async () => {
    const id = await sos(await createUser('Priya'), AT.cp)

    await tick(1)
    assert.equal((await incident(id)).escalation_level, 0, 'nothing before 2 minutes')

    await tick(2.5)
    let row = await incident(id)
    assert.equal(row.escalation_level, 1)

    await tick(5.5)
    row = await incident(id)
    assert.equal(row.escalation_level, 2)

    await tick(8)
    assert.equal((await incident(id)).escalation_level, 3)

    const { rows } = await db.query(
      `select level, target, org_id from public.incident_escalations where incident_id = $1
       order by level, target`,
      [id],
    )
    assert.deepEqual(
      rows.map((r) => [r.level, r.target, r.org_id]),
      [
        [1, 'station', ORG.cp],
        [2, 'parent', ORG.control],
        [3, 'oversight', null],
        [3, 'parent', ORG.control],
      ],
    )
    const escalated = (await ledgerFor(id)).filter((e) => e.action === 'incident.escalated')
    assert.deepEqual(
      escalated.map((e) => [e.payload.level, e.payload.to, e.payload.oversight]),
      [
        [1, 'station', false],
        [2, 'parent', false],
        [3, 'parent', true],
      ],
    )
    assert.ok(escalated[0].payload.after_s >= 149)
  })

  it('stops at the first acknowledgement', async () => {
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const id = await sos(await createUser('Priya'), AT.cp)
    await tick(2.5)
    await call(officer, 'select public.acknowledge_incident($1)', [id])
    await tick(6)
    await tick(9)
    const row = await incident(id)
    assert.equal(row.escalation_level, 1)
    assert.equal(row.response_state, 'acknowledged')
    assert.equal(row.acknowledged_by, officer)
    const ack = (await ledgerFor(id)).find((e) => e.action === 'incident.acknowledged')
    assert.equal(ack.actor_id, officer)
    assert.equal(ack.payload.level, 1)
  })

  it('times a queued SOS from when it was pressed', async () => {
    const { rows } = await db.query(`select now() - interval '4 minutes' as t`)
    const id = await sos(await createUser('Priya'), AT.cp, rows[0].t)
    await tick(0)
    assert.equal((await incident(id)).escalation_level, 1, 'already past 2 minutes')
  })
})

describe('the response', () => {
  it('acknowledges, dispatches with an ETA, arrives and closes, and the citizen sees it', async () => {
    const officer = await createStaff('Ravi Kumar', 'officer', ORG.cp)
    const citizen = await createUser('Priya')
    const id = await sos(citizen, AT.cp)
    const detail = await asUser(officer, async (c) =>
      (await c.query('select public.console_incident($1) as d', [id])).rows[0].d,
    )
    const unit = detail.units.find((u) => u.call_sign === 'CP-PCR-1')
    assert.equal(unit.status, 'available')
    assert.ok(unit.distance_m < 500)
    assert.ok(!detail.units.some((u) => u.call_sign === 'TM-PCR-1'), "other stations' units stay out")
    assert.ok(detail.units.some((u) => u.call_sign === 'ND-QRT-1'), "the district's units are offered")

    await call(officer, 'select public.dispatch_unit($1, $2, 6)', [id, unit.id])
    let row = await incident(id)
    assert.equal(row.response_state, 'responding')
    assert.ok(row.acknowledged_at, 'dispatching also acknowledges')

    const seen = await asUser(citizen, async (c) =>
      (await c.query('select public.incident_response($1) as r', [id])).rows[0].r,
    )
    assert.equal(seen.org_name, 'Connaught Place Police Station')
    assert.equal(seen.state, 'responding')
    assert.equal(seen.unit, 'CP-PCR-1')
    const etaMin = (new Date(seen.eta_at).getTime() - Date.now()) / 60_000
    assert.ok(etaMin > 5 && etaMin <= 6.1, `ETA ${etaMin} min`)

    // Someone else can't take a busy unit.
    const other = await sos(await createUser('Meera'), AT.cp)
    await asUser(officer, async (c) => {
      await assert.rejects(
        c.query('select public.dispatch_unit($1, $2, 5)', [other, unit.id]),
        /CP-PCR-1 is not available/,
      )
    })

    await call(officer, 'select public.mark_on_scene($1)', [id])
    assert.equal((await incident(id)).response_state, 'on_scene')

    await asUser(officer, async (c) => {
      await assert.rejects(c.query(`select public.close_incident($1, 'whatever')`, [id]), /closing code/)
    })
    await call(officer, `select public.close_incident($1, 'assisted_on_scene', 'Escorted home')`, [id])
    row = await incident(id)
    assert.equal(row.status, 'resolved')
    assert.equal(row.close_code, 'assisted_on_scene')
    const { rows } = await db.query('select status from public.patrol_units where id = $1', [unit.id])
    assert.equal(rows[0].status, 'available')

    const actions = (await ledgerFor(id)).map((e) => e.action)
    for (const step of [
      'incident.acknowledged',
      'incident.dispatched',
      'incident.on_scene',
      'incident.closed',
    ]) {
      assert.ok(actions.includes(step), step)
    }
    const closed = (await ledgerFor(id)).find((e) => e.action === 'incident.closed')
    assert.deepEqual(closed.payload, { code: 'assisted_on_scene', note: 'Escorted home' })

    const after = await asUser(officer, async (c) =>
      (await c.query('select public.console_incident($1) as d', [id])).rows[0].d,
    )
    assert.ok(after.metrics.ack_s >= 0 && after.metrics.arrival_s >= after.metrics.ack_s)
    assert.ok(after.timeline.some((e) => e.action === 'incident.dispatched'))
  })

  it("lets staff read their own and their district's units, not other stations'", async () => {
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const signs = await asUser(officer, async (c) =>
      (await c.query('select call_sign from public.patrol_units order by call_sign')).rows.map(
        (r) => r.call_sign,
      ),
    )
    assert.deepEqual(signs, ['CP-BIKE-2', 'CP-PCR-1', 'ND-QRT-1'])
    const citizen = await createUser('Priya')
    await asUser(citizen, async (c) => {
      const { rowCount } = await c.query('select 1 from public.patrol_units')
      assert.equal(rowCount, 0)
    })
  })

  it("won't send another station's unit", async () => {
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const id = await sos(await createUser('Priya'), AT.cp)
    const { rows } = await db.query(`select id from public.patrol_units where call_sign = 'TM-PCR-1'`)
    await asUser(officer, async (c) => {
      await assert.rejects(
        c.query('select public.dispatch_unit($1, $2, 5)', [id, rows[0].id]),
        /does not belong to this station/,
      )
    })
  })

  it("shows the police response on the contacts' live link", async () => {
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const citizen = await createUser('Priya')
    const { share_token: token, incident_id: id } = await call(
      citizen,
      `select (public.create_sos(p_lat => 28.6315, p_lng => 77.2167)) as r`,
    ).then((r) => r.r)
    await call(officer, 'select public.acknowledge_incident($1)', [id])
    const view = await asAnon(async (c) =>
      (await c.query('select public.view_share_link($1) as v', [token])).rows[0].v,
    )
    assert.equal(view.police.org_name, 'Connaught Place Police Station')
    assert.equal(view.police.state, 'acknowledged')
  })
})

describe('duty and policies', () => {
  it('lets staff go on and off duty in their own organisations', async () => {
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    await call(officer, 'select public.set_on_duty($1, false)', [ORG.cp])
    const { rows } = await db.query('select on_duty from public.memberships where user_id = $1', [
      officer,
    ])
    assert.equal(rows[0].on_duty, false)
    await asUser(officer, async (c) => {
      await assert.rejects(c.query('select public.set_on_duty($1, true)', [ORG.tilak]), /not a member/)
    })
  })

  it('lets only admins change the ladder, with levels in order', async () => {
    const admin = await createStaff('Asha Admin', 'admin', null)
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const levels = JSON.stringify([
      { after_s: 60, to: 'station' },
      { after_s: 180, to: 'parent' },
    ])
    await asUser(officer, async (c) => {
      await assert.rejects(
        c.query('select public.admin_set_escalation_policy(null, $1, 120)', [levels]),
        /Only an admin/,
      )
    })
    await asUser(admin, async (c) => {
      await assert.rejects(
        c.query('select public.admin_set_escalation_policy(null, $1, 120)', [
          JSON.stringify([{ after_s: 300, to: 'station' }, { after_s: 120, to: 'parent' }]),
        ]),
        /each later than the last/,
      )
    })
    await asUserCommitted(admin, (c) =>
      c.query('select public.admin_set_escalation_policy($1, $2, 120)', [ORG.cp, levels]),
    )
    const id = await sos(await createUser('Priya'), AT.cp)
    await tick(1.5)
    assert.equal((await incident(id)).escalation_level, 1, 'the station policy applies (60 s)')
  })
})

describe('demo incidents', () => {
  it('starts three mock SOS alerts in three stations at three escalation levels', async () => {
    const supervisor = await createStaff('Inspector Rao', 'supervisor', ORG.control, 'supervisor')
    const loaded = await call(supervisor, 'select public.admin_load_demo_incidents() as n')
    assert.equal(loaded.n, 3)
    await tick(0)
    await tick(0)

    const rows = await board(supervisor)
    const demo = rows.filter((r) => r.is_demo)
    assert.deepEqual(demo.map((r) => r.escalation_level).sort(), [0, 1, 2])
    assert.deepEqual(
      demo.map((r) => r.org_name).sort(),
      ['Connaught Place Police Station', 'Mandir Marg Police Station', 'Tilak Marg Police Station'],
    )
    assert.ok(demo.every((r) => r.citizen_name.endsWith('(demo)')))

    // Loading again replaces them.
    await call(supervisor, 'select public.admin_load_demo_incidents()')
    const { rows: active } = await db.query(
      `select count(*)::int as n from public.incidents where is_demo and status = 'active'`,
    )
    assert.equal(active[0].n, 3)

    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    await asUser(officer, async (c) => {
      await assert.rejects(c.query('select public.admin_load_demo_incidents()'), /Only an admin/)
    })
  })
})
