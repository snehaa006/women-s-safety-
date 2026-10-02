import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, KeyRound, Watch } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-context'
import { FieldError } from '@/features/auth/forms/field-error'
import { fetchMyProfile, profileKeys, updateMyProfile } from '@/features/profile/api'
import { fetchPinStatus, setPins, sosKeys, type PinStatus } from '@/features/sos/api'
import { paths } from '@/lib/paths'

export function Component() {
  const auth = useAuth()
  const userId = auth.status === 'signed-in' ? auth.profile.id : null

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />
      {userId ? <ProfileCard userId={userId} /> : null}
      <PinCard />
      <Card className="gap-0 py-0">
        <Link
          to={paths.app.devices}
          className="hover:bg-accent flex items-center gap-3 rounded-xl px-6 py-4"
        >
          <Watch className="text-primary size-5" aria-hidden />
          <span className="grid flex-1">
            <span className="font-semibold">Wearables</span>
            <span className="text-muted-foreground text-sm">
              Pair a keychain, or try the virtual wearable.
            </span>
          </span>
          <ChevronRight className="text-muted-foreground size-4" aria-hidden />
        </Link>
      </Card>
    </div>
  )
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(80),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\+?[0-9][0-9 ()-]{5,19}$/.test(v), 'Enter a valid phone number.'),
})
type ProfileValues = z.infer<typeof profileSchema>

function ProfileCard({ userId }: { userId: string }) {
  const profile = useQuery({
    queryKey: profileKeys.mine(userId),
    queryFn: () => fetchMyProfile(userId),
  })
  if (!profile.data) return null
  return (
    <ProfileForm
      userId={userId}
      initial={{ fullName: profile.data.full_name ?? '', phone: profile.data.phone ?? '' }}
    />
  )
}

function ProfileForm({ userId, initial }: { userId: string; initial: ProfileValues }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: initial,
  })
  const { errors, isSubmitting } = form.formState

  async function save(values: ProfileValues) {
    setStatus(null)
    try {
      await updateMyProfile(userId, { full_name: values.fullName, phone: values.phone || null })
      await queryClient.invalidateQueries({ queryKey: profileKeys.mine(userId) })
      setStatus({ ok: true, text: 'Saved.' })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>About you</CardTitle>
        <CardDescription>
          Your first name and phone number appear on the live link your contacts open, so they can
          call you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit(save)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="full-name">Name</Label>
              <Input
                id="full-name"
                autoComplete="name"
                aria-invalid={!!errors.fullName}
                aria-describedby="full-name-error"
                {...form.register('fullName')}
              />
              <FieldError id="full-name-error" message={errors.fullName?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                aria-invalid={!!errors.phone}
                aria-describedby="phone-error"
                {...form.register('phone')}
              />
              <FieldError id="phone-error" message={errors.phone?.message} />
            </div>
          </div>
          {status ? (
            <p
              className={
                status.ok
                  ? 'text-sm text-emerald-700 dark:text-emerald-400'
                  : 'text-destructive text-sm'
              }
            >
              {status.text}
            </p>
          ) : null}
          <Button type="submit" className="justify-self-start" disabled={isSubmitting}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

const pin = z.string().regex(/^\d{4,6}$/, 'Use 4 to 6 digits.')

function pinSchema(hasPin: boolean) {
  return z
    .object({
      currentPin: hasPin ? pin : z.string(),
      sosPin: pin,
      confirmPin: z.string(),
      duressPin: z.union([z.literal(''), pin]),
    })
    .refine((v) => v.sosPin === v.confirmPin, {
      message: "The PINs don't match.",
      path: ['confirmPin'],
    })
    .refine((v) => v.duressPin === '' || v.duressPin !== v.sosPin, {
      message: 'The duress PIN must be different from your SOS PIN.',
      path: ['duressPin'],
    })
}
type PinValues = z.infer<ReturnType<typeof pinSchema>>

function PinCard() {
  const status = useQuery({ queryKey: sosKeys.pins, queryFn: fetchPinStatus })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="text-primary size-5" aria-hidden />
          SOS PIN
        </CardTitle>
        <CardDescription>
          Only you can end an SOS: "I'm safe" asks for this PIN. If someone forces you to cancel,
          enter your <strong>duress PIN</strong> instead. Your screen shows the SOS as ended, but it
          stays active for your circle.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status.data ? (
          <PinForm status={status.data} />
        ) : status.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{status.error.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PinForm({ status }: { status: PinStatus }) {
  const queryClient = useQueryClient()
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const form = useForm<PinValues>({
    resolver: zodResolver(pinSchema(status.has_pin)),
    defaultValues: { currentPin: '', sosPin: '', confirmPin: '', duressPin: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function save(values: PinValues) {
    setResult(null)
    try {
      const response = await setPins(
        values.sosPin,
        values.duressPin || null,
        status.has_pin ? values.currentPin : null,
      )
      if (response.status === 'saved') {
        form.reset()
        await queryClient.invalidateQueries({ queryKey: sosKeys.pins })
        setResult({ ok: true, text: 'Your PINs are saved.' })
      } else {
        setResult({
          ok: false,
          text:
            response.status === 'locked'
              ? 'Too many wrong PINs. Try again in 10 minutes.'
              : 'Your current PIN is wrong.',
        })
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  const field = (name: keyof PinValues, label: string, hint?: string) => (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        aria-invalid={!!errors[name]}
        aria-describedby={`${name}-error`}
        className="font-mono tracking-widest"
        {...form.register(name)}
      />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      <FieldError id={`${name}-error`} message={errors[name]?.message} />
    </div>
  )

  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit(save)} noValidate>
      <p className="text-sm">
        {status.has_pin
          ? `SOS PIN is set${status.has_duress_pin ? ', and so is a duress PIN' : ''}.`
          : 'No PIN yet: anyone holding your phone can end your SOS.'}
      </p>
      {status.has_pin ? field('currentPin', 'Current SOS PIN') : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('sosPin', status.has_pin ? 'New SOS PIN' : 'SOS PIN')}
        {field('confirmPin', 'Repeat the SOS PIN')}
      </div>
      {field(
        'duressPin',
        'Duress PIN (optional)',
        status.has_pin
          ? 'Leave empty to remove your duress PIN.'
          : 'A second PIN that only looks like it cancels.',
      )}
      {result ? (
        <p
          className={
            result.ok
              ? 'text-sm text-emerald-700 dark:text-emerald-400'
              : 'text-destructive text-sm'
          }
        >
          {result.text}
        </p>
      ) : null}
      <Button type="submit" className="justify-self-start" disabled={isSubmitting}>
        {status.has_pin ? 'Change PINs' : 'Save PINs'}
      </Button>
    </form>
  )
}
