// The `evidence` function's logic (docs/02-architecture.md §11): re-hash a stored file for
// sealing or a custody hand-off, or remove a file whose deletion came due. The database decides
// what a hash means; this code only reports what is in the bucket.
//
// Pure logic: the bucket is injected, so the tests run on Node without Supabase.

export type EvidenceCheck = {
  check_id: string
  evidence_id: string
  purpose: 'seal' | 'transfer' | 'purge'
  storage_path: string
  sha256: string
  size_bytes: number
}

export type CheckOutcome =
  | { sha256: string; size: number }
  | { removed: true }
  | { error: string; retry: boolean }

export type Bucket = {
  /** The file's bytes, or null when there is no such object. */
  download: (path: string) => Promise<Uint8Array | null>
  remove: (path: string) => Promise<void>
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Runs one check. Never throws. */
export async function runCheck(check: EvidenceCheck, bucket: Bucket): Promise<CheckOutcome> {
  try {
    if (check.purpose === 'purge') {
      await bucket.remove(check.storage_path)
      return { removed: true }
    }
    const bytes = await bucket.download(check.storage_path)
    if (!bytes) return { error: 'The file is not in storage', retry: true }
    return { sha256: await sha256Hex(bytes), size: bytes.byteLength }
  } catch (error) {
    return { error: `Storage error: ${(error as Error).message}`.slice(0, 200), retry: true }
  }
}

export type CheckQueue = {
  claim: (limit: number) => Promise<EvidenceCheck[]>
  finish: (check: EvidenceCheck, outcome: CheckOutcome) => Promise<void>
}

/** Claims checks a few at a time until the queue is empty. Files are read one by one. */
export async function drainChecks(queue: CheckQueue, bucket: Bucket, { batch = 3, maxRounds = 5 } = {}) {
  const totals = { hashed: 0, removed: 0, failed: 0 }
  for (let round = 0; round < maxRounds; round++) {
    const claimed = await queue.claim(batch)
    if (claimed.length === 0) break
    for (const check of claimed) {
      const outcome = await runCheck(check, bucket)
      if ('error' in outcome) totals.failed += 1
      else if ('removed' in outcome) totals.removed += 1
      else totals.hashed += 1
      await queue.finish(check, outcome)
    }
  }
  return totals
}
