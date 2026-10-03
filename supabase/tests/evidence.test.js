// Phase 4: the evidence vault (register, upload policy, server re-hash, sharing, delayed
// deletion), cases with a workflow stored as data, the two-signature lock, the custody
// handshake, Merkle anchoring and the public verifier.

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'

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

const ORG = {
  control: '00000000-0000-4000-8000-000000000001',
  cp: '00000000-0000-4000-8000-000000000011',
  tilak: '00000000-0000-4000-8000-000000000012',
}
const CP = { lat: 28.6315, lng: 77.2167 }

const sha = (text) => createHash('sha256').update(text).digest('hex')

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

/** Registers a file, "uploads" it (a storage row, as the bucket would write) and confirms. */
async function addFile(userId, content, { caseId = null, upload = true } = {}) {
  const { r } = await call(
    userId,
    `select public.register_evidence(p_file_name => $1, p_mime_type => 'image/jpeg',
       p_size_bytes => $2, p_sha256 => $3, p_kind => 'photo', p_lat => $4, p_lng => $5,
       p_case_id => $6) as r`,
    ['photo.jpg', Buffer.byteLength(content), sha(content), CP.lat, CP.lng, caseId],
  )
  if (upload) {
    await asUser(userId, async (c) => {
      await c.query(
        `insert into storage.objects (bucket_id, name, owner) values ('evidence', $1, $2)`,
        [r.storage_path, userId],
      )
      await c.query('commit')
    })
    await call(userId, 'select public.confirm_evidence_upload($1)', [r.evidence_id])
  }
  return r
}

/** Plays the `evidence` Edge Function: claims the queue and reports the stored file's hash. */
async function runChecks(contentFor) {
  return asServiceRole(async (c) => {
    const { rows } = await c.query('select * from public.claim_evidence_checks(20)')
    const results = []
    for (const check of rows) {
      const content = contentFor(check)
      const { rows: out } = await c.query(
        'select public.finish_evidence_check($1, $2, $3) as r',
        check.purpose === 'purge'
          ? [check.check_id, null, null]
          : [check.check_id, sha(content), Buffer.byteLength(content)],
      )
      results.push({ ...check, result: out[0].r })
    }
    return results
  })
}

async function item(id) {
  return (await db.query('select * from public.evidence_items where id = $1', [id])).rows[0]
}

async function fileComplaint(userId, text = 'A man has been following me from the metro') {
  const { r } = await call(
    userId,
    `select public.create_complaint(p_description => $1, p_lat => $2, p_lng => $3) as r`,
    [text, CP.lat, CP.lng],
  )
  return r
}

async function sealedShared(citizen, content) {
  const complaint = await fileComplaint(citizen)
  const file = await addFile(citizen, content)
  await runChecks(() => content)
  await call(citizen, 'select public.share_evidence($1, $2)', [
    file.evidence_id,
    complaint.complaint_id,
  ])
  return { complaint, file }
}

async function team() {
  return {
    lead: await createStaff('Inspector Mehra', 'officer', ORG.cp),
    colleague: await createStaff('Constable Rao', 'officer', ORG.cp),
    supervisor: await createStaff('SHO Kapoor', 'supervisor', ORG.cp, 'supervisor'),
    elsewhere: await createStaff('Officer Tilak', 'officer', ORG.tilak),
  }
}

async function openCase(officer, complaintId) {
  return (
    await call(officer, `select public.open_case('Stalking near the metro', $1) as r`, [
      complaintId,
    ])
  ).r
}

