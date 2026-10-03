// triage: the asynchronous AI triage of complaints (docs/02-architecture.md §9.1).
//
// Called by Postgres through pg_net when a complaint is filed, and again by the complaint's
// triage checks while it waits. Like `notify`, it reads nothing from the request and trusts no
// caller: it only claims complaints that are already waiting (public.claim_triage) and reports
// each answer (public.finish_triage), which applies the max(rules, model) rule and writes the
// ledger. That is why it runs without JWT verification.
//
// GEMINI_API_KEY switches the Gemini adapter on; TRIAGE_MODEL overrides the model. Without the
// key every complaint keeps the rules' answer and is recorded as "skipped".

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { env, json, serviceClient } from '../_shared/env.ts'
import {
  classify,
  DEFAULT_MODEL,
  drain,
  geminiClient,
  type ClaimedComplaint,
} from '../_shared/triage.ts'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const db = serviceClient()
  const apiKey = env('GEMINI_API_KEY')
  const model = env('TRIAGE_MODEL') ?? DEFAULT_MODEL
  const generate = apiKey ? geminiClient(apiKey) : null

  const totals = await drain(
    {
      claim: async (limit) => {
        const { data, error } = await db.rpc('claim_triage', { p_limit: limit })
        if (error) throw new Error(`claim_triage: ${error.message}`)
        return (data ?? []) as ClaimedComplaint[]
      },
      finish: async (complaintId, outcome) => {
        const { error } = await db.rpc('finish_triage', {
          p_complaint_id: complaintId,
          p_outcome: outcome.outcome,
          p_result: outcome.outcome === 'done' ? outcome.result : null,
          p_error: outcome.outcome === 'done' ? null : outcome.error,
          p_retry: outcome.outcome === 'failed' ? outcome.retry : false,
        })
        // The complaint's triage checks re-ask later, so a lost report is retried.
        if (error) console.error(`finish_triage ${complaintId}: ${error.message}`)
      },
    },
    (complaint) => classify(complaint, generate, model),
  )

  return json(totals)
})
