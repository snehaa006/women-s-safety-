import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestQueryClient } from '@/test/render-route'

import { createSos } from './api'
import { flushOutbox, resetOutbox, useOutbox } from './outbox'
import { COUNTDOWN_S, HOLD_MS, SosHoldButton } from './sos-button'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createSos: vi.fn(async () => ({ incident_id: 'inc-42', share_token: 'tok', created: true })),
}))

function renderButton() {
  const router = createMemoryRouter(
    [
      { path: '/app', element: <SosHoldButton /> },
      { path: '/app/sos/:incidentId', element: <p>SOS screen</p> },
    ],
    { initialEntries: ['/app'] },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

async function holdFor(ms: number) {
  const button = screen.getByRole('button', { name: /SOS. Press and hold/ })
  fireEvent.pointerDown(button, { button: 0, pointerId: 1 })
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  fireEvent.pointerUp(button, { pointerId: 1 })
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.mocked(createSos).mockClear()
  await resetOutbox()
})
afterEach(() => vi.useRealTimers())

describe('SOS button', () => {
  it('does nothing when released early', async () => {
    renderButton()
    await holdFor(HOLD_MS / 2)
    for (let s = 0; s < COUNTDOWN_S + 2; s++) await tick(1000)
    expect(screen.queryByText(/Sending SOS in/)).not.toBeInTheDocument()
    expect(createSos).not.toHaveBeenCalled()
  })

  it('counts down after a full hold, and can be cancelled', async () => {
    renderButton()
    await holdFor(HOLD_MS + 50)
    expect(screen.getByText(`Sending SOS in ${COUNTDOWN_S}…`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    for (let s = 0; s < COUNTDOWN_S + 2; s++) await tick(1000)
    expect(createSos).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /SOS. Press and hold/ })).toBeInTheDocument()
  })

  it('sends once the countdown ends and opens the live SOS screen', async () => {
    const router = renderButton()
    await holdFor(HOLD_MS + 50)
    for (let s = 0; s < COUNTDOWN_S; s++) await tick(1000)
    await tick(2000)

    expect(createSos).toHaveBeenCalledTimes(1)
    const [clientId] = vi.mocked(createSos).mock.calls[0]
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/)
    expect(router.state.location.pathname).toBe('/app/sos/inc-42')
  })

  it('can skip the countdown with "Send now"', async () => {
    const router = renderButton()
    await holdFor(HOLD_MS + 50)
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    await tick(2000)
    expect(createSos).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/app/sos/inc-42')
  })

  it('offers a retry with the same request id, and 112, when the server refuses', async () => {
    vi.mocked(createSos).mockRejectedValueOnce(new Error('Database unavailable'))
    const router = renderButton()
    await holdFor(HOLD_MS + 50)
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    await tick(2000)

    expect(screen.getByText('Database unavailable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Call 112/ })).toHaveAttribute('href', 'tel:112')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await tick(2000)
    const calls = vi.mocked(createSos).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toBe(calls[0][0])
    expect(router.state.location.pathname).toBe('/app/sos/inc-42')
  })

  it('queues the SOS when offline, offers the SMS fallback, and sends it once back online', async () => {
    localStorage.setItem('circle-phones', JSON.stringify(['+91 98000 00002']))
    vi.mocked(createSos).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    function Spy() {
      return <p data-testid="queued">{useOutbox().pending.length}</p>
    }
    const router = renderButton()
    render(<Spy />)
    await holdFor(HOLD_MS + 50)
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    await tick(2000)

    expect(screen.getByText('No connection. Your SOS is saved.')).toBeInTheDocument()
    const sms = screen.getByRole('link', { name: 'Text my circle (1)' })
    expect(sms.getAttribute('href')).toMatch(/^sms:\+919800000002\?&body=SOS/)
    expect(screen.getByTestId('queued')).toHaveTextContent('1')
    const [clientId] = vi.mocked(createSos).mock.calls[0]

    // Back online: the queue sends it with the same id and the time it was pressed.
    await act(async () => {
      await flushOutbox()
    })
    const last = vi.mocked(createSos).mock.calls.at(-1)!
    expect(last[0]).toBe(clientId)
    expect(last[3]).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(screen.getByTestId('queued')).toHaveTextContent('0')
    expect(router.state.location.pathname).toBe('/app/sos/inc-42')
  })
})
