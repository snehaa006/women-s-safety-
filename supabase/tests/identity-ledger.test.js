// Identity, roles and the ledger: the rules every later feature depends on.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'

import pg from 'pg'

import { asServiceRole, asUser, createUser, db, setupTestDatabase, testUrl } from './helpers.js'

setupTestDatabase()

async function verify() {
  const { rows } = await db.query('select * from public.ledger_verify()')
  return rows[0]
}

describe('sign-up', () => {
  it('creates a citizen profile and records it in the ledger', async () => {
    const id = await createUser('Priya Sharma')
    const { rows } = await db.query('select full_name, role from public.profiles where id = $1', [
      id,
    ])
    assert.deepEqual(rows[0], { full_name: 'Priya Sharma', role: 'citizen' })

    const entry = await db.query(
      `select action, actor_id, actor_role from public.ledger_entries
       where subject_type = 'profile' and subject_id = $1`,
      [id],
    )
    assert.deepEqual(entry.rows, [
      { action: 'account.created', actor_id: id, actor_role: 'citizen' },
    ])
  })
})

describe('profiles', () => {
  it('lets a user read and edit their own profile only', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')

    await asUser(priya, async (c) => {
      const own = await c.query('select id from public.profiles')
      assert.deepEqual(
        own.rows.map((r) => r.id),
        [priya],
      )

      await c.query(`update public.profiles set full_name = 'Priya S' where id = $1`, [priya])
      const other = await c.query(`update public.profiles set full_name = 'x' where id = $1`, [
        meera,
      ])
      assert.equal(other.rowCount, 0)
    })
  })

  it('never lets a user change their own role', async () => {
    const priya = await createUser('Priya')
    await asUser(priya, async (c) => {
      await assert.rejects(
        c.query(`update public.profiles set role = 'admin' where id = $1`, [priya]),
        /permission denied/,
      )
    })
  })

  it('lets only admins grant roles, and ledgers each grant', async () => {
    const adminId = await createUser('Asha Admin')
    const officerId = await createUser('Ravi')
    const someone = await createUser('Someone')

    // Bootstrap: the service role makes the first admin.
    await asServiceRole((c) => c.query(`select public.admin_set_role($1, 'admin')`, [adminId]))

    await asUser(someone, async (c) => {
      await assert.rejects(
        c.query(`select public.admin_set_role($1, 'officer')`, [officerId]),
        /Only an admin can change roles/,
      )
    })

    const client = new pg.Client({ connectionString: testUrl })
    await client.connect()
    await client.query('begin')
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [adminId])
    await client.query(`select public.admin_set_role($1, 'officer')`, [officerId])
    await client.query('commit')
    await client.end()

    const { rows } = await db.query(
      `select actor_id, payload from public.ledger_entries
       where action = 'profile.role_changed' and subject_id = $1`,
      [officerId],
    )
    assert.deepEqual(rows, [{ actor_id: adminId, payload: { from: 'citizen', to: 'officer' } }])
  })

  it('lets admins read every profile', async () => {
    const adminId = await createUser('Admin Two')
    await asServiceRole((c) => c.query(`select public.admin_set_role($1, 'admin')`, [adminId]))
    const total = (await db.query('select count(*)::int as n from public.profiles')).rows[0].n
    await asUser(adminId, async (c) => {
      const { rows } = await c.query('select count(*)::int as n from public.profiles')
      assert.equal(rows[0].n, total)
    })
  })
})

describe('organizations', () => {
  it('are readable by signed-in users and writable only by admins', async () => {
    const priya = await createUser('Priya')
    await asUser(priya, async (c) => {
      const { rows } = await c.query('select count(*)::int as n from public.organizations')
      assert.equal(rows[0].n, 5)
      await assert.rejects(
        c.query(`insert into public.organizations (name, type) values ('Fake', 'police_station')`),
        /row-level security/,
      )
    })
  })

  it('are hidden from anonymous visitors', async () => {
    const client = new pg.Client({ connectionString: testUrl })
    await client.connect()
    await client.query('set role anon')
    await assert.rejects(client.query('select * from public.organizations'), /permission denied/)
    await client.end()
  })
})

describe('public API surface', () => {
  it('exposes only the deliberate security-definer RPCs', async () => {
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef order by p.proname`)
    assert.deepEqual(
      rows.map((r) => r.proname),
      [
        'admin_set_role',
        'claim_alerts',
        'create_sos',
        'device_event',
        'disconnect_telegram',
        'finish_alert',
        'incident_timeline',
        'ledger_verify',
        'link_telegram',
        'record_location',
        'register_device',
        'reset_device_secret',
        'resolve_incident',
        'respond_to_share_link',
        'set_sos_pins',
        'sos_pin_status',
        'unlink_telegram_chat',
        'view_share_link',
      ],
    )
  })

  it('lets anonymous visitors call only the live-link, device and safe-point RPCs', async () => {
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
      order by p.proname`)
    assert.deepEqual(
      rows.map((r) => r.proname),
      ['device_event', 'nearby_safe_points', 'respond_to_share_link', 'view_share_link'],
    )
  })

  it('keeps the sending and Telegram-linking RPCs for the service role only', async () => {
    const { rows } = await db.query(`
      select p.proname,
             has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
             has_function_privilege('service_role', p.oid, 'execute') as service
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('claim_alerts', 'finish_alert', 'link_telegram', 'unlink_telegram_chat')
      order by p.proname`)
    assert.equal(rows.length, 4)
    for (const row of rows) {
      assert.deepEqual([row.signed_in, row.service], [false, true], row.proname)
    }
  })
})

