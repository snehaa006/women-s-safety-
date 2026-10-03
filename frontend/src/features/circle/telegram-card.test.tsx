import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createTestQueryClient } from '@/test/render-route'

import type { Contact } from './api'
import { TelegramCard } from './telegram-card'

const contact: Contact = {
  id: 'c1',
  owner_id: 'u1',
  name: 'Asha',
  phone: '+91 98000 00002',
  email: null,
  relationship: null,
  priority: 1,
  created_at: '2026-10-03T10:00:00Z',
  updated_at: '2026-10-03T10:00:00Z',
  telegram_code: 'AbC_123-xyz456789012345',
  telegram_linked_at: null,
  telegram_username: null,
}

function renderCard(c: Contact, bot: string | null) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TelegramCard contact={c} bot={bot} />
    </QueryClientProvider>,
  )
}

describe('Telegram alerts card', () => {
  it('offers a one-time invite to the bot', () => {
    renderCard(contact, 'SafetyAlertsBot')
    const whatsapp = screen.getByRole('link', { name: /WhatsApp/ })
    expect(decodeURIComponent(whatsapp.getAttribute('href')!)).toContain(
      'https://t.me/SafetyAlertsBot?start=AbC_123-xyz456789012345',
    )
    expect(screen.getByRole('link', { name: /SMS/ }).getAttribute('href')).toMatch(
      /^sms:\+919800000002/,
    )
  })

  it('shows a connected contact and lets her disconnect', () => {
    renderCard(
      { ...contact, telegram_linked_at: '2026-10-03T10:05:00Z', telegram_username: 'asha_t' },
      'SafetyAlertsBot',
    )
    expect(screen.getByText(/Connected as @asha_t/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('says so when Telegram is not set up', () => {
    renderCard(contact, null)
    expect(screen.getByText(/aren't switched on for this app yet/)).toBeInTheDocument()
  })
})
