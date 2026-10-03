import { describe, expect, it } from 'vitest'

import { describeComplaintEntry, timeLeft } from './labels'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const entry = (action: string, payload: Record<string, unknown>) => ({
  seq: 1,
  occurred_at: '2026-10-03T12:00:00Z',
  action,
  payload,
})

describe('timeLeft', () => {
  it('counts down in m:ss under ten minutes, then minutes and hours', () => {
    expect(timeLeft('2026-10-03T12:02:41Z', NOW)).toEqual({
      seconds: 161,
      overdue: false,
      text: '2:41 left',
    })
    expect(timeLeft('2026-10-03T12:25:00Z', NOW).text).toBe('25 min left')
    expect(timeLeft('2026-10-03T15:05:00Z', NOW).text).toBe('3 h 5 min left')
    expect(timeLeft('2026-10-03T11:56:00Z', NOW)).toMatchObject({
      overdue: true,
      text: '4:00 overdue',
    })
  })
})

describe('timeline labels', () => {
  it('keeps internal details off the citizen timeline', () => {
    const override = entry('complaint.severity_overridden', {
      from: 4,
      to: 2,
      baseline: 4,
      justification: 'Spoke to her; she is home.',
    })
    expect(describeComplaintEntry(override)).toBe('Priority changed from L4 to L2')
    expect(describeComplaintEntry(override, true)).toMatch(/below the L4 baseline: "Spoke to her/)
    expect(describeComplaintEntry(entry('complaint.ai_skipped', { reason: 'No AI model' }))).toBe(
      'Scored by the rules',
    )
  })

  it('describes filing, AI review and escalation', () => {
    expect(
      describeComplaintEntry(entry('complaint.filed', { category: 'stalking', severity: 4 })),
    ).toBe('Report filed: Stalking or being followed, L4')
    expect(
      describeComplaintEntry(entry('complaint.ai_triaged', { raised: true, severity: 5 })),
    ).toBe('AI review raised it to L5')
    expect(
      describeComplaintEntry(
        entry('complaint.escalated', { to: 'parent', org_name: 'Control Room' }),
      ),
    ).toBe('Not acknowledged in time: raised to Control Room')
  })
})
