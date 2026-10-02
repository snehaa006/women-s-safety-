// Shared setup for the database tests: each test file gets a fresh database with the Supabase
// stub, every migration and the seed applied. Needs DATABASE_URL pointing at a superuser
// connection, e.g. DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test

import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const supabaseDir = join(here, '..')
const adminUrl = process.env.DATABASE_URL
if (!adminUrl) throw new Error('Set DATABASE_URL to a superuser connection string')

// node --test runs each file in its own process, so the pid keeps databases apart.
const testDb = `ws_test_${process.pid}`
export const testUrl = (() => {
  const url = new URL(adminUrl)
  url.pathname = `/${testDb}`
  return url.toString()
})()

/** Superuser connection to the test database. Set once setupTestDatabase's hook has run. */
export let db

function sqlFile(...parts) {
  return readFileSync(join(supabaseDir, ...parts), 'utf8')
}

/** Registers hooks that create the test database before the file's tests and drop it after. */
export function setupTestDatabase() {
  before(async () => {
    const admin = new pg.Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`drop database if exists ${testDb}`)
    await admin.query(`create database ${testDb}`)
    await admin.end()

    db = new pg.Client({ connectionString: testUrl })
    await db.connect()
    await db.query(sqlFile('tests', 'supabase-stub.sql'))
    const migrations = readdirSync(join(supabaseDir, 'migrations')).filter((f) =>
      f.endsWith('.sql'),
    )
    for (const file of migrations.sort()) {
      await db.query(sqlFile('migrations', file))
    }
    await db.query(sqlFile('seed.sql'))
  })

  after(async () => {
    await db?.end()
    const admin = new pg.Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`drop database if exists ${testDb} with (force)`)
    await admin.end()
  })
}

async function withClient(setup, fn, { transaction }) {
  const client = new pg.Client({ connectionString: testUrl })
  await client.connect()
  try {
    if (transaction) await client.query('begin')
    await setup(client)
    return await fn(client)
  } finally {
    if (transaction) await client.query('rollback').catch(() => {})
    await client.end()
  }
}

/** Runs fn inside a transaction as a signed-in Supabase user (role authenticated). Rolls back. */
export function asUser(userId, fn) {
  return withClient(
    async (c) => {
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    },
    fn,
    { transaction: true },
  )
}

/** Like asUser, but commits, for steps whose effects later assertions read. */
export function asUserCommitted(userId, fn) {
  return withClient(
    async (c) => {
      await c.query('set role authenticated')
      await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId])
    },
    fn,
    { transaction: false },
  )
}

/** Runs fn as a visitor with only the publishable key (role anon). Commits. */
export function asAnon(fn) {
  return withClient((c) => c.query('set role anon'), fn, { transaction: false })
}

/** Runs fn as the service role (what an Edge Function or backend with the secret key uses). */
export function asServiceRole(fn) {
  return withClient((c) => c.query('set role service_role'), fn, { transaction: false })
}

/** Creates an auth user; the sign-up trigger gives them a citizen profile. */
export async function createUser(fullName) {
  const id = randomUUID()
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${id}@example.test`,
    { full_name: fullName },
  ])
  return id
}

/** Ledger entries about one subject, oldest first. */
export async function ledgerFor(subjectId) {
  const { rows } = await db.query(
    `select action, actor_id, device_id, lat, lng, payload
     from public.ledger_entries where subject_id = $1 order by seq`,
    [subjectId],
  )
  return rows
}
