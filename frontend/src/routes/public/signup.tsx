import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate } from 'react-router'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-context'
import { FieldError } from '@/features/auth/forms/field-error'
import { homePathForRole } from '@/lib/roles'

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.'),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
})
type Values = z.infer<typeof schema>

export function Component() {
  const auth = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema) })
  const { errors, isSubmitting } = form.formState

  if (auth.status === 'signed-in') {
    return <Navigate to={homePathForRole(auth.profile.role)} replace />
  }

  async function onSubmit(values: Values) {
    setError(null)
    try {
      const { needsConfirmation } = await auth.client.signUp(
        values.fullName,
        values.email,
        values.password,
      )
      if (needsConfirmation) setSentTo(values.email)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-up failed.')
    }
  }

  if (sentTo) {
    return (
      <Card className="mx-auto w-full max-w-sm text-center">
        <CardContent className="grid justify-items-center gap-3">
          <MailCheck className="text-primary size-8" aria-hidden />
          <h1 className="text-xl font-bold">Check your email</h1>
          <p className="text-muted-foreground">
            We sent a confirmation link to <strong>{sentTo}</strong>. Open it, then sign in.
          </p>
          <Button asChild variant="outline">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <h1 className="text-2xl leading-none font-semibold">Create an account</h1>
        <CardDescription>
          For citizens. Staff accounts come from your administrator.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="fullName">Your name</Label>
            <Input
              id="fullName"
              autoComplete="name"
              aria-invalid={!!errors.fullName}
              aria-describedby="fullName-error"
              {...form.register('fullName')}
            />
            <FieldError id="fullName-error" message={errors.fullName?.message} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby="email-error"
              {...form.register('email')}
            />
            <FieldError id="email-error" message={errors.email?.message} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby="password-error"
              {...form.register('password')}
            />
            <FieldError id="password-error" message={errors.password?.message} />
          </div>
          <Button type="submit" size="touch" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            Already registered?{' '}
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
