import type { Verification } from './api'
import { merkleRootFromProof, sha256Hex } from './hash'

export type Check = { label: string; ok: boolean }

/** Re-checks, in this browser, every hash the server returned. */
export async function checkVerification(v: Extract<Verification, { found: true }>) {
  const checks: Check[] = [
    {
      label: "The sealing entry's payload names this fingerprint",
      ok: v.entry.payload_text.includes(v.sha256),
    },
    {
      label: 'The payload hashes to the entry’s payload hash',
      ok: (await sha256Hex(v.entry.payload_text)) === v.entry.payload_hash,
    },
    {
      label: 'The entry’s fields hash to its entry hash (chained to the previous entry)',
      ok:
        (await sha256Hex(v.entry.material)) === v.entry.entry_hash &&
        v.entry.material.includes(v.entry.payload_hash) &&
        v.entry.material.includes(v.entry.prev_hash),
    },
  ]
  if (v.anchor?.proof) {
    checks.push({
      label: `The Merkle proof leads to the anchored root of entries ${v.anchor.from_seq}–${v.anchor.to_seq}`,
      ok: (await merkleRootFromProof(v.entry.entry_hash, v.anchor.proof)) === v.anchor.merkle_root,
    })
  }
  return checks
}
