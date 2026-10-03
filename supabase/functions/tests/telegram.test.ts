// The Telegram bot's replies to /start <code>, /stop and anything else.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { handleUpdate, type Linker } from '../telegram-webhook/handle.ts'

function db(linked = true): Linker & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    link: async (code, chatId, username) => {
      calls.push(['link', code, chatId, username])
      return linked ? { status: 'linked', owner_name: 'Priya' } : { status: 'unknown_code' }
    },
    unlink: async (chatId) => {
      calls.push(['unlink', chatId])
      return 1
    },
  }
}

const message = (text: string, type = 'private') => ({
  message: { chat: { id: 42, type }, from: { username: 'asha' }, text },
})

describe('telegram bot', () => {
  it('links a chat from the invite link', async () => {
    const fake = db()
    const reply = await handleUpdate(message('/start AbC_123-xyz456789012345'), fake)
    assert.deepEqual(fake.calls, [['link', 'AbC_123-xyz456789012345', 42, 'asha']])
    assert.equal(reply?.chatId, 42)
    assert.match(reply!.text, /You're now in Priya's trusted circle/)
  })

  it('explains a used or unknown invite', async () => {
    const reply = await handleUpdate(message('/start AbC_123-xyz456789012345'), db(false))
    assert.match(reply!.text, /already been used or is no longer valid/)
  })

  it('answers /start without a code, and /stop', async () => {
    const fake = db()
    assert.match((await handleUpdate(message('/start'), fake))!.text, /open the invite link/)
    assert.match((await handleUpdate(message('/stop'), fake))!.text, /won't get SOS alerts/)
    assert.deepEqual(fake.calls, [['unlink', 42]])
  })

  it('ignores groups and updates without a message', async () => {
    const fake = db()
    assert.equal(await handleUpdate(message('/start AbC_123-xyz456789012345', 'group'), fake), null)
    assert.equal(await handleUpdate({}, fake), null)
    assert.equal(fake.calls.length, 0)
  })
})
