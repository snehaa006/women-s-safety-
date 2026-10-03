import { describe, expect, it } from 'vitest'

import type { BoardIncident } from './api'
import {
  describeConsoleEntry,
  escalationLabel,
  formatDuration,
  isUrgent,
  summarize,
  waitingFor,
} from './board'

const row = (over: Partial<BoardIncident>) =>
  ({
    id: 'i',
    started_at: '2026-10-03T12:00:00Z',
    escalation_level: 0,
    acknowledged_at: null,
    ...over,
  }) as BoardIncident

describe('board helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(42)).toBe('42 s')
    expect(formatDuration(185)).toBe('3 min')
    expect(formatDuration(3900)).toBe('1 h 5 min')
    expect(waitingFor(row({}), Date.parse('2026-10-03T12:02:00Z'))).toBe(120)
  })

  it('flags escalated, unacknowledged incidents as urgent', () => {
    expect(isUrgent(row({}))).toBe(false)
    expect(isUrgent(row({ escalation_level: 2 }))).toBe(true)
    expect(isUrgent(row({ escalation_level: 2, acknowledged_at: '2026-10-03T12:05:00Z' }))).toBe(
      false,
    )
    expect(escalationLabel(0)).toBeNull()
    expect(escalationLabel(2)).toBe('Raised to control room')
    expect(escalationLabel(4)).toBe('Escalated 4×')
  })

  it('summarizes the board', () => {
    expect(
      summarize([
        row({ escalation_level: 2 }),
        row({ acknowledged_at: '2026-10-03T12:01:00Z' }),
        row({}),
      ]),
    ).toEqual({ total: 3, unacknowledged: 2, urgent: 1 })
  })

  it('labels the timeline in staff terms', () => {
    const entry = (action: string, payload: Record<string, unknown>) => ({
      seq: 1,
      occurred_at: '2026-10-03T12:00:00Z',
      action,
      actor_role: 'officer',
      payload,
    })
    expect(describeConsoleEntry(entry('incident.acknowledged', { after_s: 95 }))).toBe(
      'Acknowledged after 1 min',
    )
    expect(
      describeConsoleEntry(
        entry('incident.closed', { code: 'assisted_on_scene', note: 'Escorted home' }),
      ),
    ).toBe('Closed: assisted on scene — Escorted home')
    expect(
      describeConsoleEntry(entry('incident.dispatched', { unit: 'CP-PCR-1', eta_min: 6 })),
    ).toBe('CP-PCR-1 sent, ETA 6 min')
  })
})
