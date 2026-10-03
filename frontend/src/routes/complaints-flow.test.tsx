import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createComplaint,
  fetchComplaintTimeline,
  fetchConsoleComplaint,
  fetchMyComplaint,
  fetchQueue,
  fetchReviews,
  reviewOverride,
  setComplaintSeverity,
  shareIdentity,
  triagePreview,
  type ConsoleComplaint,
  type QueueComplaint,
} from '@/features/complaints/api'
import { fetchMemberships } from '@/features/console/api'
import { admin, citizen, createFakeAuthClient, officer } from '@/test/fake-auth-client'
import { renderRoute } from '@/test/render-route'

vi.mock('@/features/complaints/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/complaints/api')>()),
  triagePreview: vi.fn(),
  createComplaint: vi.fn(),
  listMyComplaints: vi.fn(async () => []),
  fetchMyComplaint: vi.fn(),
  fetchComplaintTimeline: vi.fn(async () => []),
  shareIdentity: vi.fn(async () => {}),
  fetchQueue: vi.fn(),
  fetchConsoleComplaint: vi.fn(),
  acknowledgeComplaint: vi.fn(async () => {}),
  setComplaintStatus: vi.fn(async () => {}),
  setComplaintSeverity: vi.fn(async () => ({ severity: 2, review: true })),
  fetchReviews: vi.fn(),
  reviewOverride: vi.fn(async () => {}),
  loadDemoComplaints: vi.fn(async () => 4),
}))
vi.mock('@/features/console/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/console/api')>()),
  fetchMemberships: vi.fn(),
  fetchBoard: vi.fn(async () => []),
}))

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

const queueRow = (over: Partial<QueueComplaint> = {}): QueueComplaint => ({
  id: 'c1',
  reference: 'C-2026-000042',
  status: 'submitted',
  category: 'stalking',
  category_label: 'Stalking or being followed',
  severity: 4,
  baseline_severity: 4,
  triage_state: 'skipped',
  excerpt: 'ek aadmi metro se mera peecha kar raha hai',
  input_mode: 'voice',
  created_at: inMinutes(-2),
  occurred_at: null,
  sla_due_at: inMinutes(8),
  acknowledged_at: null,
  escalation_level: 0,
  org_id: 'org-cp',
  org_name: 'Connaught Place Police Station',
  reporter: { confidential: true, alias: 'Reporter 7F3K', name: null, phone: null },
  is_demo: false,
  pending_review: false,
  ...over,
})

const workbench = (over: Partial<ConsoleComplaint> = {}): ConsoleComplaint => ({
  ...queueRow(),
  description: 'ek aadmi metro se mera peecha kar raha hai',
  location: { lat: 28.6315, lng: 77.2167, accuracy_m: 10 },
  incident_id: null,
  rules: {
    category: 'stalking',
    category_label: 'Stalking or being followed',
    severity: 4,
    signals: ['ongoing', 'public_transport'],
    language: 'hinglish',
    rationale: 'Stalking or being followed (L4): happening now, on public transport.',
  },
  ai: null,
  resolved_at: null,
  outcome_note: null,
  acknowledged_by: null,
  overrides: [],
  timeline: [
    {
      seq: 1,
      occurred_at: inMinutes(-2),
      action: 'complaint.filed',
      actor_role: 'citizen',
      payload: { category: 'stalking', severity: 4 },
    },
  ],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchMemberships).mockResolvedValue([
    {
      org_id: 'org-cp',
      org_name: 'Connaught Place Police Station',
      role: 'officer',
      on_duty: true,
    },
  ])
})

describe('report screen', () => {
  it('previews the rules answer and files the report', async () => {
    vi.mocked(triagePreview).mockResolvedValue({
      category: 'stalking',
      category_label: 'Stalking or being followed',
      severity: 4,
      signals: ['ongoing', 'public_transport'],
      language: 'hinglish',
      rationale: 'Stalking or being followed (L4): happening now, on public transport.',
    })
    vi.mocked(createComplaint).mockResolvedValue({
      complaint_id: 'c1',
      reference: 'C-2026-000042',
      created: true,
      category: 'stalking',
      severity: 4,
      rationale: 'Stalking or being followed (L4): happening now, on public transport.',
      org_name: 'Connaught Place Police Station',
    })
    renderRoute('/app/report', createFakeAuthClient(citizen))

    await userEvent.type(
      await screen.findByLabelText('What happened?'),
      'ek aadmi metro se mera peecha kar raha hai',
    )
    expect(
      await screen.findByText(
        /Likely: Stalking or being followed · happening now, public transport/,
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText(/Keep my name private/))
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByRole('heading', { name: 'Report sent' })).toBeInTheDocument()
    expect(screen.getByText('C-2026-000042')).toBeInTheDocument()
    expect(screen.getByText('L4 High')).toBeInTheDocument()
    expect(createComplaint).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'ek aadmi metro se mera peecha kar raha hai',
        inputMode: 'text',
        occurredAt: null,
        confidential: true,
      }),
    )
  })
})

