import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { formatBytes, kindFromMime, merkleRootFromProof, otsFile, sha256Hex } from './hash'

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

describe('hashing', () => {
  it('matches Node for text and bytes, and one changed byte changes it', async () => {
    expect(await sha256Hex('original')).toBe(sha('original'))
    const bytes = new TextEncoder().encode('original')
    expect(await sha256Hex(bytes)).toBe(sha('original'))
    bytes[0] ^= 1
    expect(await sha256Hex(bytes)).not.toBe(sha('original'))
  })

  it('walks a Merkle proof to the root the database computes', async () => {
    const leaves = ['a', 'b', 'c'].map((l) => Buffer.from(sha(l), 'hex'))
    const pair = (x: Buffer, y: Buffer) =>
      createHash('sha256')
        .update(Buffer.concat([x, y]))
        .digest()
    const ab = pair(leaves[0], leaves[1])
    const cc = pair(leaves[2], leaves[2])
    const root = pair(ab, cc).toString('hex')
    // Leaf c: its sibling is itself (odd node), then ab on the left.
    const proof = [
      { side: 'right' as const, hash: leaves[2].toString('hex') },
      { side: 'left' as const, hash: ab.toString('hex') },
    ]
    expect(await merkleRootFromProof(leaves[2].toString('hex'), proof)).toBe(root)
    expect(await merkleRootFromProof(leaves[0].toString('hex'), proof)).not.toBe(root)
    expect(await merkleRootFromProof(root, [])).toBe(root)
  })
})

describe('helpers', () => {
  it('builds a detached .ots file around the root', () => {
    const file = otsFile('ab'.repeat(32), btoa('ð\u0001'))
    expect(new TextDecoder().decode(file.slice(1, 15))).toBe('OpenTimestamps')
    expect(file[31]).toBe(0x01)
    expect(file[32]).toBe(0x08)
    expect(file[33]).toBe(0xab)
    expect(Array.from(file.slice(-2))).toEqual([0xf0, 0x01])
    expect(file.length).toBe(31 + 2 + 32 + 2)
  })

  it('names kinds and sizes', () => {
    expect(kindFromMime('image/jpeg')).toBe('photo')
    expect(kindFromMime('audio/webm')).toBe('audio')
    expect(kindFromMime('application/pdf')).toBe('document')
    expect(formatBytes(2048)).toBe('2.0 KB')
  })
})
