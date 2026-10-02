import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useSearchParams } from 'react-router'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-context'
import { FieldError } from '@/features/auth/forms/field-error'
import { resolvePostLoginPath } from '@/lib/roles'

const schema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})
type Values = z.infer<typeof schema>

export function Component() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema) })
  const { errors, isSubmitting } = form.formState

  if (auth.status === 'signed-in') {
    return <Navigate to={resolvePostLoginPath(params.get('next'), auth.profile.role)} replace />
  }

  async function onSubmit(values: Values) {
    setError(null)
    try {
      await auth.client.signIn(values.email, values.password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    }
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <h1 className="text-2xl leading-none font-semibold">Sign in</h1>
        <CardDescription>Citizens and authority staff use the same sign-in.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          {!auth.client.configured ? (
            <Alert>
              <AlertDescription>
                Sign-in is not set up yet. Add the Supabase keys to frontend/.env.local.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
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
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby="password-error"
              {...form.register('password')}
            />
            <FieldError id="password-error" message={errors.password?.message} />
          </div>
          <Button type="submit" size="touch" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            New here?{' '}
            <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
