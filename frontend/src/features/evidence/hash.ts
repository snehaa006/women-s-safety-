// Everything here runs on the device: files are hashed locally and never leave it unless the
// person uploads them. The verifier re-checks every hash the server returns.

function hex(bytes: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** SHA-256 in lowercase hex of bytes or UTF-8 text. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
}

/** The file's fingerprint. Files are capped at 50 MB, so reading them whole is fine. */
export async function hashFile(file: Blob) {
  return sha256Hex(await file.arrayBuffer())
}

export type ProofStep = { side: 'left' | 'right'; hash: string }

/** Walks a Merkle proof from a ledger entry hash up to the anchored root (private.merkle). */
export async function merkleRootFromProof(leafHex: string, proof: ProofStep[]) {
  let node = fromHex(leafHex)
  for (const step of proof) {
    const sibling = fromHex(step.hash)
    const pair = new Uint8Array(64)
    pair.set(step.side === 'left' ? sibling : node, 0)
    pair.set(step.side === 'left' ? node : sibling, 32)
    node = new Uint8Array(await crypto.subtle.digest('SHA-256', pair))
  }
  return hex(node)
}

// The header of a detached OpenTimestamps proof, then version 1 and the SHA-256 file-hash op.
const OTS_MAGIC = [
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]

/** A standard .ots file for the anchored Merkle root: `ots upgrade` and `ots verify` read it. */
export function otsFile(rootHex: string, receiptBase64: string) {
  const receipt = Uint8Array.from(atob(receiptBase64), (c) => c.charCodeAt(0))
  return new Uint8Array([...OTS_MAGIC, 0x01, 0x08, ...fromHex(rootHex), ...receipt])
}

export function kindFromMime(mime: string): 'photo' | 'video' | 'audio' | 'document' | 'file' {
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'document'
  return 'file'
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function shortHash(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-8)}`
}
