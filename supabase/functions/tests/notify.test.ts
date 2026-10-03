// The notify function's logic: message text, channel adapters and the flush loop. Runs on Node
// (node --test) with fakes for fetch and the database; no network.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { deliver, flush, retryable, type ChannelConfig, type Outcome } from '../_shared/channels.ts'
import { renderMessage, type ClaimedAlert } from '../_shared/messages.ts'

const alert: ClaimedAlert = {
  alert_id: 'a1',
  channel: 'email',
  template: 'sos',
  level: 0,
  attempts: 1,
  address: 'asha@example.test',
  recipient_name: 'Asha',
  citizen_name: 'Priya',
  citizen_phone: '+919876543210',
  link_token: 'tok_ABC-123',
  incident_status: 'active',
  lat: '28.6315',
  lng: '77.2167',
  location_at: '2026-10-02T08:33:00Z',
  started_at: '2026-10-02T08:35:00Z',
  source: 'simulator',
}

const config: ChannelConfig = {
  siteUrl: 'https://safety.example/',
  timeZone: 'Asia/Kolkata',
  now: new Date('2026-10-02T08:36:00Z'),
  resendApiKey: 're_test',
  emailFrom: 'Safety <alerts@safety.example>',
  telegramBotToken: '123:abc',
}

type Call = { url: string; init: RequestInit }

function fakeFetch(status: number, body: unknown, calls: Call[] = []) {
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { fn, calls }
}

describe('messages', () => {
  it('puts the live link, position, phone and 112 in an SOS', () => {
    const message = renderMessage(alert, config)
    assert.equal(message.subject, 'SOS: Priya needs help')
    assert.match(message.text, /Priya sent an SOS at 2:05 pm from her wearable\./i)
    assert.match(message.text, /Follow her live location: https:\/\/safety\.example\/t\/tok_ABC-123/)
    assert.match(message.text, /Last known position \(3 minutes ago\): https:\/\/maps\.google\.com\/\?q=28\.6315,77\.2167/)
    assert.match(message.text, /Call Priya: \+919876543210/)
    assert.match(message.text, /call 112/)
    assert.deepEqual(message.button, {
      label: 'Open live location',
      url: 'https://safety.example/t/tok_ABC-123',
    })
    assert.match(message.html, /<a href="https:\/\/safety\.example\/t\/tok_ABC-123">/)
  })

  it('words reminders and "safe" messages differently', () => {
    const reminder = renderMessage({ ...alert, template: 'reminder' }, config)
    assert.equal(reminder.subject, "Reminder: Priya's SOS is still active")
    assert.match(reminder.text, /nobody has said they're responding yet/)

    const safe = renderMessage({ ...alert, template: 'safe' }, config)
    assert.equal(safe.subject, 'Priya is safe')
    assert.doesNotMatch(safe.text, /live location/)
    assert.equal(safe.button, null)
  })

  it('escapes HTML from names', () => {
    const message = renderMessage({ ...alert, citizen_name: '<b>Eve</b>' }, config)
    assert.doesNotMatch(message.html, /<b>Eve<\/b>/)
    assert.match(message.html, /&lt;b&gt;Eve&lt;\/b&gt;/)
  })
})

describe('channels', () => {
  it('sends email through Resend', async () => {
    const { fn, calls } = fakeFetch(200, { id: 'em_1' })
    const result = await deliver(alert, config, fn)
    assert.deepEqual(result, { outcome: 'sent', providerRef: 'resend:em_1' })
    assert.equal(calls[0].url, 'https://api.resend.com/emails')
    const headers = calls[0].init.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer re_test')
    const body = JSON.parse(String(calls[0].init.body))
    assert.deepEqual(body.to, ['asha@example.test'])
    assert.equal(body.from, 'Safety <alerts@safety.example>')
    assert.equal(body.subject, 'SOS: Priya needs help')
  })

  it('sends Telegram messages with a button to the live link', async () => {
    const { fn, calls } = fakeFetch(200, { ok: true, result: { message_id: 99 } })
    const result = await deliver({ ...alert, channel: 'telegram', address: '424242' }, config, fn)
    assert.deepEqual(result, { outcome: 'sent', providerRef: 'telegram:99' })
    assert.equal(calls[0].url, 'https://api.telegram.org/bot123:abc/sendMessage')
    const body = JSON.parse(String(calls[0].init.body))
    assert.equal(body.chat_id, 424242)
    assert.match(body.text, /^SOS: Priya needs help\n\n/)
    assert.equal(body.reply_markup.inline_keyboard[0][0].url, 'https://safety.example/t/tok_ABC-123')
  })

  it('skips a channel whose key is missing, without calling out', async () => {
    const { fn, calls } = fakeFetch(200, {})
    const email = await deliver(alert, { ...config, resendApiKey: undefined }, fn)
    const telegram = await deliver(
      { ...alert, channel: 'telegram' },
      { ...config, telegramBotToken: undefined },
      fn,
    )
    assert.deepEqual(email, { outcome: 'skipped', error: 'Email is not set up yet' })
    assert.deepEqual(telegram, { outcome: 'skipped', error: 'Telegram is not set up yet' })
    assert.equal(calls.length, 0)
  })

  it('retries rate limits, outages and network errors, not bad requests', async () => {
    assert.deepEqual([429, 500, 503, 400, 403, 422].map(retryable), [
      true,
      true,
      true,
      false,
      false,
      false,
    ])
    const limited = await deliver(alert, config, fakeFetch(429, { message: 'Too many' }).fn)
    assert.deepEqual(limited, { outcome: 'failed', error: 'Email: Too many', retry: true })
    const sandbox = await deliver(
      alert,
      config,
      fakeFetch(403, { message: 'You can only send testing emails to your own address' }).fn,
    )
    assert.equal(sandbox.retry, false)
    const blocked = await deliver(
      { ...alert, channel: 'telegram', address: '1' },
      config,
      fakeFetch(403, { ok: false, description: 'Forbidden: bot was blocked by the user' }).fn,
    )
    assert.deepEqual(blocked, {
      outcome: 'failed',
      error: 'Telegram: Forbidden: bot was blocked by the user',
      retry: false,
    })
    const offline = await deliver(alert, config, (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch)
    assert.deepEqual(offline, { outcome: 'failed', error: 'email: fetch failed', retry: true })
  })
})

describe('flush', () => {
  it('claims batches until the queue is empty and reports every result', async () => {
    const queue = Array.from({ length: 5 }, (_, i) => ({ ...alert, alert_id: `a${i}` }))
    const finished: [string, Outcome][] = []
    const totals = await flush(
      {
        claim: async (limit) => queue.splice(0, limit),
        finish: async (id, result) => {
          finished.push([id, result])
        },
      },
      async (a) =>
        a.alert_id === 'a3' ? { outcome: 'failed', error: 'x', retry: true } : { outcome: 'sent' },
      { batchSize: 2 },
    )
    assert.deepEqual(totals, { sent: 4, failed: 1, skipped: 0 })
    assert.equal(finished.length, 5)
  })

  it('stops when its time budget is spent', async () => {
    let now = 0
    let claims = 0
    await flush(
      {
        claim: async (limit) => {
          claims += 1
          now += 15_000
          return Array.from({ length: limit }, (_, i) => ({ ...alert, alert_id: `b${i}` }))
        },
        finish: async () => {},
      },
      async () => ({ outcome: 'sent' }),
      { batchSize: 1, budgetMs: 20_000, clock: () => now },
    )
    assert.equal(claims, 2)
  })
})
