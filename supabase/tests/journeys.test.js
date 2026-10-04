// Phase 5: risk cells (aggregated, k-anonymous, day and night), zone reports, route scoring
// against the seeded red zone on Janpath, and the journey watchdog on a fake clock.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { asUserCommitted, createUser, db, ledgerFor, setupTestDatabase } from './helpers.js'

setupTestDatabase()

// 21:30 and 11:30 in New Delhi.
const NIGHT = '2026-10-03T16:00:00Z'
const DAY = '2026-10-04T06:00:00Z'

// Janpath, straight through the demo red zone, and a parallel street about 500 m east.
const JANPATH = [
  [77.2196, 28.6328],
  [77.2192, 28.629],
  [77.2189, 28.626],
  [77.2187, 28.6235],
  [77.2197, 28.617],
]
const EAST = [
  [77.2196, 28.6328],
  [77.2245, 28.631],
  [77.2245, 28.624],
  [77.2245, 28.618],
  [77.2197, 28.617],
]
const DEST = { lat: 28.617, lng: 77.2197 }

/** Points every ~50 m along a line, as the app sends them. */
function sample(line, stepDeg = 0.0005) {
  const out = []
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepDeg))
    for (let s = 0; s < n; s++) {
      out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n])
    }
  }
  out.push(line.at(-1))
  return out
}

async function call(userId, sql, params = []) {
  return (await asUserCommitted(userId, async (c) => (await c.query(sql, params)).rows[0])).r
}

async function journey(id) {
  return (await db.query('select * from public.journeys where id = $1', [id])).rows[0]
}

async function tickAt(sqlTime) {
  return (await db.query(`select private.tick(${sqlTime}) as r`)).rows[0].r
}

describe('risk map', () => {
  it('shows the demo red zone at night from aggregated cells only', async () => {
    const citizen = await createUser('Map Reader')
    const night = await call(citizen, `select public.risk_map('night') as r`)
    const day = await call(citizen, `select public.risk_map('day') as r`)
    const janpath = (map) =>
      map.cells.filter((c) => c.bounds[0] <= 77.2188 && 77.2188 < c.bounds[2] &&
                              c.bounds[1] <= 28.625 && 28.625 < c.bounds[3])
    assert.equal(janpath(night)[0].level, 'high')
    assert.ok(janpath(night)[0].factors['zone:poor_lighting'] >= 2, 'explains why it is red')
    assert.ok((janpath(day)[0]?.score ?? 0) < janpath(night)[0].score, 'darker at night')
    for (const cell of night.cells) {
      assert.ok(cell.signals >= night.min_signals)
      assert.deepEqual(Object.keys(cell).sort(), ['bounds', 'factors', 'level', 'score', 'signals', 'x', 'y'])
    }
  })

  it('needs k signals before a cell appears', async () => {
    const [a, b, c] = [await createUser('A'), await createUser('B'), await createUser('C')]
    const spot = [28.6455, 77.2005]
    const visible = async () => {
      await db.query('select private.compute_risk_cells(now())')
      const map = await call(a, `select public.risk_map('night') as r`)
      return map.cells.some((cell) => cell.bounds[1] <= spot[0] && spot[0] < cell.bounds[3] &&
                                       cell.bounds[0] <= spot[1] && spot[1] < cell.bounds[2])
    }
    for (const user of [a, b]) {
      await call(user, `select public.report_zone($1, $2, 'harassment', true) as r`, spot)
      await call(user, `select public.report_zone($1, $2, 'isolated', true) as r`, spot)
    }
    // Four reports, two people: a medium score, but is it shown? Four signals ≥ k = 3, so yes.
    assert.equal(await visible(), true)

    const lone = [28.6505, 77.1905]
    await call(c, `select public.report_zone($1, $2, 'poor_lighting', true) as r`, lone)
    await call(c, `select public.report_zone($1, $2, 'isolated', true) as r`, lone)
    await db.query('select private.compute_risk_cells(now())')
    const map = await call(a, `select public.risk_map('night') as r`)
    assert.ok(!map.cells.some((cell) => cell.bounds[1] <= lone[0] && lone[0] < cell.bounds[3] &&
                                        cell.bounds[0] <= lone[1] && lone[1] < cell.bounds[2]),
              'two signals stay hidden')
    assert.equal((await ledgerFor((await db.query(
      `select id from public.zone_reports where reporter_id = $1 limit 1`, [c])).rows[0].id))[0].action,
      'zone.reported')
  })
})

describe('safe routes', () => {
  it('scores the Janpath route as riskier than the detour at night, not by day as much', async () => {
    const citizen = await createUser('Route Planner')
    const night = await call(citizen, 'select public.score_routes($1, $2) as r', [
      JSON.stringify([sample(JANPATH), sample(EAST)]),
      NIGHT,
    ])
    assert.equal(night.period, 'night')
    const [jan, east] = night.routes
    assert.ok(jan.high_cells >= 1, 'Janpath crosses the red zone')
    assert.equal(east.high_cells, 0)
    assert.ok(jan.exposure > east.exposure)

    const day = await call(citizen, 'select public.score_routes($1, $2) as r', [
      JSON.stringify([sample(JANPATH)]),
      DAY,
    ])
    assert.equal(day.period, 'day')
    assert.ok(day.routes[0].exposure < jan.exposure)
    await assert.rejects(
      call(citizen, 'select public.score_routes($1) as r', ['[[[1, 2]]]']),
      /2 to 2000 points/,
    )
  })
})