describe('vault', () => {
  it('seals a file only when the server re-hash matches, and the verifier finds it', async () => {
    const citizen = await createUser('Meera')
    const content = 'original photo bytes ' + randomUUID()
    const file = await addFile(citizen, content)
    assert.equal(file.storage_path, `${citizen}/${file.evidence_id}`)
    assert.equal((await item(file.evidence_id)).status, 'registered')

    const checks = await runChecks(() => content)
    assert.deepEqual(
      checks.map((c) => [c.purpose, c.result.match]),
      [['seal', true]],
    )
    const sealed = await item(file.evidence_id)
    assert.equal(sealed.status, 'sealed')
    assert.ok(sealed.sealed_seq)
    assert.deepEqual(
      (await ledgerFor(file.evidence_id)).map((e) => e.action),
      ['evidence.registered', 'evidence.uploaded', 'evidence.sealed'],
    )
    // The sealing entry names no person and no place.
    const entry = (
      await db.query('select * from public.ledger_entries where seq = $1', [sealed.sealed_seq])
    ).rows[0]
    assert.equal(entry.actor_id, null)
    assert.equal(entry.lat, null)

    const found = await asAnon(
      async (c) => (await c.query('select public.verify_evidence($1) as r', [sha(content)])).rows[0].r,
    )
    assert.equal(found.found, true)
    assert.equal(found.entry.seq, Number(sealed.sealed_seq))
    // Every hash can be re-checked by a browser from what the verifier returns.
    assert.equal(sha(found.entry.payload_text), found.entry.payload_hash)
    assert.match(found.entry.payload_text, new RegExp(sha(content)))
    assert.equal(sha(found.entry.material), found.entry.entry_hash)
    assert.ok(!JSON.stringify(found).includes(citizen), 'no owner id in the answer')

    // One changed byte is a different file.
    const tampered = content.slice(0, -1) + (content.endsWith('a') ? 'b' : 'a')
    const missing = await asAnon(
      async (c) => (await c.query('select public.verify_evidence($1) as r', [sha(tampered)])).rows[0].r,
    )
    assert.equal(missing.found, false)
  })

  it('rejects a stored file that differs from the device fingerprint', async () => {
    const citizen = await createUser('Kavya')
    const file = await addFile(citizen, 'what the phone hashed')
    await runChecks(() => 'what actually arrived')
    const rejected = await item(file.evidence_id)
    assert.equal(rejected.status, 'rejected')
    assert.match(rejected.reject_reason, /does not match/)
    assert.equal((await ledgerFor(file.evidence_id)).at(-1).action, 'evidence.rejected')
  })

  it('lets owners upload only to their own registered path, once', async () => {
    const citizen = await createUser('Asha')
    const other = await createUser('Bina')
    const file = await addFile(citizen, 'asha file', { upload: false })
    const insert = (userId, name) =>
      asUser(userId, (c) =>
        c.query(`insert into storage.objects (bucket_id, name, owner) values ('evidence', $1, $2)`, [
          name,
          userId,
        ]),
      )
    await assert.rejects(insert(other, file.storage_path), /row-level security/)
    await assert.rejects(insert(citizen, `${citizen}/${randomUUID()}`), /row-level security/)
    await insert(citizen, file.storage_path)
    // Uploaded and confirmed: no second upload, no overwrite.
    await asUser(citizen, async (c) => {
      await c.query(`insert into storage.objects (bucket_id, name, owner) values ('evidence', $1, $2)`, [
        file.storage_path,
        citizen,
      ])
      await c.query('commit')
    })
    await call(citizen, 'select public.confirm_evidence_upload($1)', [file.evidence_id])
    await assert.rejects(
      asUser(citizen, (c) =>
        c.query(`update storage.objects set name = name where name = $1 returning 1`, [
          file.storage_path,
        ]).then((r) => {
          if (r.rowCount === 0) throw new Error('row-level security: no update')
        }),
      ),
      /row-level security/,
    )
  })

  it('closes an upload that never arrives after an hour', async () => {
    const citizen = await createUser('Late Uploader')
    const file = await addFile(citizen, 'never sent', { upload: false })
    await assert.rejects(
      call(citizen, 'select public.confirm_evidence_upload($1)', [file.evidence_id]),
      /not arrived/,
    )
    await db.query(`select private.tick(now() + interval '61 minutes')`)
    assert.equal((await item(file.evidence_id)).status, 'rejected')
  })

  it('waits 30 days before deleting, and never deletes shared evidence', async () => {
    const citizen = await createUser('Deleter')
    const content = 'to delete ' + randomUUID()
    const file = await addFile(citizen, content)
    await runChecks(() => content)
    const { r } = await call(citizen, 'select public.request_evidence_deletion($1) as r', [
      file.evidence_id,
    ])
    assert.ok(new Date(r.delete_after) - Date.now() > 29 * 86400_000)

    await db.query(`select private.tick(now() + interval '29 days')`)
    assert.equal((await item(file.evidence_id)).status, 'sealed', 'not before 30 days')
    await db.query(`select private.tick(now() + interval '31 days')`)
    const purges = await runChecks(() => null)
    assert.deepEqual(
      purges.map((p) => p.purpose),
      ['purge'],
    )
    const gone = await item(file.evidence_id)
    assert.equal(gone.status, 'deleted')
    // The ledger still proves it existed.
    assert.equal(
      (
        await asAnon(
          async (c) => (await c.query('select public.verify_evidence($1) as r', [sha(content)])).rows[0].r,
        )
      ).deleted_at !== null,
      true,
    )

    const { file: shared } = await sealedShared(citizen, 'shared ' + randomUUID())
    await assert.rejects(
      call(citizen, 'select public.request_evidence_deletion($1)', [shared.evidence_id]),
      /can't be deleted/,
    )
  })

  it('cancels a pending deletion when the item is shared', async () => {
    const citizen = await createUser('Changes Mind')
    const complaint = await fileComplaint(citizen)
    const content = 'keep me ' + randomUUID()
    const file = await addFile(citizen, content)
    await runChecks(() => content)
    await call(citizen, 'select public.request_evidence_deletion($1)', [file.evidence_id])
    await call(citizen, 'select public.share_evidence($1, $2)', [
      file.evidence_id,
      complaint.complaint_id,
    ])
    await db.query(`select private.tick(now() + interval '31 days')`)
    assert.equal((await item(file.evidence_id)).status, 'sealed')
  })
})

