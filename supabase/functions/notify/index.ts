// notify: sends the alerts the database has queued (email via Resend, Telegram via the Bot API).
//
// Called by Postgres through pg_net right after an SOS and by the Cron tick while alerts wait.
// It reads nothing from the request and trusts no caller: it only claims alerts that are already
// due (public.claim_alerts) and reports each result (public.finish_alert), which writes the
// ledger. That is why it runs without JWT verification.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { deliver, flush, type Outcome } from '../_shared/channels.ts'
import { channelConfig, json, serviceClient } from '../_shared/env.ts'
import type { ClaimedAlert } from '../_shared/messages.ts'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const client = serviceClient()
  const config = channelConfig()

  const totals = await flush(
    {
      claim: async (limit) => {
        const { data, error } = await client.rpc('claim_alerts', { p_limit: limit })
        if (error) throw new Error(`claim_alerts: ${error.message}`)
        return (data ?? []) as ClaimedAlert[]
      },
      finish: async (alertId, result: Outcome) => {
        const { error } = await client.rpc('finish_alert', {
          p_alert_id: alertId,
          p_outcome: result.outcome,
          p_provider_ref: result.providerRef ?? null,
          p_error: result.error ?? null,
          p_retry: result.retry ?? false,
        })
        // The tick re-queues an alert stuck in "sending", so a lost report is retried later.
        if (error) console.error(`finish_alert ${alertId}: ${error.message}`)
      },
    },
    (alert) => deliver(alert, config),
  )

  return json(totals)
})
