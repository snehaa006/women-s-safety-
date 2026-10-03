import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acknowledgeIncident,
  closeIncident,
  dispatchUnit,
  fetchBoard,
  fetchConsoleIncident,
  fetchMemberships,
  fetchPolicies,
  loadDemoIncidents,
  saveEscalationPolicy,
  setOnDuty,
  type BoardIncident,
  type ConsoleIncident,
} from '@/features/console/api'
import { admin, createFakeAuthClient, officer } from '@/test/fake-auth-client'
import { renderRoute } from '@/test/render-route'

vi.mock('@/features/console/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/console/api')>()),
  fetchBoard: vi.fn(),
  fetchConsoleIncident: vi.fn(),
  fetchMemberships: vi.fn(),
  fetchPolicies: vi.fn(),
  acknowledgeIncident: vi.fn(async () => {}),
  dispatchUnit: vi.fn(async () => {}),
  markOnScene: vi.fn(async () => {}),
  closeIncident: vi.fn(async () => {}),
  setOnDuty: vi.fn(async () => {}),
  loadDemoIncidents: vi.fn(async () => 3),
  saveEscalationPolicy: vi.fn(async () => {}),
}))

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const row = (over: Partial<BoardIncident>): BoardIncident => ({
  id: 'inc-1',
  status: 'active',
  source: 'app',
  is_demo: false,
  started_at: minutesAgo(1),
  citizen_name: 'Ananya Verma',
  citizen_phone: '+91 98000 11111',
  battery_pct: 72,
  last_location: { lat: 28.6315, lng: 77.2167, accuracy_m: 10, at: minutesAgo(0) },
  org_id: 'org-cp',
  org_name: 'Connaught Place Police Station',
  response_state: 'unacknowledged',
  escalation_level: 0,
  escalated_at: null,
  acknowledged_at: null,
  acknowledged_by: null,
  unit: null,
  dispatched_at: null,
  eta_at: null,
  arrived_at: null,
  closed_under_duress: false,
  responders: 0,
  close_code: null,
  ...over,
})

