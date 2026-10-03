// The `anchor` function's logic (docs/02-architecture.md §6): submit each new ledger Merkle root
// to an OpenTimestamps calendar. Only the 32-byte root leaves the platform. The calendar's
// answer, prefixed with the standard header and the root, is a .ots proof that the official
// client can upgrade and verify once the calendar has committed it to Bitcoin.
//
// Pure logic: fetch is injected, so the tests run on Node without network.

export const CALENDARS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
]

export type ClaimedAnchor = { anchor_id: string; merkle_root: string }
export type StampOutcome = { calendar: string; receipt: string } | { error: string }

export function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Tries each calendar in turn until one returns a timestamp. Never throws. */
export async function stamp(
  rootHex: string,
  fetchFn: typeof fetch,
  calendars = CALENDARS,
): Promise<StampOutcome> {
  if (!/^[0-9a-f]{64}$/.test(rootHex)) return { error: 'Not a SHA-256 root' }
  const errors: string[] = []
  for (const calendar of calendars) {
    try {
      const response = await fetchFn(`${calendar}/digest`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.opentimestamps.v1',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'womens-safety-ledger',
        },
        body: hexToBytes(rootHex),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        errors.push(`${new URL(calendar).host}: ${response.status}`)
        continue
      }
      const receipt = new Uint8Array(await response.arrayBuffer())
      if (receipt.byteLength === 0) {
        errors.push(`${new URL(calendar).host}: empty answer`)
        continue
      }
      return { calendar, receipt: toBase64(receipt) }
    } catch (error) {
      errors.push(`${new URL(calendar).host}: ${(error as Error).message}`)
    }
  }
  return { error: errors.join('; ').slice(0, 300) }
}

export type AnchorQueue = {
  claim: (limit: number) => Promise<ClaimedAnchor[]>
  finish: (anchorId: string, outcome: StampOutcome) => Promise<void>
}

export async function drainAnchors(queue: AnchorQueue, fetchFn: typeof fetch) {
  const totals = { submitted: 0, failed: 0 }
  const claimed = await queue.claim(10)
  for (const anchor of claimed) {
    const outcome = await stamp(anchor.merkle_root, fetchFn)
    totals['error' in outcome ? 'failed' : 'submitted'] += 1
    await queue.finish(anchor.anchor_id, outcome)
  }
  return totals
}
