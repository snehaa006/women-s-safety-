// Channel adapters behind one interface: send(alert) → outcome. Email goes through Resend and
// Telegram through the Bot API. A channel without its key reports "skipped", so the citizen sees
// that it wasn't sent instead of a silent gap. `fetch` is injected so tests never hit the network.

import { renderMessage, type ClaimedAlert, type MessageOptions } from './messages.ts'

export type Outcome = {
  outcome: 'sent' | 'failed' | 'skipped'
  providerRef?: string
  error?: string
  /** Worth trying again later (rate limits, provider outages, network errors). */
  retry?: boolean
}

export type ChannelConfig = MessageOptions & {
  resendApiKey?: string
  emailFrom: string
  telegramBotToken?: string
}

type Fetch = typeof fetch

/** 429 and 5xx are temporary; other 4xx mean the request itself is wrong and won't improve. */
export function retryable(status: number) {
  return status === 429 || status >= 500
}

async function readError(response: Response) {
  try {
    const body = await response.json()
    return String(body?.message ?? body?.description ?? body?.error ?? response.statusText)
  } catch {
    return response.statusText || `HTTP ${response.status}`
  }
}

export async function sendEmail(
  alert: ClaimedAlert,
  config: ChannelConfig,
  fetchFn: Fetch,
): Promise<Outcome> {
  if (!config.resendApiKey) return { outcome: 'skipped', error: 'Email is not set up yet' }
  if (!alert.address) return { outcome: 'skipped', error: 'The contact has no email address' }
  const message = renderMessage(alert, config)
  const response = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [alert.address],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })
  if (!response.ok) {
    return {
      outcome: 'failed',
      error: `Email: ${await readError(response)}`,
      retry: retryable(response.status),
    }
  }
  const body = await response.json().catch(() => ({}))
  return { outcome: 'sent', providerRef: body?.id ? `resend:${body.id}` : 'resend' }
}

export async function telegramApi(
  token: string,
  method: string,
  payload: unknown,
  fetchFn: Fetch,
): Promise<Response> {
  return fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function sendTelegram(
  alert: ClaimedAlert,
  config: ChannelConfig,
  fetchFn: Fetch,
): Promise<Outcome> {
  if (!config.telegramBotToken) return { outcome: 'skipped', error: 'Telegram is not set up yet' }
  if (!alert.address) return { outcome: 'skipped', error: 'The contact unlinked Telegram' }
  const message = renderMessage(alert, config)
  const response = await telegramApi(
    config.telegramBotToken,
    'sendMessage',
    {
      chat_id: Number(alert.address),
      text: `${message.subject}\n\n${message.text}`,
      disable_web_page_preview: true,
      reply_markup: message.button
        ? { inline_keyboard: [[{ text: message.button.label, url: message.button.url }]] }
        : undefined,
    },
    fetchFn,
  )
  if (!response.ok) {
    return {
      outcome: 'failed',
      error: `Telegram: ${await readError(response)}`,
      retry: retryable(response.status),
    }
  }
  const body = await response.json().catch(() => ({}))
  const id = body?.result?.message_id
  return { outcome: 'sent', providerRef: id ? `telegram:${id}` : 'telegram' }
}

export async function deliver(
  alert: ClaimedAlert,
  config: ChannelConfig,
  fetchFn: Fetch = fetch,
): Promise<Outcome> {
  try {
    return alert.channel === 'email'
      ? await sendEmail(alert, config, fetchFn)
      : await sendTelegram(alert, config, fetchFn)
  } catch (error) {
    // Network errors and timeouts: try again.
    return {
      outcome: 'failed',
      error: `${alert.channel}: ${error instanceof Error ? error.message : String(error)}`,
      retry: true,
    }
  }
}

export type Queue = {
  claim: (limit: number) => Promise<ClaimedAlert[]>
  finish: (alertId: string, result: Outcome) => Promise<void>
}

/**
 * Drains due alerts: claim a batch, send it in parallel, report each result, repeat until the
 * queue is empty or the time budget is spent (the next tick picks up the rest).
 */
export async function flush(
  queue: Queue,
  send: (alert: ClaimedAlert) => Promise<Outcome>,
  { batchSize = 25, budgetMs = 20_000, clock = () => Date.now() } = {},
) {
  const started = clock()
  const totals = { sent: 0, failed: 0, skipped: 0 }
  while (clock() - started < budgetMs) {
    const batch = await queue.claim(batchSize)
    if (batch.length === 0) break
    await Promise.all(
      batch.map(async (alert) => {
        const result = await send(alert)
        await queue.finish(alert.alert_id, result)
        totals[result.outcome] += 1
      }),
    )
    if (batch.length < batchSize) break
  }
  return totals
}