describe('cases and the workflow engine', () => {
  it('lists every missing requirement when a step is skipped', async () => {
    const t = await team()
    const citizen = await createUser('Reporter One')
    const { complaint, file } = await sealedShared(citizen, 'evidence ' + randomUUID())
    const opened = await openCase(t.lead, complaint.complaint_id)
    assert.equal(opened.created, true)
    assert.equal(
      (await openCase(t.colleague, complaint.complaint_id)).case_id,
      opened.case_id,
      'one open case per complaint',
    )

    const view = (
      await call(t.lead, 'select public.console_case($1) as r', [opened.case_id])
    ).r
    assert.equal(view.state, 'registered')
    assert.deepEqual(
      view.evidence.map((e) => e.id),
      [file.evidence_id],
      'evidence shared to the complaint is on the case',
    )

    const jump = (
      await call(t.lead, `select public.advance_case($1, 'submitted') as r`, [opened.case_id])
    ).r
    assert.equal(jump.ok, false)
    assert.deepEqual(
      jump.missing.map((m) => [m.state, m.kind]),
      [
        ['site_inspected', 'site_visit'],
        ['statement_recorded', 'statement'],
        ['evidence_locked', 'evidence_locked'],
      ],
    )
    assert.equal(
      (await db.query('select state from public.cases where id = $1', [opened.case_id])).rows[0]
        .state,
      'registered',
    )
    assert.equal((await ledgerFor(opened.case_id)).at(-1).action, 'case.advance_blocked')

    // Evidence is sealed, so the next step goes through.
    const step = (
      await call(t.lead, `select public.advance_case($1, 'evidence_collected') as r`, [
        opened.case_id,
      ])
    ).r
    assert.equal(step.ok, true)

    // A check-in 2 km away doesn't count; one at the site does.
    const far = (
      await call(t.lead, 'select public.case_checkin($1, 28.6500, 77.2167) as r', [opened.case_id])
    ).r
    assert.equal(far.within_geofence, false)
    assert.equal(
      (await call(t.lead, `select public.advance_case($1, 'site_inspected') as r`, [opened.case_id]))
        .r.ok,
      false,
    )
    const near = (
      await call(t.lead, 'select public.case_checkin($1, $2, $3) as r', [
        opened.case_id,
        CP.lat + 0.0005,
        CP.lng,
      ])
    ).r
    assert.equal(near.within_geofence, true)
    await call(t.lead, `select public.add_case_note($1, 'statement', $2)`, [
      opened.case_id,
      'The complainant states she was followed from Rajiv Chowk.',
    ])
    assert.equal(
      (
        await call(t.lead, `select public.advance_case($1, 'statement_recorded') as r`, [
          opened.case_id,
        ])
      ).r.ok,
      true,
    )
    await assert.rejects(
      call(t.lead, `select public.advance_case($1, 'registered')`, [opened.case_id]),
      /only moves forward/,
    )
  })

  it('keeps cases inside their station', async () => {
    const t = await team()
    const citizen = await createUser('Reporter Two')
    const { complaint, file } = await sealedShared(citizen, 'private ' + randomUUID())
    const opened = await openCase(t.lead, complaint.complaint_id)
    await assert.rejects(
      call(t.elsewhere, 'select public.console_case($1)', [opened.case_id]),
      /No such case/,
    )
    const control = await createStaff('Control Room', 'officer', ORG.control)
    assert.ok((await call(control, 'select public.console_case($1) as r', [opened.case_id])).r)

    // Storage downloads follow the same rule.
    const path = (await item(file.evidence_id)).storage_path
    const canRead = (userId) =>
      asUser(userId, async (c) =>
        (await c.query(`select count(*)::int as n from storage.objects where name = $1`, [path]))
          .rows[0].n,
      )
    assert.equal(await canRead(t.lead), 1)
    assert.equal(await canRead(citizen), 1)
    assert.equal(await canRead(t.elsewhere), 0)
  })

  it('shows a confidential reporter as their alias on evidence', async () => {
    const t = await team()
    const citizen = await createUser('Hidden Name')
    const { r: complaint } = await call(
      citizen,
      `select public.create_complaint(p_description => 'Someone keeps messaging me threats',
         p_lat => $1, p_lng => $2, p_confidential => true) as r`,
      [CP.lat, CP.lng],
    )
    const content = 'screenshot ' + randomUUID()
    const file = await addFile(citizen, content)
    await runChecks(() => content)
    await call(citizen, 'select public.share_evidence($1, $2)', [
      file.evidence_id,
      complaint.complaint_id,
    ])
    const opened = await openCase(t.lead, complaint.complaint_id)
    const view = (
      await call(t.lead, 'select public.console_evidence($1, $2) as r', [
        opened.case_id,
        file.evidence_id,
      ])
    ).r
    assert.match(view.added_by, /^Reporter [0-9A-F]{4}$/)
    assert.ok(!JSON.stringify(view).includes('Hidden Name'))
  })

  it('saves workflows as new versions and checks them', async () => {
    const admin = await createStaff('Admin', 'admin', null)
    const officer = await createStaff('Officer', 'officer', ORG.cp)
    const states = [
      { key: 'open', label: 'Open', requires: [] },
      { key: 'done', label: 'Done', requires: ['statement', 'statement'] },
    ]
    await assert.rejects(
      call(officer, `select public.admin_save_workflow('quick', 'Quick', $1)`, [
        JSON.stringify(states),
      ]),
      /Only admins/,
    )
    await assert.rejects(
      call(admin, `select public.admin_save_workflow('quick', 'Quick', $1)`, [
        JSON.stringify([{ key: 'a', label: 'A', requires: ['magic'] }, states[0]]),
      ]),
      /Unknown requirement|unique key/,
    )
    const v1 = (
      await call(admin, `select public.admin_save_workflow('quick', 'Quick', $1) as r`, [
        JSON.stringify(states),
      ])
    ).r
    const v2 = (
      await call(admin, `select public.admin_save_workflow('quick', 'Quick v2', $1) as r`, [
        JSON.stringify(states),
      ])
    ).r
    assert.deepEqual([v1.version, v2.version], [1, 2])
    const list = (await call(officer, 'select public.console_workflows() as r')).r
    const quick = list.workflows.find((w) => w.key === 'quick')
    assert.equal(quick.version, 2)
    assert.deepEqual(quick.states[1].requires, ['statement'])
  })
})

