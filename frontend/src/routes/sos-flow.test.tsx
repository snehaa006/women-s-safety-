import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchAlerts,
  fetchIncident,
  fetchPinStatus,
  resolveIncident,
  respondToLiveLink,
  viewLiveLink,
  type Incident,
  type LiveView,
} from '@/features/sos/api'
import { citizen, createFakeAuthClient } from '@/test/fake-auth-client'
import { renderRoute } from '@/test/render-route'

vi.mock('@/features/sos/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/sos/api')>()),
  fetchIncident: vi.fn(),
  fetchAlerts: vi.fn(async () => ({ alerts: [], links: [] })),
  fetchSafePoints: vi.fn(async () => [
    {
      id: 'sp-1',
      name: 'Connaught Place Police Station',
      category: 'police',
      lat: 28.632,
      lng: 77.219,
      phone: '011 2341 2345',
      address: null,
      distance_m: 240,
    },
  ]),
  fetchPath: vi.fn(async () => []),
  fetchResponders: vi.fn(async () => []),
  fetchPoliceResponse: vi.fn(async () => ({
    org_name: 'Connaught Place Police Station',
    org_phone: '011 2334 0101',
    state: 'unacknowledged',
    acknowledged_at: null,
    unit: null,
    eta_at: null,
    arrived_at: null,
    raised_to_control_room: true,
  })),
  fetchPinStatus: vi.fn(),
  resolveIncident: vi.fn(),
  viewLiveLink: vi.fn(),
  respondToLiveLink: vi.fn(async () => {}),
}))
vi.mock('@/features/circle/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/circle/api')>()),
  listContacts: vi.fn(async () => [
    { id: 'c1', name: 'Asha', phone: '+91 98000 00002', email: null, priority: 1 },
  ]),
}))

const incident: Incident = {
  id: 'inc-1',
  citizen_id: citizen.id,
  source: 'simulator',
  device_id: 'dev-1',
  client_id: null,
  status: 'active',
  started_at: new Date(Date.now() - 60_000).toISOString(),
  closed_by_citizen_at: null,
  resolved_at: null,
  resolution: null,
  last_lat: 28.6315,
  last_lng: 77.2167,
  last_accuracy_m: 8,
  last_battery_pct: 81,
  last_location_at: new Date().toISOString(),
  ledger_batch_at: new Date().toISOString(),
  live_topic: 'topic-1',
  assigned_org_id: 'org-cp',
  routed_at: new Date().toISOString(),
  response_state: 'unacknowledged',
  escalation_level: 0,
  escalated_at: null,
  acknowledged_at: null,
  acknowledged_by: null,
  unit_id: null,
  dispatched_at: null,
  eta_at: null,
  arrived_at: null,
  close_code: null,
  close_note: null,
  closed_by: null,
  is_demo: false,
}

const liveView: LiveView = {
  citizen_name: 'Priya',
  contact_name: null,
  channel: 'live:topic-1',
  citizen_phone: '+91 98765 43210',
  status: 'active',
  closed_under_duress: false,
  source: 'app',
  started_at: new Date(Date.now() - 120_000).toISOString(),
  resolved_at: null,
  resolution: null,
  battery_pct: 64,
  last_location: { lat: 28.632, lng: 77.2175, accuracy_m: 9, at: new Date().toISOString() },
  path: [
    [77.2167, 28.6315],
    [77.2175, 28.632],
  ],
  responders: [],
  police: {
    org_name: 'Connaught Place Police Station',
    org_phone: '011 2334 0101',
    state: 'responding',
    acknowledged_at: new Date().toISOString(),
    unit: 'CP-PCR-1',
    eta_at: new Date(Date.now() + 6 * 60_000 + 20_000).toISOString(),
    arrived_at: null,
    raised_to_control_room: false,
  },
}

beforeEach(() => {
  vi.mocked(fetchIncident).mockResolvedValue({ incident, shareToken: 'tok-123' })
  vi.mocked(fetchPinStatus).mockResolvedValue({ has_pin: true, has_duress_pin: true })
  vi.mocked(resolveIncident).mockReset()
  vi.mocked(viewLiveLink).mockResolvedValue(liveView)
  vi.mocked(respondToLiveLink).mockClear()
})

