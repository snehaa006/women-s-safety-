// Phase 3: complaints, the rules triage, routing and SLA (with a fake clock), the AI triage queue,
// the accountability lock and its review queue, and confidential mode.

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import {
  asServiceRole,
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
}
const AT = {
  cp: { lat: 28.6315, lng: 77.2167 },
  tilak: { lat: 28.6098, lng: 77.2405 },
}

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

async function call(userId, sql, params = []) {
  return asUserCommitted(userId, async (c) => (await c.query(sql, params)).rows[0])
}

async function rules(text) {
  const { rows } = await db.query('select private.triage_rules($1) as r', [text])
  return rows[0].r
}

async function file(userId, text, { at = AT.cp, confidential = false, clientId = null } = {}) {
  const row = await call(
    userId,
    `select public.create_complaint(p_description => $1, p_lat => $2, p_lng => $3,
                                    p_confidential => $4, p_client_id => $5) as r`,
    [text, at?.lat ?? null, at?.lng ?? null, confidential, clientId],
  )
  return row.r
}

async function complaint(id) {
  const { rows } = await db.query('select * from public.complaints where id = $1', [id])
  return rows[0]
}

async function tick(secondsAhead) {
  const { rows } = await db.query(`select private.tick(now() + make_interval(secs => $1)) as r`, [
    secondsAhead,
  ])
  return rows[0].r
}

beforeEach(async () => {
  await db.query(`update private.jobs set status = 'done' where status = 'pending'`)
})

describe('rules triage', () => {
  it('scores the Hinglish example as stalking, L4, with a rationale', async () => {
    const r = await rules('ek aadmi metro se mera peecha kar raha hai')
    assert.equal(r.category, 'stalking')
    assert.equal(r.severity, 4)
    assert.equal(r.language, 'hinglish')
    assert.deepEqual(r.signals, ['ongoing', 'public_transport'])
    assert.equal(r.rationale, 'Stalking or being followed (L4): happening now, on public transport.')
  })

  it('understands Devanagari, weapons, abduction and the past tense', async () => {
    assert.equal((await rules('कोई आदमी मेरा पीछा कर रहा है')).severity, 4)
    assert.equal((await rules('He has a knife and is threatening me')).severity, 5)
    const abduction = await rules('bachao koi mujhe utha ke le ja raha hai')
    assert.equal(abduction.category, 'abduction')
    assert.equal(abduction.severity, 5)
    const past = await rules('yesterday some boys passed comments at me near the market')
    assert.deepEqual([past.category, past.severity], ['harassment', 2])
    const groped = await rules('someone groped me in the bus just now')
    assert.deepEqual([groped.category, groped.severity], ['sexual_harassment', 3])
    const dv = await rules('mera pati mujhe roz maarta hai, dahej ke liye')
    assert.deepEqual([dv.category, dv.severity], ['domestic_violence', 4])
    const lights = await rules('The street lights on our lane are broken, very dark at night')
    assert.deepEqual([lights.category, lights.severity], ['public_safety', 1])
  })

  it("doesn't read ordinary words as violence", async () => {
    const r = await rules('mere pita ne mujhe chhutti nahi di')
    assert.deepEqual([r.category, r.severity], ['other', 2])
  })

  it('is previewable while typing, but only when signed in', async () => {
    const priya = await createUser('Priya')
    await asUser(priya, async (c) => {
      const { rows } = await c.query(`select public.triage_preview('he is following me') as r`)
      assert.equal(rows[0].r.category, 'stalking')
      await assert.rejects(c.query(`select private.triage_rules('x')`), /permission denied/)
    })
  })
})

