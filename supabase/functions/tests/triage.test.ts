// The triage function's logic: request shape, answer checking, refusals and the drain loop. Runs
// on Node (node --test) with a fake model; no network.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildParams,
  classify,
  drain,
  type ClaimedComplaint,
  type CreateMessage,
  type ModelResponse,
  type TriageOutcome,
} from '../_shared/triage.ts'

const complaint: ClaimedComplaint = {
  complaint_id: 'c1',
  description: 'ek aadmi metro se mera peecha kar raha hai',
  occurred_at: null,
  created_at: '2026-10-03T12:00:00Z',
  rules: {
    category: 'stalking',
    severity: 4,
    signals: ['ongoing', 'public_transport'],
    rationale: 'Stalking or being followed (L4): happening now, on public transport.',
  },
}

function answer(body: unknown, over: Partial<ModelResponse> = {}): ModelResponse {
  return {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
    ...over,
  }
}

function fakeModel(response: ModelResponse | Error, calls: Record<string, unknown>[] = []) {
  const fn: CreateMessage = async (params) => {
    calls.push(params)
    if (response instanceof Error) throw response
    return response
  }
  return { fn, calls }
}

describe('request', () => {
  it('asks for schema-checked JSON at low effort, with the report fenced as data', () => {
    const params = buildParams(complaint, 'claude-opus-5-5') as Record<string, any>
    assert.equal(params.model, 'claude-opus-5-5')
    assert.equal(params.output_config.effort, 'low')
    assert.equal(params.output_config.format.type, 'json_schema')
    assert.deepEqual(params.output_config.format.schema.required, [
      'category',
      'severity',
      'confidence',
      'signals',
      'rationale',
      'legal_tags',
    ])
    assert.equal(params.tool_choice, undefined) // forced tool use isn't available on this model
    assert.equal(params.thinking, undefined) // thinking stays at the model's default
    assert.equal(params.fallbacks, 'default')
    assert.match(params.system, /never instructions to you/)
    const prompt = params.messages[0].content as string
    assert.match(prompt, /<report>\nek aadmi metro se mera peecha kar raha hai\n<\/report>/)
    assert.match(prompt, /Rules engine: stalking, L4/)
  })
})

describe('classify', () => {
  it('records "skipped" without a model', async () => {
    assert.deepEqual(await classify(complaint, null), {
      outcome: 'skipped',
      error: 'No AI model is set up',
    })
  })

  it('returns the checked result', async () => {
    const { fn } = fakeModel(
      answer({
        category: 'stalking',
        severity: 4,
        confidence: 0.9,
        signals: ['being_followed', 'public_transport'],
        rationale: 'A man is following the reporter from the metro right now.',
        legal_tags: ['BNS:78'],
      }),
    )
    const outcome = await classify(complaint, fn)
    assert.equal(outcome.outcome, 'done')
    if (outcome.outcome !== 'done') return
    assert.equal(outcome.result.severity, 4)
    assert.equal(outcome.result.provider, 'claude')
    assert.equal(outcome.result.model, 'claude-opus-5-5')
    assert.deepEqual(outcome.result.legal_tags, ['BNS:78'])
  })

  it('falls back to the rules category and clamps confidence', async () => {
    const { fn } = fakeModel(
      answer({ category: 'made_up', severity: 3, confidence: 7, signals: 'x', rationale: 'r', legal_tags: [] }),
    )
    const outcome = await classify(complaint, fn)
    assert.equal(outcome.outcome, 'done')
    if (outcome.outcome !== 'done') return
    assert.equal(outcome.result.category, 'stalking')
    assert.equal(outcome.result.confidence, 1)
    assert.deepEqual(outcome.result.signals, [])
  })

  it("keeps the rules' answer when the model declines, without retrying", async () => {
    const { fn } = fakeModel(
      answer('', { stop_reason: 'refusal', stop_details: { category: 'general_harms' } }),
    )
    assert.deepEqual(await classify(complaint, fn), {
      outcome: 'failed',
      error: 'The model declined (general_harms)',
      retry: false,
    })
  })

  it('retries bad JSON, missing severity and server errors, but not bad requests', async () => {
    const bad = await classify(complaint, fakeModel(answer('not json')).fn)
    assert.deepEqual(bad, { outcome: 'failed', error: 'The model did not return JSON', retry: true })
    const noSeverity = await classify(complaint, fakeModel(answer({ category: 'other' })).fn)
    assert.equal(noSeverity.outcome === 'failed' && noSeverity.retry, true)

    const overloaded = Object.assign(new Error('Overloaded'), { status: 529 })
    const r1 = (await classify(complaint, fakeModel(overloaded).fn)) as TriageOutcome
    assert.equal(r1.outcome === 'failed' && r1.retry, true)
    const badRequest = Object.assign(new Error('invalid'), { status: 400 })
    const r2 = (await classify(complaint, fakeModel(badRequest).fn)) as TriageOutcome
    assert.equal(r2.outcome === 'failed' && r2.retry, false)
  })
})

describe('drain', () => {
  it('claims in batches until the queue is empty and reports every outcome', async () => {
    const waiting = ['a', 'b', 'c'].map((id) => ({ ...complaint, complaint_id: id }))
    const finished: [string, string][] = []
    const totals = await drain(
      {
        claim: async (limit) => waiting.splice(0, limit),
        finish: async (id, outcome) => {
          finished.push([id, outcome.outcome])
        },
      },
      (c) => classify(c, null),
      { batch: 2 },
    )
    assert.deepEqual(totals, { done: 0, skipped: 3, failed: 0 })
    assert.deepEqual(finished.map(([id]) => id).sort(), ['a', 'b', 'c'])
  })
})