describe('my reports', () => {
  it('shows the status and timeline, and lets a confidential reporter share their name', async () => {
    vi.mocked(fetchMyComplaint).mockResolvedValue({
      id: 'c1',
      reference: 'C-2026-000042',
      description: 'A man followed me from the metro.',
      status: 'acknowledged',
      category: 'stalking',
      severity: 4,
      confidential: true,
      identity_shared_at: null,
      created_at: inMinutes(-10),
      occurred_at: null,
      acknowledged_at: inMinutes(-5),
      resolved_at: null,
      outcome_note: null,
      triage_state: 'skipped',
      input_mode: 'text',
    })
    vi.mocked(fetchComplaintTimeline).mockResolvedValue([
      {
        seq: 1,
        occurred_at: inMinutes(-10),
        action: 'complaint.filed',
        payload: { category: 'stalking', severity: 4 },
      },
      { seq: 2, occurred_at: inMinutes(-5), action: 'complaint.acknowledged', payload: {} },
    ])
    renderRoute('/app/reports/c1', createFakeAuthClient(citizen))

    expect(await screen.findByText('Seen by an officer')).toBeInTheDocument()
    expect(await screen.findByText('An officer has seen your report')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Share my name with the police' }))
    expect(shareIdentity).toHaveBeenCalledWith('c1')
  })
})

describe('console complaints', () => {
  it('lists complaints with a countdown and hides confidential reporters', async () => {
    vi.mocked(fetchQueue).mockResolvedValue([
      queueRow(),
      queueRow({
        id: 'c2',
        reference: 'C-2026-000043',
        severity: 2,
        category_label: 'Verbal harassment',
        sla_due_at: inMinutes(-4),
        escalation_level: 1,
        reporter: { confidential: false, alias: 'Reporter 1A2B', name: 'Riya Sen', phone: null },
      }),
    ])
    renderRoute('/console/complaints', createFakeAuthClient(officer))

    const stalking = (await screen.findByText('Stalking or being followed')).closest('a')!
    expect(within(stalking).getByText('Confidential')).toBeInTheDocument()
    expect(within(stalking).getByLabelText(/Time to acknowledge: \d:\d\d left/)).toBeInTheDocument()
    const late = screen.getByText('Verbal harassment').closest('a')!
    expect(within(late).getByText(/overdue/)).toBeInTheDocument()
    expect(within(late).getByText('SLA missed')).toBeInTheDocument()
    expect(screen.getByText('2 open · 2 waiting for acknowledgement')).toBeInTheDocument()
  })

  it('blocks a downgrade below the baseline until it is justified', async () => {
    vi.mocked(fetchConsoleComplaint).mockResolvedValue(workbench())
    renderRoute('/console/complaints/c1', createFakeAuthClient(officer))

    expect(await screen.findByText('Reporter 7F3K')).toBeInTheDocument()
    expect(screen.queryByText(/Riya|Priya/)).not.toBeInTheDocument()
    expect(screen.getByText('AI review is not set up; the rules decided.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Change severity' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Past incident/ }))
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const why = 'Spoke to the reporter; she is home safe now.'
    await userEvent.type(within(dialog).getByLabelText(/Justification/), why)
    expect(save).toBeEnabled()
    await userEvent.click(save)
    await waitFor(() => expect(setComplaintSeverity).toHaveBeenCalledWith('c1', 2, why))
  })
})

describe('reviews', () => {
  it('upholds, or reverses with a note', async () => {
    vi.mocked(fetchMemberships).mockResolvedValue([])
    vi.mocked(fetchReviews).mockResolvedValue([
      {
        id: 'o1',
        complaint_id: 'c1',
        reference: 'C-2026-000042',
        category_label: 'Stalking or being followed',
        excerpt: 'A man is following me',
        from: 4,
        to: 2,
        baseline: 4,
        justification: 'Spoke to the reporter; she is home safe now.',
        officer: 'Ravi Kumar',
        org_name: 'Connaught Place Police Station',
        at: inMinutes(-30),
        week: '2026-09-28T00:00:00Z',
      },
    ])
    renderRoute('/console/reviews', createFakeAuthClient(admin))

    expect(await screen.findByText(/Spoke to the reporter/)).toBeInTheDocument()
    const reverse = screen.getByRole('button', { name: 'Reverse to L4' })
    expect(reverse).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Note/), 'Following is L4 by policy.')
    await userEvent.click(reverse)
    await waitFor(() =>
      expect(reviewOverride).toHaveBeenCalledWith('o1', 'reversed', 'Following is L4 by policy.'),
    )
  })
})
