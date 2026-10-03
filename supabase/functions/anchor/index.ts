// anchor: stamps the ledger's Merkle roots with OpenTimestamps (docs/02-architecture.md §6).
//
// Called by Postgres through pg_net after the 10-minute anchoring job. It reads nothing from the
// request and trusts no caller: it only claims roots that are already waiting
// (public.claim_anchors) and stores each calendar receipt (public.finish_anchor). OpenTimestamps
// needs no key.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { drainAnchors, type ClaimedAnchor } from '../_shared/anchor.ts'
import { json, serviceClient } from '../_shared/env.ts'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const db = serviceClient()
  const totals = await drainAnchors(
    {
      claim: async (limit) => {
        const { data, error } = await db.rpc('claim_anchors', { p_limit: limit })
        if (error) throw new Error(`claim_anchors: ${error.message}`)
        return (data ?? []) as ClaimedAnchor[]
      },
      finish: async (anchorId, outcome) => {
        const { error } = await db.rpc('finish_anchor', {
          p_anchor_id: anchorId,
          p_calendar: 'calendar' in outcome ? outcome.calendar : null,
          p_receipt: 'receipt' in outcome ? outcome.receipt : null,
          p_error: 'error' in outcome ? outcome.error : null,
        })
        if (error) console.error(`finish_anchor ${anchorId}: ${error.message}`)
      },
    },
    fetch,
  )
  return json(totals)
})
