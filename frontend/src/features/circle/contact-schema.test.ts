import { describe, expect, it } from 'vitest'

import { contactSchema } from './contact-schema'

describe('contact form rules', () => {
  it('needs a phone number or an email', () => {
    const result = contactSchema.safeParse({ name: 'Asha', phone: '', email: '', relationship: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toMatch(/phone number or an email/)
  })

  it('turns empty optional fields into null', () => {
    const result = contactSchema.parse({
      name: ' Asha ',
      phone: '+91 98000 00002',
      email: '',
      relationship: '',
    })
    expect(result).toEqual({
      name: 'Asha',
      phone: '+91 98000 00002',
      email: null,
      relationship: null,
    })
  })

  it('rejects numbers the database would refuse', () => {
    expect(contactSchema.safeParse({ name: 'A', phone: 'call me', email: '' }).success).toBe(false)
  })
})
