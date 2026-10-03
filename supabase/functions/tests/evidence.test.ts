// The evidence and anchor functions' logic: re-hashing, removal, errors, and the OpenTimestamps
// calendar call. Runs on Node (node --test) with a fake bucket and fetch; no network.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import { drainAnchors, hexToBytes, stamp, toBase64 } from '../_shared/anchor.ts'
import { drainChecks, runCheck, sha256Hex, type Bucket, type EvidenceCheck } from '../_shared/evidence.ts'

const bytes = new TextEncoder().encode('a photo')
const check = (over: Partial<EvidenceCheck> = {}): EvidenceCheck => ({
  check_id: 'k1',
  evidence_id: 'e1',
  purpose: 'seal',
  storage_path: 'u1/e1',
  sha256: createHash('sha256').update('a photo').digest('hex'),
  size_bytes: bytes.byteLength,
  ...over,
})

function bucket(files: Record<string, Uint8Array>, removed: string[] = []): Bucket {
  return {
    download: async (path) => files[path] ?? null,
    remove: async (path) => {
      removed.push(path)
      delete files[path]
    },
  }
}

describe('evidence checks', () => {
  it('hashes the stored bytes like Node does', async () => {
    assert.equal(await sha256Hex(bytes), check().sha256)
    assert.deepEqual(await runCheck(check(), bucket({ 'u1/e1': bytes })), {
      sha256: check().sha256,
      size: bytes.byteLength,
    })
  })

  it('reports a missing file for a retry and removes files on purge', async () => {
    assert.deepEqual(await runCheck(check(), bucket({})), {
      error: 'The file is not in storage',
      retry: true,
    })
    const removed: string[] = []
    assert.deepEqual(await runCheck(check({ purpose: 'purge' }), bucket({ 'u1/e1': bytes }, removed)), {
      removed: true,
    })
    assert.deepEqual(removed, ['u1/e1'])
    const broken: Bucket = {
      download: async () => {
        throw new Error('timeout')
      },
      remove: async () => {},
    }
    assert.deepEqual(await runCheck(check(), broken), { error: 'Storage error: timeout', retry: true })
  })

  it('drains the queue and reports every check', async () => {
    const waiting = [check({ check_id: 'a' }), check({ check_id: 'b', purpose: 'purge' })]
    const finished: [string, unknown][] = []
    const totals = await drainChecks(
      {
        claim: async (limit) => waiting.splice(0, limit),
        finish: async (c, outcome) => {
          finished.push([c.check_id, outcome])
        },
      },
      bucket({ 'u1/e1': bytes }),
    )
    assert.deepEqual(totals, { hashed: 1, removed: 1, failed: 0 })
    assert.deepEqual(
      finished.map(([id]) => id),
      ['a', 'b'],
    )
  })
})

describe('anchoring', () => {
  const root = 'ab'.repeat(32)

  it('posts the raw 32-byte root to a calendar and keeps its answer', async () => {
    const calls: { url: string; body: Uint8Array }[] = []
    const outcome = await stamp(root, (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as Uint8Array })
      return new Response(new Uint8Array([0xf0, 1, 2]), { status: 200 })
    }) as typeof fetch)
    assert.deepEqual(outcome, {
      calendar: 'https://a.pool.opentimestamps.org',
      receipt: toBase64(new Uint8Array([0xf0, 1, 2])),
    })
    assert.equal(calls[0].url, 'https://a.pool.opentimestamps.org/digest')
    assert.deepEqual(Array.from(calls[0].body), Array.from(hexToBytes(root)))
  })

  it('falls through to the next calendar, and reports when all fail', async () => {
    let n = 0
    const flaky = (async (url: string) => {
      n++
      if (url.includes('a.pool.opentimestamps')) return new Response('busy', { status: 503 })
      return new Response(new Uint8Array([7]), { status: 200 })
    }) as typeof fetch
    const ok = await stamp(root, flaky)
    assert.equal('calendar' in ok && ok.calendar, 'https://b.pool.opentimestamps.org')
    assert.equal(n, 2)

    const down = (async () => {
      throw new Error('offline')
    }) as typeof fetch
    const failed = await stamp(root, down)
    assert.match('error' in failed ? failed.error : '', /a\.pool\.opentimestamps\.org: offline/)
    assert.deepEqual(await stamp('not-hex', down), { error: 'Not a SHA-256 root' })
  })

  it('drains claimed roots', async () => {
    const finished: string[] = []
    const totals = await drainAnchors(
      {
        claim: async () => [{ anchor_id: 'x', merkle_root: root }],
        finish: async (id) => {
          finished.push(id)
        },
      },
      (async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch,
    )
    assert.deepEqual(totals, { submitted: 1, failed: 0 })
    assert.deepEqual(finished, ['x'])
  })
})
