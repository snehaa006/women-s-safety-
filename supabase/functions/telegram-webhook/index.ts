// telegram-webhook: the Telegram bot. A contact opens t.me/<bot>?start=<code> from the citizen's
// invite; the code links their chat so SOS alerts can reach them. /stop unlinks it.
//
// Telegram signs nothing, so the webhook is registered with a secret token (setWebhook's
// secret_token) and every request must carry it in X-Telegram-Bot-Api-Secret-Token.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { telegramApi } from '../_shared/channels.ts'
import { env, json, serviceClient } from '../_shared/env.ts'

import { handleUpdate, type TelegramUpdate } from './handle.ts'

Deno.serve(async (request) => {
  const token = env('TELEGRAM_BOT_TOKEN')
  const secret = env('TELEGRAM_WEBHOOK_SECRET')
  if (!token || !secret) return json({ error: 'Telegram is not set up' }, 503)
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const update = (await request.json().catch(() => ({}))) as TelegramUpdate
  const client = serviceClient()

  const reply = await handleUpdate(update, {
    link: async (code, chatId, username) => {
      const { data, error } = await client.rpc('link_telegram', {
        p_code: code,
        p_chat_id: chatId,
        p_username: username,
      })
      if (error) throw new Error(error.message)
      return data
    },
    unlink: async (chatId) => {
      const { data, error } = await client.rpc('unlink_telegram_chat', { p_chat_id: chatId })
      if (error) throw new Error(error.message)
      return data ?? 0
    },
  })

  if (reply) {
    await telegramApi(token, 'sendMessage', { chat_id: reply.chatId, text: reply.text }, fetch)
  }
  // Always 200 once authenticated, or Telegram keeps re-sending the same update.
  return json({ ok: true })
})