describe('filing a complaint', () => {
  it('routes by location, scores instantly and starts the SLA clock', async () => {
    const priya = await createUser('Priya')
    const r = await file(priya, 'ek aadmi metro se mera peecha kar raha hai')
    assert.equal(r.created, true)
    assert.match(r.reference, /^C-\d{4}-\d{6}$/)
    assert.equal(r.category, 'stalking')
    assert.equal(r.severity, 4)
    assert.equal(r.org_name, 'Connaught Place Police Station')

    const c = await complaint(r.complaint_id)
    assert.equal(c.assigned_org_id, ORG.cp)
    assert.equal(c.routed_how, 'jurisdiction')
    assert.equal(c.triage_state, 'pending')
    // L4: 10 minutes to acknowledge.
    const slaS = (c.sla_due_at - c.created_at) / 1000
    assert.ok(Math.abs(slaS - 600) < 2, `SLA was ${slaS}s`)

    const ledger = await ledgerFor(r.complaint_id)
    assert.equal(ledger[0].action, 'complaint.filed')
    assert.equal(ledger[0].payload.severity, 4)
    assert.match(ledger[0].payload.description_sha256, /^[0-9a-f]{64}$/)
  })

  it('is idempotent by client id and goes to the control room without a location', async () => {
    const priya = await createUser('Priya')
    const clientId = '11111111-1111-4111-8111-111111111111'
    const first = await file(priya, 'Someone keeps sending me messages', { at: null, clientId })
    const again = await file(priya, 'Someone keeps sending me messages', { at: null, clientId })
    assert.equal(again.created, false)
    assert.equal(again.complaint_id, first.complaint_id)
    assert.equal((await complaint(first.complaint_id)).routed_how, 'default')
    assert.equal((await complaint(first.complaint_id)).assigned_org_id, ORG.control)
  })

  it('lets citizens read only their own complaints', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    const r = await file(priya, 'A man followed me home yesterday')
    await asUser(meera, async (c) => {
      const { rows } = await c.query('select id from public.complaints')
      assert.equal(rows.length, 0)
      const t = await c.query('select * from public.complaint_timeline($1)', [r.complaint_id])
      assert.equal(t.rows.length, 0)
      await assert.rejects(
        c.query(`update public.complaints set severity = 1 where id = $1`, [r.complaint_id]),
        /permission denied/,
      )
    })
    await asUser(priya, async (c) => {
      const { rows } = await c.query('select id, severity from public.complaints')
      assert.equal(rows.length, 1)
    })
  })
})

describe('SLA', () => {
  it('gives an L5 complaint 3 minutes, then escalates on a fake clock', async () => {
    const priya = await createUser('Priya')
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const r = await file(priya, 'He has a knife and is following me, help me')
    const c = await complaint(r.complaint_id)
    assert.equal(c.severity, 5)
    assert.ok(Math.abs((c.sla_due_at - c.created_at) / 1000 - 180) < 2)

    await tick(170)
    assert.equal((await complaint(r.complaint_id)).escalation_level, 0)
    await tick(185)
    assert.equal((await complaint(r.complaint_id)).escalation_level, 1)
    await tick(185 + 125)
    assert.equal((await complaint(r.complaint_id)).escalation_level, 2)

    const ledger = await ledgerFor(r.complaint_id)
    const escalated = ledger.filter((e) => e.action === 'complaint.escalated')
    assert.deepEqual(
      escalated.map((e) => [e.payload.level, e.payload.to]),
      [
        [1, 'station'],
        [2, 'parent'],
      ],
    )
    assert.equal(escalated[1].payload.org_name, 'New Delhi District Control Room')

    // Acknowledging stops the ladder.
    await call(officer, 'select public.acknowledge_complaint($1)', [r.complaint_id])
    await tick(185 + 125 + 300)
    assert.equal((await complaint(r.complaint_id)).escalation_level, 2)
  })

  it('does not escalate when acknowledged in time', async () => {
    const priya = await createUser('Priya')
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const r = await file(priya, 'A man is following me right now')
    await call(officer, 'select public.acknowledge_complaint($1)', [r.complaint_id])
    await tick(3600)
    const c = await complaint(r.complaint_id)
    assert.equal(c.escalation_level, 0)
    assert.equal(c.status, 'acknowledged')
    const ack = (await ledgerFor(r.complaint_id)).find((e) => e.action === 'complaint.acknowledged')
    assert.equal(ack.payload.within_sla, true)
  })
})

