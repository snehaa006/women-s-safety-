import { z } from 'zod'

const optional = (schema: z.ZodType<string, string>) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(schema.nullable())

export const contactSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(80, 'Use 80 characters or fewer.'),
    phone: optional(
      z.string().regex(/^\+?[0-9][0-9 ()-]{5,19}$/, 'Enter a phone number, e.g. +91 98765 43210.'),
    ),
    email: optional(z.email('Enter a valid email address.')),
    relationship: optional(z.string().max(40, 'Use 40 characters or fewer.')),
  })
  .refine((v) => v.phone !== null || v.email !== null, {
    message: 'Add a phone number or an email, so they can be reached.',
    path: ['phone'],
  })