describe('ledger', () => {
  it('chains entries and verifies cleanly', async () => {
    const userId = await createUser('Chain Tester')
    await asServiceRole(async (c) => {
      for (const action of ['sos.triggered', 'alert.sent', 'alert.acknowledged']) {
        await c.query(
          `select private.ledger_append($1, 'incident', $2, $3, p_lat => 28.6139, p_lng => 77.2090, p_actor_id => $4)`,
          [action, randomUUID(), { note: action }, userId],
        )
      }
    })

    const { rows } = await db.query(
      'select seq, prev_hash, entry_hash from public.ledger_entries order by seq',
    )
    rows.forEach((row, i) => {
      assert.equal(Number(row.seq), i + 1, 'seq is gapless')
      assert.equal(row.prev_hash, i === 0 ? '0'.repeat(64) : rows[i - 1].entry_hash)
    })
    assert.deepEqual(await verify(), {
      ok: true,
      checked: String(rows.length),
      first_bad_seq: null,
      reason: null,
    })
  })

  it('refuses updates and deletes, even from the service role', async () => {
    await asServiceRole(async (c) => {
      await assert.rejects(
        c.query(`update public.ledger_entries set payload = '{}' where seq = 1`),
        /append-only/,
      )
      await assert.rejects(
        c.query('delete from public.ledger_entries where seq = 1'),
        /append-only/,
      )
    })
    await assert.rejects(db.query('truncate public.ledger_entries'), /append-only/)
  })

  it('cannot be written directly by signed-in users', async () => {
    const priya = await createUser('Priya')
    await asUser(priya, async (c) => {
      await assert.rejects(
        c.query(`select private.ledger_append('sos.triggered', 'incident', gen_random_uuid())`),
        /permission denied/,
      )
    })
    await asUser(priya, async (c) => {
      await assert.rejects(
        c.query(
          `insert into public.ledger_entries (occurred_at, action, subject_type, payload_hash, prev_hash, entry_hash)
           values (now(), 'fake.entry', 'incident', 'x', 'x', 'x')`,
        ),
        /permission denied/,
      )
    })
  })

  it('takes the actor from the session, not from the caller', async () => {
    const priya = await createUser('Priya')
    const meera = await createUser('Meera')
    // A domain function running for Priya cannot attribute an entry to Meera.
    await db.query(`
      create function public.test_append_as(p_claimed uuid) returns uuid
      language sql security definer set search_path = '' as $$
        select (private.ledger_append('test.event', 'profile', p_claimed, p_actor_id => p_claimed)).actor_id
      $$;
      grant execute on function public.test_append_as to authenticated;
    `)
    await asUser(priya, async (c) => {
      const { rows } = await c.query('select public.test_append_as($1) as actor', [meera])
      assert.equal(rows[0].actor, priya)
    })
    await db.query('drop function public.test_append_as')
  })

  it('lets users read only the entries they authored', async () => {
    const priya = await createUser('Priya Reader')
    await asUser(priya, async (c) => {
      const { rows } = await c.query('select distinct actor_id from public.ledger_entries')
      assert.deepEqual(
        rows.map((r) => r.actor_id),
        [priya],
      )
      await assert.rejects(c.query('select * from public.ledger_verify()'), /admin or oversight/)
    })
  })

  it('stays a valid chain under concurrent writers', async () => {
    const writers = Array.from({ length: 8 }, (_, i) =>
      asServiceRole((c) =>
        c.query(`select private.ledger_append('load.test', 'incident', gen_random_uuid(), $1)`, [
          { writer: i },
        ]),
      ),
    )
    await Promise.all(writers)
    assert.equal((await verify()).ok, true)
  })

  it('detects a tampered entry', async () => {
    // Simulate an attacker with database superuser access who bypasses the triggers.
    const { rows } = await db.query(
      `select seq from public.ledger_entries where action = 'alert.sent' limit 1`,
    )
    const target = rows[0].seq
    await db.query('alter table public.ledger_entries disable trigger ledger_no_update_delete')
    await db.query(
      `update public.ledger_entries set payload = '{"note":"edited"}' where seq = $1`,
      [target],
    )
    await db.query('alter table public.ledger_entries enable trigger ledger_no_update_delete')

    const result = await verify()
    assert.equal(result.ok, false)
    assert.equal(result.first_bad_seq, target)
    assert.equal(result.reason, 'payload was changed')
  })
})