const detail = (over: Partial<ConsoleIncident> = {}): ConsoleIncident => ({
  ...row({}),
  resolved_at: null,
  close_note: null,
  metrics: { ack_s: null, dispatch_s: null, arrival_s: null },
  path: [[77.2167, 28.6315]],
  responders: [],
  units: [
    {
      id: 'u-1',
      call_sign: 'CP-PCR-1',
      kind: 'pcr_van',
      status: 'available',
      org_name: 'Connaught Place Police Station',
      distance_m: 900,
    },
    {
      id: 'u-2',
      call_sign: 'CP-BIKE-2',
      kind: 'bike',
      status: 'dispatched',
      org_name: 'Connaught Place Police Station',
      distance_m: 300,
    },
  ],
  timeline: [
    {
      seq: 1,
      occurred_at: minutesAgo(1),
      action: 'sos.triggered',
      actor_role: 'citizen',
      payload: { source: 'app' },
    },
    {
      seq: 2,
      occurred_at: minutesAgo(1),
      action: 'incident.routed',
      actor_role: null,
      payload: { name: 'Connaught Place Police Station' },
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
  vi.mocked(fetchBoard).mockResolvedValue([
    row({ id: 'inc-2', citizen_name: 'Riya Sen', escalation_level: 2, started_at: minutesAgo(6) }),
    row({}),
  ])
  vi.mocked(fetchConsoleIncident).mockResolvedValue(detail())
})

describe('live board', () => {
  it('lists active incidents with escalated ones flagged', async () => {
    renderRoute('/console', createFakeAuthClient(officer))
    expect(await screen.findByRole('link', { name: 'Riya Sen' })).toBeInTheDocument()
    expect(screen.getByText('2 active · 2 not acknowledged')).toBeInTheDocument()
    expect(screen.getByText('1 escalated')).toBeInTheDocument()
    expect(screen.getByText('Raised to control room')).toBeInTheDocument()
    // Officers don't get the demo loader.
    expect(screen.queryByRole('button', { name: /Load demo incidents/ })).not.toBeInTheDocument()
  })

  it('acknowledges from the board', async () => {
    renderRoute('/console', createFakeAuthClient(officer))
    const item = (await screen.findByRole('link', { name: 'Ananya Verma' })).closest('li')!
    await userEvent.click(within(item).getByRole('button', { name: 'Acknowledge' }))
    expect(acknowledgeIncident).toHaveBeenCalledWith('inc-1')
  })

  it('lets admins load demo incidents', async () => {
    vi.mocked(fetchMemberships).mockResolvedValue([])
    renderRoute('/console', createFakeAuthClient(admin))
    await userEvent.click(await screen.findByRole('button', { name: /Load demo incidents/ }))
    expect(loadDemoIncidents).toHaveBeenCalled()
  })

  it('toggles duty from the header', async () => {
    renderRoute('/console', createFakeAuthClient(officer))
    const toggle = await screen.findByRole('switch', { name: /On duty/ })
    await userEvent.click(toggle)
    expect(setOnDuty).toHaveBeenCalledWith('org-cp', false)
  })
})

describe('incident command view', () => {
  it('shows the incident, its location and the timeline', async () => {
    renderRoute('/console/incidents/inc-1', createFakeAuthClient(officer))
    expect(await screen.findByRole('heading', { name: 'Ananya Verma' })).toBeInTheDocument()
    expect(screen.getByText('Sent to Connaught Place Police Station')).toBeInTheDocument()
    expect(screen.getByText('SOS raised from the app')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Call \+91 98000 11111/ })).toHaveAttribute(
      'href',
      'tel:+919800011111',
    )
  })

  it('dispatches an available unit with an ETA', async () => {
    renderRoute('/console/incidents/inc-1', createFakeAuthClient(officer))
    await userEvent.click(await screen.findByRole('button', { name: /Dispatch unit/ }))
    // Busy units aren't offered.
    expect(screen.queryByText('CP-BIKE-2')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /CP-PCR-1/ })).toBeChecked()
    expect(screen.getByText(/0.9 km away/)).toBeInTheDocument()
    const eta = screen.getByLabelText('Arrival in (minutes)')
    await userEvent.clear(eta)
    await userEvent.type(eta, '8')
    await userEvent.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(dispatchUnit).toHaveBeenCalledWith('inc-1', 'u-1', 8))
  })

  it('closes with a code and a note', async () => {
    renderRoute('/console/incidents/inc-1', createFakeAuthClient(officer))
    await userEvent.click(await screen.findByRole('button', { name: 'Close incident' }))
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: 'Close incident' })
    expect(submit).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Assisted on scene' }))
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Escorted home')
    await userEvent.click(submit)
    await waitFor(() =>
      expect(closeIncident).toHaveBeenCalledWith('inc-1', 'assisted_on_scene', 'Escorted home'),
    )
  })

  it('shows response times once the unit has arrived', async () => {
    vi.mocked(fetchConsoleIncident).mockResolvedValue(
      detail({
        response_state: 'on_scene',
        acknowledged_at: minutesAgo(1),
        acknowledged_by: 'Ravi Kumar',
        unit: { id: 'u-1', call_sign: 'CP-PCR-1' },
        arrived_at: minutesAgo(0),
        metrics: { ack_s: 40, dispatch_s: 75, arrival_s: 410 },
      }),
    )
    renderRoute('/console/incidents/inc-1', createFakeAuthClient(officer))
    expect(await screen.findByText('40 s')).toBeInTheDocument()
    expect(screen.getByText('6 min')).toBeInTheDocument()
    expect(screen.getByText(/by Ravi Kumar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark on scene' })).not.toBeInTheDocument()
  })
})

describe('escalation policy admin', () => {
  it('edits the ladder in minutes and saves it in seconds', async () => {
    vi.mocked(fetchPolicies).mockResolvedValue([
      {
        id: 'p-1',
        org_id: null,
        org_name: null,
        levels: [
          { after_s: 120, to: 'station' },
          { after_s: 300, to: 'parent' },
        ],
        repeat_s: 120,
        updated_at: new Date().toISOString(),
      },
    ])
    renderRoute('/console/admin/escalation', createFakeAuthClient(admin))
    expect(await screen.findByText('Default policy')).toBeInTheDocument()
    const first = screen.getByLabelText(/Level 1/)
    await userEvent.clear(first)
    await userEvent.type(first, '1.5')
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    await waitFor(() =>
      expect(saveEscalationPolicy).toHaveBeenCalledWith(
        null,
        [
          { after_s: 90, to: 'station' },
          { after_s: 300, to: 'parent' },
        ],
        120,
      ),
    )
  })
})
