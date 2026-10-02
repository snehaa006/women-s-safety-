import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/features/auth/forms/field-error'

import type { ContactInput } from './api'
import { contactSchema } from './contact-schema'

type FormInput = z.input<typeof contactSchema>

export function ContactForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ContactInput>
  submitLabel: string
  onSubmit: (values: ContactInput) => Promise<void>
  onCancel?: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const form = useForm<FormInput, unknown, ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: initial?.name ?? '',
      phone: initial?.phone ?? '',
      email: initial?.email ?? '',
      relationship: initial?.relationship ?? '',
    },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: ContactInput) {
    setError(null)
    try {
      await onSubmit(values)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit(submit)} noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="contact-name">Name</Label>
        <Input
          id="contact-name"
          autoComplete="off"
          aria-invalid={!!errors.name}
          aria-describedby="contact-name-error"
          {...form.register('name')}
        />
        <FieldError id="contact-name-error" message={errors.name?.message} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="contact-phone">Phone</Label>
          <Input
            id="contact-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+91 98765 43210"
            aria-invalid={!!errors.phone}
            aria-describedby="contact-phone-error"
            {...form.register('phone')}
          />
          <FieldError id="contact-phone-error" message={errors.phone?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contact-email">Email</Label>
          <Input
            id="contact-email"
            type="email"
            autoComplete="off"
            aria-invalid={!!errors.email}
            aria-describedby="contact-email-error"
            {...form.register('email')}
          />
          <FieldError id="contact-email-error" message={errors.email?.message} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="contact-relationship">Relationship (optional)</Label>
        <Input
          id="contact-relationship"
          placeholder="Sister, friend, roommate…"
          aria-invalid={!!errors.relationship}
          aria-describedby="contact-relationship-error"
          {...form.register('relationship')}
        />
        <FieldError id="contact-relationship-error" message={errors.relationship?.message} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}