describe('AI triage queue', () => {
  it('is claimed and finished only by the service role', async () => {
    const priya = await createUser('Priya')
    await file(priya, 'test complaint text')
    await asUser(priya, async (c) => {
      await assert.rejects(c.query('select * from public.claim_triage()'), /permission denied/)
    })
  })

  it('raises severity and tightens the SLA, but never goes below the rules floor', async () => {
    const priya = await createUser('Priya')
    const r = await file(priya, 'Some boys passed comments at me near the market yesterday')
    assert.equal(r.severity, 2)

    const claimed = await asServiceRole(async (c) => (await c.query('select * from public.claim_triage(20)')).rows)
    const mine = claimed.find((x) => x.complaint_id === r.complaint_id)
    assert.ok(mine)
    assert.equal(mine.rules.category, 'harassment')

    const result = {
      category: 'threat',
      severity: 3,
      confidence: 0.8,
      signals: ['group'],
      rationale: 'A group harassed the reporter; mentions they may return.',
      legal_tags: ['BNS:79'],
      provider: 'claude',
      model: 'test-model',
    }
    const outcome = await asServiceRole(
      async (c) =>
        (await c.query(`select public.finish_triage($1, 'done', $2) as o`, [r.complaint_id, result]))
          .rows[0].o,
    )
    assert.equal(outcome, 'done')
    const c = await complaint(r.complaint_id)
    assert.equal(c.triage_state, 'done')
    assert.equal(c.category, 'threat')
    assert.equal(c.severity, 3)
    assert.equal(c.baseline_severity, 3)
    assert.equal(c.ai.final, 3)
    // L3: 20 minutes instead of L2's 30.
    assert.ok(Math.abs((c.sla_due_at - c.created_at) / 1000 - 1200) < 2)

    // A model answering lower than the rules floor can't lower it.
    const r2 = await file(priya, 'A man is following me right now on the metro')
    await asServiceRole((c) => c.query('select * from public.claim_triage(20)'))
    await asServiceRole((c) =>
      c.query(`select public.finish_triage($1, 'done', $2)`, [
        r2.complaint_id,
        { category: 'nonsense', severity: 1, rationale: 'x' },
      ]),
    )
    const c2 = await complaint(r2.complaint_id)
    assert.equal(c2.severity, 4)
    assert.equal(c2.category, 'stalking') // unknown category falls back to the rules'
    assert.equal(c2.ai.final, 4)
  })

  it('records "skipped" without a model and gives up after three silent tries', async () => {
    const priya = await createUser('Priya')
    const a = await file(priya, 'first complaint text')
    await asServiceRole((c) =>
      c.query(`select public.finish_triage($1, 'skipped', null, 'No AI model is set up')`, [a.complaint_id]),
    )
    assert.equal((await complaint(a.complaint_id)).triage_state, 'skipped')
    assert.ok((await ledgerFor(a.complaint_id)).some((e) => e.action === 'complaint.ai_skipped'))

    const b = await file(priya, 'second complaint text')
    // Re-armed by the tick: checks at 45 s, +60 s, +60 s.
    await db.query(
      `update private.jobs set status = 'done'
       where status = 'pending' and kind = 'complaint.triage_check' and payload->>'complaint_id' <> $1`,
      [b.complaint_id],
    )
    await tick(50)
    await tick(115)
    await tick(180)
    assert.equal((await complaint(b.complaint_id)).triage_state, 'failed')
  })
})

