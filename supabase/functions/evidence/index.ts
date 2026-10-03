// evidence: re-hashes stored evidence files and removes files whose deletion came due
// (docs/02-architecture.md §11).
//
// Called by Postgres through pg_net when an upload is confirmed or a custody hand-off is
// accepted, and again by the check jobs while work waits. Like `notify`, it reads nothing from
// the request and trusts no caller: it only claims checks that are already queued
// (public.claim_evidence_checks) and reports what the bucket holds (public.finish_evidence_check),
// which decides sealing, custody and deletion and writes the ledger.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { json, serviceClient } from '../_shared/env.ts'
import { drainChecks, type EvidenceCheck } from '../_shared/evidence.ts'

const BUCKET = 'evidence'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const db = serviceClient()
  const totals = await drainChecks(
    {
      claim: async (limit) => {
        const { data, error } = await db.rpc('claim_evidence_checks', { p_limit: limit })
        if (error) throw new Error(`claim_evidence_checks: ${error.message}`)
        return (data ?? []) as EvidenceCheck[]
      },
      finish: async (check, outcome) => {
        const { error } = await db.rpc('finish_evidence_check', {
          p_check_id: check.check_id,
          p_sha256: 'sha256' in outcome ? outcome.sha256 : null,
          p_size_bytes: 'size' in outcome ? outcome.size : null,
          p_error: 'error' in outcome ? outcome.error : null,
          p_retry: 'error' in outcome ? outcome.retry : false,
        })
        // A claimed check is re-claimed after two minutes, so a lost report is retried.
        if (error) console.error(`finish_evidence_check ${check.check_id}: ${error.message}`)
      },
    },
    {
      download: async (path) => {
        const { data, error } = await db.storage.from(BUCKET).download(path)
        if (error || !data) {
          const status = (error as { status?: number; statusCode?: string } | null)?.statusCode
          if (status === '404' || /not.?found/i.test(error?.message ?? '')) return null
          throw new Error(error?.message ?? 'No data')
        }
        return new Uint8Array(await data.arrayBuffer())
      },
      remove: async (path) => {
        const { error } = await db.storage.from(BUCKET).remove([path])
        if (error) throw new Error(error.message)
      },
    },
  )

  return json(totals)
})