describe('active SOS screen', () => {
  it('shows the SOS and ways to send the live link', async () => {
    renderRoute('/app/sos/inc-1', createFakeAuthClient(citizen))
    expect(await screen.findByRole('heading', { name: 'SOS active' })).toBeInTheDocument()
    expect(screen.getByText(/from the virtual wearable/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Call 112 now/ })).toHaveAttribute('href', 'tel:112')
    expect(await screen.findByText('Alerting the police')).toBeInTheDocument()
    expect(screen.getByText(/district control room was alerted too/)).toBeInTheDocument()

    const whatsapp = await screen.findByRole('link', { name: /WhatsApp/ })
    expect(decodeURIComponent(whatsapp.getAttribute('href')!)).toContain('/t/tok-123')
    const sms = await screen.findByRole('link', { name: /SMS circle \(1\)/ })
    expect(sms.getAttribute('href')).toMatch(/^sms:\+919800000002\?&body=/)
  })

  it('keeps the SOS active on a wrong PIN', async () => {
    vi.mocked(resolveIncident).mockResolvedValue({ status: 'wrong_pin', keep_sharing: false })
    renderRoute('/app/sos/inc-1', createFakeAuthClient(citizen))
    await userEvent.click(await screen.findByRole('button', { name: "I'm safe" }))
    await userEvent.type(await screen.findByLabelText('SOS PIN'), '0000')
    await userEvent.click(screen.getByRole('button', { name: 'End SOS' }))

    expect(await screen.findByText("That PIN isn't right. Try again.")).toBeInTheDocument()
    expect(resolveIncident).toHaveBeenCalledWith('inc-1', '0000', 'safe')
  })

  it('looks the same for the duress PIN as for the real one', async () => {
    vi.mocked(resolveIncident).mockResolvedValue({ status: 'resolved', keep_sharing: true })
    renderRoute('/app/sos/inc-1', createFakeAuthClient(citizen))
    await userEvent.click(await screen.findByRole('button', { name: "I'm safe" }))
    await userEvent.type(await screen.findByLabelText('SOS PIN'), '1470')
    await userEvent.click(screen.getByRole('button', { name: 'End SOS' }))

    expect(await screen.findByRole('heading', { name: "You're marked safe" })).toBeInTheDocument()
    expect(screen.queryByText(/duress/i)).not.toBeInTheDocument()
  })
})

describe('your circle on the SOS screen', () => {
  it('shows who was alerted, how, and who opened the link', async () => {
    vi.mocked(fetchAlerts).mockResolvedValue({
      alerts: [
        {
          id: 'a1',
          contact_id: 'c-asha',
          recipient_name: 'Asha',
          channel: 'email',
          template: 'sos',
          status: 'sent',
          sent_at: new Date().toISOString(),
          last_error: null,
        },
        {
          id: 'a2',
          contact_id: 'c-ravi',
          recipient_name: 'Ravi',
          channel: 'telegram',
          template: 'sos',
          status: 'skipped',
          sent_at: null,
          last_error: 'Telegram is not set up yet',
        },
      ],
      links: [
        {
          id: 'l1',
          contact_id: 'c-asha',
          recipient_name: 'Asha',
          first_viewed_at: new Date().toISOString(),
        },
      ],
    })
    renderRoute('/app/sos/inc-1', createFakeAuthClient(citizen))
    expect(await screen.findByText(/Opened your live link at/)).toBeInTheDocument()
    expect(screen.getByText('Telegram not sent: Telegram is not set up yet')).toBeInTheDocument()
  })

  it('shows the nearest police station', async () => {
    renderRoute('/app/sos/inc-1', createFakeAuthClient(citizen))
    expect(await screen.findByText('Connaught Place Police Station')).toBeInTheDocument()
    expect(screen.getByText('Police · 240 m')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Call Connaught Place Police Station' }),
    ).toHaveAttribute('href', 'tel:01123412345')
  })
})

describe('live link for trusted contacts', () => {
  it('greets a contact by name on their own link', async () => {
    vi.mocked(viewLiveLink).mockResolvedValue({ ...liveView, contact_name: 'Asha' })
    renderRoute('/t/tok-123', createFakeAuthClient())
    expect(await screen.findByLabelText('Your name')).toHaveValue('Asha')
  })

  it('shows who needs help, where, and how to reach them', async () => {
    renderRoute('/t/tok-123', createFakeAuthClient())
    expect(await screen.findByRole('heading', { name: 'Priya needs help' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Call Priya/ })).toHaveAttribute(
      'href',
      'tel:+919876543210',
    )
    expect(screen.getByText('64%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=28.632,77.2175',
    )
    expect(screen.getByText('Officer on the way')).toBeInTheDocument()
    expect(
      screen.getByText(
        'CP-PCR-1 from Connaught Place Police Station, arriving in about 6 minutes.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /duty desk/ })).toHaveAttribute(
      'href',
      'tel:01123340101',
    )
  })

  it('warns contacts when the SOS was cancelled with the duress PIN', async () => {
    vi.mocked(viewLiveLink).mockResolvedValue({ ...liveView, closed_under_duress: true })
    renderRoute('/t/tok-123', createFakeAuthClient())
    expect(await screen.findByText('Priya may not be safe')).toBeInTheDocument()
  })

  it('lets a contact say they are responding', async () => {
    renderRoute('/t/tok-123', createFakeAuthClient())
    await userEvent.type(await screen.findByLabelText('Your name'), 'Asha')
    await userEvent.click(screen.getByRole('button', { name: "I'm responding" }))
    await waitFor(() => expect(respondToLiveLink).toHaveBeenCalledWith('tok-123', 'Asha'))
    expect(await screen.findByText("Priya can see you're responding")).toBeInTheDocument()
  })

  it('shows the end of an SOS', async () => {
    vi.mocked(viewLiveLink).mockResolvedValue({
      ...liveView,
      status: 'resolved',
      resolution: 'safe',
      resolved_at: new Date().toISOString(),
    })
    renderRoute('/t/tok-123', createFakeAuthClient())
    expect(await screen.findByRole('heading', { name: 'Priya is safe' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "I'm responding" })).not.toBeInTheDocument()
  })
})
