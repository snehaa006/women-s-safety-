import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { admin, citizen, createFakeAuthClient, officer } from '@/test/fake-auth-client'
import { renderRoute } from '@/test/render-route'

vi.mock('@/features/sos/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/sos/api')>()),
  viewLiveLink: vi.fn(async () => null),
}))

describe('route guards', () => {
  it('sends signed-out visitors to sign-in and remembers where they were going', async () => {
    const { router } = renderRoute('/app/vault', createFakeAuthClient())
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?next=%2Fapp%2Fvault')
  })

  it('shows the citizen home to a citizen', async () => {
    renderRoute('/app', createFakeAuthClient(citizen))
    expect(await screen.findByRole('heading', { name: 'Hi Priya' })).toBeInTheDocument()
  })

  it('blocks citizens from the authority console', async () => {
    renderRoute('/console', createFakeAuthClient(citizen))
    expect(await screen.findByText(/This area is for authority staff/)).toBeInTheDocument()
  })

  it('shows the live board to an officer', async () => {
    renderRoute('/console', createFakeAuthClient(officer))
    expect(await screen.findByRole('heading', { name: 'Live board' })).toBeInTheDocument()
  })

  it('keeps admin screens for admins only', async () => {
    renderRoute('/console/admin/stations', createFakeAuthClient(officer))
    expect(await screen.findByText(/You can't open this page/)).toBeInTheDocument()
  })

  it('lets an admin open admin screens', async () => {
    renderRoute('/console/admin/stations', createFakeAuthClient(admin))
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument()
    expect(screen.getByText('stations')).toBeInTheDocument()
  })
})

describe('dynamic routes', () => {
  it('passes route params to the screen', async () => {
    renderRoute('/console/cases/CASE-2026-001/evidence/EV-17', createFakeAuthClient(officer))
    expect(await screen.findByRole('heading', { name: 'Evidence item' })).toBeInTheDocument()
    expect(screen.getByText('CASE-2026-001')).toBeInTheDocument()
    expect(screen.getByText('EV-17')).toBeInTheDocument()
  })

  it('serves the trusted-contact live link without signing in', async () => {
    const { router } = renderRoute('/t/abc123', createFakeAuthClient())
    expect(
      await screen.findByRole('heading', { name: 'This link has expired' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/t/abc123')
  })

  it('shows a not-found page for unknown paths', async () => {
    renderRoute('/nowhere', createFakeAuthClient())
    expect(await screen.findByText("This page doesn't exist")).toBeInTheDocument()
  })
})

describe('sign-in', () => {
  it('validates the form before calling the auth client', async () => {
    const client = createFakeAuthClient()
    renderRoute('/login', client)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(client.signIn).not.toHaveBeenCalled()
  })

  it('signs in and continues to the page the user asked for', async () => {
    const client = createFakeAuthClient()
    client.signIn.mockImplementation(async () => client.becomeSignedIn(officer))
    const { router } = renderRoute('/login?next=%2Fconsole%2Fmap', client)

    await userEvent.type(await screen.findByLabelText('Email'), 'ravi@example.org')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(client.signIn).toHaveBeenCalledWith('ravi@example.org', 'correct horse')
    await waitFor(() => expect(router.state.location.pathname).toBe('/console/map'))
  })

  it('shows the error from a failed sign-in', async () => {
    const client = createFakeAuthClient()
    client.signIn.mockRejectedValue(new Error('Invalid login credentials'))
    renderRoute('/login', client)

    await userEvent.type(await screen.findByLabelText('Email'), 'priya@example.org')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
  })
})
