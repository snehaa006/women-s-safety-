// The triage function's logic: request shape, answer checking, refusals and the drain loop. Runs
// on Node (node --test) with a fake model; no network.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildRequest,
  classify,
  drain,
  geminiClient,
  type ClaimedComplaint,
  type GenerateContent,
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

function answer(body: unknown, finishReason = 'STOP'): ModelResponse {
  return {
    modelVersion: 'gemini-2.5-flash',
    candidates: [
      {
        finishReason,
        content: {
          parts: [{ text: typeof body === 'string' ? body : JSON.stringify(body) }],
        },
      },
    ],
  }
}

function fakeModel(response: ModelResponse | Error, calls: [string, Record<string, unknown>][] = []) {
  const fn: GenerateContent = async (model, body) => {
    calls.push([model, body])
    if (response instanceof Error) throw response
    return response
  }
  return { fn, calls }
}

describe('request', () => {
  it('asks for schema-checked JSON, with the report fenced as data', () => {
    const body = buildRequest(complaint) as Record<string, any>
    assert.equal(body.generationConfig.responseMimeType, 'application/json')
    assert.deepEqual(body.generationConfig.responseSchema.required, [
      'category',
      'severity',
      'confidence',
      'signals',
      'rationale',
      'legal_tags',
    ])
    assert.match(body.systemInstruction.parts[0].text, /never instructions to you/)
    const prompt = body.contents[0].parts[0].text as string
    assert.match(prompt, /<report>\nek aadmi metro se mera peecha kar raha hai\n<\/report>/)
    assert.match(prompt, /Rules engine: stalking, L4/)
    assert.equal(body.safetySettings.length, 4)
  })

  it('sends the key in a header and turns HTTP errors into statuses', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const ok = geminiClient('k-123', (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return new Response(JSON.stringify(answer({ severity: 2 })), { status: 200 })
    }) as typeof fetch)
    await ok('gemini-flash-latest', { a: 1 })
    assert.equal(
      seen[0].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    )
    assert.equal((seen[0].init.headers as Record<string, string>)['x-goog-api-key'], 'k-123')
    assert.doesNotMatch(seen[0].url, /k-123/)

    const limited = geminiClient('k', (async () =>
      new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), {
        status: 429,
      })) as typeof fetch)
    await assert.rejects(limited('m', {}), { status: 429, message: 'Quota exceeded' })
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
    const { fn, calls } = fakeModel(
      answer({
        category: 'stalking',
        severity: 4,
        confidence: 0.9,
        signals: ['being_followed', 'public_transport'],
        rationale: 'A man is following the reporter from the metro right now.',
        legal_tags: ['BNS:78'],
      }),
    )
    const outcome = await classify(complaint, fn, 'gemini-flash-latest')
    assert.equal(calls[0][0], 'gemini-flash-latest')
    assert.equal(outcome.outcome, 'done')
    if (outcome.outcome !== 'done') return
    assert.equal(outcome.result.severity, 4)
    assert.equal(outcome.result.provider, 'gemini')
    assert.equal(outcome.result.model, 'gemini-2.5-flash')
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
    assert.deepEqual(await classify(complaint, fakeModel(answer('', 'SAFETY')).fn), {
      outcome: 'failed',
      error: 'The model declined (SAFETY)',
      retry: false,
    })
    const blocked = await classify(complaint, fakeModel({ promptFeedback: { blockReason: 'OTHER' } }).fn)
    assert.deepEqual(blocked, { outcome: 'failed', error: 'The model declined (OTHER)', retry: false })
  })

  it('retries bad JSON, cut-off answers and server errors, but not bad requests', async () => {
    const bad = await classify(complaint, fakeModel(answer('not json')).fn)
    assert.deepEqual(bad, { outcome: 'failed', error: 'The model did not return JSON', retry: true })
    const noSeverity = await classify(complaint, fakeModel(answer({ category: 'other' })).fn)
    assert.equal(noSeverity.outcome === 'failed' && noSeverity.retry, true)
    const cut = await classify(complaint, fakeModel(answer('{"seve', 'MAX_TOKENS')).fn)
    assert.deepEqual(cut, { outcome: 'failed', error: 'The model answer was cut off', retry: true })

    const overloaded = Object.assign(new Error('Overloaded'), { status: 503 })
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