describe('lock and custody', () => {
  async function caseWithEvidence() {
    const t = await team()
    const citizen = await createUser('Reporter Three')
    const content = 'video ' + randomUUID()
    const { complaint, file } = await sealedShared(citizen, content)
    const opened = await openCase(t.lead, complaint.complaint_id)
    return { t, content, caseId: opened.case_id, evidenceId: file.evidence_id }
  }

  it("needs both the investigating officer's and a supervisor's signature to lock", async () => {
    const { t, caseId, evidenceId } = await caseWithEvidence()
    const sign = (userId) =>
      call(userId, 'select public.sign_evidence_lock($1, $2) as r', [caseId, evidenceId])

    await assert.rejects(sign(t.colleague), /Only the investigating officer or a supervisor/)
    const first = (await sign(t.lead)).r
    assert.deepEqual([first.capacity, first.locked], ['investigating_officer', false])
    await assert.rejects(sign(t.lead), /already signed/)
    const second = (await sign(t.supervisor)).r
    assert.deepEqual([second.capacity, second.locked], ['supervisor', true])

    const view = (await call(t.lead, 'select public.console_evidence($1, $2) as r', [caseId, evidenceId]))
      .r
    assert.ok(view.locked_at)
    assert.deepEqual(
      view.signatures.map((s) => [s.capacity, s.valid]),
      [
        ['investigating_officer', true],
        ['supervisor', true],
      ],
    )
    const signed = view.checklist.steps.find((s) => s.step === 'signed')
    assert.equal(signed.done, true)
    assert.deepEqual(
      (await ledgerFor(evidenceId)).map((e) => e.action).filter((a) => a.startsWith('evidence.lock')),
      ['evidence.lock_signed', 'evidence.lock_signed', 'evidence.locked'],
    )

    // A changed signature no longer verifies.
    await db.query(
      `update public.evidence_signatures set material = material || 'x'
       where case_id = $1 and evidence_id = $2 and capacity = 'supervisor'`,
      [caseId, evidenceId],
    )
    const after = (await call(t.lead, 'select public.console_evidence($1, $2) as r', [caseId, evidenceId]))
      .r
    assert.equal(after.signatures.find((s) => s.capacity === 'supervisor').valid, false)
  })

  it('hands custody over with both signatures and a re-verified hash', async () => {
    const { t, content, caseId, evidenceId } = await caseWithEvidence()
    await assert.rejects(
      call(t.colleague, `select public.start_custody_transfer($1, $2, $3, 'To the lab')`, [
        caseId,
        evidenceId,
        t.supervisor,
      ]),
      /current custodian/,
    )
    await assert.rejects(
      call(t.lead, `select public.start_custody_transfer($1, $2, $3, 'To the lab')`, [
        caseId,
        evidenceId,
        t.elsewhere,
      ]),
      /another officer on this case/,
    )
    const { r: started } = await call(
      t.lead,
      `select public.start_custody_transfer($1, $2, $3, 'To the forensic lab') as r`,
      [caseId, evidenceId, t.colleague],
    )
    await assert.rejects(
      call(t.supervisor, `select public.respond_custody_transfer($1, 'accept')`, [
        started.transfer_id,
      ]),
      /Only the receiving officer/,
    )
    await call(t.colleague, `select public.respond_custody_transfer($1, 'accept')`, [
      started.transfer_id,
    ])
    const checks = await runChecks(() => content)
    assert.deepEqual(
      checks.map((c) => [c.purpose, c.result.match]),
      [['transfer', true]],
    )

    const view = (
      await call(t.colleague, 'select public.console_evidence($1, $2) as r', [caseId, evidenceId])
    ).r
    assert.equal(view.custodian_id, t.colleague)
    const transfer = view.transfers[0]
    assert.deepEqual([transfer.status, transfer.rehash_ok], ['completed', true])
    assert.equal(transfer.rehash_sha256, sha(content))
    assert.deepEqual(
      view.signatures
        .filter((s) => s.transfer_id === transfer.id)
        .map((s) => [s.capacity, s.valid]),
      [
        ['sender', true],
        ['receiver', true],
      ],
    )
    assert.deepEqual(
      (await ledgerFor(evidenceId)).map((e) => e.action).filter((a) => a.startsWith('custody.')),
      [
        'custody.received',
        'custody.transfer_started',
        'custody.transfer_accepted',
        'custody.transferred',
      ],
    )

    // A file that changed in storage fails the hand-off and keeps the custodian.
    const { r: back } = await call(
      t.colleague,
      `select public.start_custody_transfer($1, $2, $3, 'Back to the IO') as r`,
      [caseId, evidenceId, t.lead],
    )
    await call(t.lead, `select public.respond_custody_transfer($1, 'accept')`, [back.transfer_id])
    await runChecks(() => 'swapped file')
    const after = (
      await call(t.lead, 'select public.console_evidence($1, $2) as r', [caseId, evidenceId])
    ).r
    assert.equal(after.custodian_id, t.colleague)
    assert.deepEqual(
      [after.transfers.at(-1).status, after.transfers.at(-1).rehash_ok],
      ['mismatch', false],
    )
    assert.ok(after.checklist.missing.includes('Custody clear'))
  })
})