describe('console and confidential mode', () => {
  it('shows complaints to the handling station only, most urgent first', async () => {
    const priya = await createUser('Priya')
    const cpOfficer = await createStaff('Ravi', 'officer', ORG.cp)
    const tilakOfficer = await createStaff('Arjun', 'officer', ORG.tilak)
    const low = await file(priya, 'street lights broken near the park')
    const high = await file(priya, 'A man is following me right now')
    await file(priya, 'A man is following me right now', { at: AT.tilak })

    const list = await asUser(cpOfficer, async (c) =>
      (await c.query('select public.console_complaints() as l')).rows[0].l.filter((x) =>
        [low.complaint_id, high.complaint_id].includes(x.id),
      ),
    )
    assert.deepEqual(
      list.map((x) => x.id),
      [high.complaint_id, low.complaint_id],
    )
    await asUser(tilakOfficer, async (c) => {
      await assert.rejects(
        c.query('select public.console_complaint($1)', [high.complaint_id]),
        /No such complaint/,
      )
    })
  })

  it('hides a confidential reporter until they share their identity', async () => {
    const priya = await createUser('Priya Sharma')
    await db.query(`update public.profiles set phone = '+91 98765 43210' where id = $1`, [priya])
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const r = await file(priya, 'My manager harasses me every day', { confidential: true })

    const view = async () =>
      asUser(officer, async (c) => {
        const { rows } = await c.query('select public.console_complaint($1) as v', [r.complaint_id])
        return rows[0].v
      })
    const hidden = await view()
    assert.equal(hidden.reporter.confidential, true)
    assert.equal(hidden.reporter.name, null)
    assert.equal(hidden.reporter.phone, null)
    assert.match(hidden.reporter.alias, /^Reporter [0-9A-F]{4}$/)
    const text = JSON.stringify(hidden)
    assert.ok(!text.includes(priya), 'no account id anywhere')
    assert.ok(!text.includes('Priya'), 'no name anywhere')
    assert.ok(!text.includes('98765'), 'no phone anywhere')

    await call(priya, 'select public.share_complaint_identity($1)', [r.complaint_id])
    const shared = await view()
    assert.equal(shared.reporter.name, 'Priya Sharma')
    assert.equal(shared.reporter.phone, '+91 98765 43210')
  })
})