describe('journey watchdog', () => {
  async function start(citizen, at = { lat: 28.6328, lng: 77.2196 }) {
    const { journey_id } = await call(
      citizen,
      `select public.start_journey($1, $2, 'Janpath market', $3, 'safest', 20, $4, $5) as r`,
      [DEST.lat, DEST.lng, JSON.stringify(EAST), at.lat, at.lng],
    )
    // The first watchdog run is due in 15 s.
    await db.query(`update private.jobs set status = 'done' where status = 'pending' and kind <> 'journey.check'`)
    return journey_id
  }

  it('asks "Are you OK?" after a 3-minute stop, then raises an SOS when nobody answers', async () => {
    const citizen = await createUser('Stopped Walker')
    // A spot on the route, away from safe points and the destination.
    const here = { lat: 28.6275, lng: 77.2245 }
    const id = await start(citizen, here)
    await db.query(
      `update public.journeys set last_moved_at = now() - interval '4 minutes',
              moved_lat = $2, moved_lng = $3 where id = $1`,
      [id, here.lat, here.lng],
    )
    await tickAt(`now() + interval '20 seconds'`)
    const asked = await journey(id)
    assert.equal(asked.check_in_reason, 'stopped')
    assert.ok(asked.check_in_due_at)

    // Still pinging, but no answer within 60 s.
    await db.query(`update public.journeys set last_ping_at = now() + interval '80 seconds' where id = $1`, [id])
    await tickAt(`now() + interval '90 seconds'`)
    const escalated = await journey(id)
    assert.equal(escalated.status, 'escalated')
    assert.equal(escalated.escalation_reason, 'no_check_in')
    const incident = (await db.query('select * from public.incidents where id = $1', [escalated.incident_id])).rows[0]
    assert.equal(incident.status, 'active')
    assert.deepEqual(
      (await ledgerFor(id)).map((e) => e.action),
      ['journey.started', 'journey.check_in_requested', 'journey.escalated'],
    )
    assert.ok((await ledgerFor(incident.id)).some((e) => e.action === 'sos.from_journey'))
  })

  it('checks in after 60 s off the route; the PIN clears it and the duress PIN raises an SOS quietly', async () => {
    const citizen = await createUser('Detour Walker')
    await asUserCommitted(citizen, (c) => c.query(`select public.set_sos_pins('2580', '1470')`))
    const id = await start(citizen)
    // 400 m west of the eastern route.
    const state = await call(citizen, 'select public.journey_ping($1, 28.6275, 77.2203) as r', [id])
    assert.ok(state.off_route_m > 150)
    await db.query(`update public.journeys set off_route_since = now() - interval '70 seconds' where id = $1`, [id])
    await tickAt(`now() + interval '20 seconds'`)
    assert.equal((await journey(id)).check_in_reason, 'off_route')

    const wrong = await call(citizen, `select public.journey_check_in($1, '0000') as r`, [id])
    assert.deepEqual([wrong.ok, wrong.error], [false, 'wrong_pin'])
    const ok = await call(citizen, `select public.journey_check_in($1, '2580') as r`, [id])
    assert.equal(ok.ok, true)
    assert.equal((await journey(id)).check_in_due_at, null)

    // Asked again, answered with the duress PIN: looks fine on screen, but the SOS is raised.
    await db.query(
      `update public.journeys set check_in_due_at = now() + interval '60 seconds',
              check_in_reason = 'off_route' where id = $1`,
      [id],
    )
    const duress = await call(citizen, `select public.journey_check_in($1, '1470') as r`, [id])
    assert.deepEqual([duress.ok, duress.status], [true, 'active'])
    const after = await journey(id)
    assert.deepEqual([after.status, after.escalation_reason], ['escalated', 'duress_pin'])
  })

  it('treats 45 s of silence as the alarm, without a check-in', async () => {
    const citizen = await createUser('Silent Phone')
    const id = await start(citizen)
    await tickAt(`now() + interval '50 seconds'`)
    const j = await journey(id)
    assert.deepEqual([j.status, j.escalation_reason], ['escalated', 'lost_heartbeat'])
  })

  it('ends on arrival and needs no more pings', async () => {
    const citizen = await createUser('Home Safe')
    const id = await start(citizen)
    const state = await call(citizen, 'select public.journey_ping($1, $2, $3) as r', [id, DEST.lat + 0.0003, DEST.lng])
    assert.equal(state.status, 'arrived')
    await tickAt(`now() + interval '10 minutes'`)
    assert.equal((await journey(id)).status, 'arrived')
    const view = await call(citizen, 'select public.journey_view($1) as r', [id])
    assert.equal(view.route.length, EAST.length)
    assert.equal(view.citizen_id, undefined)
    await assert.rejects(
      call(await createUser('Stranger'), 'select public.journey_ping($1, 28.6, 77.2) as r', [id]),
      /No such journey/,
    )
  })

  it('switches on active monitoring in a high-risk cell at night', async () => {
    const { rows } = await db.query(`select private.cell_level(28.625, 77.2188, 'night') as l,
                                            private.cell_level(28.625, 77.2188, 'day') as d`)
    assert.equal(rows[0].l, 'high')
    assert.notEqual(rows[0].d, 'high')
  })
})