describe('anchoring', () => {
  it('stamps a Merkle root whose proofs verify outside the database', async () => {
    const citizen = await createUser('Anchor Owner')
    const content = 'anchored ' + randomUUID()
    const file = await addFile(citizen, content)
    await runChecks(() => content)

    const anchor = (await db.query('select private.anchor_ledger() as r')).rows[0].r
    assert.ok(anchor.root)
    const before = (await db.query('select count(*)::int as n from net.requests')).rows[0].n
    assert.ok(before >= 1)

    // The root, recomputed from the entry hashes the same way a verifier would.
    const { rows } = await db.query(
      'select entry_hash from public.ledger_entries where seq between $1 and $2 order by seq',
      [anchor.from, anchor.to],
    )
    let level = rows.map((r) => Buffer.from(r.entry_hash, 'hex'))
    while (level.length > 1) {
      const next = []
      for (let i = 0; i < level.length; i += 2) {
        next.push(
          createHash('sha256')
            .update(Buffer.concat([level[i], level[i + 1] ?? level[i]]))
            .digest(),
        )
      }
      level = next
    }
    assert.equal(level[0].toString('hex'), anchor.root)

    // The anchor function stamps it.
    await asServiceRole(async (c) => {
      const claimed = (await c.query('select * from public.claim_anchors(5)')).rows
      assert.equal(claimed.length, 1)
      await c.query(`select public.finish_anchor($1, 'https://a.pool.opentimestamps.org', $2)`, [
        claimed[0].anchor_id,
        Buffer.from('receipt').toString('base64'),
      ])
    })

    const found = await asAnon(
      async (c) => (await c.query('select public.verify_evidence($1) as r', [sha(content)])).rows[0].r,
    )
    assert.equal(found.anchor.ots_status, 'submitted')
    let hash = Buffer.from(found.entry.entry_hash, 'hex')
    for (const step of found.anchor.proof) {
      const sibling = Buffer.from(step.hash, 'hex')
      hash = createHash('sha256')
        .update(step.side === 'left' ? Buffer.concat([sibling, hash]) : Buffer.concat([hash, sibling]))
        .digest()
    }
    assert.equal(hash.toString('hex'), found.anchor.merkle_root)

    // The next run starts where this one ended.
    await db.query(`select private.ledger_append('test.marker', 'test', null)`)
    const next = (await db.query('select private.anchor_ledger() as r')).rows[0].r
    assert.equal(next.from, anchor.to + 1)

    const view = (await call(citizen, 'select public.vault_item($1) as r', [file.evidence_id])).r
    assert.equal(view.anchor.ots_status, 'submitted')
    assert.equal(view.owner_id, undefined)
  })
})