describe('accountability lock', () => {
  it('blocks a downgrade below the baseline without a justification', async () => {
    const priya = await createUser('Priya')
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const r = await file(priya, 'A man is following me right now')

    await assert.rejects(
      call(officer, 'select public.set_complaint_severity($1, 2)', [r.complaint_id]),
      /needs a justification of at least 20 characters/,
    )
    await assert.rejects(
      call(officer, `select public.set_complaint_severity($1, 2, 'too short')`, [r.complaint_id]),
      /justification/,
    )
    // Raising needs nothing.
    const up = await call(officer, 'select public.set_complaint_severity($1, 5) as r', [
      r.complaint_id,
    ])
    assert.equal(up.r.review, false)
    assert.equal((await complaint(r.complaint_id)).severity, 5)
  })

  it('logs a justified downgrade and puts it in the supervisor queue', async () => {
    const priya = await createUser('Priya')
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const supervisor = await createStaff('Inspector Rao', 'supervisor', ORG.control, 'supervisor')
    const otherStation = await createStaff('Tilak SHO', 'supervisor', ORG.tilak, 'supervisor')
    const r = await file(priya, 'A man is following me right now')
    const why = 'Spoke to the reporter by phone; the man left and she is home safe.'

    const down = await call(officer, 'select public.set_complaint_severity($1, 2, $2) as r', [
      r.complaint_id,
      why,
    ])
    assert.equal(down.r.review, true)
    const c = await complaint(r.complaint_id)
    assert.equal(c.severity, 2)
    assert.equal(c.baseline_severity, 4)
    const entry = (await ledgerFor(r.complaint_id)).find(
      (e) => e.action === 'complaint.severity_overridden',
    )
    assert.deepEqual([entry.payload.from, entry.payload.to, entry.payload.baseline], [4, 2, 4])
    assert.equal(entry.payload.justification, why)

    // The officer can't review their own downgrade; another station's supervisor can't see it.
    const own = await asUser(officer, async (c) => (await c.query('select public.console_reviews() as q')).rows[0].q)
    assert.equal(own.length, 0)
    const other = await asUser(otherStation, async (c) => (await c.query('select public.console_reviews() as q')).rows[0].q)
    assert.equal(other.length, 0)

    const queue = await asUser(supervisor, async (c) => (await c.query('select public.console_reviews() as q')).rows[0].q)
    const item = queue.find((q) => q.complaint_id === r.complaint_id)
    assert.ok(item)
    assert.equal(item.justification, why)
    assert.equal(item.officer, 'Ravi')

    await assert.rejects(
      call(supervisor, `select public.review_override($1, 'reversed')`, [item.id]),
      /Say why/,
    )
    await call(supervisor, `select public.review_override($1, 'reversed', 'Following is L4 by policy.')`, [
      item.id,
    ])
    assert.equal((await complaint(r.complaint_id)).severity, 4)
    const after = await asUser(supervisor, async (c) => (await c.query('select public.console_reviews() as q')).rows[0].q)
    assert.ok(!after.some((q) => q.id === item.id))

    // The citizen's timeline shows the change but not the internal justification.
    const timeline = await asUser(priya, async (c) =>
      (await c.query('select * from public.complaint_timeline($1)', [r.complaint_id])).rows,
    )
    const override = timeline.find((e) => e.action === 'complaint.severity_overridden')
    assert.equal(override.payload.justification, undefined)
    assert.ok(!timeline.some((e) => e.action === 'complaint.override_reviewed'))
  })

  it('needs a note to resolve, and closed complaints leave the queue', async () => {
    const priya = await createUser('Priya')
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const r = await file(priya, 'street lights broken near the park')
    await assert.rejects(
      call(officer, `select public.set_complaint_status($1, 'resolved')`, [r.complaint_id]),
      /note/,
    )
    await call(officer, `select public.set_complaint_status($1, 'resolved', 'Reported to NDMC; lights fixed.')`, [
      r.complaint_id,
    ])
    const c = await complaint(r.complaint_id)
    assert.equal(c.status, 'resolved')
    assert.ok(c.acknowledged_at)
    const list = await asUser(officer, async (cl) => (await cl.query('select public.console_complaints() as l')).rows[0].l)
    assert.ok(!list.some((x) => x.id === r.complaint_id))
  })
})

describe('demo complaints', () => {
  it('loads four, including an overdue one, for admins and supervisors only', async () => {
    const officer = await createStaff('Ravi', 'officer', ORG.cp)
    const admin = await createStaff('Asha', 'admin', null)
    await assert.rejects(call(officer, 'select public.admin_load_demo_complaints()'), /Only admins/)
    const n = await call(admin, 'select public.admin_load_demo_complaints() as n')
    assert.equal(n.n, 4)
    await tick(5)
    const { rows } = await db.query(
      `select category, severity, escalation_level, confidential from public.complaints
       where is_demo and status = 'submitted' order by created_at desc`,
    )
    assert.equal(rows.length, 4)
    assert.deepEqual(rows[0], {
      category: 'sexual_harassment',
      severity: 3,
      escalation_level: 0,
      confidential: true,
    })
    // The L2 harassment report from 40 minutes ago missed its 30-minute SLA; the others are within
    // theirs (L4 stalking 4 of 10 minutes, L1 lighting 60 minutes of 4 hours).
    assert.deepEqual(
      rows.map((r) => [r.category, r.escalation_level]),
      [
        ['sexual_harassment', 0],
        ['stalking', 0],
        ['harassment', 1],
        ['public_safety', 0],
      ],
    )

    // Reloading replaces them.
    await call(admin, 'select public.admin_load_demo_complaints()')
    const { rows: open } = await db.query(
      `select count(*)::int as n from public.complaints where is_demo and status = 'submitted'`,
    )
    assert.equal(open[0].n, 4)
  })
})
